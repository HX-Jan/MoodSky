const { createHash } = require('node:crypto');
const { AppError } = require('../shared/result');
const { businessDate } = require('../shared/date');
const { classification } = require('../domains/campus-rules');
// Opt-in persistence candidate. No collection is created or deployed by this module.
// resolveActive and findPlace MUST read within tx. Client roles/owner never used.
function createPersistentService({
  database,
  resolveIdentity,
  resolveActive,
  resolveDisabled,
  findPlace,
  now = Date.now,
  onWrite = async () => {},
}) {
  const docId = (owner) => createHash('sha256').update(owner).digest('hex');
  const reject = (code, message) => {
    throw new AppError(code, message);
  };
  async function run(binding, work) {
    const owner = await resolveIdentity(binding);
    if (!owner) {
      reject('UNAUTHENTICATED', '请先登录。');
    }
    return database.runTransaction(async (tx) => {
      if (!(await resolveActive(tx, owner))) {
        reject('ACCOUNT_DISABLED', '账号已停用。');
      }
      const doc = tx.collection('campus_checkin_states').doc(docId(owner));
      const result = await doc.get();
      const state = result.data || { owner, visits: [], requests: [], revision: 0 };
      if (
        !Array.isArray(state.visits) ||
        !Array.isArray(state.requests) ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 0
      ) {
        reject('CONFLICT', '打卡存储格式无效。');
      }
      if (state.owner !== owner) {
        reject('FORBIDDEN', '记录归属不匹配。');
      }
      return work({ tx, doc, state, owner });
    });
  }
  return {
    complete(request, binding) {
      if (
        !request ||
        !/^req_[A-Za-z0-9_-]{1,100}$/.test(request.requestId || '') ||
        !request.payload ||
        Object.keys(request.payload).length !== 1 ||
        typeof request.payload.placeId !== 'string' ||
        !request.payload.placeId.trim()
      ) {
        return Promise.reject(new AppError('INVALID_INPUT', '打卡请求无效。'));
      }
      return run(binding, async ({ tx, doc, state, owner }) => {
        const { placeId } = request.payload;
        const prior = state.requests.find((r) => r.id === request.requestId);
        if (prior) {
          if (prior.placeId !== placeId) {
            reject('CONFLICT', '原请求内容不可更改。');
          }
          await onWrite(tx, owner, false);
          return prior.result;
        }
        const instant = now();
        const place = await findPlace(tx, placeId);
        if (
          !['verified', 'expiring'].includes(classification(place, instant)) ||
          !['OPEN', 'LIMITED'].includes(place.openState)
        ) {
          reject('NOT_FOUND', '地点不可打卡。');
        }
        const date = businessDate(new Date(instant));
        let visit = state.visits.find((v) => v.placeId === placeId && v.date === date);
        const duplicated = Boolean(visit);
        if (state.requests.length >= 500 || (!visit && state.visits.length >= 500)) {
          reject('CONFLICT', '候选存储容量已满，请联系维护者。');
        }
        if (!visit) {
          visit = {
            placeId,
            date,
            completedAt: new Date(instant).toISOString(),
            placeName: place.name,
            selfReported: true,
          };
          state.visits.push(visit);
          state.revision++;
        }
        const result = { visit, duplicated };
        state.requests.push({ id: request.requestId, placeId, result });
        await onWrite(tx, owner, !duplicated);
        const data = { ...state, owner, ownerId: owner };
        delete data._id;
        await doc.set({ data });
        return result;
      });
    },
    history({ page = 1, pageSize = 10 } = {}, binding) {
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 50
      ) {
        return Promise.reject(new AppError('INVALID_INPUT', '分页无效。'));
      }
      return run(binding, ({ state }) => {
        const rows = [...state.visits].sort(
          (a, b) =>
            Date.parse(b.completedAt) - Date.parse(a.completedAt) ||
            a.placeId.localeCompare(b.placeId),
        );
        return {
          items: rows.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: rows.length,
          hasMore: page * pageSize < rows.length,
        };
      });
    },
    // Server-only lifecycle seam; not exposed through the page transport.
    cleanupDisabled(owner) {
      if (typeof resolveDisabled !== 'function') {
        return Promise.reject(new AppError('NOT_IMPLEMENTED', '未接入可信停用围栏。'));
      }
      return database.runTransaction(async (tx) => {
        if (!(await resolveDisabled(tx, owner))) {
          reject('FORBIDDEN', '账号未停用。');
        }
        const doc = tx.collection('campus_checkin_states').doc(docId(owner));
        const result = await doc.get();
        if (!result.data) {
          return { removed: 0, sharedRetained: true };
        }
        if (result.data.owner !== owner) {
          reject('FORBIDDEN', '记录归属不匹配。');
        }
        const removed = result.data.visits.length;
        // Preserve monotonic revision as a tombstone; drop visit/request contents.
        await doc.set({
          data: {
            owner,
            visits: [],
            requests: [],
            revision: result.data.revision + (removed ? 1 : 0),
          },
        });
        return { removed, sharedRetained: true };
      });
    },
    exportMine(binding) {
      return run(binding, ({ state }) => ({ visits: state.visits, revision: state.revision }));
    },
  };
}
module.exports = { createPersistentService };
