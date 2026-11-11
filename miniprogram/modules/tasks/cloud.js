const service = require('./service');
const { LIMITS } = require('../../shared/constants');
const { AppError } = require('../../shared/result');
const { isBusinessDate, businessDate } = require('../../shared/date');
const { activityDestination } = require('./destination');
const HISTORY_DAYS = 90;

const LABELS = {
  available: '可以选择',
  selected: '已选择',
  completed: '已完成',
  replaced: '已替换',
  skipped: '已跳过',
};
const TARGETS = { select: 'selected', complete: 'completed', replace: 'replaced', skip: 'skipped' };
function invalid() {
  throw new AppError('INVALID_RESPONSE', '任务返回格式不兼容。');
}
function task(item, history = false) {
  if (!item || typeof item.taskId !== 'string' || !item.taskId) {
    invalid();
  }
  const state = item.state || 'available';
  if (
    !Object.prototype.hasOwnProperty.call(LABELS, state) ||
    (history && !isBusinessDate(item.date))
  ) {
    invalid();
  }
  if (
    (!history &&
      (typeof item.title !== 'string' ||
        !Number.isFinite(item.durationMin) ||
        item.durationMin <= 0)) ||
    (item.title !== undefined && typeof item.title !== 'string')
  ) {
    invalid();
  }
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return {
    id: history ? [item.taskId, item.date, state, item.createdAt || ''].join('_') : item.taskId,
    taskId: item.taskId,
    title: item.title || '小任务',
    date: item.date || '',
    description:
      typeof item.description === 'string'
        ? item.description
        : Array.isArray(item.steps)
          ? item.steps.join('\n')
          : '',
    durationMin: item.durationMin,
    tags,
    tagText: tags.join(' · '),
    destination: history ? '' : activityDestination(tags),
    state,
    stateLabel: LABELS[state],
    canSelect: state === 'available',
    canComplete: state === 'selected',
    canReplace: state === 'selected',
    canSkip: state === 'selected',
  };
}
function items(result, history = false) {
  if (!result || result.ok !== true || !result.data || !Array.isArray(result.data.items)) {
    invalid();
  }
  const rows = result.data.items;
  if (history && result.data.truncated === true) {
    invalid();
  }
  if (
    !history &&
    (rows.length > LIMITS.taskSuggestions ||
      new Set(rows.map((x) => x && x.taskId)).size !== rows.length)
  ) {
    invalid();
  }
  return rows.map((item) => task(item, history));
}

