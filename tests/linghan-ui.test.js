const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PREFERENCES } = require('../miniprogram/shared/constants');
const { preferencesFromSwitches } = require('../miniprogram/modules/account/presentation');
const { createLocalAccount } = require('../miniprogram/modules/account/week-one');
const { checkHealth } = require('../miniprogram/modules/system/health');
const preview = require('../miniprogram/modules/campus/simulated-weather');

function createStorage() {
  const values = new Map();
  return {
    getStorageSync(key) {
      return values.get(key);
    },
    setStorageSync(key, value) {
      values.set(key, value);
    },
    removeStorageSync(key) {
      values.delete(key);
    },
  };
}

test('preference switches only produce a local copy and preserve privacy defaults', () => {
  const draft = preferencesFromSwitches(DEFAULT_PREFERENCES, 'cardTextPreview', true);
  assert.deepEqual(draft, { cardTextPreview: true, decorationsEnabled: true });
  assert.equal(DEFAULT_PREFERENCES.cardTextPreview, false);
  assert.equal(preferencesFromSwitches(draft, 'unexpected', true), draft);
});

test('campus preview is explicitly simulated with five fixed skies', () => {
  assert.equal(preview.simulated, true);
  assert.equal(preview.skies.length, 5);
  assert.deepEqual(
    preview.skies.map((sky) => sky.name),
    ['晴天', '晴间多云', '阴天', '雨天', '暴风雨'],
  );
  assert.match(preview.description, /不读取私人天气记录/);
});

test('preferences stay isolated between the two synthetic accounts', () => {
  const account = createLocalAccount(createStorage());
  account.savePreference('cardTextPreview', true);
  account.switchAccount('demo-b');
  assert.equal(account.snapshot().preferences.cardTextPreview, false);
  account.savePreference('decorationsEnabled', false);
  account.switchAccount('demo-a');
  assert.deepEqual(account.snapshot().preferences, {
    cardTextPreview: true,
    decorationsEnabled: true,
  });
});

test('JSON and Markdown exports contain only the selected synthetic account', () => {
  let clock = 1000;
  const account = createLocalAccount(createStorage(), () => clock);
  let token = account.startExport('JSON');
  assert.equal(account.completeExport(token), true);
  let task = account.snapshot().exportTask;
  assert.equal(task.status, 'completed');
  assert.equal(JSON.parse(task.content).accountId, 'demo-a');

  account.switchAccount('demo-b');
  clock += 1;
  token = account.startExport('Markdown');
  assert.equal(account.completeExport(token), true);
  task = account.snapshot().exportTask;
  assert.equal(task.status, 'completed');
  assert.match(task.content, /demo-b/);
  assert.doesNotMatch(task.content, /demo-a/);
});

test('export failure and expiration clear downloadable synthetic content', () => {
  let clock = 2000;
  const account = createLocalAccount(createStorage(), () => clock);
  let token = account.startExport('JSON');
  assert.equal(account.completeExport(token, true), true);
  assert.equal(account.snapshot().exportTask.status, 'failed');
  assert.equal(account.snapshot().exportTask.content, '');

  clock += 1;
  token = account.startExport('JSON');
  account.completeExport(token);
  account.expireExport();
  const expired = account.snapshot().exportTask;
  assert.equal(expired.status, 'expired');
  assert.equal(expired.content, '');
});

test('account switching rejects stale callbacks and disabling blocks operations', () => {
  const account = createLocalAccount(createStorage());
  const staleToken = account.startExport('JSON');
  account.switchAccount('demo-b');
  assert.equal(account.completeExport(staleToken), false);
  assert.equal(account.disable().status, 'disabled');
  assert.throws(() => account.savePreference('cardTextPreview', true), /ACCOUNT_DISABLED/);
  assert.throws(() => account.startExport('JSON'), /ACCOUNT_DISABLED/);
});

test('closure follows 35, 70, and 100 percent synthetic progress', () => {
  const account = createLocalAccount(createStorage());
  const token = account.startClosure();
  assert.equal(account.advanceClosure(token, 35), true);
  assert.equal(account.snapshot().closureTask.progress, 35);
  assert.equal(account.advanceClosure(token, 70), true);
  assert.equal(account.snapshot().closureTask.progress, 70);
  assert.equal(account.advanceClosure(token, 100), true);
  assert.equal(account.snapshot().status, 'closed');
});

test('synthetic system health returns API version and traceable request id', async () => {
  const result = await checkHealth('demo');
  assert.equal(result.ok, true);
  assert.equal(result.apiVersion, '1');
  assert.match(result.requestId, /^req_/);
  assert.equal(result.message, 'local-synthetic');
});
