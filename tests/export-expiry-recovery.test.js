const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createProductionAccountController } = require('../miniprogram/modules/account/production');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
const { databaseFixture } = require('./helpers/w2-database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');
const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const ready = { jobId: 'synthetic_job', state: 'ready', format: 'markdown' };
function fixture(overrides = {}) {
  const session = createSessionState(),
    state = {},
    sent = [],
    storage = new Map();
  session.accept('scope_' + 'a'.repeat(64));
  const service = {
    authenticate: async () => true,
    preferences: async () => ({ ok: true, data: {} }),
    createExport: (format) => createRequest('account.requestExport', { format }),
    submit: async (request) => {
      sent.push(request);
      return { ok: true, data: { ...ready } };
    },
    download: async () => {
      throw new AppError('CONFLICT', 'synthetic');
    },
    exportStatus: async () => ({ ok: true, data: { ...ready, state: 'expired' } }),
    ...overrides,
  };
  const controller = createProductionAccountController({
    service,
    session,
    storage: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
    },
    publish: (patch) => Object.assign(state, patch),
  });
  return { controller, session, state, sent, service };
}
async function loaded(f) {
  await f.controller.load();
  await f.controller.requestExport('markdown');
}
for (const reason of ['time', 'source']) {
  test(`actual production ${reason} expiry is recovered by the client without writing a stale file`, async () => {
    const db = databaseFixture().db;
    let time = new Date('2026-11-03T04:00:00Z');
    const entry = createProductionEntry({
      readConfig: () => config,
      openDatabase: () => db,
      now: () => time,
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_client',
        OPENID: 'synthetic_export_recovery',
        identityFromCurrentInvocation: true,
      }),
    });
    const signedIn = await entry(createRequest('account.session'));
    assert.equal(signedIn.ok, true);
    const scope = signedIn.data.scope;
    const call = async (request) => {
      const result = await entry({ ...request, sessionScope: scope });
      if (!result.ok) {
        throw new AppError(result.error.code, result.error.message);
      }
      return result;
    };
    const sent = [],
      reads = [];
    const f = fixture({
      preferences: () => call(createRequest('account.preferences', { operation: 'get' })),
      submit: (request) => {
        sent.push(request);
        return call(request);
      },
      download: (jobId) => call(createRequest('account.downloadExport', { jobId })),
      exportStatus: (jobId) => {
        reads.push(jobId);
        return call(createRequest('account.exportStatus', { jobId }));
      },
    });
    await loaded(f);
    const original = f.state.exportJob;
    if (reason === 'time') {
      time = new Date('2026-11-04T05:00:00Z');
    } else {
      await call(createRequest('account.preferences', { operation: 'set', cardTextPreview: true }));
    }
    let writes = 0;
    await f.controller.download(() => {
      writes++;
    });
    assert.equal(writes, 0);
    assert.equal(f.state.exportJob.state, 'expired');
    assert.equal(f.state.exportJob.jobId, original.jobId);
    assert.equal(f.state.exportStateLabel, '已过期');
    assert.deepEqual(reads, [original.jobId]);
    assert.equal(sent.length, 1, 'Never create a new export automatically');
    f.controller.setExportFormat('json');
    await f.controller.reapplyExport(original.jobId);
    assert.equal(sent[1].payload.format, 'markdown');
    assert.notEqual(sent[1].requestId, sent[0].requestId);
    assert.equal(f.state.exportJob.state, 'ready');
    await f.controller.reapplyExport(original.jobId);
    assert.equal(sent.length, 2, 'Old job buttons cannot reapply a new job');
    f.controller.dispose();
  });
}
test('a download conflict alone never invents expiry when the status is still ready', async () => {
  const f = fixture({ exportStatus: async () => ({ ok: true, data: { ...ready } }) });
  await loaded(f);
  await f.controller.download(() => assert.fail('Conflict must not save a file'));
  assert.equal(f.state.exportJob.state, 'ready');
  assert.match(f.state.notice, /重试/);
  assert.equal(f.sent.length, 1);
  f.controller.dispose();
});
test('transport failure preserves a ready export and waits for explicit status retry', async () => {
  let queries = 0;
  const f = fixture({
    download: async () => {
      throw new AppError('NETWORK_ERROR', 'synthetic network');
    },
    exportStatus: async () => {
      queries++;
      return { ok: true, data: { ...ready, state: 'expired' } };
    },
  });
  await loaded(f);
  await f.controller.download(() => assert.fail('No file on failed read'));
  assert.equal(queries, 0);
  assert.equal(f.state.exportJob.state, 'ready');
  await f.controller.refreshExport();
  assert.equal(f.state.exportJob.state, 'expired');
  f.controller.dispose();
});
test('status recovery publishes only metadata and never projects file content or private fields', async () => {
  const f = fixture({
    exportStatus: async () => ({
      ok: true,
      data: {
        ...ready,
        state: 'expired',
        content: 'SYNTHETIC_PRIVATE_EXPORT',
        ownerId: 'SYNTHETIC_OWNER',
        receipt: 'SYNTHETIC_RECEIPT',
      },
    }),
  });
  await loaded(f);
  await f.controller.download(() => assert.fail('No file from a conflict'));
  assert.deepEqual(f.state.exportJob, { ...ready, state: 'expired' });
  assert.doesNotMatch(
    JSON.stringify(f.state),
    /SYNTHETIC_PRIVATE_EXPORT|SYNTHETIC_OWNER|SYNTHETIC_RECEIPT/,
  );
  f.controller.dispose();
});
for (const bad of [{ jobId: 'wrong' }, { state: 'unknown' }, { format: 'json' }]) {
  test(`a mismatched export status is rejected without replacing the confirmed job ${JSON.stringify(bad)}`, async () => {
    const f = fixture({ exportStatus: async () => ({ ok: true, data: { ...ready, ...bad } }) });
    await loaded(f);
    await f.controller.refreshExport();
    assert.deepEqual(f.state.exportJob, ready);
    assert.equal(f.state.exportStateLabel, '可领取');
    f.controller.dispose();
  });
}
for (const boundary of ['hide', 'switch']) {
  test(`an export conflict status cannot refill an old account view after ${boundary}`, async () => {
    let resolve,
      reads = 0;
    const waiting = new Promise((done) => {
      resolve = done;
    });
    const f = fixture({
      exportStatus: () => {
        reads++;
        return waiting;
      },
    });
    await loaded(f);
    const downloading = f.controller.download(() => assert.fail('No stale file'));
    await new Promise((done) => setImmediate(done));
    assert.equal(reads, 1);
    if (boundary === 'hide') {
      f.controller.suspend();
    } else {
      f.session.accept('scope_' + 'b'.repeat(64));
    }
    const before = JSON.stringify(f.state);
    resolve({ ok: true, data: { ...ready, state: 'expired' } });
    await downloading;
    assert.equal(JSON.stringify(f.state), before);
    f.controller.dispose();
  });
}
test('the actual account Page forwards the expired job id from its reapply button', () => {
  const file = path.resolve(__dirname, '../miniprogram/pages/account/index.js');
  const local = createRequire(file),
    requested = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx: {},
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return {
          cloudEnabled: true,
          cloudEnvId: 'synthetic',
          trustedSessionEnabled: true,
          releaseProfile: 'production',
        };
      }
      if (id.endsWith('/modules/account/production')) {
        return {
          createProductionAccountController: () => ({
            load() {},
            dispose() {},
            reapplyExport: (id) => requested.push(id),
          }),
        };
      }
      return local(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.onLoad();
  page.onReapplyExport({ currentTarget: { dataset: { jobId: 'synthetic_expired' } } });
  assert.deepEqual(requested, ['synthetic_expired']);
  const template = fs.readFileSync(file.replace('.js', '.wxml'), 'utf8');
  assert.match(template, /bindtap="onReapplyExport" data-job-id="{{exportJob.jobId}}"/);
  page.onUnload();
});