// Candidate response fields follow Jiawei's W1 JF02 examples; server approval
// and live integration remain pending. No demo fallback is used here.
function createCloudTaskController({
  api = service,
  session,
  publish = () => {},
  refreshAfterWrite = false,
  pendingStorage,
  readOnly: configuredReadOnly = false,
  now = () => new Date(),
} = {}) {
  let generation = 0;
  let choiceGeneration = 0;
  let writeSequence = 0;
  let disposed = false;
  let suspended = false;
  let refreshOnResume = false;
  let activeView = 'suggestions';
  let busy = false;
  let pending = null;
  let pendingScope = null;
  let storageBlocked = false;
  let suggestions = [];
  let readOnly = configuredReadOnly;
  let historyRows = [];
  let historyCursor = null;
  let historyQuery = null;
  let historyScope = null;
  let historyReadBusy = false;
  let historyPageQuery = null;
  const historyCursors = new Set();
  const readOnlyNotice = '仅支持浏览建议，任务操作暂未开放。';
  // An opaque session epoch comes from the identity integration, never from
  // a payload owner id or the local demo account selector. No adapter = closed.
  const captureScope = () =>
    session &&
    typeof session.capture === 'function' &&
    typeof session.isCurrent === 'function' &&
    typeof session.subscribe === 'function'
      ? session.capture()
      : null;
  const scopeCurrent = (scope) =>
    scope !== null &&
    scope !== undefined &&
    session &&
    typeof session.isCurrent === 'function' &&
    session.isCurrent(scope) === true;
  const current = (token) => !disposed && !suspended && token === generation;
  const send = (patch) => {
    if (!disposed && !suspended) {
      publish(patch);
    }
  };
  function clearHistory() {
    historyRows = [];
    historyCursor = null;
    historyQuery = null;
    historyScope = null;
    historyReadBusy = false;
    historyPageQuery = null;
    historyCursors.clear();
    send({
      history: [],
      historyLoaded: false,
      historyHasMore: false,
      historyLoadingMore: false,
      historyMoreError: '',
    });
  }
  function nextHistoryCursor(result) {
    const next = result.data.nextCursor ?? null;
    if (
      next !== null &&
      (typeof next !== 'string' ||
        !next.trim() ||
        historyCursors.has(next) ||
        !result.data.items.length)
    ) {
      invalid();
    }
    return next;
  }
  const privateUnavailable = (changed = false) => {
    clearHistory();
    send({
      history: [],
      taskListLoaded: false,
      suggestions: [],
      quickEntries: [],
      loading: false,
      busy: false,
      retryPending: false,
      writeBlocked: true,
      errorCode: changed ? 'UNAUTHENTICATED' : 'NOT_IMPLEMENTED',
      notice: changed
        ? '登录状态已变化，旧请求没有重放；请重新进入任务页。'
        : '本人任务与登录会话尚未接通，当前没有读取或修改私人任务。',
      noticeType: 'warning',
    });
  };
  function restorePending() {
    if (!pendingStorage || pending || !scopeCurrent(captureScope())) {
      return !storageBlocked;
    }
    const scope = captureScope();
    let saved;
    try {
      saved = pendingStorage.read(scope.scope);
      storageBlocked = false;
    } catch {
      storageBlocked = true;
    }
    if (!saved && !storageBlocked) {
      send({ storageBlocked: false });
      return true;
    }
    // An older page read cannot replace the recovery state or its notice.
    generation++;
    suggestions = [];
    if (saved) {
      pending = saved;
      pendingScope = scope;
    }
    clearHistory();
    send({
      suggestions: [],
      taskListLoaded: false,
      loading: false,
      storageBlocked,
      retryPending: Boolean(saved),
      writeBlocked: true,
      notice: storageBlocked
        ? '本机任务记录暂时无法读取，请重新读取后再操作。'
        : '上一任务操作结果尚未确认，请重试原操作。',
      noticeType: 'warning',
    });
    return !storageBlocked;
  }
  function clearPendingRequest(scope, request) {
    try {
      pendingStorage?.clear(scope.scope, request);
    } catch {
      throw new AppError('INVALID_RESPONSE', '本机原请求暂未清除，请重试原操作。');
    }
    pending = null;
    pendingScope = null;
  }
  async function load(view = 'suggestions') {
    if (disposed || suspended || !restorePending() || busy || pending) {
      return;
    }
    clearHistory();
    if (view === 'history' && readOnly) {
      send({
        history: [],
        errorCode: 'NOT_IMPLEMENTED',
        notice: '任务历史暂未开放，可先看看建议。',
        noticeType: 'info',
      });
      return;
    }
    activeView = view === 'history' ? 'history' : 'suggestions';
    const scope = captureScope();
    if (activeView === 'history' && !scopeCurrent(scope)) {
      privateUnavailable();
      return;
    }
    const token = ++generation;
    if (view === 'history') {
      send({ history: [] });
    } else {
      suggestions = [];
      send({ suggestions: [], taskListLoaded: false });
    }
    send({
      loading: true,
      writeBlocked: true,
      errorCode: '',
      notice: '正在读取任务服务…',
      noticeType: 'info',
    });
    try {
      if (view === 'history') {
        const to = businessDate(now());
        const from = new Date(Date.parse(to + 'T00:00:00Z') - (HISTORY_DAYS - 1) * 86400000)
          .toISOString()
          .slice(0, 10);
        historyQuery = Object.freeze({ from, to });
      }
      const result = view === 'history' ? await api.history(historyQuery) : await api.suggestions();
      const rows = items(result, view === 'history');
      if (configuredReadOnly && rows.some((item) => item.state !== 'available')) {
        invalid();
      }
      if (
        view !== 'history' &&
        Object.prototype.hasOwnProperty.call(result.data, 'readOnly') &&
        typeof result.data.readOnly !== 'boolean'
      ) {
        invalid();
      }
      if (!current(token)) {
        return;
      }
      if (scope !== null && scope !== undefined && !scopeCurrent(scope)) {
        privateUnavailable(true);
        return;
      }
      if (view !== 'history') {
        suggestions = rows;
        readOnly = configuredReadOnly || result.data.readOnly === true;
      } else {
        const next = nextHistoryCursor(result);
        historyRows = rows;
        historyCursor = next;
        historyScope = scope;
        if (next !== null) {
          historyCursors.add(next);
        }
      }
      send({
        [view === 'history' ? 'history' : 'suggestions']: rows,
        [view === 'history' ? 'historyLoaded' : 'taskListLoaded']: true,
        historyHasMore: historyCursor !== null,
        tasksReadOnly: readOnly,
        writeBlocked: readOnly || !scopeCurrent(scope),
        notice: rows.length
          ? readOnly
            ? readOnlyNotice
            : scopeCurrent(scope)
              ? ''
              : '可先浏览建议，登录后选择任务。'
          : view === 'history'
            ? ''
            : '暂无可用任务。',
        noticeType: 'info',
      });
    } catch (error) {
      if (current(token)) {
        if (scope !== null && scope !== undefined && !scopeCurrent(scope)) {
          privateUnavailable(true);
          return;
        }
        send({
          [view === 'history' ? 'history' : 'suggestions']: [],
          errorCode: error.code || 'NETWORK_ERROR',
          notice:
            error.code === 'NOT_IMPLEMENTED'
              ? '任务暂不可用，请稍后重试。'
              : error.code === 'UNAUTHENTICATED'
                ? '请先登录后查看本人任务历史。'
                : '任务读取失败，请重试。',
          noticeType: 'warning',
        });
      }
    } finally {
      if (current(token)) {
        send({ loading: false });
      }
    }
  }
  async function loadMoreHistory() {
    if (
      disposed ||
      suspended ||
      busy ||
      pending ||
      historyReadBusy ||
      activeView !== 'history' ||
      readOnly ||
      historyCursor === null
    ) {
      return;
    }
    const scope = historyScope;
    if (!scopeCurrent(scope)) {
      privateUnavailable(true);
      return;
    }
    const token = ++generation;
    const query = historyPageQuery || Object.freeze({ ...historyQuery, cursor: historyCursor });
    historyPageQuery = query;
    historyReadBusy = true;
    send({ historyLoadingMore: true, historyMoreError: '' });
    try {
      const result = await api.history(query);
      if (!current(token)) {
        return;
      }
      if (!scopeCurrent(scope)) {
        privateUnavailable(true);
        return;
      }
      const rows = items(result, true);
      const next = nextHistoryCursor(result);
      // task_history stores one current state per task and business date.
      const seen = new Set(historyRows.map((row) => row.taskId + ':' + row.date));
      const appended = [];
      for (const row of rows) {
        const key = row.taskId + ':' + row.date;
        if (!seen.has(key)) {
          seen.add(key);
          appended.push(row);
        }
      }
      historyRows = historyRows.concat(appended);
      historyCursor = next;
      historyPageQuery = null;
      if (next !== null) {
        historyCursors.add(next);
      }
      send({ history: historyRows, historyHasMore: next !== null, historyMoreError: '' });
    } catch (error) {
      if (current(token)) {
        if (
          !scopeCurrent(scope) ||
          ['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(error.code)
        ) {
          privateUnavailable(true);
        } else {
          send({ historyMoreError: '后续历史读取失败，已显示的记录仍保留，请重试加载。' });
        }
      }
    } finally {
      if (current(token)) {
        historyReadBusy = false;
        send({ historyLoadingMore: false });
      }
    }
  }
  async function transition(taskId, action) {
    if (disposed || suspended || busy || !restorePending()) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(TARGETS, action)) {
      return;
    }
    // A valid identity does not imply that this backend implements task writes.
    // Retained unknown requests still use the existing receipt recovery path.
    if (configuredReadOnly || (readOnly && !pending)) {
      send({
        writeBlocked: true,
        errorCode: 'NOT_IMPLEMENTED',
        notice: readOnlyNotice,
        noticeType: 'info',
      });
      return;
    }
    if (pending && !scopeCurrent(pendingScope)) {
      privateUnavailable(true);
      return;
    }
    const scope = pending ? pendingScope : captureScope();
    if (!scopeCurrent(scope)) {
      privateUnavailable();
      return;
    }
    if (pending && (pending.payload.taskId !== taskId || pending.payload.transition !== action)) {
      send({ notice: '上一操作结果尚未确认，请先重试原操作。', noticeType: 'warning' });
      return;
    }
    const selected = suggestions.find((item) => item.id === taskId);
    if (!pending && (!selected || !selected['can' + action[0].toUpperCase() + action.slice(1)])) {
      return;
    }
    if (!pending) {
      const request = api.createTransitionRequest({
        taskId,
        transition: action,
        expectedDate: businessDate(now()),
      });
      try {
        pendingStorage?.save(scope.scope, request);
      } catch {
        storageBlocked = true;
        send({
          storageBlocked: true,
          writeBlocked: true,
          notice: '本机任务请求暂未保存，未发送操作。请重新读取后再试。',
          noticeType: 'warning',
        });
        return;
      }
      pending = request;
    }
    pendingScope = scope;
    const request = pending;
    const writeToken = ++writeSequence;
    busy = true;
    clearHistory();
    ++generation;
    send({
      busy: true,
      loading: false,
      errorCode: '',
      retryPending: true,
      writeBlocked: true,
      notice: '正在提交任务操作…',
      noticeType: 'info',
    });
    try {
      const result = await api.submit(request);
      if (
        !result ||
        result.ok !== true ||
        !result.data ||
        result.data.taskId !== taskId ||
        result.data.state !== TARGETS[action] ||
        result.data.date !== request.payload.expectedDate
      ) {
        invalid();
      }
      if (disposed || pending !== request || !scopeCurrent(scope)) {
        return;
      }
      clearPendingRequest(scope, request);
      suggestions = suggestions.map((item) =>
        item.id === taskId ? task({ ...item, taskId, state: result.data.state }) : item,
      );
      pending = null;
      pendingScope = null;
      if (refreshAfterWrite) {
        refreshOnResume = true;
      }
      send({
        suggestions,
        history: [],
        retryPending: false,
        writeBlocked: readOnly,
        notice: '任务状态已更新。',
        noticeType: 'success',
      });
      return true;
    } catch (error) {
      if (!disposed && pending === request && scopeCurrent(scope)) {
        // Unknown outcomes retain the exact frozen request and block a different write.
        if (
          error.code &&
          !['NETWORK_ERROR', 'INVALID_RESPONSE', 'INTERNAL_ERROR'].includes(error.code)
        ) {
          try {
            clearPendingRequest(scope, request);
          } catch {
            // Preserve the frozen request until local cleanup can be confirmed.
          }
        }
        if (error.code === 'NOT_IMPLEMENTED' && !pending) {
          readOnly = true;
        }
        const expired =
          error.code === 'CONFLICT' &&
          request.payload.expectedDate !== businessDate(now()) &&
          !pending;
        if (expired) {
          suggestions = [];
          // A new operation requires a separate current-day read and user choice.
          refreshOnResume = false;
        }
        send({
          ...(expired ? { suggestions: [], taskListLoaded: false } : {}),
          writeBlocked: Boolean(pending) || readOnly || expired,
          tasksReadOnly: readOnly,
          retryPending: Boolean(pending),
          errorCode: error.code || 'NETWORK_ERROR',
          notice: expired
            ? '原任务操作已跨日，未写入今天。请重新读取当天任务后再选择。'
            : pending
              ? '任务操作结果尚未确认，请重试原操作。'
              : error.code === 'NOT_IMPLEMENTED'
                ? '任务操作暂未开放，请重新读取。'
                : '任务操作未被接受，请重新读取当前状态。',
          noticeType: 'warning',
        });
      }
    } finally {
      // A retired account's write cannot release a newer account's busy state.
      if (writeToken === writeSequence) {
        busy = false;
        if (!disposed && !suspended) {
          if (!scopeCurrent(scope)) {
            privateUnavailable(true);
          } else {
            send({ busy: false });
            if (refreshOnResume && !pending) {
              refreshOnResume = false;
              await Promise.all([load(activeView), loadChoices()]);
            }
          }
        }
      }
    }
  }
  async function loadChoices() {
    if (disposed || suspended) {
      return;
    }
    const token = ++choiceGeneration;
    send({ quickEntries: [] });
    try {
      const result = await api.quickChoice();
      if (!result || result.ok !== true || !result.data || !Array.isArray(result.data.entries)) {
        invalid();
      }
      const entries = result.data.entries;
      if (
        entries.some(
          (item) =>
            !item ||
            !['places', 'tasks'].includes(item.kind) ||
            typeof item.label !== 'string' ||
            typeof item.enabled !== 'boolean',
        )
      ) {
        invalid();
      }
      if (token === choiceGeneration) {
        send({ quickEntries: entries });
      }
    } catch (_error) {
      if (token === choiceGeneration) {
        send({ quickEntries: [] });
      }
    }
  }
  const unsubscribe =
    session && typeof session.subscribe === 'function'
      ? session.subscribe(() => {
          if (disposed) {
            return;
          }
          generation++;
          choiceGeneration++;
          writeSequence++;
          busy = false;
          pending = null;
          pendingScope = null;
          storageBlocked = false;
          send({ storageBlocked: false });
          refreshOnResume = false;
          suggestions = [];
          privateUnavailable(true);
        })
      : null;
  return {
    load,
    getWorkStatus: () => ({
      draft: false,
      pending: !disposed && (busy || !!pending || storageBlocked),
    }),
    loadMoreHistory,
    loadChoices,
    transition,
    retry() {
      if (disposed || suspended || busy || !restorePending()) {
        return;
      }
      return pending
        ? transition(pending.payload.taskId, pending.payload.transition)
        : load(activeView);
    },
    suspend() {
      if (disposed) {
        return;
      }
      generation++;
      choiceGeneration++;
      suggestions = [];
      clearHistory();
      refreshOnResume = true;
      send({
        suggestions: [],
        taskListLoaded: false,
        history: [],
        quickEntries: [],
        loading: false,
        busy: false,
        retryPending: false,
        writeBlocked: true,
        errorCode: '',
        notice: '',
        noticeType: 'info',
      });
      suspended = true;
    },
    async resume(view = activeView) {
      if (disposed) {
        return;
      }
      suspended = false;
      activeView = view === 'history' ? 'history' : 'suggestions';
      if (!restorePending()) {
        return;
      }
      if (pending && !scopeCurrent(pendingScope)) {
        privateUnavailable(true);
        return;
      }
      send({
        busy,
        retryPending: Boolean(pending) && !busy,
        writeBlocked: readOnly || !scopeCurrent(captureScope()),
        loading: false,
      });
      if (busy || pending) {
        send({
          notice: busy ? '正在等待原操作响应…' : '上一操作结果尚未确认，请重试原操作。',
          noticeType: 'warning',
        });
        return;
      }
      refreshOnResume = false;
      await Promise.all([load(activeView), loadChoices()]);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      generation++;
      choiceGeneration++;
      writeSequence++;
      suggestions = [];
      pending = null;
      pendingScope = null;
      clearHistory();
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    },
  };
}
module.exports = { createCloudTaskController };
