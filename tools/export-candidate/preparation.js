// Trusted worker preparation candidate. No file writes, upload, credentials or public handler.
const { createExportService } = require('../../cloudfunctions/moodsky/domains/export');
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
  now = () => new Date(),
} = {}) {
  const snapshots = createExportService({ db, readSourceState, maxRecords, pageSize });
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
      return { source, format: job.format };
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
        })
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
      if (before.format !== after.format || !sameSource(before.source, after.source)) {
        return fail('CONFLICT');
      }
      // A future publisher must revalidate this source inside its fenced commit.
      // This object is private worker material, never a download/authorization response.
      return {
        jobId,
        format: before.format,
        accountEpoch: before.source.epoch,
        sourceRevisions: { ...before.source.revisions },
        artifact,
      };
    },
  };
}
module.exports = { createExportPreparation };
