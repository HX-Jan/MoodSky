// Trusted worker preparation candidate. No file writes, upload, credentials or public handler.
const {
  createExportService,
  readCandidateRevision,
} = require('../../cloudfunctions/moodsky/domains/export');
const {
  database,
  identity,
  account,
  sourceState,
  fail,
} = require('../../cloudfunctions/moodsky/domains/storage-support');
const { notImplemented } = require('../../cloudfunctions/moodsky/shared/result');
const { formatExport } = require('./formatter');
const { exportStatus } = require('./access-policy');

const sameSource = (left, right) =>
  left.epoch === right.epoch &&
  Object.keys(left.revisions).every((key) => left.revisions[key] === right.revisions[key]);

function createExportPreparation({
  db,
  readSourceState,
  maxRecords,
  maxBytes,
  pageSize,
  includeCandidateSources = false,
  now = () => new Date(),
} = {}) {
  // Same contract as domains/export.js: candidate sources are opt-in only, and a
  // malformed flag is rejected instead of being coerced into a truthy value that
  // would query the undeployed collection behind the default path's back.
  if (typeof includeCandidateSources !== 'boolean') {
    throw new TypeError(
      'createExportPreparation({ includeCandidateSources }) must be a boolean; candidate sources are opt-in only.',
    );
  }
  // Forwarded verbatim so this worker can never widen the source set on its own.
  const snapshots = createExportService({
    db,
    readSourceState,
    maxRecords,
    pageSize,
    includeCandidateSources,
  });
  async function guard(ownerId, jobId) {
    return db.runTransaction(async (tx) => {
      const owner = account(
        (await tx.collection('accounts').doc(ownerId).get()).data,
        ownerId,
        'active',
      );
      const source = sourceState(await readSourceState(ownerId, tx), ownerId);
      const job = (await tx.collection('export_jobs').doc(jobId).get()).data;
      if (!job || job.ownerId !== ownerId || job._id !== jobId) {
        return fail('FORBIDDEN');
      }
      const status = exportStatus({
        actorId: ownerId,
        account: { id: ownerId, status: owner.status, exportEpoch: owner.exportEpoch },
        job: { ...job, id: job._id },
        sourceRevisions: source.revisions,
        now: now(),
      });
      if (owner.exportEpoch !== source.epoch || status.state !== 'pending') {
        return fail('CONFLICT');
      }
      const expected = sourceState(
        { ownerId, status: 'active', epoch: job.accountEpoch, revisions: job.sourceRevisions },
        ownerId,
      );
      if (!sameSource(expected, source)) {
        return fail('CONFLICT');
      }
      // Opt-in only, and in the same transaction as the job and source reads: the
      // candidate version is a separate field so sourceState() keeps its fixed
      // five-domain contract. A job created without the candidate channel carries
      // no version, so it can never be prepared as if it had one.
      const candidateRevision = includeCandidateSources
        ? await readCandidateRevision(tx, ownerId)
        : undefined;
      if (includeCandidateSources && candidateRevision !== job.candidateRevision) {
        return fail('CONFLICT');
      }
      return { source, format: job.format, candidateRevision };
    });
  }
  return {
    async prepare(ownerId, jobId) {
      identity(ownerId);
      identity(jobId);
      database(db);
      if (typeof readSourceState !== 'function') {
        return notImplemented();
      }
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        return fail();
      }
      const before = await guard(ownerId, jobId);
      const snapshot = await snapshots.gatherExportData(ownerId);
      if (
        !sameSource(before.source, {
          epoch: snapshot.accountEpoch,
          revisions: snapshot.sourceRevisions,
        }) ||
        (includeCandidateSources && snapshot.candidateRevision !== before.candidateRevision)
      ) {
        return fail('CONFLICT');
      }
      const artifact = formatExport(snapshot, {
        accountId: ownerId,
        format: before.format,
        exportedAt: now(),
        maxRecords,
        maxBytes,
      });
      const after = await guard(ownerId, jobId);
      // Both guards read the candidate version around formatting: an association
      // written while the file was being generated cannot slip into the artifact
      // as a silently missing record.
      if (
        before.format !== after.format ||
        !sameSource(before.source, after.source) ||
        (includeCandidateSources && before.candidateRevision !== after.candidateRevision)
      ) {
        return fail('CONFLICT');
      }
      // A future publisher must revalidate this source inside its fenced commit.
      // This object is private worker material, never a download/authorization response.
      return {
        jobId,
        format: before.format,
        accountEpoch: before.source.epoch,
        sourceRevisions: { ...before.source.revisions },
        ...(includeCandidateSources ? { candidateRevision: before.candidateRevision } : {}),
        artifact,
      };
    },
  };
}
module.exports = { createExportPreparation };
