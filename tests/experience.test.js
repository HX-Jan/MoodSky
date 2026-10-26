const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { buildExperience } = require('../scripts/package-experience');
const { isExperience, EXPERIENCE_VERSION } = require('../miniprogram/config/experience');
const root = path.resolve(__dirname, '..');
const config = {
  presentationProfile: 'experience',
  cloudEnabled: false,
  journalDemo: true,
};
function loadPage(name, overrides = {}) {
  const file = path.join(root, 'miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: { showToast() {} },
    setTimeout,
    clearTimeout,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return config;
      }
      if (Object.hasOwn(overrides, id)) {
        return overrides[id];
      }
      return localRequire(id);
    },
  });
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

test('experience presentation requires explicit cloud-off memory mode', () => {
  assert.equal(isExperience(config), true);
  for (const other of [
    null,
    {},
    { ...config, cloudEnabled: true },
    { ...config, journalDemo: false },
  ]) {
    assert.equal(isExperience(other), false);
  }
});

test('experience package copies the accepted client and adds only explicit generated settings', () => {
  const outputRoot = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-experience-')),
    'package',
  );
  const { client, manifest } = buildExperience({ outputRoot });
  assert.equal(manifest.uploadVersion, EXPERIENCE_VERSION);
  assert.equal(typeof manifest.sourceWorktreeDirty, 'boolean');
  assert.equal(manifest.privateBusinessEnabled, false);
  assert.equal(manifest.cloudDeploymentRequested, false);
  assert.equal(manifest.automaticCloudCalls, false);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(client, 'miniprogram/config/environment.local.js'), 'utf8'),
    { module },
  );
  assert.equal(isExperience(module.exports), true);
  assert.equal(module.exports.cloudEnvId, '');
  assert.equal(module.exports.trustedSessionEnabled, undefined);
  for (const file of Object.keys(manifest.clientHashes)) {
    assert.deepEqual(
      fs.readFileSync(path.join(client, file)),
      fs.readFileSync(path.join(root, file)),
      file,
    );
  }
  assert.equal(manifest.weather.length, 8);
  assert.equal(fs.existsSync(path.join(client, 'project.private.config.json')), false);
  assert.equal(fs.existsSync(path.join(client, 'cloudfunctions')), false);
});

test('audience Me opens without constructing or reading a synthetic account and supports help navigation', () => {
  const page = loadPage('me', {
    '../../modules/account/week-one': {
      FORMATS: [],
      createLocalAccount() {
        throw Error('Must not open demo account');
      },
    },
  });
  page.onLoad();
  assert.equal(page.account, undefined);
  assert.equal(page.data.isExperience, true);
  page.onSection({ currentTarget: { dataset: { section: 'privacy' } } });
  assert.equal(page.data.activeSection, 'privacy');
  page.onSection({ currentTarget: { dataset: { section: 'help' } } });
  assert.equal(page.data.activeSection, 'help');
  page.onUnload();
});

test('experience tasks show only this page actual interactions, not fixture completions', () => {
  const page = loadPage('tasks');
  page.onLoad({ view: 'history' });
  page.onToggleAuth();
  assert.equal(page.data.history.length, 0);
  assert.equal(page.data.modeLabel, '本次任务体验中');
  const taskId = page.data.suggestions[0].id;
  for (const action of ['select', 'complete']) {
    page.onTaskAction({ currentTarget: { dataset: { taskId, action } } });
  }
  assert.equal(page.data.suggestions[0].state, 'completed');
  assert.equal(page.data.history.length, 2);
  page.onUnload();
  const next = loadPage('tasks');
  next.onLoad({ view: 'history' });
  next.onToggleAuth();
  assert.equal(next.data.history.length, 0);
  next.onUnload();
});

test('experience campus enters the labelled member catalogue without a disconnected cloud attempt', () => {
  let cloudReads = 0;
  const realService = require('../miniprogram/modules/campus/service');
  const page = loadPage('campus', {
    '../../modules/campus/service': {
      ...realService,
      listPlaces() {
        cloudReads++;
        throw Error('No cloud');
      },
    },
  });
  page.onLoad();
  assert.equal(page.data.catalogMode, 'field-note');
  assert.equal(page.data.places.length > 0, true);
  assert.equal(
    page.data.places.every((item) => item.navigationAvailable === false),
    true,
  );
  assert.equal(cloudReads, 0);
  page.onUnload();
});

test('experience archive omits artificial empty-month fixtures', () => {
  const page = loadPage('review/archive', {
    '../../../modules/review/demo-store': {
      reviewStore: { listAll: () => [], subscribe: () => () => {} },
    },
  });
  page.onLoad({});
  assert.equal(page.data.months.length, 0);
  page.onUnload();
});
