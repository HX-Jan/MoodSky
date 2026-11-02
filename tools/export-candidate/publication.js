// Internal candidate only. Never uploads/removes files or returns download credentials.
const { createHash } = require('node:crypto');
const { LIMITS } = require('../../cloudfunctions/moodsky/shared/constants');
const { notImplemented } = require('../../cloudfunctions/moodsky/shared/result');
const {
  database,
  identity,
  account,
  sourceState,
  fail,
} = require('../../cloudfunctions/moodsky/domains/storage-support');
const { exportStatus } = require('./access-policy');
const sameSource = (a, b) =>
  a.epoch === b.epoch &&
  Object.keys(a.revisions).every((key) => a.revisions[key] === b.revisions[key]);

function createExportPublication({
  db,
  readSourceState,
  inspectArtifact,
  maxBytes,
  now = () => new Date(),
} = {}) {
  return {
    async publish(ownerId, jobId, prepared, fileId) {
      identity(ownerId);
      identity(jobId);
      database(db);
      if (typeof readSourceState !== 'function' || typeof inspectArtifact !== 'function') {
        return notImplemented();
      }
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 ||
        !prepared ||
        prepared.jobId !== jobId ||
        !['json', 'markdown'].includes(prepared.format) ||
        !prepared.artifact ||
        typeof prepared.artifact.content !== 'string' ||
        typeof fileId !== 'string' ||
        !fileId.trim() ||
        fileId.length > 2048 ||
        /[\u0000-\u001f\u007f]/.test(fileId)
      ) {
        return fail();
      }
      // Capture all caller-owned material before awaiting storage inspection.
      const format = prepared.format;
      const expected = sourceState(
        {
          ownerId,
          status: 'active',
          epoch: prepared.accountEpoch,
          revisions: prepared.sourceRevisions,
        },
        ownerId,
      );
      const byteLength = Buffer.byteLength(prepared.artifact.content, 'utf8');
      const contentSha256 = createHash('sha256')
        .update(prepared.artifact.content, 'utf8')
        .digest('hex');
      const mimeType =
        format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8';
      if (
        byteLength < 1 ||
        byteLength > maxBytes ||
        byteLength !== prepared.artifact.byteLength ||
        mimeType !== prepared.artifact.mimeType ||
        prepared.artifact.extension !== (format === 'json' ? 'json' : 'md')
      ) {
        return fail();
      }
      const projection = () => ({ jobId, state: 'ready', format });
      const matches = (job) =>
        job.fileId === fileId &&
        job.contentSha256 === contentSha256 &&
        job.byteLength === byteLength &&
        job.mimeType === mimeType;
      async function checked(tx) {
        const accountDocument = tx.collection('accounts').doc(ownerId);
        const owner = account((await accountDocument.get()).data, ownerId, 'active');
        const source = sourceState(await readSourceState(ownerId, tx), ownerId);
        const jobDocument = tx.collection('export_jobs').doc(jobId);
        const job = (await jobDocument.get()).data;
        if (!job || job.ownerId !== ownerId || job._id !== jobId) {
          return fail('FORBIDDEN');
        }
        const original = sourceState(
          { ownerId, status: 'active', epoch: job.accountEpoch, revisions: job.sourceRevisions },
          ownerId,
        );
        const status = exportStatus({
          actorId: ownerId,
          account: { id: ownerId, status: owner.status, exportEpoch: owner.exportEpoch },
          job: { ...job, id: jobId },
          sourceRevisions: source.revisions,
          now: now(),
        });
        if (
          owner.exportEpoch !== source.epoch ||
          !sameSource(source, expected) ||
          !sameSource(original, expected) ||
          job.format !== format ||
          !['pending', 'ready'].includes(status.state)
        ) {
          return fail('CONFLICT');
        }
        if (status.state === 'ready') {
          if (!matches(job)) {
            return fail('CONFLICT');
          }
        } else {
          if (owner.operationFence === undefined) {
            return notImplemented();
          }
          if (
            !Number.isSafeInteger(owner.operationFence) ||
            owner.operationFence < 0 ||
            owner.operationFence === Number.MAX_SAFE_INTEGER
          ) {
            return fail('CONFLICT');
          }
        }
        return { owner, job, accountDocument, jobDocument, state: status.state };
      }
      const initial = await db.runTransaction(checked);
      if (initial.state === 'ready') {
        return projection();
      }
      // The adapter must inspect server-owned, PRIVATE IMMUTABLE storage metadata.
      // A client-supplied object, boolean or this function alone cannot prove those properties.
      const stored = await inspectArtifact({ ownerId, jobId, fileId });
      if (
        !stored ||
        stored.ownerId !== ownerId ||
        stored.jobId !== jobId ||
        stored.fileId !== fileId ||
        stored.private !== true ||
        stored.immutable !== true ||
        stored.sha256 !== contentSha256 ||
        stored.byteLength !== byteLength ||
        stored.mimeType !== mimeType
      ) {
        return fail('FORBIDDEN');
      }
      const instant = now();
      if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
        return fail();
      }
      const readyAt = instant.toISOString();
      const expiresAt = new Date(
        instant.getTime() + LIMITS.exportFileHours * 3600000,
      ).toISOString();
      return db.runTransaction(async (tx) => {
        const current = await checked(tx);
        if (current.state === 'ready') {
          return projection();
        }
        const time = now().getTime();
        if (!Number.isFinite(time) || time < instant.getTime() || time >= Date.parse(expiresAt)) {
          return fail('CONFLICT');
        }
        const fenced = await current.accountDocument.update({
          data: { operationFence: current.owner.operationFence + 1 },
        });
        if (fenced.stats?.updated !== 1) {
          return fail('CONFLICT');
        }
        const updated = await current.jobDocument.update({
          data: {
            state: 'ready',
            fileId,
            contentSha256,
            byteLength,
            mimeType,
            readyAt,
            expiresAt,
            updatedAt: readyAt,
          },
        });
        if (updated.stats?.updated !== 1) {
          return fail('CONFLICT');
        }
        return projection();
      });
    },
  };
}
module.exports = { createExportPublication };
