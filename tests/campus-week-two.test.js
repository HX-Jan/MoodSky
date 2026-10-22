const test = require('node:test');
const assert = require('node:assert/strict');
const campusService = require('../miniprogram/modules/campus/service');
const { FIELD_NOTE_PLACES } = require('../miniprogram/modules/campus/field-note-places');
const { canNavigateToPlace } = require('../miniprogram/modules/campus/presentation');

const PAGE_FILE = require.resolve('../miniprogram/pages/campus/index');

function loadPage(platform = {}) {
  const originalPage = globalThis.Page;
  const originalWx = globalThis.wx;
  let definition;
  globalThis.Page = (page) => {
    definition = page;
  };
  globalThis.wx = platform;
  delete require.cache[PAGE_FILE];
  require(PAGE_FILE);
  globalThis.Page = originalPage;
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
  return {
    page,
    restore() {
      globalThis.Page = originalPage;
      globalThis.wx = originalWx;
      delete require.cache[PAGE_FILE];
    },
  };
}

function wait() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settle() {
  await wait();
  await wait();
}

function cloudPlace(placeId, name = placeId) {
  return {
    placeId,
    name,
    campus: '福州大学旗山校区',
    address: '校园区域说明',
    source: '学校地图与成员核验记录',
    openHours: '待复核',
    openState: 'unknown',
    environmentTags: ['湖边'],
    verifiedAt: null,
    validUntil: null,
    enabled: true,
    isSynthetic: false,
    verificationStatus: 'pending_review',
    coordinateStatus: 'unverified',
    location: null,
    navigationAvailable: false,
  };
}

function listReply(items, page, total, hasMore) {
  return { data: { items, page, pageSize: 2, total, hasMore } };
}

test('five member field-note entries retain review status and omit unconfirmed coordinates', () => {
  assert.equal(FIELD_NOTE_PLACES.length, 5);
  for (const place of FIELD_NOTE_PLACES) {
    assert.equal(place.campus, '福州大学旗山校区');
    assert.equal(place.verifiedAt, null);
    assert.equal(place.verificationStatus, 'pending_review');
    assert.equal(place.location, null);
    assert.equal(place.navigationAvailable, false);
    assert.equal(canNavigateToPlace(place, '2026-10-21'), false);
  }
});

test('local field-note preview filters and paginates five member records', () => {
  const { page, restore } = loadPage();
  try {
    page.onStartFieldNotePreview();
    assert.equal(page.data.catalogMode, 'field-note');
    assert.equal(page.data.listState, 'ready');
    assert.equal(page.data.total, 5);
    assert.equal(page.data.places.length, 2);
    assert.equal(page.data.places[0].verificationLabel, '成员提交，待复核');
    page.onLoadMore();
    assert.equal(page.data.places.length, 4);
    page.onLoadMore();
    assert.equal(page.data.places.length, 5);
    assert.equal(page.data.hasMore, false);
    page.onTagChange({ detail: { value: page.data.tagOptions.indexOf('湖边') } });
    assert.equal(page.data.page, 1);
    assert.equal(page.data.total, 2);
    assert.equal(new Set(page.data.places.map((place) => place.placeId)).size, 2);
  } finally {
    restore();
  }
});

test('cloud list error stays in cloud mode and never silently loads the local preview', async () => {
  const originalListPlaces = campusService.listPlaces;
  campusService.listPlaces = () => Promise.reject(Object.assign(new Error('NOT_IMPLEMENTED'), { code: 'NOT_IMPLEMENTED' }));
  const { page, restore } = loadPage();
  try {
    page.onLoad();
    await settle();
    assert.equal(page.data.catalogMode, 'cloud');
    assert.equal(page.data.demoEnabled, false);
    assert.equal(page.data.listState, 'error');
    assert.deepEqual(page.data.places, []);
    assert.equal(page.data.cloudState, 'error');
    page.onLoadCloudPlaces();
    await settle();
    assert.equal(page.data.listState, 'error');
    assert.deepEqual(page.data.places, []);
  } finally {
    campusService.listPlaces = originalListPlaces;
    restore();
  }
});

