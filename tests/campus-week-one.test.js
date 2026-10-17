const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEMO_PLACES } = require('../miniprogram/modules/campus/demo-places');
const {
  PLACE_STATUS,
  canNavigateToPlace,
  filterAndPagePlaces,
  navigationOptions,
  placeStatus,
} = require('../miniprogram/modules/campus/presentation');
const { openVerifiedPlace, requestCurrentLocation } = require('../miniprogram/modules/campus/interactions');
const { ACTIONS } = require('../miniprogram/shared/contracts');

const TODAY = '2026-10-16';
const PAGE_FILE = path.join(__dirname, '../miniprogram/pages/campus/index.js');

function loadCampusPage(platform) {
  const previousPage = globalThis.Page;
  const previousWx = globalThis.wx;
  let definition;
  globalThis.Page = (page) => {
    definition = page;
  };
  globalThis.wx = platform;
  delete require.cache[require.resolve(PAGE_FILE)];
  require(PAGE_FILE);
  globalThis.Page = previousPage;
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
  return { definition, page, restore() {
    globalThis.Page = previousPage;
    globalThis.wx = previousWx;
  } };
}

test('the place fixture is explicitly synthetic and has no navigable coordinates', () => {
  assert.equal(DEMO_PLACES.length, 6);
  for (const place of DEMO_PLACES) {
    assert.equal(place.isSynthetic, true);
    assert.equal(place.location, null);
    assert.equal(place.coordinateStatus, '待核实');
    assert.equal(canNavigateToPlace(place, TODAY), false);
  }
});

test('campus and environment filters preserve stable pagination metadata', () => {
  const first = filterAndPagePlaces(
    DEMO_PLACES,
    { campus: '云汀校区（合成）', tag: '安静', page: 1, pageSize: 1 },
    TODAY,
  );
  const second = filterAndPagePlaces(
    DEMO_PLACES,
    { campus: '云汀校区（合成）', tag: '安静', page: 2, pageSize: 1 },
    TODAY,
  );
  assert.equal(first.total, 2);
  assert.equal(first.items[0].placeId, 'demo-courtyard');
  assert.equal(first.hasMore, true);
  assert.equal(second.items[0].placeId, 'demo-reading-room');
  assert.equal(second.page, 2);
  assert.equal(second.hasMore, false);
});

test('unmatched filters return an empty successful page shape', () => {
  const result = filterAndPagePlaces(
    DEMO_PLACES,
    { campus: '不存在的合成校区', tag: '全部标签', page: 1, pageSize: 2 },
    TODAY,
  );
  assert.deepEqual(result, { items: [], page: 1, pageSize: 2, total: 0, hasMore: false });
});

test('expired, closed, and unknown places cannot become recommendations', () => {
  const expired = DEMO_PLACES.find((place) => place.placeId === 'demo-garden-expired');
  const closed = DEMO_PLACES.find((place) => place.placeId === 'demo-studio-closed');
  assert.equal(placeStatus(expired, TODAY), PLACE_STATUS.EXPIRED);
  assert.equal(placeStatus(closed, TODAY), PLACE_STATUS.CLOSED);
  const all = filterAndPagePlaces(
    DEMO_PLACES,
    { campus: '全部校区', tag: '全部标签', page: 1, pageSize: 6 },
    TODAY,
  );
  assert.equal(all.items.find((place) => place.placeId === expired.placeId).recommendable, false);
  assert.equal(all.items.find((place) => place.placeId === closed.placeId).recommendable, false);
});

test('location access only starts when the explicit request handler is invoked', () => {
  let privacyRequests = 0;
  let locationRequests = 0;
  const platform = {
    requirePrivacyAuthorize(options) {
      privacyRequests += 1;
      options.success();
    },
    getLocation(options) {
      locationRequests += 1;
      assert.equal(options.type, 'gcj02');
      options.fail({ errMsg: 'mock denial' });
    },
  };
  const { page, restore } = loadCampusPage(platform);
  try {
    page.onLoad();
    assert.equal(privacyRequests, 0);
    assert.equal(locationRequests, 0);
    assert.equal(page.data.listState, 'unverified');
    page.onStartDemo();
    assert.equal(page.data.listState, 'ready');
    page.onRequestLocation();
    assert.equal(privacyRequests, 1);
    assert.equal(locationRequests, 1);
    assert.match(page.data.locationState, /仍可继续浏览列表/);
    assert.equal(page.data.listState, 'ready');
    assert.equal(Object.hasOwn(page.data, 'location'), false);
  } finally {
    restore();
  }
});

