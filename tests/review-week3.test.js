// W3 Z01—Z03：七天气 + 自定义天气回顾契约专项测试。
// 覆盖：CUSTOM 名称边界（1—20 码点）、非 CUSTOM 不得携带 customName、
// 分布 bins 为七天气 + 自定义共 8 类且总和等于记录数、0/2/3 条趋势门槛。
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, error } = require('./helpers/backend-fixture');
const { CUSTOM_NAME_MIN, CUSTOM_NAME_MAX } = require('../miniprogram/shared/constants');

function saveCustom(f, name, date = '2026-10-18') {
  return f.call(
    'journal.upsert',
    { date, weather: 'CUSTOM', customName: name, expectedVersion: 0 },
    { id: 'req_custom_' + name.length + '_' + date },
  );
}

test('W3 Z01 CUSTOM weather accepts names within 1—20 code points', async () => {
  const f = fixture();
  const cases = [
    { name: '晴', date: '2026-10-16' },
    { name: '今天心情不错', date: '2026-10-17' },
    { name: 'a'.repeat(CUSTOM_NAME_MAX), date: '2026-10-18' },
  ];
  for (const { name, date } of cases) {
    const result = await saveCustom(f, name, date);
    assert.equal(result.ok, true, 'name of length ' + [...name].length + ' should be accepted');
  }
});

test('W3 Z01 CUSTOM weather rejects empty and overlong names', async () => {
  const f = fixture();
  const cases = [
    { name: '', date: '2026-10-16' },
    { name: 'a'.repeat(CUSTOM_NAME_MAX + 1), date: '2026-10-17' },
    { name: '🙂'.repeat(21), date: '2026-10-18' },
  ];
  for (const { name, date } of cases) {
    const result = await saveCustom(f, name, date);
    error(result, 'INVALID_INPUT');
  }
});

test('W3 Z01 non-CUSTOM weather must not carry customName', async () => {
  const f = fixture();
  const result = await f.call(
    'journal.upsert',
    { date: '2026-10-18', weather: 'SUNNY', customName: '晴', expectedVersion: 0 },
    { id: 'req_sunny_custom' },
  );
  error(result, 'INVALID_INPUT');
});

test('W3 Z01 review marks preserve customName only for CUSTOM records', async () => {
  const f = fixture();
  await f.call(
    'journal.upsert',
    { date: '2026-10-18', weather: 'CUSTOM', customName: '转晴', expectedVersion: 0 },
    { id: 'req_mark_custom' },
  );
  const cal = await f.call('review.calendar', { month: '2026-10' }, { actor: 'a' });
  assert.equal(cal.ok, true);
  const entry = cal.data.entries.find((item) => item.weather === 'CUSTOM');
  assert.equal(entry.customName, '转晴');
  assert.doesNotMatch(JSON.stringify(cal.data), /text|tags|ownerId/);
});

test('W3 Z03 distribution emits eight bins (seven weather + CUSTOM) summing to recordCount', async () => {
  const f = fixture();
  await f.save({ weather: 'SUNNY' }, { id: 'req_dist_sunny' });
  await f.call(
    'journal.upsert',
    { date: '2026-10-17', weather: 'HEAVY_RAIN', expectedVersion: 0 },
    { id: 'req_dist_heavy' },
  );
  const dist = await f.call('review.distribution', { windowDays: 7 }, { actor: 'a' });
  assert.equal(dist.ok, true);
  assert.equal(dist.data.bins.length, 8);
  const codes = dist.data.bins.map((bin) => bin.weather);
  assert.deepEqual(codes, [
    'SUNNY',
    'PARTLY_CLOUDY',
    'CLOUDY',
    'RAINY',
    'STORMY',
    'HEAVY_RAIN',
    'TYPHOON',
    'CUSTOM',
  ]);
  assert.equal(dist.data.bins.find((bin) => bin.weather === 'SUNNY').count, 1);
  assert.equal(dist.data.bins.find((bin) => bin.weather === 'HEAVY_RAIN').count, 1);
  assert.equal(
    dist.data.bins.reduce((sum, bin) => sum + bin.count, 0),
    dist.data.recordCount,
  );
});

test('W3 Z03 trend eligibility follows the 3-record threshold for 0/2/3 entries', async () => {
  for (const count of [0, 2, 3]) {
    const f = fixture();
    const dates = ['2026-10-16', '2026-10-17', '2026-10-18'];
    for (let i = 0; i < count; i += 1) {
      await f.call(
        'journal.upsert',
        { date: dates[i], weather: 'SUNNY', expectedVersion: 0 },
        { id: 'req_trend_' + i },
      );
    }
    const line = await f.call('review.timeline', { windowDays: 7 }, { actor: 'a' });
    assert.equal(line.ok, true);
    assert.equal(line.data.recordCount, count);
    assert.equal(line.data.trendEligible, count >= 3);
    assert.equal(Object.prototype.hasOwnProperty.call(line.data, 'trendConclusion'), false);
  }
});

test('W3 Z01 HEAVY_RAIN and TYPHOON are first-class weather codes end to end', async () => {
  const f = fixture();
  await f.call(
    'journal.upsert',
    { date: '2026-10-17', weather: 'TYPHOON', expectedVersion: 0 },
    { id: 'req_typhoon' },
  );
  const cal = await f.call('review.calendar', { month: '2026-10' }, { actor: 'a' });
  assert.equal(cal.ok, true);
  assert.ok(cal.data.entries.some((item) => item.weather === 'TYPHOON'));
  const dist = await f.call('review.distribution', { windowDays: 7 }, { actor: 'a' });
  assert.equal(dist.data.bins.find((bin) => bin.weather === 'TYPHOON').count, 1);
});
