const { PLACES } = require('../../shared/campus-checkins');
const { AppError } = require('../../shared/result');
const PAGE_SIZE = 10;
const order = (a, b) =>
  Date.parse(b.completedAt) - Date.parse(a.completedAt) || a.placeId.localeCompare(b.placeId);
const recordKey = (row) => row.date + ':' + row.placeId;
function createCheckinHistory({ service, session, validateRecord, publish, isBlocked, login }) {
  let visible = false,
    disposed = false,
    opened = false,
    generation = 0;
  let binding = session.capture(),
    operation = null,
    rows = [],
    page = 0,
    total = 0;
  let message = '',
    restart = false,
    retryMore = false;
  const current = () => binding !== null && session.isCurrent(binding);
  function render() {
    publish({
      checkinHistoryOpen: opened,
      checkinHistory: rows.map((row) => ({
        key: recordKey(row),
        name: PLACES.find((place) => place.placeId === row.placeId).name,
        date: row.date,
        time: new Date(Date.parse(row.completedAt) + 8 * 3600000).toISOString().slice(11, 16),
      })),
      checkinHistoryBusy: operation !== null,
      checkinHistoryLoaded: page > 0,
      checkinHistoryEmpty: opened && page > 0 && !operation && !rows.length && !message,
      checkinHistoryMore: page > 0 && rows.length < total,
      checkinHistoryError: message,
      checkinHistoryRestart: restart,
    });
  }
  function reset() {
    ++generation;
    operation = null;
    opened = false;
    rows = [];
    page = 0;
    total = 0;
    message = '';
    restart = false;
    retryMore = false;
    render();
  }
  function changed() {
    throw Object.assign(new AppError('INVALID_RESPONSE', '记录已更新，请重新读取。'), {
      restart: true,
    });
  }
  function read(more = false) {
    if (!visible || disposed || !opened || !current() || isBlocked()) {
      return Promise.resolve(false);
    }
    if (operation) {
      return operation.promise;
    }
    if (more && (!page || rows.length >= total || restart)) {
      return Promise.resolve(false);
    }
    const nextPage = more ? page + 1 : 1;
    const token = ++generation,
      scope = binding,
      task = {};
    operation = task;
    retryMore = more;
    message = '';
    render();
    task.promise = (async () => {
      try {
        const response = await service.submit(
          service.createRequest('campus.checkinHistory', { page: nextPage, pageSize: PAGE_SIZE }),
        );
        if (disposed || !visible || token !== generation || !session.isCurrent(scope)) {
          return false;
        }
        const data = response?.data;
        if (
          response?.ok !== true ||
          data?.page !== nextPage ||
          data.pageSize !== PAGE_SIZE ||
          !Number.isSafeInteger(data.total) ||
          data.total < 0 ||
          !Array.isArray(data.items) ||
          data.items.length !==
            Math.min(PAGE_SIZE, Math.max(0, data.total - (nextPage - 1) * PAGE_SIZE)) ||
          data.hasMore !== nextPage * PAGE_SIZE < data.total
        ) {
          throw new AppError('INVALID_RESPONSE', '打卡记录返回不完整。');
        }
        if (more && data.total !== total) {
          changed();
        }
        const incoming = data.items.map((row) => {
          validateRecord(row);
          return { placeId: row.placeId, date: row.date, completedAt: row.completedAt };
        });
        const previous = more ? rows : [];
        const seen = new Set(previous.map(recordKey));
        let last = previous[previous.length - 1];
        for (const row of incoming) {
          if (seen.has(recordKey(row)) || (last && order(last, row) > 0)) {
            changed();
          }
          seen.add(recordKey(row));
          last = row;
        }
        rows = previous.concat(incoming);
        page = nextPage;
        total = data.total;
        restart = false;
        retryMore = false;
        return true;
      } catch (error) {
        if (!disposed && visible && token === generation && session.isCurrent(scope)) {
          if (['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(error?.code)) {
            session.clear();
          } else if (error?.restart === true) {
            restart = true;
            message = '记录已更新，请重新读取。';
          } else {
            message = '暂时无法读取打卡记录，请稍后重试。';
          }
        }
        return false;
      } finally {
        if (!disposed && visible && token === generation && operation === task) {
          operation = null;
          render();
        }
      }
    })();
    return task.promise;
  }
  const unsubscribe = session.subscribe(() => {
    binding = session.capture();
    reset();
  });
  return {
    show() {
      if (disposed) {
        return;
      }
      visible = true;
      binding = session.capture();
      reset();
    },
    reset,
    toggle() {
      if (!visible || disposed) {
        return Promise.resolve(false);
      }
      if (opened) {
        reset();
        return Promise.resolve(false);
      }
      if (isBlocked()) {
        return Promise.resolve(false);
      }
      if (!current()) {
        login();
        return Promise.resolve(false);
      }
      opened = true;
      return read();
    },
    more: () => read(true),
    refresh: () => read(),
    retry: () => read(retryMore && !restart),
    hide() {
      visible = false;
      reset();
    },
    dispose() {
      if (disposed) {
        return;
      }
      visible = false;
      disposed = true;
      reset();
      unsubscribe();
    },
  };
}
module.exports = { createCheckinHistory };