test('location permission denial leaves the local place list usable', () => {
  let locationRequests = 0;
  const result = requestCurrentLocation(
    {
      getLocation(options) {
        locationRequests += 1;
        options.fail();
      },
    },
    {},
  );
  assert.equal(result, true);
  assert.equal(locationRequests, 1);
});

test('only an eligible verified real place opens the native map; map failure can return to list', () => {
  let mapRequests = 0;
  const platform = {
    openLocation(options) {
      mapRequests += 1;
      assert.equal(options.latitude, 26.0);
      assert.equal(options.longitude, 119.0);
      options.fail();
    },
  };
  const verifiedPlace = {
    placeId: 'verified-test-only',
    name: 'test fixture',
    address: 'test fixture',
    enabled: true,
    openState: 'open',
    coordinateStatus: 'verified',
    isSynthetic: false,
    verificationStatus: 'verified',
    verifiedAt: '2026-10-01',
    validUntil: '2099-12-31',
    location: { latitude: 26.0, longitude: 119.0, coordinateSystem: 'gcj02' },
  };
  let failure = '';
  assert.equal(openVerifiedPlace(platform, verifiedPlace, { onFailure: (reason) => (failure = reason) }), true);
  assert.equal(mapRequests, 1);
  assert.equal(failure, 'map-failed');
  assert.equal(navigationOptions(DEMO_PLACES[0]), null);
});

test('Campus handler opens map only after explicit user action and returns to the list on failure', () => {
  let mapRequests = 0;
  const { page, restore } = loadCampusPage({
    openLocation(options) {
      mapRequests += 1;
      options.fail();
    },
  });
  try {
    page.onLoad();
    assert.equal(mapRequests, 0);
    page.setData({ selectedPlace: DEMO_PLACES[0] });
    page.onNavigate();
    assert.equal(mapRequests, 0);
    page.setData({
      selectedPlace: {
        placeId: 'verified-test-only',
        name: 'test fixture',
        address: 'test fixture',
        enabled: true,
        openState: 'open',
        coordinateStatus: 'verified',
        isSynthetic: false,
    verificationStatus: 'verified',
    verifiedAt: '2026-10-01',
        validUntil: '2099-12-31',
        location: { latitude: 26.0, longitude: 119.0, coordinateSystem: 'gcj02' },
        recommendable: true,
        navigationAvailable: true,
      },
    });
    page.onNavigate();
    assert.equal(mapRequests, 1);
    assert.equal(page.data.mapState, 'failed');
    page.onMapBack();
    assert.equal(page.data.selectedPlace, null);
    assert.equal(page.data.mapState, 'idle');
  } finally {
    restore();
  }
});

test('favorite toggle removes and re-adds while correction rejects over-limit Unicode input', () => {
  const { page, restore } = loadCampusPage({});
  try {
    page.onLoad();
    page.onStartDemo();
    page.setData({ selectedPlace: DEMO_PLACES[0] });
    page.onToggleFavorite();
    page.onToggleFavorite();
    assert.deepEqual(page.data.favorites, []);
    page.onToggleFavorite();
    assert.deepEqual(page.data.favorites, ['demo-courtyard']);
    page.onCorrectionInput({ detail: { value: '🌦'.repeat(201) } });
    assert.equal(page.data.correctionCount, 201);
    assert.equal(Array.from(page.data.correctionText).length, 201);
    page.onSubmitCorrection();
    assert.equal(page.data.correctionState, 'invalid');
    page.onCorrectionInput({ detail: { value: '🌦'.repeat(200) } });
    page.onSubmitCorrection();
    assert.equal(page.data.correctionState, 'pending');
  } finally {
    restore();
  }
});

