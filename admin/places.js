(function registerPlaces(root) {
  const FIELDS = ['name', 'campus', 'openHours', 'address', 'source', 'validUntil', 'enabled'];
  const COPY = {
    FORBIDDEN: '当前账号没有资料维护权限，输入已保留。',
    UNAUTHENTICATED: '登录已失效，请重新登录。',
    ACCOUNT_DISABLED: '账号已停用，不能维护资料。',
    NOT_IMPLEMENTED: '地点服务尚未接通，输入已保留。',
    CONFLICT: '资料已被更新，请保留草稿并重新读取后核对。',
    NOT_FOUND: '地点已不可用，当前输入已保留。',
    INVALID_INPUT: '请核对填写内容，当前输入已保留。',
    INVALID_RESPONSE: '无法确认服务结果，输入已保留。',
    NETWORK_ERROR: '网络请求未完成，输入已保留。',
  };
  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function place(input, expectedId) {
    if (
      !input ||
      typeof input.placeId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(input.placeId) ||
      (expectedId && input.placeId !== expectedId) ||
      typeof input.name !== 'string' ||
      typeof input.campus !== 'string' ||
      typeof input.enabled !== 'boolean' ||
      (input.updatedAt !== null &&
        (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt))))
    ) {
      fail('INVALID_RESPONSE');
    }
    const result = {
      placeId: input.placeId,
      updatedAt: input.updatedAt,
      verificationState: input.verificationState || 'unverified',
    };
    FIELDS.forEach((key) => {
      result[key] = input[key] === undefined ? null : input[key];
    });
    for (const key of ['openHours', 'address', 'source', 'validUntil']) {
      if (result[key] !== null && typeof result[key] !== 'string') {
        fail('INVALID_RESPONSE');
      }
    }
    return result;
  }
  function data(result) {
    if (!result || result.ok !== true || !result.data) {
      fail('INVALID_RESPONSE');
    }
    return result.data;
  }
  function sameChanges(record, changes) {
    return Object.entries(changes).every(([key, value]) => record[key] === value);
  }
  function createPlaceController({ api, session, enabled = false, publish = () => {} }) {
    let serial = 0;
    let working = false;
    let preflighting = false;
    let disposed = false;
    let suspended = false;
    let pending = null;
    let state = {
      items: [],
      selected: null,
      draft: null,
      dirty: false,
      loading: false,
      busy: false,
      pending: false,
      canSave: false,
      hasMore: false,
      page: 1,
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
        loading: false,
        busy: false,
        pending: false,
        canSave: false,
        hasMore: false,
        page: 1,
        observed: null,
        notice: '请登录后重新读取资料。',
        noticeType: 'info',
        errorCode: '',
      });
    }
    const unsubscribe = session.subscribe(reset);
    const current = (token, scope) =>
      !disposed && !suspended && token === serial && session.isCurrent(scope);
    const updateSave = () =>
      send({
        canSave: Boolean(
          enabled === true &&
          state.selected?.updatedAt &&
          state.dirty &&
          !working &&
          !pending &&
          session.isCurrent(session.capture()),
        ),
      });
    function report(error) {
      const code = error?.code || 'NETWORK_ERROR';
      if (['UNAUTHENTICATED', 'ACCOUNT_DISABLED'].includes(code)) {
        session.invalidate();
      }
      send({
        notice: COPY[code] || '服务未能确认操作，输入已保留。',
        noticeType: 'error',
        errorCode: code,
      });
    }
    // Lock before getSession: duplicate clicks must not dispatch two writes.
    // Identity changes during preflight clear drafts; changes during I/O fence late responses.
    async function run(kind, work, requiresDraft = false, authOnly = false) {
      if (disposed || suspended || working) {
        return;
      }
      const token = ++serial;
      const originalScope = session.capture();
      working = true;
      preflighting = true;
      send({ [kind]: true, canSave: false, errorCode: '' });
      let scope;
      try {
        if (!authOnly && enabled !== true) {
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
        if (requiresDraft && (scope !== originalScope || !state.selected)) {
          return;
        }
        send({ [kind]: true });
        await work(scope, token);
      } catch (error) {
        if (!disposed && !suspended && token === serial && (!scope || session.isCurrent(scope))) {
          report(error);
        }
      } finally {
        if (token === serial) {
          preflighting = false;
          working = false;
          send({ loading: false, busy: false, pending: Boolean(pending) });
          updateSave();
        }
      }
    }
    async function list(input = {}) {
      if (state.dirty || pending) {
        return;
      }
      return run('loading', async (scope, token) => {
        send({ items: [], hasMore: false, notice: '正在读取地点…', noticeType: 'info' });
        const result = data(await api.call('admin.listPlaces', input));
        if (!current(token, scope)) {
          return;
        }
        if (
          !Array.isArray(result.items) ||
          result.truncated !== false ||
          !Number.isInteger(result.page) ||
          result.page < 1 ||
          !Number.isInteger(result.total) ||
          result.total < 0 ||
          typeof result.hasMore !== 'boolean'
        ) {
          fail('INVALID_RESPONSE');
        }
        const items = result.items.map((row) => place(row));
        if (
          items.length > 100 ||
          result.total < items.length ||
          new Set(items.map((row) => row.placeId)).size !== items.length
        ) {
          fail('INVALID_RESPONSE');
        }
        send({
          items,
          page: result.page,
          hasMore: result.hasMore,
          notice: items.length ? '请选择要维护的地点。' : '没有符合条件的地点。',
          noticeType: 'info',
        });
      });
    }
    async function select(placeId, discard = false) {
      if ((state.dirty || pending) && !discard) {
        return;
      }
      return run('loading', async (scope, token) => {
        send({ notice: '正在读取地点详情…', noticeType: 'info' });
        const record = place(data(await api.call('admin.getPlace', { placeId })), placeId);
        if (!current(token, scope)) {
          return;
        }
        // An uncertain save stays blocked until a fresh detail read actually succeeds.
        pending = null;
        send({
          selected: record,
          draft: { ...record, markVerified: false },
          dirty: false,
          pending: false,
          notice: record.updatedAt
            ? '可以编辑资料；保存后将重新读取核对。'
            : '该资料缺少版本，暂时只读，请联系资料负责人。',
          noticeType: 'info',
        });
      });
    }
    function edit(key, value) {
      if (
        disposed ||
        suspended ||
        !state.draft ||
        working ||
        pending ||
        ![...FIELDS, 'markVerified'].includes(key)
      ) {
        return;
      }
      send({
        draft: { ...state.draft, [key]: value },
        dirty: true,
        errorCode: '',
        notice: '尚未保存。',
        noticeType: 'info',
      });
      updateSave();
    }
    async function verify(scope, token, attempt) {
      const record = place(
        data(await api.call('admin.getPlace', { placeId: attempt.placeId })),
        attempt.placeId,
      );
      if (!current(token, scope) || pending !== attempt) {
        return;
      }
      if (!attempt.acknowledged) {
        send({
          notice:
            '已重新读取当前资料；原保存结果仍未确认。请核对后放弃草稿并重读，再决定是否修改。',
          noticeType: 'warning',
          observed: record,
        });
        return;
      }
      if (
        record.updatedAt !== attempt.acknowledged.updatedAt ||
        !sameChanges(record, attempt.changes)
      ) {
        fail('CONFLICT');
      }
      pending = null;
      send({
        selected: record,
        draft: { ...record, markVerified: false },
        dirty: false,
        pending: false,
        observed: null,
        errorCode: '',
        notice: '地点已保存，并重新读取确认。',
        noticeType: 'success',
      });
    }
    async function save() {
      if (!state.canSave || pending) {
        return;
      }
      return run(
        'busy',
        async (scope, token) => {
          const changes = {};
          FIELDS.forEach((key) => {
            if (state.draft[key] !== state.selected[key]) {
              changes[key] = state.draft[key];
            }
          });
          if (!Object.keys(changes).length) {
            if (!state.draft.markVerified) {
              return;
            }
            changes.source = state.draft.source;
          }
          const attempt = {
            placeId: state.selected.placeId,
            changes: clone(changes),
            acknowledged: null,
          };
          pending = attempt;
          send({ pending: true, notice: '正在保存，等待服务确认…', noticeType: 'info' });
          const payload = {
            placeId: attempt.placeId,
            changes,
            markVerified: state.draft.markVerified,
            expectedUpdatedAt: state.selected.updatedAt,
          };
          try {
            const result = data(await api.call('admin.updatePlace', payload));
            if (!current(token, scope)) {
              return;
            }
            const record = place(result.place, attempt.placeId);
            if (
              result.saved !== true ||
              result.verified !== true ||
              !record.updatedAt ||
              record.updatedAt === state.selected.updatedAt ||
              !sameChanges(record, attempt.changes)
            ) {
              fail('INVALID_RESPONSE');
            }
            attempt.acknowledged = record;
            await verify(scope, token, attempt);
          } catch (error) {
            // This service has no durable request receipts. Unknown outcomes must not be resubmitted.
            if (
              current(token, scope) &&
              ['FORBIDDEN', 'NOT_IMPLEMENTED', 'INVALID_INPUT', 'CONFLICT', 'NOT_FOUND'].includes(
                error.code,
              ) &&
              !attempt.acknowledged
            ) {
              pending = null;
            }
            throw error;
          }
        },
        true,
      );
    }
    async function verifySaved() {
      const attempt = pending;
      if (!attempt) {
        return;
      }
      return run(
        'busy',
        async (scope, token) => {
          if (pending !== attempt) {
            return;
          }
          send({ notice: '正在重新读取核对，未重复提交保存。', noticeType: 'info' });
          await verify(scope, token, attempt);
        },
        true,
      );
    }
    return {
      list,
      select,
      edit,
      save,
      verifySaved,
      clear: reset,
      suspend() {
        serial++;
        working = false;
        preflighting = false;
        suspended = true;
        // Hide private view; preserve this identity's draft and unknown write in memory only.
        publish({
          ...clone(state),
          items: [],
          selected: null,
          draft: null,
          observed: null,
          canSave: false,
          busy: false,
          loading: false,
        });
        state.loading = false;
        state.busy = false;
      },
      async resume() {
        if (disposed) {
          return;
        }
        suspended = false;
        await run(
          'loading',
          async () => {
            send({});
          },
          false,
          true,
        );
      },
      dispose() {
        reset();
        disposed = true;
        unsubscribe();
      },
    };
  }
  root.MoodSkyAdminPlaces = Object.freeze({ createPlaceController });
})(globalThis);
