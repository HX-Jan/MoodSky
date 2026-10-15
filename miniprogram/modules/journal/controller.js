const { WEATHER_TYPES, JOURNAL_TAGS, LIMITS } = require('../../shared/constants');
const { validateJournalInput } = require('../../shared/validation');
const { businessDate, canCreateEntry, isBusinessDate } = require('../../shared/date');
const { AppError } = require('../../shared/result');

const UNKNOWN_RESULTS = ['NETWORK_ERROR', 'INVALID_RESPONSE', 'INTERNAL_ERROR'];
const ERROR_COPY = {
  NETWORK_ERROR: '未能确认操作结果。输入已保留，请重试原操作。',
  INVALID_RESPONSE: '未能确认服务返回的结果。输入已保留，请重试原操作。',
  INTERNAL_ERROR: '暂时无法确认操作结果，请重试原操作。',
  NOT_IMPLEMENTED: '记录服务尚未开放，本次尚未保存或修改数据。',
  CLOUD_NOT_CONFIGURED: '记录服务尚未连接，输入已保留。',
  CONFLICT: '记录状态已变化，输入已保留。请重新读取后再编辑。',
  INVALID_INPUT: '输入未通过服务校验，请检查日期和内容。',
  UNAUTHENTICATED: '登录状态需要重新确认，已清空本页内容。',
  ACCOUNT_DISABLED: '账号已停用，已清空本页内容。',
  FORBIDDEN: '当前不能执行这项操作。',
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function readEntry(result, date) {
  if (!result || result.ok !== true || !result.data || !hasOwn(result.data, 'entry')) {
    throw new AppError('INVALID_RESPONSE', '记录结果不完整。');
  }
  const entry = result.data.entry;
  if (entry === null) {
    return null;
  }
  if (
    !entry ||
    typeof entry !== 'object' ||
    entry.date !== date ||
    typeof entry.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id) ||
    !Number.isSafeInteger(entry.version) ||
    entry.version <= 0 ||
    !Array.isArray(entry.tags) ||
    typeof entry.text !== 'string' ||
    typeof entry.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(entry.createdAt)) ||
    typeof entry.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(entry.updatedAt))
  ) {
    throw new AppError('INVALID_RESPONSE', '记录结果不完整。');
  }
  let normalized;
  try {
    normalized = validateJournalInput({
      date: entry.date,
      weather: entry.weather,
      tags: entry.tags,
      text: entry.text,
      expectedVersion: entry.version,
    });
  } catch (_error) {
    throw new AppError('INVALID_RESPONSE', '记录内容格式不兼容。');
  }
  return {
    id: entry.id,
    date: normalized.date,
    weather: normalized.weather,
    tags: normalized.tags,
    text: normalized.text,
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function createJournalController({
  service,
  now = () => new Date(),
  onChange = () => {},
  onChanged = () => {},
  isDemo = false,
}) {
  let generation = 0;
  let disposed = false;
  let pending = null;
  let requestedDate = null;
  const initial = () => ({
    today: businessDate(now()),
    date: businessDate(now()),
    entry: null,
    weather: '',
    tags: [],
    text: '',
    phase: 'idle',
    loaded: false,
    confirm: '',
    requiresReload: false,
    errorCode: '',
    notice: '先选择一天，再记录当时的天气。',
    noticeType: 'info',
  });
  let state = initial();
  const busy = () => state.phase !== 'idle';
  const dirty = () =>
    state.weather !== (state.entry ? state.entry.weather : '') ||
    state.text !== (state.entry ? state.entry.text : '') ||
    JSON.stringify(state.tags) !== JSON.stringify(state.entry ? state.entry.tags : []);
  function snapshot() {
    const textCount = Array.from(state.text).length;
    const locked = busy() || !!pending || !!state.confirm;
    return copy({
      ...state,
      isDemo,
      confirmationDate: requestedDate || '',
      confirmationAction:
        requestedDate && requestedDate !== state.date
          ? '放弃输入并查看 ' + requestedDate
          : '放弃输入并重新读取',
      recordStatus:
        state.phase === 'loading'
          ? '正在读取'
          : !state.loaded
            ? '未读取'
            : state.entry
              ? '已有记录'
              : '尚未记录',
      textCount,
      textLimit: LIMITS.journalTextCodePoints,
      tagLimit: LIMITS.journalTags,
      tagCount: state.tags.length,
      pendingRetry: !!pending,
      inputLocked: locked,
      canSave:
        !locked &&
        state.loaded &&
        !state.requiresReload &&
        !!state.weather &&
        textCount <= LIMITS.journalTextCodePoints &&
        (!!state.entry || canCreateEntry(state.date, now())),
      canDelete: !locked && state.loaded && !state.requiresReload && !!state.entry,
      canRetry: !!pending && !busy() && !state.confirm,
      canReload: !busy() && !state.confirm,
      canPreviousDate: !busy() && !state.confirm && state.date > '0000-01-01',
      canNextDate: !busy() && !state.confirm && state.date < state.today,
      canReturnToday: !busy() && !state.confirm && state.date !== state.today,
      isOlderNewDate: state.loaded && !state.entry && !canCreateEntry(state.date, now()),
      weatherOptions: WEATHER_TYPES.map((item) => ({
        ...item,
        selected: item.code === state.weather,
      })),
      tagOptions: JOURNAL_TAGS.map((item) => ({ ...item, selected: state.tags.includes(item.id) })),
    });
  }
  const emit = () => {
    if (!disposed) {
      onChange(snapshot());
    }
  };
  const active = (token) => !disposed && token === generation;
  const notice = (message, type = 'info') => {
    state.notice = message;
    state.noticeType = type;
  };
  function applyEntry(entry) {
    state.entry = entry;
    state.weather = entry ? entry.weather : '';
    state.tags = entry ? [...entry.tags] : [];
    state.text = entry ? entry.text : '';
  }
  function handleError(error) {
    const code = error && hasOwn(ERROR_COPY, error.code) ? error.code : 'INTERNAL_ERROR';
    if (code === 'ACCOUNT_DISABLED' || code === 'UNAUTHENTICATED') {
      generation++;
      pending = null;
      requestedDate = null;
      state = initial();
      state.errorCode = code;
      notice(ERROR_COPY[code], 'warning');
      emit();
      return;
    }
    state.errorCode = code;
    state.requiresReload = code === 'CONFLICT';
    if (!UNKNOWN_RESULTS.includes(code)) {
      pending = null;
    }
    notice(ERROR_COPY[code], 'warning');
  }
  function notify(kind) {
    try {
      onChanged({ date: state.date, kind });
    } catch (_error) {
      notice(
        isDemo
          ? '本地演示操作已完成，请重新进入回顾页刷新。'
          : '操作已完成，请重新进入回顾页刷新。',
        'info',
      );
    }
  }
  async function fetchDate(date) {
    const token = ++generation;
    pending = null;
    requestedDate = null;
    state = { ...initial(), date, phase: 'loading' };
    notice('正在读取这一天的记录。');
    emit();
    try {
      const result = await service.get(date);
      if (!active(token)) {
        return false;
      }
      applyEntry(readEntry(result, date));
      state.loaded = true;
      state.requiresReload = false;
      state.errorCode = '';
      notice(
        state.entry
          ? '这一天已有记录，可以修改后保存。'
          : canCreateEntry(date, now())
            ? '这一天还没有记录，选择天气即可保存。'
            : '这一天没有记录，已超出新建范围；已有旧记录仍可编辑。',
      );
      return true;
    } catch (error) {
      if (active(token)) {
        handleError(error);
      }
      return false;
    } finally {
      if (active(token)) {
        state.phase = 'idle';
        emit();
      }
    }
  }
  async function loadDate(date = state.date) {
    if (disposed || busy() || state.confirm) {
      return false;
    }
    if (!isBusinessDate(date)) {
      notice('请选择真实日期。', 'warning');
      emit();
      return false;
    }
    state.today = businessDate(now());
    if (dirty() || pending) {
      requestedDate = date;
      state.confirm = 'reload';
      notice(
        pending
          ? '结果尚未确认。重新读取会放弃本页输入，也可以取消后重试原操作。'
          : '重新读取会放弃尚未保存的输入，是否继续？',
        'warning',
      );
      emit();
      return false;
    }
    return fetchDate(date);
  }
  function refreshToday() {
    if (disposed) {
      return false;
    }
    state.today = businessDate(now());
    emit();
    return true;
  }
  function moveDate(direction) {
    if (disposed || busy() || state.confirm || ![-1, 1, 'today'].includes(direction)) {
      return Promise.resolve(false);
    }
    state.today = businessDate(now());
    let target = state.today;
    if (direction !== 'today') {
      const time = Date.parse(state.date + 'T00:00:00.000Z') + direction * 86400000;
      target = new Date(time).toISOString().slice(0, 10);
    }
    if (
      !isBusinessDate(target) ||
      (direction === 1 && target > state.today) ||
      target === state.date
    ) {
      emit();
      return Promise.resolve(false);
    }
    return loadDate(target);
  }
  async function confirmReload() {
    if (state.confirm !== 'reload' || busy() || disposed) {
      return false;
    }
    const date = requestedDate;
    state.confirm = '';
    return fetchDate(date);
  }
  function edit(field, value) {
    if (disposed || busy() || pending || state.confirm) {
      return false;
    }
    state[field] = value;
    state.errorCode = state.requiresReload ? 'CONFLICT' : '';
    if (!state.requiresReload) {
      notice('输入尚未保存。');
    }
    emit();
    return true;
  }
  function chooseWeather(code) {
    if (!WEATHER_TYPES.some((item) => item.code === code)) {
      return false;
    }
    return edit('weather', code);
  }
  function toggleTag(id) {
    if (
      disposed ||
      busy() ||
      pending ||
      state.confirm ||
      !JOURNAL_TAGS.some((item) => item.id === id)
    ) {
      return false;
    }
    if (!state.tags.includes(id) && state.tags.length >= LIMITS.journalTags) {
      notice('最多选择 5 个标签。', 'warning');
      emit();
      return false;
    }
    return edit(
      'tags',
      state.tags.includes(id) ? state.tags.filter((item) => item !== id) : [...state.tags, id],
    );
  }
  function setText(text) {
    if (typeof text !== 'string') {
      return false;
    }
    const changed = edit('text', text);
    if (changed && Array.from(text).length > LIMITS.journalTextCodePoints) {
      notice('正文最多 1000 个字，emoji 也计入长度。', 'warning');
      emit();
    }
    return changed;
  }
  async function send(operation) {
    const token = ++generation;
    state.phase = operation.kind === 'save' ? 'saving' : 'deleting';
    state.errorCode = '';
    state.confirm = '';
    notice(operation.kind === 'save' ? '正在保存，请稍候。' : '正在删除，请稍候。');
    emit();
    try {
      const result = await service.submit(operation.request);
      if (!active(token)) {
        return false;
      }
      if (operation.kind === 'save') {
        const entry = readEntry(result, operation.request.payload.date);
        const input = operation.request.payload;
        if (
          !entry ||
          entry.weather !== input.weather ||
          entry.text !== (input.text || '') ||
          JSON.stringify(entry.tags) !== JSON.stringify(input.tags || []) ||
          (input.expectedVersion > 0 &&
            (!state.entry ||
              entry.id !== state.entry.id ||
              entry.createdAt !== state.entry.createdAt ||
              entry.version !== input.expectedVersion + 1))
        ) {
          throw new AppError('INVALID_RESPONSE', '保存结果不匹配。');
        }
        applyEntry(entry);
        state.loaded = true;
        pending = null;
        state.requiresReload = false;
        notice(isDemo ? '已保存到本地演示，未上传云端。' : '已保存。', 'success');
        notify('saved');
      } else {
        if (
          !result ||
          result.ok !== true ||
          !result.data ||
          result.data.date !== operation.request.payload.date ||
          typeof result.data.deleted !== 'boolean'
        ) {
          throw new AppError('INVALID_RESPONSE', '删除结果不完整。');
        }
        pending = null;
        applyEntry(null);
        state.loaded = false;
        state.requiresReload = false;
        const deleted = result.data.deleted;
        try {
          const current = await service.get(state.date);
          if (!active(token)) {
            return false;
          }
          applyEntry(readEntry(current, state.date));
          state.loaded = true;
          notice(
            state.entry
              ? '原删除操作已确认；此日期已有更新记录，已重新读取。'
              : isDemo
                ? '本地演示记录已清除，未修改云端数据。'
                : deleted
                  ? '删除操作已确认。'
                  : '当前没有可删除的记录。',
            'success',
          );
        } catch (_error) {
          if (!active(token)) {
            return false;
          }
          notice('删除操作已确认；当前状态读取失败，请重新读取。', 'warning');
        }
        notify('deleted');
      }
      return true;
    } catch (error) {
      if (active(token)) {
        handleError(error);
      }
      return false;
    } finally {
      if (active(token)) {
        state.phase = 'idle';
        emit();
      }
    }
  }
  async function save() {
    if (disposed || busy() || pending || state.confirm) {
      return false;
    }
    if (!state.loaded) {
      notice('请先成功读取这一天的记录。', 'warning');
      emit();
      return false;
    }
    if (state.requiresReload) {
      notice(ERROR_COPY.CONFLICT, 'warning');
      emit();
      return false;
    }
    if (!state.entry && !canCreateEntry(state.date, now())) {
      notice('新记录只支持今天及此前 29 天。', 'warning');
      emit();
      return false;
    }
    let request;
    try {
      const input = validateJournalInput({
        date: state.date,
        weather: state.weather,
        tags: state.tags,
        text: state.text,
        expectedVersion: state.entry ? state.entry.version : 0,
      });
      request = service.createSaveRequest(input);
    } catch (error) {
      state.errorCode = 'INVALID_INPUT';
      notice(error instanceof AppError ? error.message : '请检查输入。', 'warning');
      emit();
      return false;
    }
    pending = { kind: 'save', request };
    return send(pending);
  }
  function requestDelete() {
    if (!snapshot().canDelete) {
      return false;
    }
    state.confirm = 'delete';
    notice('确认删除这一天的记录？未保存的修改也会放弃。', 'warning');
    emit();
    return true;
  }
  async function confirmDelete() {
    if (disposed || busy() || state.confirm !== 'delete' || !state.entry) {
      return false;
    }
    const request = service.createDeleteRequest({
      date: state.date,
      expectedVersion: state.entry.version,
    });
    pending = { kind: 'delete', request };
    return send(pending);
  }
  function cancelConfirm() {
    if (busy() || disposed) {
      return;
    }
    state.confirm = '';
    requestedDate = null;
    notice(pending ? '结果尚未确认，请重试原操作。' : '已取消，输入保持不变。');
    emit();
  }
  function retry() {
    if (disposed || busy() || state.confirm || !pending) {
      return Promise.resolve(false);
    }
    return send(pending);
  }
  function reset() {
    generation++;
    pending = null;
    requestedDate = null;
    state = initial();
    emit();
  }
  function dispose() {
    generation++;
    pending = null;
    requestedDate = null;
    state = initial();
    disposed = true;
  }
  emit();
  return {
    getState: snapshot,
    loadDate,
    moveDate,
    refreshToday,
    confirmReload,
    chooseWeather,
    toggleTag,
    setText,
    save,
    requestDelete,
    confirmDelete,
    cancelConfirm,
    retry,
    reset,
    dispose,
  };
}

module.exports = { createJournalController, readEntry };