test('cloud filter resets pagination and repeated page items are not duplicated', async () => {
  const originalListPlaces = campusService.listPlaces;
  const requests = [];
  campusService.listPlaces = (filters) => {
    requests.push(filters);
    if (filters.page === 1 && filters.tags.length === 0) {
      return Promise.resolve(listReply([cloudPlace('A'), cloudPlace('B')], 1, 3, true));
    }
    if (filters.page === 2 && filters.tags.length === 0) {
      return Promise.resolve(listReply([cloudPlace('B'), cloudPlace('C')], 2, 3, false));
    }
    return Promise.resolve(listReply([cloudPlace('D')], 1, 1, false));
  };
  const { page, restore } = loadPage();
  try {
    page.onLoad();
    await settle();
    assert.equal(page.data.listState, 'ready');
    page.onLoadMore();
    page.onLoadMore();
    await Promise.resolve();
    assert.equal(requests.length, 2);
    await settle();
    assert.deepEqual(page.data.places.map((place) => place.placeId), ['A', 'B', 'C']);
    assert.equal(new Set(page.data.places.map((place) => place.placeId)).size, 3);
    const tagIndex = page.data.tagOptions.indexOf('湖边');
    page.onTagChange({ detail: { value: tagIndex } });
    await settle();
    assert.equal(page.data.page, 1);
    assert.equal(requests.at(-1).page, 1);
    assert.deepEqual(requests.at(-1).tags, ['湖边']);
    assert.deepEqual(page.data.places.map((place) => place.placeId), ['D']);
  } finally {
    campusService.listPlaces = originalListPlaces;
    restore();
  }
});

test('cloud detail reports failure, retries, and ignores a stale earlier selection', async () => {
  const originalListPlaces = campusService.listPlaces;
  const originalGetPlace = campusService.getPlace;
  campusService.listPlaces = () => Promise.resolve(listReply([cloudPlace('P1'), cloudPlace('P2')], 1, 2, false));
  let firstResolve;
  let p1Calls = 0;
  campusService.getPlace = (placeId) => {
    if (placeId === 'P1') {
      p1Calls += 1;
      if (p1Calls === 1) {
        return Promise.reject(new Error('temporary detail failure'));
      }
      return new Promise((resolve) => {
        firstResolve = resolve;
      });
    }
    return Promise.resolve({ data: { place: cloudPlace(placeId, 'newer selection') } });
  };
  const { page, restore } = loadPage();
  try {
    page.onLoad();
    await settle();
    page.onPlaceTap({ currentTarget: { dataset: { id: 'P1' } } });
    await settle();
    assert.equal(page.data.detailState, 'error');
    page.onRetryDetail();
    page.onPlaceTap({ currentTarget: { dataset: { id: 'P2' } } });
    await settle();
    assert.equal(page.data.detailState, 'ready');
    assert.equal(page.data.selectedPlace.placeId, 'P2');
    firstResolve({ data: { place: cloudPlace('P1', 'late response') } });
    await settle();
    assert.equal(page.data.selectedPlace.placeId, 'P2');
    assert.equal(page.data.selectedPlace.name, 'newer selection');
  } finally {
    campusService.listPlaces = originalListPlaces;
    campusService.getPlace = originalGetPlace;
    restore();
  }
});

test('cloud favorite mutation blocks repeated taps and retries the exact original request', async () => {
  const originalCreate = campusService.createFavoriteRequest;
  const originalSubmit = campusService.submit;
  const submitted = [];
  let mutationCount = 0;
  campusService.createFavoriteRequest = (input) => ({ requestId: `favorite-${input.operation}`, payload: input });
  campusService.submit = (request) => {
    submitted.push(request);
    if (request.payload.operation !== 'list' && mutationCount++ === 0) {
      return Promise.reject(new Error('temporary failure'));
    }
    if (request.payload.operation === 'list') {
      return Promise.resolve({ data: { placeIds: ['place-1'] } });
    }
    return Promise.resolve({ data: { saved: true } });
  };
  const { page, restore } = loadPage();
  try {
    page.setData({ catalogMode: 'cloud', selectedPlace: cloudPlace('place-1'), favorites: [] });
    page.onToggleFavorite();
    page.onToggleFavorite();
    await settle();
    assert.equal(page.data.favoriteState, 'error');
    assert.equal(submitted.length, 1);
    const originalRequest = submitted[0];
    page.onRetryFavorite();
    await settle();
    assert.equal(submitted[1], originalRequest);
    assert.equal(page.data.favoriteState, 'ready');
    assert.deepEqual(page.data.favorites, ['place-1']);
    page.onHide();
    assert.deepEqual(page.data.favorites, []);
    assert.equal(page.data.selectedPlaceFavorited, false);
  } finally {
    campusService.createFavoriteRequest = originalCreate;
    campusService.submit = originalSubmit;
    restore();
  }
});

