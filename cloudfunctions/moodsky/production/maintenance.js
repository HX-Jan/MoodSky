// Remove expired artifact bodies without deleting job metadata or source records.
function createExportMaintenance({ db, now = () => new Date() }) {
  return async () => {
    const stamp = now().toISOString();
    const page = await db
      .collection('export_jobs')
      .where({ state: 'ready', expiresAt: db.command.lte(stamp) })
      .orderBy('_id', 'asc')
      .limit(10)
      .get();
    if (!Array.isArray(page.data) || page.data.length > 10) {
      throw new Error('Invalid export maintenance page');
    }
    let expired = 0;
    for (const row of page.data) {
      if (!row || typeof row._id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row._id)) {
        throw new Error('Invalid export maintenance row');
      }
      expired += await db.runTransaction(async (tx) => {
        const ref = tx.collection('export_jobs').doc(row._id);
        const current = (await ref.get()).data;
        if (
          !current ||
          current.state !== 'ready' ||
          !Number.isFinite(Date.parse(current.expiresAt)) ||
          Date.parse(current.expiresAt) > now().getTime()
        ) {
          return 0;
        }
        if (current._id !== row._id || current.ownerId !== row.ownerId) {
          throw new Error('Export owner changed');
        }
        const metadata = { ...current, state: 'expired', fileId: null, updatedAt: stamp };
        for (const key of [
          '_id',
          'content',
          'contentSha256',
          'byteLength',
          'mimeType',
          'extension',
        ]) {
          delete metadata[key];
        }
        await ref.set({ data: metadata });
        return 1;
      });
    }
    return expired;
  };
}
module.exports = { createExportMaintenance };
