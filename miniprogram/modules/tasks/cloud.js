const service = require('./service');
const { LIMITS } = require('../../shared/constants');
const { AppError } = require('../../shared/result');
const { isBusinessDate } = require('../../shared/date');

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
  return {
    id: history ? [item.taskId, item.date, state, item.createdAt || ''].join('_') : item.taskId,
    taskId: item.taskId,
    title: item.title || '小任务',
    date: item.date || '',
    description: typeof item.description === 'string' ? item.description : '',
    durationMin: item.durationMin,
    tagText: Array.isArray(item.tags) ? item.tags.join(' · ') : '',
    state,
    stateLabel: LABELS[state],
    canSelect: ['available', 'replaced', 'skipped'].includes(state),
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
function createCloudTaskController({ api = service, session, publish = () => {} } = {}) {
  let generation = 0;
  let choiceGeneration = 0;
  let disposed = false;
  let suspended = false;
  let refreshOnResume = false;
  let activeView = 'suggestions';
  let busy = false;
  let pending = null;
  let pendingScope = null;
  let suggestions = [];
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
  const privateUnavailable = (changed = false) =>
    send({
      history: [],
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
  async function load(view = 'suggestions') {
    if (disposed || suspended || busy || pending) {
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
      send({ suggestions: [] });
    }
    send({
      loading: true,
      writeBlocked: !scopeCurrent(scope),
      errorCode: '',
      notice: '正在读取任务服务…',
      noticeType: 'info',
    });
    try {
      const result = view === 'history' ? await api.history() : await api.suggestions();
      const rows = items(result, view === 'history');
      if (!current(token)) {
        return;
      }
      if (scope !== null && scope !== undefined && !scopeCurrent(scope)) {
        privateUnavailable(true);
        return;
      }
      if (view !== 'history') {
        suggestions = rows;
      }
      send({
        [view === 'history' ? 'history' : 'suggestions']: rows,
        notice: rows.length
          ? scopeCurrent(scope)
            ? '小任务由你自愿选择，可随时跳过。'
            : '任务建议可浏览；登录服务接通后可选择。'
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
              ? '任务接口尚未实现，请等待服务接入。'
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
  async function transition(taskId, action) {
    if (disposed || suspended || busy) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(TARGETS, action)) {
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
    pending = pending || api.createTransitionRequest({ taskId, transition: action });
    pendingScope = scope;
    const request = pending;
    busy = true;
    ++generation;
    send({
      busy: true,
      loading: false,
      errorCode: '',
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
        result.data.state !== TARGETS[action]
      ) {
        invalid();
      }
      if (disposed || pending !== request || !scopeCurrent(scope)) {
        return;
      }
      suggestions = suggestions.map((item) =>
        item.id === taskId ? task({ ...item, taskId, state: result.data.state }) : item,
      );
      pending = null;
      pendingScope = null;
      send({
        suggestions,
        history: [],
        retryPending: false,
        notice: '任务状态已由服务确认。',
        noticeType: 'success',
      });
    } catch (error) {
      if (!disposed && pending === request && scopeCurrent(scope)) {
        // Unknown outcomes retain the exact frozen request and block a different write.
        if (
          error.code &&
          !['NETWORK_ERROR', 'INVALID_RESPONSE', 'INTERNAL_ERROR'].includes(error.code)
        ) {
          pending = null;
          pendingScope = null;
        }
        send({
          retryPending: Boolean(pending),
          errorCode: error.code || 'NETWORK_ERROR',
          notice:
            error.code === 'NOT_IMPLEMENTED'
              ? '任务操作尚未实现，当前选择已保留。'
              : '未能确认任务操作，当前选择已保留。',
          noticeType: 'warning',
        });
      }
    } finally {
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
          suggestions = [];
          privateUnavailable(true);
        })
      : null;
  return {
    load,
    loadChoices,
    transition,
    retry: () =>
      pending ? transition(pending.payload.taskId, pending.payload.transition) : load(activeView),
    suspend() {
      if (disposed) {
        return;
      }
      generation++;
      choiceGeneration++;
      suggestions = [];
      refreshOnResume = true;
      send({
        suggestions: [],
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
      if (pending && !scopeCurrent(pendingScope)) {
        privateUnavailable(true);
        return;
      }
      send({
        busy,
        retryPending: Boolean(pending) && !busy,
        writeBlocked: !scopeCurrent(captureScope()),
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
      suggestions = [];
      pending = null;
      pendingScope = null;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    },
  };
}
module.exports = { createCloudTaskController };
