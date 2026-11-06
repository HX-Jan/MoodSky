(function registerCatalogue(root) {
  const ACTIONS = {
    templates: 'admin.listTaskTemplates',
    resources: 'admin.listSupportResources',
    corrections: 'admin.listCorrections',
  };
  const COPY = {
    FORBIDDEN: '当前账号没有资料维护权限，输入已保留。',
    UNAUTHENTICATED: '登录已失效，请重新登录。',
    ACCOUNT_DISABLED: '账号已停用，不能维护资料。',
    NOT_IMPLEMENTED: '该服务尚未接通，输入已保留。',
    INVALID_INPUT: '请核对输入，当前草稿已保留。',
    CONFLICT: '资料已变化或审核读回未确认，请重新读取核对。',
    INVALID_RESPONSE: '返回结果不兼容，未确认操作成功。',
    NETWORK_ERROR: '网络请求未完成，当前草稿已保留。',
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  function data(result) {
    if (!result || result.ok !== true || !result.data) {
      fail('INVALID_RESPONSE');
    }
    return result.data;
  }
  function correction(row) {
    if (
      !row ||
      !id(row.correctionId) ||
      !id(row.placeId) ||
      typeof row.text !== 'string' ||
      !['pending', 'approved', 'rejected'].includes(row.status) ||
      !date(row.createdAt) ||
      (row.status !== 'pending' && !date(row.reviewedAt)) ||
      (row.reviewNote !== null && typeof row.reviewNote !== 'string')
    ) {
      fail('INVALID_RESPONSE');
    }
    return {
      correctionId: row.correctionId,
      placeId: row.placeId,
      text: row.text,
      status: row.status,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      reviewNote: row.reviewNote,
    };
  }
  function row(kind, input) {
    if (kind === 'corrections') {
      return correction(input);
    }
    const key = kind === 'templates' ? 'templateId' : 'resourceId';
    if (
      !input ||
      !id(input[key]) ||
      typeof input.enabled !== 'boolean' ||
      typeof input.isSynthetic !== 'boolean'
    ) {
      fail('INVALID_RESPONSE');
    }
    const fields =
      kind === 'templates'
        ? ['title', 'updatedAt']
        : ['name', 'campus', 'category', 'source', 'validUntil', 'verificationState'];
    const result = { [key]: input[key], enabled: input.enabled, isSynthetic: input.isSynthetic };
    for (const field of fields) {
      if (input[field] !== null && typeof input[field] !== 'string') {
        fail('INVALID_RESPONSE');
      }
      result[field] = input[field];
    }
    return result;
  }
  function page(kind, value, expectedPage) {
    if (
      !Array.isArray(value.items) ||
      value.items.length > 100 ||
      value.truncated !== false ||
      value.page !== expectedPage ||
      !Number.isInteger(value.total) ||
      value.total < value.items.length ||
      typeof value.hasMore !== 'boolean'
    ) {
      fail('INVALID_RESPONSE');
    }
    const items = value.items.map((item) => row(kind, item));
    const key =
      kind === 'templates' ? 'templateId' : kind === 'resources' ? 'resourceId' : 'correctionId';
    if (new Set(items.map((item) => item[key])).size !== items.length) {
      fail('INVALID_RESPONSE');
    }
    return { items, page: value.page, total: value.total, hasMore: value.hasMore };
  }
  function createCatalogueController({ api, session, enabled = false, publish = () => {} }) {
    let serial = 0,
      working = false,
      preflighting = false,
      suspended = false,
      disposed = false,
      pending = null;
    let state = {
      kind: 'templates',
      items: [],
      page: 1,
      total: 0,
      hasMore: false,
      selected: null,
      draft: null,
      dirty: false,
      pending: false,
      observed: null,
      loading: false,
      busy: false,
      canReview: false,
      notice: '',
      noticeType: 'info',
      errorCode: '',
    };
    const send = (patch) => {
      state = { ...state, ...patch };
      if (!disposed && !suspended) {
        publish(clone(state));
      }
    };
    function reset() {
      if (!preflighting) {
        serial++;
        working = false;
      }
      pending = null;
      send({
        items: [],
        selected: null,
        draft: null,
        dirty: false,
        pending: false,
        observed: null,
        loading: false,
        busy: false,
        canReview: false,
        page: 1,
        hasMore: false,
        total: 0,
        notice: '请登录后重新读取资料。',
        noticeType: 'info',
        errorCode: '',
      });
    }
    const unsubscribe = session.subscribe(reset);
    const current = (token, scope) =>
      !disposed && !suspended && token === serial && session.isCurrent(scope);
    function updateReview() {
      send({
        canReview: Boolean(
          enabled &&
          !working &&
          !pending &&
          state.selected?.status === 'pending' &&
          state.draft &&
          ['approved', 'rejected'].includes(state.draft.decision) &&
          session.isCurrent(session.capture()),
        ),
      });
    }
    async function run(kind, work, draftRequired = false, authOnly = false) {
      if (disposed || suspended || working) {
        return;
      }
      const token = ++serial,
        original = session.capture();
      working = true;
      preflighting = true;
      send({ [kind]: true, canReview: false, errorCode: '' });
      let scope;
      try {
        if (!authOnly && !enabled) {
          fail('NOT_IMPLEMENTED');
        }
        scope = await session.refresh();
        if (disposed || suspended || token !== serial) {
          return;
        }
        if (!scope || !session.isCurrent(scope)) {
          fail('UNAUTHENTICATED');
        }
        preflighting = false;
        if (draftRequired && (scope !== original || !state.selected)) {
          return;
        }
        send({ [kind]: true });
        await work(scope, token);
      } catch (error) {
        if (!disposed && !suspended && token === serial && (!scope || session.isCurrent(scope))) {
          const code = error.code || 'NETWORK_ERROR';
          if (['UNAUTHENTICATED', 'ACCOUNT_DISABLED'].includes(code)) {
            session.invalidate();
          }
          send({
            errorCode: code,
            notice: COPY[code] || '服务未确认结果，输入已保留。',
            noticeType: 'error',
          });
        }
      } finally {
        if (token === serial) {
          preflighting = false;
          working = false;
          send({ loading: false, busy: false, pending: Boolean(pending) });
          updateReview();
        }
      }
    }
    async function list(kind = state.kind, pageNumber = 1, discard = false) {
      if (!Object.hasOwn(ACTIONS, kind) || (!discard && (state.dirty || pending))) {
        return;
      }
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 1000) {
        return;
      }
      return run('loading', async (scope, token) => {
        const result = page(
          kind,
          data(await api.call(ACTIONS[kind], { page: pageNumber, pageSize: 20 })),
          pageNumber,
        );
        if (!current(token, scope)) {
          return;
        }
        pending = null;
        send({
          ...result,
          kind,
          selected: null,
          draft: null,
          dirty: false,
          pending: false,
          observed: null,
          notice:
            kind === 'corrections'
              ? '审核仅记录处理意见；地点修改需单独维护。'
              : '当前可读取资料；该类资料的保存服务尚未接通。',
          noticeType: 'info',
        });
      });
    }
    function select(correctionId) {
      if (
        disposed ||
        suspended ||
        working ||
        state.dirty ||
        pending ||
        state.kind !== 'corrections'
      ) {
        return;
      }
      const selected = state.items.find((item) => item.correctionId === correctionId);
      if (!selected) {
        return;
      }
      send({
        selected,
        draft: { decision: '', note: '' },
        observed: null,
        dirty: false,
        notice:
          selected.status === 'pending'
            ? '请选择审核结果；提交前将再次确认。'
            : '该记录已处理，只能查看。',
        noticeType: 'info',
      });
      updateReview();
    }
    function edit(key, value) {
      if (
        disposed ||
        suspended ||
        working ||
        pending ||
        state.selected?.status !== 'pending' ||
        !['decision', 'note'].includes(key) ||
        typeof value !== 'string'
      ) {
        return;
      }
      send({
        draft: { ...state.draft, [key]: value },
        dirty: true,
        notice: '审核草稿尚未提交。',
        noticeType: 'info',
      });
      updateReview();
    }
    async function verify(scope, token, attempt) {
      const result = page(
        'corrections',
        data(await api.call(ACTIONS.corrections, attempt.query)),
        attempt.query.page,
      );
      if (!current(token, scope) || pending !== attempt) {
        return;
      }
      const stored = result.items.find((item) => item.correctionId === attempt.input.correctionId);
      if (!stored || !attempt.acknowledged) {
        send({
          observed: stored || null,
          notice: stored
            ? '已读取当前审核状态；原提交结果仍未确认。核对后可放弃草稿并重新读取。'
            : '当前页未找到该记录，结果仍未确认。请放弃草稿后重新读取队列。',
          noticeType: 'warning',
        });
        return;
      }
      if (
        stored.placeId !== attempt.acknowledged.placeId ||
        stored.text !== attempt.acknowledged.text ||
        stored.status !== attempt.input.decision ||
        stored.reviewedAt !== attempt.acknowledged.reviewedAt ||
        stored.reviewNote !== attempt.acknowledged.reviewNote
      ) {
        fail('CONFLICT');
      }
      pending = null;
      send({
        ...result,
        selected: stored,
        draft: { decision: '', note: '' },
        dirty: false,
        pending: false,
        observed: null,
        notice: '审核状态已重新读取确认；地点资料保持原值。',
        noticeType: 'success',
      });
    }
    async function review(confirmed = false) {
      if (!confirmed || !state.canReview || pending) {
        return;
      }
      return run(
        'busy',
        async (scope, token) => {
          const input = Object.freeze({
            correctionId: state.selected.correctionId,
            decision: state.draft.decision,
            note: state.draft.note || null,
          });
          const attempt = { input, query: { page: state.page, pageSize: 20 }, acknowledged: null };
          pending = attempt;
          send({ pending: true, notice: '正在提交审核…', noticeType: 'info' });
          try {
            const result = data(await api.call('admin.reviewCorrection', input));
            if (!current(token, scope)) {
              return;
            }
            const record = correction(result.correction);
            if (
              typeof result.reviewed !== 'boolean' ||
              typeof result.alreadyReviewed !== 'boolean' ||
              result.reviewed === result.alreadyReviewed ||
              result.placeUpdated !== false ||
              record.correctionId !== input.correctionId ||
              record.placeId !== state.selected.placeId ||
              record.text !== state.selected.text ||
              record.status !== input.decision
            ) {
              fail('INVALID_RESPONSE');
            }
            attempt.acknowledged = record;
            await verify(scope, token, attempt);
          } catch (error) {
            if (
              current(token, scope) &&
              !attempt.acknowledged &&
              ['FORBIDDEN', 'NOT_IMPLEMENTED', 'INVALID_INPUT', 'NOT_FOUND'].includes(error.code)
            ) {
              pending = null;
            }
            throw error;
          }
        },
        true,
      );
    }
    return {
      list,
      select,
      edit,
      review,
      verifySaved: () =>
        pending ? run('busy', (scope, token) => verify(scope, token, pending), true) : undefined,
      suspend() {
        serial++;
        working = false;
        preflighting = false;
        suspended = true;
        publish({
          ...clone(state),
          items: [],
          selected: null,
          draft: null,
          observed: null,
          canReview: false,
          busy: false,
          loading: false,
        });
        state.busy = false;
        state.loading = false;
      },
      async resume() {
        if (!disposed) {
          suspended = false;
          await run('loading', async () => send({}), false, true);
        }
      },
      dispose() {
        reset();
        disposed = true;
        unsubscribe();
      },
    };
  }
  root.MoodSkyAdminCatalogue = Object.freeze({ createCatalogueController });
})(globalThis);
