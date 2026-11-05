const { AppError } = require('../../miniprogram/shared/result');
const { businessDate } = require('../../miniprogram/shared/date');
const { classification } = require('../../cloudfunctions/moodsky/domains/campus-rules');
const fail = (code, message) => {
  throw new AppError(code, message);
};
const copy = (x) => globalThis.structuredClone(x);
// Local review candidate. The store serializes every operation, including account
// disable, place updates and cleanup. Production must provide the same transaction.
function createLocalStore({ accounts = [], places = [] } = {}) {
  let tail = Promise.resolve();
  const state = {
    accounts: copy(accounts),
    places: copy(places),
    visits: [],
    requests: [],
    revisions: {},
  };
  return {
    transaction(work) {
      const result = tail.then(async () => {
        const next = copy(state);
        const value = await work(next);
        Object.assign(state, next);
        return copy(value);
      });
      tail = result.catch(() => {});
      return result;
    },
  };
}
function createCheckinCandidate({ store, resolveIdentity, now = () => Date.now() }) {
  async function owned(work, credential) {
    const owner = await resolveIdentity(credential);
    if (!owner) {
      fail('UNAUTHENTICATED', '请先登录。');
    }
    return store.transaction((state) => {
      if (state.accounts.find((a) => a.id === owner)?.status !== 'active') {
        fail('ACCOUNT_DISABLED', '账号不可用。');
      }
      return work(state, owner);
    });
  }
  function project(row) {
    const { placeId, date, completedAt, placeName } = row;
    return { placeId, date, completedAt, placeName, selfReported: true };
  }
  return {
    async complete(request, credential) {
      if (
        !request ||
        !/^req_[A-Za-z0-9_-]{1,100}$/.test(request.requestId || '') ||
        Object.keys(request).some((k) => !['requestId', 'payload'].includes(k)) ||
        !request.payload ||
        Object.keys(request.payload).length !== 1 ||
        typeof request.payload.placeId !== 'string' ||
        !request.payload.placeId.trim()
      ) {
        fail('INVALID_INPUT', '打卡请求无效。');
      }
      const { placeId } = request.payload;
      return owned((state, owner) => {
        const prior = state.requests.find((r) => r.owner === owner && r.id === request.requestId);
        if (prior) {
          if (prior.placeId !== placeId) {
            fail('CONFLICT', '原请求内容不可更改。');
          }
          return prior.result;
        }
        const instant = now();
        const place = state.places.find((p) => p.placeId === placeId);
        if (
          !['verified', 'expiring'].includes(classification(place, instant)) ||
          !['OPEN', 'LIMITED'].includes(place.openState)
        ) {
          fail('NOT_FOUND', '地点已失效或不可打卡。');
        }
        const date = businessDate(new Date(instant));
        let row = state.visits.find(
          (r) => r.owner === owner && r.placeId === placeId && r.date === date,
        );
        const duplicated = Boolean(row);
        if (!row) {
          row = {
            owner,
            placeId,
            date,
            placeName: place.name,
            completedAt: new Date(instant).toISOString(),
          };
          state.visits.push(row);
          state.revisions[owner] = (state.revisions[owner] || 0) + 1;
        }
        const result = { visit: project(row), duplicated };
        state.requests.push({ owner, id: request.requestId, placeId, result });
        return result;
      }, credential);
    },
    history({ page = 1, pageSize = 10 } = {}, credential) {
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 50
      ) {
        fail('INVALID_INPUT', '分页参数无效。');
      }
      return owned((state, owner) => {
        const rows = state.visits
          .filter((r) => r.owner === owner)
          .sort(
            (a, b) =>
              b.completedAt.localeCompare(a.completedAt) || a.placeId.localeCompare(b.placeId),
          );
        const start = (page - 1) * pageSize;
        return {
          items: rows.slice(start, start + pageSize).map(project),
          page,
          pageSize,
          total: rows.length,
          hasMore: start + pageSize < rows.length,
        };
      }, credential);
    },
    exportMine(credential) {
      return owned(
        (state, owner) => ({
          visits: state.visits.filter((r) => r.owner === owner).map(project),
          revision: state.revisions[owner] || 0,
        }),
        credential,
      );
    },
    // Server lifecycle seam, not a student callable action. Disabled is required.
    cleanupDisabled(owner) {
      return store.transaction((state) => {
        if (state.accounts.find((a) => a.id === owner)?.status !== 'disabled') {
          fail('FORBIDDEN', '仅停用账号可清理。');
        }
        const before = state.visits.length;
        state.visits = state.visits.filter((r) => r.owner !== owner);
        state.requests = state.requests.filter((r) => r.owner !== owner);
        const removed = before - state.visits.length;
        if (removed) {
          state.revisions[owner] = (state.revisions[owner] || 0) + 1;
        }
        return { removed, sharedRetained: true };
      });
    },
  };
}
module.exports = { createLocalStore, createCheckinCandidate };