test('cloud favorite read failure can retry the same read request without enabling a mutation', async () => {
  const originalCreate = campusService.createFavoriteRequest;
  const originalSubmit = campusService.submit;
  const submitted = [];
  campusService.createFavoriteRequest = () => ({ requestId: 'favorite-list', payload: { operation: 'list' } });
  campusService.submit = (request) => {
    submitted.push(request);
    return submitted.length === 1
      ? Promise.reject(new Error('temporary read failure'))
      : Promise.resolve({ data: { placeIds: [] } });
  };
  const { page, restore } = loadPage();
  try {
    page.setData({ catalogMode: 'cloud', selectedPlace: cloudPlace('place-1') });
    page.loadFavorites();
    await settle();
    assert.equal(page.data.favoriteState, 'error');
    page.onToggleFavorite();
    assert.equal(submitted.length, 1);
    page.onRetryFavorites();
    await settle();
    assert.equal(submitted[1], submitted[0]);
    assert.equal(page.data.favoriteState, 'ready');
    assert.deepEqual(page.data.favorites, []);
  } finally {
    campusService.createFavoriteRequest = originalCreate;
    campusService.submit = originalSubmit;
    restore();
  }
});

test('correction uses Unicode code points, preserves failure input, and reuses request on retry', async () => {
  const originalCreate = campusService.createCorrectionRequest;
  const originalSubmit = campusService.submit;
  const submitted = [];
  campusService.createCorrectionRequest = (input) => ({ requestId: 'correction-1', payload: input });
  campusService.submit = (request) => {
    submitted.push(request);
    return submitted.length === 1
      ? Promise.reject(new Error('sign in required'))
      : Promise.resolve({ data: { status: 'received' } });
  };
  const { page, restore } = loadPage();
  try {
    page.setData({ catalogMode: 'cloud', selectedPlace: cloudPlace('place-1') });
    page.onCorrectionInput({ detail: { value: '🌦'.repeat(201) } });
    page.onSubmitCorrection();
    assert.equal(page.data.correctionState, 'invalid');
    assert.equal(page.data.correctionCount, 201);
    assert.equal(submitted.length, 0);
    const value = `入口情况${'🌦'.repeat(196)}`;
    page.onCorrectionInput({ detail: { value } });
    assert.equal(page.data.correctionCount, 200);
    page.onSubmitCorrection();
    await settle();
    assert.equal(page.data.correctionState, 'error');
    assert.equal(page.data.correctionText, value);
    const originalRequest = submitted[0];
    page.onRetryCorrection();
    await settle();
    assert.equal(submitted[1], originalRequest);
    assert.equal(page.data.correctionState, 'submitted');
    assert.equal(page.data.correctionText, value);
    assert.match(page.data.correctionError, /不表示地点资料已经更新/);
  } finally {
    campusService.createCorrectionRequest = originalCreate;
    campusService.submit = originalSubmit;
    restore();
  }
});

test('field-note detail supports browsing without location and safely refuses map navigation', () => {
  let locationRequests = 0;
  const { page, restore } = loadPage({
    openLocation() {
      locationRequests += 1;
    },
  });
  try {
    page.onStartFieldNotePreview();
    page.onPlaceTap({ currentTarget: { dataset: { id: FIELD_NOTE_PLACES[0].placeId } } });
    assert.equal(page.data.detailState, 'ready');
    assert.equal(page.data.selectedPlace.name, '福友阁');
    page.onRequestLocation();
    page.onNavigate();
    assert.equal(locationRequests, 0);
    assert.match(page.data.locationState, /仍可继续浏览列表/);
    assert.equal(page.data.mapState, 'unavailable');
    page.onSupportResources();
    assert.equal(page.data.supportState, 'empty');
  } finally {
    restore();
  }
});

test('support resource output keeps only enabled, verified, unexpired rows', async () => {
  const originalSupportResources = campusService.supportResources;
  campusService.supportResources = () => Promise.resolve({
    data: {
      items: [
        { id: 'valid', name: 'verified resource', source: 'member reviewed', description: 'active', enabled: true, verificationStatus: 'verified', validUntil: '2099-12-31' },
        { id: 'disabled', name: 'disabled', source: 'recorded', enabled: false, verificationStatus: 'verified', validUntil: '2099-12-31' },
        { id: 'expired', name: 'expired', source: 'recorded', enabled: true, verificationStatus: 'verified', validUntil: '2000-01-01' },
        { id: 'pending', name: 'pending', source: 'recorded', enabled: true, verificationStatus: 'pending_review', validUntil: '2099-12-31' },
      ],
    },
  });
  const { page, restore } = loadPage();
  try {
    page.setData({ catalogMode: 'cloud' });
    page.onSupportResources();
    await settle();
    assert.equal(page.data.supportState, 'ready');
    assert.deepEqual(page.data.supportItems.map((item) => item.id), ['valid']);
  } finally {
    campusService.supportResources = originalSupportResources;
    restore();
  }
});
