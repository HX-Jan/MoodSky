const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const place = (id, extra = {}) => ({
  placeId: id,
  name: '合成测试地点',
  campus: '合成校区',
  address: '合成文字方位',
  environmentTags: ['散步'],
  enabled: true,
  isSynthetic: false,
  verificationStatus: 'verified',
  verifiedAt: '2026-10-01',
  validUntil: '2099-12-31',
  openState: 'open',
  location: null,
  ...extra,
});
function pageFixture(rows) {
  const file = path.resolve(__dirname, '../miniprogram/pages/campus/index.js');
  const local = createRequire(file);
  const calls = [];
  let definition;
  const service = {
    privateActionsReady: false,
    listPlaces: async () => ({
      ok: true,
      data: { items: rows, page: 1, pageSize: 2, total: rows.length, hasMore: false },
    }),
    getPlace: async (placeId) => ({
      ok: true,
      data: { place: rows.find((p) => p.placeId === placeId) },
    }),
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx: {
      requirePrivacyAuthorize: (options) => {
        calls.push('privacy');
        options.success();
      },
      getLocation: () => calls.push('location'),
      openLocation: () => calls.push('map'),
    },
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { releaseProfile: 'development' };
      }
      if (id.endsWith('/campus/service')) {
        return service;
      }
      return local(id);
    },
  });
  const page = {
    ...definition,
    data: { ...JSON.parse(JSON.stringify(definition.data)), manualCheckinMode: false },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  return { page, calls };
}

test('W4 campus current app and template expose recommendations without location declarations or map controls', () => {
  const app = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.json'), 'utf8'),
  );
  assert.equal(app.permission?.['scope.userLocation'], undefined);
  assert.equal(app.requiredPrivateInfos?.includes('getLocation') ?? false, false);
  const template = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/campus/index.wxml'),
    'utf8',
  );
  assert.doesNotMatch(
    template,
    /bindtap="(?:onRequestLocation|onToggleLocation|onNavigate|onMapBack|onSimulateMapFailure)"/,
  );
  assert.match(template, /推荐地点/);
  assert.match(template, /前往说明/);
  assert.match(template, /打卡暂未开放/);
});

test('W4 valid recommended places need no coordinates and keep their textual directions', async () => {
  const { page } = pageFixture([place('synthetic_no_coordinates')]);
  page.onLoad();
  await settle();
  assert.equal(page.data.places[0].recommendable, true);
  page.onPlaceTap({ currentTarget: { dataset: { id: 'synthetic_no_coordinates' } } });
  await settle();
  assert.equal(page.data.selectedPlace.address, '合成文字方位');
  assert.match(page.data.selectedPlace.recommendationLabel, /文字方位/);
  assert.doesNotMatch(page.data.selectedPlace.recommendationLabel, /坐标|导航/);
  assert.equal(page.data.selectedPlace.navigationAvailable, false);
  page.onUnload();
});

test('W4 retired location/map events cannot call platform APIs even for previously navigable places', () => {
  const { page, calls } = pageFixture([]);
  page.setData({
    selectedPlace: place('synthetic_legacy', {
      recommendable: true,
      navigationAvailable: true,
      coordinateStatus: 'verified',
      location: { latitude: 26, longitude: 119, coordinateSystem: 'gcj02' },
    }),
  });
  page.onRequestLocation();
  page.onNavigate();
  assert.deepEqual(calls, []);
  assert.equal(page.data.locationBusy, false);
  page.onUnload();
});

test('W4 recommendation views discard legacy coordinates and do not promote closed or expired places', async () => {
  const { page } = pageFixture([
    place('synthetic_closed', {
      openState: 'closed',
      navigationAvailable: true,
      location: { latitude: 26, longitude: 119, coordinateSystem: 'gcj02' },
    }),
    place('synthetic_expired', {
      validUntil: '2020-01-01',
      navigationAvailable: true,
      location: { latitude: 26, longitude: 119, coordinateSystem: 'gcj02' },
    }),
  ]);
  page.onLoad();
  await settle();
  for (const item of page.data.places) {
    assert.equal(item.recommendable, false);
    assert.equal(item.navigationAvailable, false);
    assert.equal(item.location, null);
    assert.doesNotMatch(item.recommendationLabel, /按文字方位自行前往/);
  }
  page.onUnload();
});
