const { PLACES } = require('../../shared/campus-checkins');
const { isBusinessDate, businessDate } = require('../../shared/date');
const { AppError } = require('../../shared/result');
const { createCheckinHistory } = require('./checkin-history-controller');
function validateRecord(row) {
  if (
    !row ||
    !PLACES.some((p) => p.placeId === row.placeId) ||
    !isBusinessDate(row.date) ||
    typeof row.completedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(row.completedAt) ||
    !isBusinessDate(row.completedAt.slice(0, 10)) ||
    !Number.isFinite(Date.parse(row.completedAt)) ||
    businessDate(new Date(row.completedAt)) !== row.date
  ) {
    throw new AppError('INVALID_RESPONSE', '打卡结果暂时无法确认。');
  }
  return row;
}
function createCheckinController({
  service,
  session,
  ensureSession,
  publish,
  login,
  historyLogin = login,
  pendingStorage,
  toast = () => {},
  clock = () => new Date(),
  schedule = (fn, delay) => setTimeout(fn, delay),
  cancel = (timer) => clearTimeout(timer),
}) {
  let visible = false,
    disposed = false,
    sequence = 0;
  let pending = null,
    flight = false,
    records = [],
    date = '',
    error = '',
    loading = false,
    dayExpired = false,
    storageBlocked = false;
  let readOperation = null,
    rolloverTimer = null,
    rolloverSequence = 0;
  function clearRollover() {
    ++rolloverSequence;
    if (rolloverTimer !== null) {
      cancel(rolloverTimer);
      rolloverTimer = null;
    }
  }
  function scheduleRollover() {
    clearRollover();
    if (
      !visible ||
      disposed ||
      pending ||
      storageBlocked ||
      !current(binding) ||
      date !== businessDate(clock())
    ) {
      return;
    }
    const delay = Date.parse(date + 'T16:00:00.000Z') - clock().getTime() + 20;
    if (!Number.isFinite(delay) || delay <= 0 || delay > 86400020) {
      return;
    }
    const token = rolloverSequence,
      scope = binding;
    rolloverTimer = schedule(() => {
      if (token !== rolloverSequence || !visible || disposed || pending || !current(scope)) {
        return;
      }
      rolloverTimer = null;
      dayExpired = businessDate(clock()) !== date;
      void refresh();
    }, delay);
    rolloverTimer?.unref?.();
  }
  let binding = session.capture();
  const current = (value) => value !== null && session.isCurrent(value);
  const history = createCheckinHistory({
    service,
    session,
    validateRecord,
    publish,
    login: historyLogin,
    isBlocked: () =>
      !visible || disposed || pending !== null || flight || loading || storageBlocked,
  });
  function restorePending() {
    if (!pendingStorage || pending || !current(binding)) {
      return !storageBlocked;
    }
    try {
      const request = pendingStorage.read(binding.scope);
      storageBlocked = false;
      if (request) {
        pending = { placeId: request.payload.placeId, binding, request };
        error = '打卡结果尚未确认，请重试原操作。';
      }
      return true;
    } catch {
      storageBlocked = true;
      error = '本机打卡记录暂时无法读取，请稍后重试。';
      return false;
    }
  }
  function clearPending(operation) {
    try {
      pendingStorage?.clear(operation.binding.scope, operation.request);
      return true;
    } catch {
      error = '本机打卡记录暂未清除，请重试原操作。';
      return false;
    }
  }
  function render() {
    if (!visible || disposed) {
      return;
    }
    publish({
      checkinPlaces: PLACES.map((p) => ({
        ...p,
        completed: !dayExpired && records.some((r) => r.placeId === p.placeId && r.date === date),
      })),
      checkinSignedIn: current(binding),
      checkinDate: date,
      checkinLoading: loading,
      checkinError: error,
      checkinPendingPlace: pending?.placeId || '',
      checkinBusy: flight,
      checkinStorageBlocked: storageBlocked,
    });
  }
  function refresh(allowRolloverRetry = true) {
    if (visible && !disposed && storageBlocked) {
      restorePending();
    }
    if (!visible || disposed || pending || storageBlocked || !current(binding)) {
      render();
      return Promise.resolve(false);
    }
    if (readOperation) {
      return readOperation.promise;
    }
    clearRollover();
    const localDayAtStart = businessDate(clock());
    const token = ++sequence,
      scope = binding,
      operation = {};
    readOperation = operation;
    loading = true;
    error = '';
    render();
    operation.promise = (async () => {
      let succeeded = false,
        crossedDay = false;
      try {
        const result = await service.submit(service.createRequest('campus.checkins'));
        if (token !== sequence || !visible || disposed || !current(scope)) {
          return false;
        }
        const data = result?.data;
        if (
          result.ok !== true ||
          !isBusinessDate(data?.date) ||
          !Array.isArray(data.items) ||
          data.items.length > PLACES.length ||
          new Set(data.items.map((r) => r?.placeId)).size !== data.items.length
        ) {
          throw new AppError('INVALID_RESPONSE', '打卡记录暂时无法读取。');
        }
        data.items.forEach((r) => {
          validateRecord(r);
          if (r.date !== data.date) {
            throw new AppError('INVALID_RESPONSE', '打卡日期不一致。');
          }
        });
        records = data.items;
        date = data.date;
        crossedDay = data.date === localDayAtStart && businessDate(clock()) !== localDayAtStart;
        dayExpired = crossedDay;
        succeeded = true;
        return true;
      } catch (e) {
        if (token === sequence && visible && current(scope)) {
          if (['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(e.code)) {
            session.clear();
          } else {
            error = e.message || '打卡记录暂时无法读取，请重试。';
          }
        }
        return false;
      } finally {
        if (token === sequence && readOperation === operation) {
          readOperation = null;
          loading = false;
          if (succeeded && !crossedDay) {
            scheduleRollover();
          }
          render();
        }
      }
    })().then((result) => {
      if (
        result &&
        dayExpired &&
        allowRolloverRetry &&
        token === sequence &&
        visible &&
        !disposed &&
        current(scope)
      ) {
        return refresh(false);
      }
      return result;
    });
    return operation.promise;
  }
  async function send() {
    if (!visible || disposed || flight || !pending || !current(pending.binding)) {
      return;
    }
    const operation = pending;
    history.reset();
    clearRollover();
    readOperation = null;
    ++sequence;
    loading = false;
    flight = true;
    error = '';
    render();
    try {
      const result = await service.submit(operation.request);
      if (pending !== operation || !current(operation.binding) || disposed) {
        return;
      }
      const row = validateRecord(result?.data);
      if (result.ok !== true || row.placeId !== operation.placeId) {
        throw new AppError('INVALID_RESPONSE', '打卡结果暂时无法确认。');
      }
      if (!clearPending(operation)) {
        return;
      }
      pending = null;
      flight = false;
      date = row.date;
      dayExpired = date !== businessDate(clock());
      records = records.filter((r) => r.placeId !== row.placeId && r.date === date).concat(row);
      if (visible) {
        toast('已打卡');
        await refresh();
      }
    } catch (e) {
      if (pending !== operation || !current(operation.binding) || disposed) {
        return;
      }
      if (['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(e.code)) {
        clearPending(operation);
        session.clear();
        return;
      }
      if (
        [
          'INVALID_INPUT',
          'ACCOUNT_DISABLED',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_IMPLEMENTED',
          'ACTION_NOT_FOUND',
          'API_VERSION_UNSUPPORTED',
          'CLOUD_NOT_CONFIGURED',
        ].includes(e.code)
      ) {
        if (!clearPending(operation)) {
          return;
        }
        pending = null;
        error = [
          'NOT_IMPLEMENTED',
          'ACTION_NOT_FOUND',
          'API_VERSION_UNSUPPORTED',
          'CLOUD_NOT_CONFIGURED',
        ].includes(e.code)
          ? '打卡服务暂未开放，请稍后再试。'
          : e.message;
      } else {
        error = '打卡结果尚未确认，请重试原操作。';
      }
    } finally {
      if (!pending || pending === operation) {
        flight = false;
        render();
      }
    }
  }
  const unsubscribe = session.subscribe(() => {
    binding = session.capture();
    clearRollover();
    readOperation = null;
    ++sequence;
    pending = null;
    storageBlocked = false;
    flight = false;
    records = [];
    date = '';
    dayExpired = false;
    error = '';
    loading = false;
    if (visible) {
      restorePending();
    }
    render();
    if (visible && current(binding)) {
      void refresh();
    }
  });
  return {
    async show() {
      if (disposed) {
        return;
      }
      visible = true;
      history.show();
      binding = session.capture();
      records = [];
      date = '';
      dayExpired = false;
      if (!restorePending()) {
        render();
        return;
      }
      render();
      if (pending) {
        if (!flight) {
          error = '打卡结果尚未确认，请重试原操作。';
          render();
        }
        return;
      }
      if (!binding) {
        const token = ++sequence;
        await ensureSession();
        if (disposed || !visible || token !== sequence) {
          return;
        }
        binding = session.capture();
        if (!restorePending() || pending) {
          render();
          return;
        }
      }
      await refresh();
    },
    hide() {
      visible = false;
      history.hide();
      clearRollover();
      readOperation = null;
      ++sequence;
      loading = false;
      publish({
        checkinPlaces: PLACES,
        checkinDate: '',
        checkinError: '',
        checkinSignedIn: false,
        checkinBusy: false,
        checkinPendingPlace: '',
        checkinLoading: false,
        checkinStorageBlocked: false,
      });
    },
    complete(placeId) {
      if (
        !visible ||
        disposed ||
        pending ||
        storageBlocked ||
        flight ||
        !PLACES.some((p) => p.placeId === placeId)
      ) {
        return;
      }
      if (!current(binding)) {
        login(placeId);
        return;
      }
      if (!dayExpired && records.some((r) => r.placeId === placeId && r.date === date)) {
        return;
      }
      if (!restorePending() || pending) {
        render();
        return;
      }
      const request = service.createRequest('campus.checkIn', { placeId });
      try {
        pendingStorage?.save(binding.scope, request);
      } catch {
        storageBlocked = true;
        error = '打卡请求未能保存在本机，请稍后重试。';
        render();
        return;
      }
      pending = { placeId, binding, request };
      void send();
    },
    refresh,
    toggleHistory: () => history.toggle(),
    loadMoreHistory: () => history.more(),
    refreshHistory: () => history.refresh(),
    retryHistory: () => history.retry(),
    retry() {
      if (!visible || disposed) {
        return Promise.resolve(false);
      }
      if (pending) {
        return send();
      }
      // A read can discover a pending check-in. Show it before allowing a send.
      if (!restorePending() || pending) {
        render();
        return Promise.resolve(false);
      }
      return refresh();
    },
    getWorkStatus: () => ({
      draft: false,
      pending: !disposed && (pending !== null || storageBlocked),
    }),
    dispose() {
      visible = false;
      disposed = true;
      history.dispose();
      clearRollover();
      readOperation = null;
      ++sequence;
      unsubscribe();
    },
  };
}
module.exports = { createCheckinController, validateRecord };