test('existing public and private campus action access is unchanged', () => {
  assert.equal(ACTIONS['campus.listPlaces'].access, 'public');
  assert.equal(ACTIONS['campus.getPlace'].access, 'public');
  assert.equal(ACTIONS['campus.favorites'].access, 'private');
  assert.equal(ACTIONS['campus.correctPlace'].access, 'private');
  assert.equal(ACTIONS['campus.supportResources'].access, 'public');
  assert.deepEqual(ACTIONS['campus.listPlaces'].requirements, ['UW3-F11', 'UW3-F12']);
});

test('app declares location use and the permission request remains user-triggered', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
  assert.deepEqual(app.requiredPrivateInfos, ['getLocation']);
  assert.match(app.permission['scope.userLocation'].desc, /主动点击/);
  const source = fs.readFileSync(PAGE_FILE, 'utf8');
  assert.match(source, /onRequestLocation\(\)\s*\{[\s\S]*requestCurrentLocation\(wx/);
  assert.doesNotMatch(source, /onLoad\(\)[\s\S]{0,160}requestCurrentLocation/);
});


test('navigation rejects unverified, stale, closed, future-dated and unknown-system data', () => {
  const verified = {
    enabled: true, openState: 'open', isSynthetic: false,
    verificationStatus: 'verified', verifiedAt: '2026-10-01', validUntil: '2026-10-31',
    coordinateStatus: 'verified', location: { longitude: 119, latitude: 26, coordinateSystem: 'gcj02' },
  };
  assert.equal(canNavigateToPlace(verified, TODAY), true);
  for (const patch of [
    { isSynthetic: true }, { verificationStatus: 'unverified' }, { enabled: false },
    { openState: 'closed' }, { openState: 'unknown' }, { validUntil: '2026-10-15' },
    { verifiedAt: '2026-10-17' }, { verifiedAt: null }, { coordinateStatus: 'unverified' },
    { location: { longitude: 119, latitude: 26, coordinateSystem: 'unknown' } },
    { location: { longitude: 181, latitude: 26, coordinateSystem: 'gcj02' } },
  ]) {
    assert.equal(canNavigateToPlace({ ...verified, ...patch }, TODAY), false);
    assert.equal(navigationOptions({ ...verified, ...patch }, TODAY), null);
  }
  assert.equal(canNavigateToPlace(verified, 'invalid-date'), false);
  assert.equal(filterAndPagePlaces([{ ...verified, validUntil: '2026-10-15' }], {}, TODAY).items[0].recommendable, false);
});

test('favorite add and remove operations are independently idempotent and memory-only', () => {
  const { createPlaceDemo } = require('../miniprogram/modules/campus/service');
  const demo = createPlaceDemo();
  assert.deepEqual(demo.listFavorites().data.placeIds, []);
  demo.setFavorite('demo-courtyard', 'add');
  demo.setFavorite('demo-courtyard', 'add');
  assert.deepEqual(demo.listFavorites().data.placeIds, ['demo-courtyard']);
  demo.setFavorite('demo-courtyard', 'remove');
  demo.setFavorite('demo-courtyard', 'remove');
  assert.deepEqual(demo.listFavorites().data.placeIds, []);
  assert.deepEqual(createPlaceDemo().listFavorites().data.placeIds, []);
  assert.throws(() => demo.setFavorite('unknown', 'add'));
});

test('correction validates 0, 1, 200, 201 code points and preserves rejected input', () => {
  const { page, restore } = loadCampusPage({});
  try {
    page.onLoad();
    page.onStartDemo();
    page.onPlaceTap({ currentTarget: { dataset: { id: 'demo-courtyard' } } });
    for (const [value, expected] of [
      ['', 'invalid'], ['   ', 'invalid'], ['🌦', 'pending'],
      ['🌦'.repeat(200), 'pending'], ['🌦'.repeat(201), 'invalid'], ['e\u0301', 'pending'],
    ]) {
      page.onCorrectionInput({ detail: { value } });
      assert.equal(page.data.correctionCount, Array.from(value).length);
      page.onSubmitCorrection();
      assert.equal(page.data.correctionState, expected);
      assert.equal(page.data.correctionText, value);
    }
    page.onCorrectionInput({ detail: { value: '入口台阶需核实' } });
    page.onSubmitCorrection();
    page.onReviewDemo({ currentTarget: { dataset: { status: 'rejected' } } });
    assert.equal(page.data.correctionState, 'rejected');
    assert.equal(page.data.correctionText, '入口台阶需核实');
    page.onSubmitCorrection();
    page.onReviewDemo({ currentTarget: { dataset: { status: 'approved' } } });
    assert.equal(page.data.correctionState, 'approved');
    assert.equal(page.data.selectedPlace.address, '合成地址示意，不对应真实位置');
    page.onStopDemo();
    assert.equal(page.data.correctionText, '');
    assert.equal(page.data.listState, 'unverified');
  } finally { restore(); }
});

test('privacy refusal prevents location API call and unavailable APIs degrade safely', () => {
  let calls = 0;
  let failures = 0;
  requestCurrentLocation({
    requirePrivacyAuthorize(options) { options.fail(); },
    getLocation() { calls += 1; },
  }, { onFailure() { failures += 1; } });
  assert.equal(calls, 0);
  assert.equal(failures, 1);
  assert.equal(requestCurrentLocation({}, { onFailure() { failures += 1; } }), false);
  requestCurrentLocation({ getLocation() { throw new Error('mock unavailable'); } }, {
    onFailure() { failures += 1; },
  });
  assert.equal(failures, 3);
});

test('page filtering resets pagination, detail uses service and map failure preserves list', () => {
  const { page, restore } = loadCampusPage({});
  try {
    page.onLoad();
    page.onStartDemo();
    assert.equal(page.data.places.length, 2);
    page.onLoadMore();
    page.onLoadMore();
    assert.equal(new Set(page.data.places.map((p) => p.placeId)).size, 6);
    assert.equal(page.data.hasMore, false);
    page.onCampusChange({ detail: { value: 1 } });
    assert.equal(page.data.page, 1);
    page.onTagChange({ detail: { value: page.data.tagOptions.indexOf('散步') } });
    assert.equal(page.data.listState, 'empty');
    page.onTagChange({ detail: { value: 0 } });
    page.onPlaceTap({ currentTarget: { dataset: { id: 'demo-courtyard' } } });
    assert.equal(page.data.selectedPlace.name, '静风庭院（合成演示）');
    const before = page.data.places;
    page.onSimulateMapFailure();
    assert.equal(page.data.mapState, 'failed');
    page.onMapBack();
    assert.equal(page.data.selectedPlace, null);
    assert.deepEqual(page.data.places, before);
    page.onSupportResources();
    assert.equal(page.data.supportState, 'notImplemented');
  } finally { restore(); }
});

test('WXML wires handlers and leaves Unicode limit to code-point validation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/campus/index.wxml'), 'utf8');
  const { page, restore } = loadCampusPage({});
  try {
    const handlers = Array.from(source.matchAll(/bind(?:tap|change|input)="([^"]+)"/g), (match) => match[1]);
    for (const handler of handlers) { assert.equal(typeof page[handler], 'function', handler); }
    for (const required of ['onStartDemo', 'onStopDemo', 'onReviewDemo', 'onSimulateMapFailure']) {
      assert.ok(handlers.includes(required), required);
    }
    assert.match(source, /maxlength="-1"/);
    assert.match(source, /listState === 'unverified'/);
  } finally { restore(); }
});

test('real candidate handoff retains 11 unverified places without granting navigation', () => {
  const { candidates } = JSON.parse(fs.readFileSync(path.join(__dirname,
    '../docs/week1/qinghan-zhang/real-candidates.json'), 'utf8'));
  assert.equal(candidates.length, 11);
  assert.equal(new Set(candidates.map((c) => c.candidateId)).size, 11);
  for (const candidate of candidates) {
    assert.equal(candidate.location.coordinateSystem, 'unknown');
    assert.equal(candidate.verificationStatus, 'unverified');
    assert.equal(candidate.verifiedAt, null);
    assert.equal(candidate.source.url, null);
    assert.equal(candidate.accessibility.status, 'unverified');
    assert.equal(candidate.navigationAvailable, false);
    assert.equal(canNavigateToPlace(candidate, TODAY), false);
  }
});
