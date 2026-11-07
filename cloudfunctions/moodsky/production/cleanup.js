// Bounded, restartable worker for the deterministic journal layout. No client identity input.
const { AppError } = require('../shared/result');
const COLLECTIONS = Object.freeze([
  'journals',
  'favorites',
  'place_checkins',
  'campus_checkin_states',
  'task_checkin_links',
  'task_history',
  'preferences',
  'month_decorations',
  'request_receipts',
  'export_jobs',
  'deletion_markers',
  'place_corrections',
]);
const fail = () => {
  throw new AppError('FORBIDDEN', '无法确认此清理任务。');
};
function createProductionCleanup({ db, now = () => new Date() }) {
  async function guard(tx, jobId) {
    const ref = tx.collection('cleanup_jobs').doc(jobId);
    const job = (await ref.get()).data;
    if (
      !job ||
      job._id !== jobId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(job.ownerId) ||
      job.exportAccessRevoked !== true ||
      !['pending', 'processing', 'completed'].includes(job.state)
    ) {
      return fail();
    }
    const ownerRef = tx.collection('accounts').doc(job.ownerId);
    const owner = (await ownerRef.get()).data;
    if (
      !owner ||
      owner._id !== job.ownerId ||
      owner.status !== 'disabled' ||
      owner.journalLayout !== 'deterministic-days-v1'
    ) {
      return fail();
    }
    if (
      !job.progress ||
      typeof job.progress !== 'object' ||
      Array.isArray(job.progress) ||
      Object.entries(job.progress).some(
        ([key, count]) => !COLLECTIONS.includes(key) || !Number.isSafeInteger(count) || count < 0,
      )
    ) {
      return fail();
    }
    return { job, ref, ownerRef };
  }
  async function step(jobId) {
    if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) {
      return fail();
    }
    const initial = await db.runTransaction((tx) => guard(tx, jobId));
    if (initial.job.state === 'completed') {
      return project(initial.job);
    }
    for (const collection of COLLECTIONS) {
      const page = await db
        .collection(collection)
        .where({ ownerId: initial.job.ownerId })
        .orderBy('_id', 'asc')
        .limit(10)
        .get();
      if (!Array.isArray(page.data) || page.data.length > 10) {
        return fail();
      }
      if (!page.data.length) {
        continue;
      }
      for (const item of page.data) {
        if (
          !item ||
          item.ownerId !== initial.job.ownerId ||
          typeof item._id !== 'string' ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(item._id)
        ) {
          return fail();
        }
        await db.runTransaction(async (tx) => {
          const { job, ref } = await guard(tx, jobId);
          if (job.state === 'completed') {
            return;
          }
          const document = tx.collection(collection).doc(item._id);
          const stored = (await document.get()).data;
          if (!stored) {
            return;
          }
          if (stored.ownerId !== job.ownerId || stored._id !== item._id) {
            return fail();
          }
          const removed = await document.remove();
          if (removed.stats?.removed !== 1) {
            return fail();
          }
          const count = job.progress[collection] || 0;
          if (count >= Number.MAX_SAFE_INTEGER) {
            return fail();
          }
          const updated = await ref.update({
            data: {
              state: 'processing',
              progress: { ...job.progress, [collection]: count + 1 },
              updatedAt: now().toISOString(),
            },
          });
          if (updated.stats?.updated !== 1) {
            return fail();
          }
        });
      }
      return project((await db.runTransaction((tx) => guard(tx, jobId))).job);
    }
    return db.runTransaction(async (tx) => {
      const { job, ref, ownerRef } = await guard(tx, jobId);
      const stamp = now().toISOString();
      // Disabled account writers share the account fence. Preserve a minimal tombstone so
      // a later login or restored private rows cannot silently reactivate this identity.
      await ownerRef.set({
        data: {
          openid: job.ownerId,
          identityKind: 'wechat-hmac-v1',
          status: 'disabled',
          journalLayout: 'deterministic-days-v1',
          closedAt: stamp,
        },
      });
      const updated = await ref.update({
        data: { state: 'completed', updatedAt: stamp, completedAt: stamp },
      });
      if (updated.stats?.updated !== 1) {
        return fail();
      }
      return project({ ...job, state: 'completed', updatedAt: stamp });
    });
  }
  function project(job) {
    return {
      jobId: job._id,
      state: job.state,
      progress: { ...job.progress },
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
  async function tick() {
    // One page per scheduler run. Repeated runs drain existing jobs without offsets.
    const result = await db
      .collection('cleanup_jobs')
      .where({ state: db.command.in(['pending', 'processing']) })
      .orderBy('_id', 'asc')
      .limit(5)
      .get();
    if (!Array.isArray(result.data) || result.data.length > 5) {
      return fail();
    }
    const outcomes = [];
    for (const job of result.data) {
      try {
        outcomes.push((await step(job._id)).state);
      } catch {
        outcomes.push('retry');
      }
    }
    return {
      examined: outcomes.length,
      completed: outcomes.filter((state) => state === 'completed').length,
      retry: outcomes.filter((state) => state === 'retry').length,
    };
  }
  return { step, tick };
}
module.exports = { createProductionCleanup, COLLECTIONS };
