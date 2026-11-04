const { setImmediate } = require('node:timers');
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../miniprogram/modules/campus/service');
const { validateCorrectPlace } = require('../cloudfunctions/moodsky/domains/campus-rules');

test('QH04 page builds the backend correction contract and retains the original retry', () => {
  const originalPage = globalThis.Page;
  const ready = service.privateActionsReady;
  const file = require.resolve('../miniprogram/pages/campus/index');
  let definition;
  globalThis.Page = (value) => {
    definition = value;
  };
  try {
    delete require.cache[file];
    require(file);
    service.privateActionsReady = true;
    for (const text of ['😀', '😀'.repeat(200)]) {
      const page = {
        ...definition,
        data: {
          ...definition.data,
          isProduction: false,
          catalogMode: 'cloud',
          selectedPlace: { placeId: 'test-place' },
          correctionText: text,
        },
        setData(patch) {
          Object.assign(this.data, patch);
        },
        submitCorrectionRequest(pending) {
          this.sent = pending;
        },
      };
      page.onSubmitCorrection();
      const pending = page.sent;
      assert.deepEqual(validateCorrectPlace(pending.request.payload), {
        placeId: 'test-place',
        text,
      });
      page.onCorrectionInput({ detail: { value: text } });
      assert.equal(page._pendingCorrectionRequest, pending);
      page.onRetryCorrection();
      assert.equal(page.sent.request, pending.request);
      page.onCorrectionInput({ detail: { value: 'changed' } });
      assert.equal(page._pendingCorrectionRequest, null);
    }
  } finally {
    service.privateActionsReady = ready;
    globalThis.Page = originalPage;
    delete require.cache[file];
  }
});

