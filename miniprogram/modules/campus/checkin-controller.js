const { PLACES } = require('../../shared/campus-checkins');
const { isBusinessDate, businessDate } = require('../../shared/date');
const { AppError } = require('../../shared/result');
function validateRecord(row) {
  if (
    !row ||
    !PLACES.some((p) => p.placeId === row.placeId) ||
    !isBusinessDate(row.date) ||
    typeof row.completedAt !== 'string' ||
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
  toast = () => {},
}) {
  let visible = false,
    disposed = false,
    sequence = 0;
  let pending = null,
    flight = false,
    records = [],
    date = '',
    error = '',
    loading = false;
  let historyOpen = false,
    historyRows = [],
    historyCursor = null,
    historyBusy = false,
    historyError = '',
    historySequence = 0;
  const historyCursors = new Set();
  function clearHistory() {
    ++historySequence;
    historyOpen = false;
    historyRows = [];
    historyCursor = null;
    historyBusy = false;
    historyError = '';
    historyCursors.clear();
  }
  let binding = session.capture();
  const current = (value) => value !== null && session.isCurrent(value);
  function render() {
    if (!visible || disposed) {
      return;
    }
    publish({
      checkinPlaces: PLACES.map((p) => ({
        ...p,
        completed: records.some((r) => r.placeId === p.placeId && r.date === date),
      })),
      checkinSignedIn: current(binding),
      checkinDate: date,
      checkinLoading: loading,
      checkinError: error,
      checkinPendingPlace: pending?.placeId || '',
      checkinBusy: flight,
      checkinHistoryEmpty: historyOpen && !historyBusy && !historyRows.length && !historyError,
      checkinHistoryOpen: historyOpen,
      checkinHistory: historyRows.map((r) => ({
        ...r,
        key: r.date + r.placeId,
        name: PLACES.find((p) => p.placeId === r.placeId).name,
        time: new Date(Date.parse(r.completedAt) + 8 * 3600000).toISOString().slice(11, 16),
      })),
      checkinHistoryBusy: historyBusy,
      checkinHistoryError: historyError,
      checkinHistoryMore: historyCursor !== null,
    });
  }
  async function readHistory(more = false) {
    if (
      !visible ||
      disposed ||
      !historyOpen ||
      historyBusy ||
      !current(binding) ||
      (more && !historyCursor)
    ) {
      return;
    }
    const token = ++historySequence,
      scope = binding,
      cursor = more ? historyCursor : null;
    historyBusy = true;
    historyError = '';
    render();
    try {
      const result = await service.submit(
        service.createRequest('campus.checkinHistory', cursor ? { cursor } : {}),
      );
      if (token !== historySequence || !visible || disposed || !current(scope)) {
        return;
      }
      const data = result?.data,
        next = data?.nextCursor;
      if (
        result.ok !== true ||
        !Array.isArray(data?.items) ||
        data.items.length > 10 ||
        (next !== null &&
          (typeof next !== 'string' ||
            !/^[A-Za-z0-9_-]{1,256}$/.test(next) ||
            data.items.length !== 10 ||
            next === cursor ||
            historyCursors.has(next)))
      ) {
        throw new AppError('INVALID_RESPONSE', '打卡记录暂时无法读取。');
      }
      data.items.forEach(validateRecord);
      const merged = (more ? historyRows : []).concat(data.items);
      for (let i = 1; i < merged.length; i++) {
        const a = merged[i - 1],
          b = merged[i];
        if (a.date < b.date || (a.date === b.date && a.placeId >= b.placeId)) {
          throw new AppError('INVALID_RESPONSE', '打卡记录顺序不一致。');
        }
      }
      historyRows = merged;
      historyCursor = next;
      if (next !== null) {
        historyCursors.add(next);
      }
    } catch (e) {
      if (token !== historySequence || !visible || disposed || !current(scope)) {
        return;
      }
      if (['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(e.code)) {
        session.clear();
      } else {
        historyError = '暂时无法读取打卡记录，请重试。';
      }
    } finally {
      if (token === historySequence) {
        historyBusy = false;
        render();
      }
    }
  }
  async function refresh() {
    if (!visible || disposed || pending || !current(binding)) {
      render();
      return;
    }
    const token = ++sequence,
      scope = binding;
    loading = true;
    error = '';
    render();
    try {
      const result = await service.submit(service.createRequest('campus.checkins'));
      if (token !== sequence || !visible || disposed || !current(scope)) {
        return;
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
    } catch (e) {
      if (token === sequence && visible && current(scope)) {
        if (['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(e.code)) {
          session.clear();
        } else {
          error = e.message || '打卡记录暂时无法读取，请重试。';
        }
      }
    } finally {
      if (token === sequence) {
        loading = false;
        render();
      }
    }
  }
  async function send() {
    if (!visible || disposed || flight || !pending || !current(pending.binding)) {
      return;
    }
    const operation = pending;
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
      pending = null;
      flight = false;
      const reopenHistory = historyOpen;
      clearHistory();
      historyOpen = reopenHistory;
      date = row.date;
      records = records.filter((r) => r.placeId !== row.placeId && r.date === date).concat(row);
      if (visible) {
        toast('已打卡');
        await refresh();
        if (historyOpen) {
          await readHistory();
        }
      }
    } catch (e) {
      if (pending !== operation || !current(operation.binding) || disposed) {
        return;
      }
      if (['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(e.code)) {
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
    clearHistory();
    ++sequence;
    pending = null;
    flight = false;
    records = [];
    date = '';
    error = '';
    loading = false;
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
      binding = session.capture();
      records = [];
      date = '';
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
      }
      await refresh();
    },
    hide() {
      visible = false;
      clearHistory();
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
        checkinHistoryEmpty: false,
        checkinHistoryOpen: false,
        checkinHistory: [],
        checkinHistoryBusy: false,
        checkinHistoryError: '',
        checkinHistoryMore: false,
      });
    },
    toggleHistory() {
      if (!visible || disposed) {
        return;
      }
      if (!current(binding)) {
        login();
        return;
      }
      if (historyOpen) {
        clearHistory();
        render();
        return;
      }
      historyOpen = true;
      void readHistory();
    },
    moreHistory() {
      return readHistory(historyRows.length > 0);
    },
    complete(placeId) {
      if (!visible || disposed || pending || flight || !PLACES.some((p) => p.placeId === placeId)) {
        return;
      }
      if (!current(binding)) {
        login();
        return;
      }
      if (records.some((r) => r.placeId === placeId && r.date === date)) {
        return;
      }
      pending = { placeId, binding, request: service.createRequest('campus.checkIn', { placeId }) };
      void send();
    },
    retry() {
      return pending ? send() : refresh();
    },
    getWorkStatus: () => ({ draft: false, pending: !disposed && pending !== null }),
    dispose() {
      visible = false;
      disposed = true;
      clearHistory();
      ++sequence;
      unsubscribe();
    },
  };
}
module.exports = { createCheckinController, validateRecord };
