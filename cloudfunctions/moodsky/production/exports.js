// Private artifacts stay inside denied-client export_jobs documents. No public URLs.
const { createHash } = require('node:crypto');
const { AppError } = require('../shared/result');
const { LIMITS } = require('../shared/constants');
const { createExportService } = require('../domains/export');
const { createAccountDataSources } = require('../services/account-data');
const { createExportPreparation } = require('../../../tools/export-candidate/preparation');
const { exportStatus } = require('../../../tools/export-candidate/access-policy');
const MAX_BYTES = 512 * 1024;
const MAX_RECORDS = 2000;
const fail = (code = 'CONFLICT') => {
  throw new AppError(code, '导出尚未完成或已失效，请重新读取。');
};
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
function createProductionExports({ db, now = () => new Date() }) {
  const { readSourceState } = createAccountDataSources({ db });
  const jobs = createExportService({ db, readSourceState, maxRecords: MAX_RECORDS, now });
  const prepare = createExportPreparation({
    db,
    readSourceState,
    maxRecords: MAX_RECORDS,
    maxBytes: MAX_BYTES,
    now,
  });
  async function inspect(tx, ownerId, jobId, fence = false) {
    const accountRef = tx.collection('accounts').doc(ownerId);
    const owner = (await accountRef.get()).data;
    const ref = tx.collection('export_jobs').doc(jobId);
    const row = (await ref.get()).data;
    if (!row || row._id !== jobId || row.ownerId !== ownerId) {
      return fail('FORBIDDEN');
    }
    const source = await readSourceState(ownerId, tx);
    const status = exportStatus({
      actorId: ownerId,
      account: { id: ownerId, status: owner.status, exportEpoch: owner.exportEpoch },
      job: { ...row, id: jobId },
      sourceRevisions: source.revisions,
      now: now(),
    });
    if (fence) {
      if (
        !Number.isSafeInteger(owner.operationFence) ||
        owner.operationFence >= Number.MAX_SAFE_INTEGER
      ) {
        return fail();
      }
      const result = await accountRef.update({
        data: { operationFence: owner.operationFence + 1 },
      });
      if (result.stats?.updated !== 1) {
        return fail();
      }
    }
    return { row, ref, source, status };
  }
  async function finish(ownerId, jobId) {
    const initial = await db.runTransaction((tx) => inspect(tx, ownerId, jobId));
    if (initial.status.state !== 'pending') {
      return initial.status;
    }
    const prepared = await prepare.prepare(ownerId, jobId);
    return db.runTransaction(async (tx) => {
      const current = await inspect(tx, ownerId, jobId, true);
      if (current.status.state === 'ready') {
        return current.status;
      }
      if (
        current.status.state !== 'pending' ||
        current.source.epoch !== prepared.accountEpoch ||
        JSON.stringify(current.source.revisions) !== JSON.stringify(prepared.sourceRevisions)
      ) {
        return fail();
      }
      const readyAt = now();
      const artifact = prepared.artifact;
      const result = await current.ref.update({
        data: {
          state: 'ready',
          fileId: 'private-db-export:' + jobId,
          content: artifact.content,
          contentSha256: hash(artifact.content),
          byteLength: artifact.byteLength,
          mimeType: artifact.mimeType,
          extension: artifact.extension,
          readyAt: readyAt.toISOString(),
          updatedAt: readyAt.toISOString(),
          expiresAt: new Date(readyAt.getTime() + LIMITS.exportFileHours * 3600000).toISOString(),
        },
      });
      if (result.stats?.updated !== 1) {
        return fail();
      }
      return { jobId, state: 'ready', format: prepared.format };
    });
  }
  return async (request) => {
    const ownerId = request.actor.accountId;
    const payload = request.payload;
    if (request.action === 'account.requestExport') {
      if (Object.keys(payload).some((key) => key !== 'format')) {
        return fail('INVALID_INPUT');
      }
      const job = await jobs.createExportJob(ownerId, payload.format, request.requestId);
      return finish(ownerId, job.jobId);
    }
    if (
      Object.keys(payload).some((key) => key !== 'jobId') ||
      typeof payload.jobId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(payload.jobId)
    ) {
      return fail('INVALID_INPUT');
    }
    if (request.action === 'account.exportStatus') {
      return finish(ownerId, payload.jobId);
    }
    return db.runTransaction(async (tx) => {
      const { row, status } = await inspect(tx, ownerId, payload.jobId, true);
      if (status.state !== 'ready') {
        return fail();
      }
      if (
        typeof row.content !== 'string' ||
        Buffer.byteLength(row.content, 'utf8') !== row.byteLength ||
        row.byteLength > MAX_BYTES ||
        hash(row.content) !== row.contentSha256
      ) {
        return fail();
      }
      return {
        jobId: row._id,
        format: row.format,
        content: row.content,
        extension: row.extension,
        byteLength: row.byteLength,
      };
    });
  };
}
module.exports = { createProductionExports, MAX_BYTES };