test('QH02-QH04 actual page calls local router for favorite, correction, review and reread', async () => {
  const { createRouter } = require('../cloudfunctions/moodsky/router');
  const { createMemoryRepositories } = require('./support/campus-repository');
  const fixtures = require('./support/campus-fixtures');
  const { campusResult } = require('../miniprogram/modules/campus/cloud-result');
  const repositories = createMemoryRepositories({ places: fixtures.places });
  const router = createRouter({
    repositories,
    now: () => fixtures.NOW,
    resolveAccount: async (id) => ({ id, status: id === 'disabled' ? 'disabled' : 'active' }),
    resolveOperatorRoles: async (id) => (id === 'operator' ? ['data_operator'] : []),
  });
  const api = require('../miniprogram/services/api');
  let actor = 'student-a';
  const invoke = async (action, payload) => {
    const result = await router(api.createRequest(action, payload), { OPENID: actor });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const saved = {
    submit: service.submit,
    getPlace: service.getPlace,
    ready: service.privateActionsReady,
  };
  const oldPage = globalThis.Page;
  let definition;
  globalThis.Page = (value) => {
    definition = value;
  };
  const file = require.resolve('../miniprogram/pages/campus/index');
  delete require.cache[file];
  require(file);
  const page = {
    ...definition,
    data: {
      ...definition.data,
      isProduction: false,
      catalogMode: 'cloud',
      selectedPlace: { placeId: 'p_library' },
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      await new Promise(setImmediate);
    }
  };
  try {
    service.privateActionsReady = true;
    service.submit = async (request) => {
      const result = await router(request, { OPENID: actor });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result;
    };
    page.loadFavorites();
    await settle();
    page.onToggleFavorite();
    await settle();
    assert.equal(page.data.selectedPlaceFavorited, true);
    page.onToggleFavorite();
    await settle();
    assert.equal(page.data.selectedPlaceFavorited, false);
    page.onCorrectionInput({ detail: { value: '😀'.repeat(201) } });
    page.onSubmitCorrection();
    assert.equal(page.data.correctionState, 'invalid');
    page.onCorrectionInput({ detail: { value: '开放时间需核对😀' } });
    page.onSubmitCorrection();
    await settle();
    assert.equal(page.data.correctionState, 'submitted');
    const correction = repositories._state.corrections[0];
    assert.equal(correction.ownerId, 'student-a');
    actor = 'operator';
    await invoke('admin.reviewCorrection', {
      correctionId: correction._id,
      decision: 'approved',
      note: '合成本地审核',
    });
    const row = repositories._state.places.find((p) => p.placeId === 'p_library');
    await invoke('admin.updatePlace', {
      placeId: 'p_library',
      expectedUpdatedAt: row.updatedAt,
      changes: { openHours: '合成修改后的开放时间' },
    });
    service.getPlace = async (placeId) =>
      campusResult('campus.getPlace', await invoke('campus.getPlace', { placeId }));
    page._catalog = { getPlace: service.getPlace };
    page.requestPlaceDetail('p_library');
    await settle();
    assert.equal(page.data.selectedPlace.openHours, '合成修改后的开放时间');
    assert.equal(JSON.stringify(page.data.selectedPlace).includes('开放时间需核对'), false);
    actor = 'student-b';
    const b = await invoke('campus.favorites', { operation: 'list' });
    assert.deepEqual(b.data.items, []);
    const forbidden = await router(api.createRequest('admin.listCorrections', {}), {
      OPENID: actor,
    });
    assert.equal(forbidden.ok, false);
    actor = 'disabled';
    const disabled = await router(api.createRequest('campus.favorites', { operation: 'list' }), {
      OPENID: actor,
    });
    assert.equal(disabled.ok, false);
    page.onHide();
    assert.deepEqual(page.data.favorites, []);
    assert.equal(page.data.correctionText, '');
  } finally {
    service.submit = saved.submit;
    service.getPlace = saved.getPlace;
    service.privateActionsReady = saved.ready;
    globalThis.Page = oldPage;
    delete require.cache[file];
  }
});

test('QH03 session changes immediately clear private campus state and unload unsubscribes', () => {
  const { cloudSessionState } = require('../miniprogram/services/session-state');
  const oldPage = globalThis.Page;
  const file = require.resolve('../miniprogram/pages/campus/index');
  let definition;
  globalThis.Page = (value) => {
    definition = value;
  };
  delete require.cache[file];
  require(file);
  const page = {
    ...definition,
    data: { ...definition.data, isExperience: false },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    loadCloudPlaces() {},
  };
  try {
    page.onLoad();
    Object.assign(page.data, {
      favorites: ['private-place'],
      correctionText: 'private draft',
      selectedPlace: { placeId: 'private-place' },
    });
    cloudSessionState.accept('scope_' + 'a'.repeat(64));
    assert.deepEqual(page.data.favorites, []);
    assert.equal(page.data.correctionText, '');
    assert.equal(page.data.selectedPlace, null);
    page.onUnload();
    assert.equal(page._unsubscribeCampusSession, null);
  } finally {
    page.onUnload();
    cloudSessionState.clear();
    globalThis.Page = oldPage;
    delete require.cache[file];
  }
});

test('first login and visible/hidden account changes restart lists and reject late responses', async () => {
  const { cloudSessionState } = require('../miniprogram/services/session-state');
  const oldPage = globalThis.Page;
  const oldWx = globalThis.wx;
  const oldList = service.listPlaces;
  const file = require.resolve('../miniprogram/pages/campus/index');
  let definition;
  const calls = [];
  service.listPlaces = () =>
    new Promise((resolve) => {
      calls.push(resolve);
    });
  globalThis.Page = (value) => {
    definition = value;
  };
  globalThis.wx = {};
  delete require.cache[file];
  require(file);
  const page = {
    ...definition,
    data: { ...definition.data, isExperience: false },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  const settle = async () => {
    await new Promise(setImmediate);
    await new Promise(setImmediate);
  };
  const reply = (name) => ({
    data: {
      items: name ? [{ placeId: name }] : [],
      page: 1,
      pageSize: 2,
      total: name ? 1 : 0,
      hasMore: false,
    },
  });
  try {
    cloudSessionState.clear();
    page.onLoad();
    await settle();
    cloudSessionState.accept('scope_' + 'b'.repeat(64));
    await settle();
    assert.equal(calls.length, 2);
    calls[0](reply('old'));
    await settle();
    assert.equal(page.data.places.length, 0);
    calls[1](reply());
    await settle();
    assert.equal(page.data.listState, 'empty');
    cloudSessionState.accept('scope_' + 'c'.repeat(64));
    await settle();
    assert.equal(calls.length, 3);
    page.onHide();
    cloudSessionState.accept('scope_' + 'd'.repeat(64));
    await settle();
    assert.equal(calls.length, 3);
    calls[2](reply('hidden-old'));
    await settle();
    assert.equal(page.data.places.length, 0);
    page.onShow();
    await settle();
    assert.equal(calls.length, 4);
    calls[3](reply());
    await settle();
    assert.equal(page.data.listState, 'empty');
  } finally {
    page.onUnload();
    cloudSessionState.clear();
    service.listPlaces = oldList;
    globalThis.Page = oldPage;
    globalThis.wx = oldWx;
    delete require.cache[file];
  }
});
