const test = require('node:test');
const assert = require('node:assert/strict');
const { businessDate } = require('../miniprogram/shared/date');
const { campusResult } = require('../miniprogram/modules/campus/cloud-result');
const { filterAndPagePlaces } = require('../miniprogram/modules/campus/presentation');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createMemoryRepositories } = require('./support/campus-repository');

function page() {
  const original = globalThis.Page;
  let definition;
  const file = require.resolve('../miniprogram/pages/campus/index');
  globalThis.Page = (value) => {
    definition = value;
  };
  delete require.cache[file];
  try {
    require(file);
  } finally {
    globalThis.Page = original;
    delete require.cache[file];
  }
  return {
    ...definition,
    data: { ...definition.data },
    setData(values) {
      this.data = { ...this.data, ...values };
    },
    loadFavorites() {},
  };
}

test('same-day expired server detail remains expired through the adapter, presentation and actual Page', async () => {
  const today = businessDate();
  const record = {
    _id: 'synthetic_doc',
    placeId: 'synthetic_place',
    name: '合成地点',
    campus: '合成校区',
    openState: 'OPEN',
    tags: [],
    enabled: true,
    isSynthetic: false,
    source: 'SYNTHETIC verified source',
    verifiedAt: '2020-01-01T00:00:00.000Z',
    validUntil: today + 'T03:00:00.000Z',
    contact: 'SYNTHETIC_OLD_CONTACT',
  };
  const router = createRouter({
    repositories: createMemoryRepositories({ places: [record] }),
    now: () => Date.parse(today + 'T04:00:00.000Z'),
  });
  const response = await router({
    apiVersion: '1',
    requestId: 'req_same_day_expiry',
    action: 'campus.getPlace',
    payload: { placeId: record.placeId },
  });
  assert.equal(response.data.verificationState, 'expired');
  const adapted = campusResult('campus.getPlace', response);
  const detail = adapted.data.place;
  assert.equal(detail.validUntil, today);
  assert.equal(detail.verificationStatus, 'expired');
  const derived = filterAndPagePlaces([detail], {}, today).items[0];
  assert.equal(derived.status, 'expired');
  assert.equal(derived.recommendable, false);
  assert.equal(derived.navigationAvailable, false);
  const p = page();
  p._selectedPlaceId = record.placeId;
  p._detailGeneration = 1;
  p.applyPlaceDetail(adapted, record.placeId, 1);
  assert.equal(p.data.selectedPlace.statusLabel, '资料已过期，不推荐前往');
  assert.equal(p.data.selectedPlace.verificationLabel, '资料已过期，需重新核验');
});

test('explicit stale detail cannot keep a contact or recommendation even if other fields look current', () => {
  const today = businessDate();
  const result = campusResult('campus.getPlace', {
    data: {
      placeId: 'synthetic_stale',
      verificationState: 'verified',
      stale: true,
      enabled: true,
      openState: 'OPEN',
      validUntil: today,
      verifiedAt: today,
      contact: 'SYNTHETIC_OLD_CONTACT',
    },
  });
  assert.equal(result.data.place.contact, null);
  assert.equal(filterAndPagePlaces([result.data.place], {}, today).items[0].recommendable, false);
});

test('returning to a completed cloud catalogue reloads once; local preview modes keep their current catalogue', () => {
  for (const mode of ['cloud', 'demo', 'field-note']) {
    const p = page();
    p.data.catalogMode = mode;
    p._cloudListBusy = false;
    let reads = 0;
    p.loadCloudPlaces = (append) => {
      assert.equal(append, false);
      reads++;
    };
    p.onHide();
    p.onShow();
    p.onShow();
    assert.equal(reads, mode === 'cloud' ? 1 : 0);
  }
});
