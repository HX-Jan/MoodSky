// Review candidate controller. Not mounted in the production page before contract review.
function createCheckinController({ service, createRequest, onChange = () => {}, pendingStorage }) {
  let scope = null;
  let generation = 0;
  let pending = null;
  let busy = false;
  let state = { status: 'idle', visits: [], error: '' };
  const publish = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  return {
    snapshot: () => JSON.parse(JSON.stringify(state)),
    session(next) {
      if (scope && scope !== next && pendingStorage) {
        pendingStorage.clear(scope);
      }
      scope = next;
      generation++;
      pending = scope && pendingStorage ? pendingStorage.read(scope) : null;
      busy = false;
      publish({ status: 'idle', visits: [], error: '' });
    },
    hide() {
      generation++;
      busy = false;
      publish({ status: 'idle' });
    },
    async refresh() {
      if (!scope) {
        publish({ status: 'login_required' });
        return;
      }
      if (busy) {
        return;
      }
      const version = generation;
      publish({ status: 'loading', error: '' });
      try {
        const rows = [];
        let page = 1;
        for (;;) {
          const result = await service.history({ page, pageSize: 50 }, scope);
          if (version !== generation) {
            return;
          }
          if (!result || !Array.isArray(result.items)) {
            throw new Error('打卡历史返回不完整。');
          }
          rows.push(...result.items);
          if (!result.hasMore) {
            break;
          }
          if (page >= 10) {
            throw new Error('打卡历史超出候选读取范围。');
          }
          page++;
        }
        const result = { items: rows };
        if (version === generation) {
          publish({ status: 'ready', visits: result.items });
        }
      } catch (error) {
        if (version === generation) {
          publish({ status: 'error', error: error.message });
        }
      }
    },
    async complete(placeId) {
      if (!scope) {
        publish({ status: 'login_required' });
        return;
      }
      if (busy) {
        return;
      }
      if (pending && pending.payload.placeId !== placeId) {
        publish({ status: 'unknown', error: '请先重试原地点的未确认请求。' });
        return;
      }
      if (!pending) {
        pending = createRequest(placeId);
      }
      try {
        if (pendingStorage) {
          pendingStorage.write(scope, pending);
        }
      } catch {
        publish({ status: 'error', error: '无法保存重试请求，尚未提交，请重试。' });
        return;
      }
      const request = pending,
        version = ++generation;
      busy = true;
      publish({ status: 'submitting', error: '' });
      try {
        const result = await service.complete(request, scope);
        if (
          !result?.visit ||
          result.visit.placeId !== placeId ||
          !/^\d{4}-\d{2}-\d{2}$/.test(result.visit.date) ||
          typeof result.visit.completedAt !== 'string'
        ) {
          throw new Error('打卡回执不完整，请重试原请求。');
        }
        if (version !== generation) {
          return;
        }
        pending = null;
        if (pendingStorage) {
          pendingStorage.clear(scope);
        }
        publish({
          status: 'completed',
          visits: [
            result.visit,
            ...state.visits.filter(
              (r) => r.placeId !== result.visit.placeId || r.date !== result.visit.date,
            ),
          ],
        });
      } catch (error) {
        if (version === generation) {
          publish({ status: 'unknown', error: error.message });
        }
      } finally {
        if (version === generation) {
          busy = false;
        }
      }
    },
  };
}
module.exports = { createCheckinController };
