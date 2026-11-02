const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildPrivatePilot } = require('../scripts/package-private-pilot');
const { settings, operatorFingerprint } = require('../tools/private-pilot/config');
const { readInvocationIdentity } = require('../tools/private-pilot/invocation');

test('invocation identity comes only from fresh platform JSON or legacy context fields', () => {
  const json = readInvocationIdentity({
    environment: JSON.stringify({
      WX_OPENID: 'fresh_b',
      WX_APPID: settings.appId,
      TCB_SOURCE: 'wx_client',
      TCB_ENV: settings.environmentId,
    }),
  });
  assert.equal(json.OPENID, 'fresh_b');
  assert.equal(json.identityFromCurrentInvocation, true);
  assert.equal(
    readInvocationIdentity({
      environ: 'WX_OPENID=fresh_c;WX_APPID=appid;TCB_SOURCE=wx_client;TCB_ENV=env',
    }).OPENID,
    'fresh_c',
  );
  assert.deepEqual(readInvocationIdentity({ environ: 'WX_OPENID=a;WX_OPENID=b' }), {});
  assert.deepEqual(readInvocationIdentity({ environment: 'bad JSON' }), {});
  assert.deepEqual(readInvocationIdentity(undefined), {});
});

test('closed pilot package cannot be enabled by environment variables and preview stays separate from experience package', async () => {
  const output = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-pilot-package-')),
    'package',
  );
  const result = buildPrivatePilot({ outputRoot: output });
  assert.equal(result.manifest.doNotUploadToExperience, true);
  assert.equal(result.manifest.closedAfterTestRequired, true);
  const config = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(result.client, 'miniprogram/config/environment.local.js'), 'utf8'),
    { module: config },
  );
  assert.equal(config.exports.cloudFunctionName, 'moodsky-private-pilot');
  assert.equal(config.exports.trustedSessionEnabled, true);
  assert.equal(config.exports.journalDemo, false);
  assert.notEqual(result.builds.closed.hashes['index.js'], result.builds.active.hashes['index.js']);
  const pkg = JSON.parse(fs.readFileSync(path.join(result.builds.active.target, 'package.json')));
  assert.equal(pkg.dependencies['@cloudbase/node-sdk'], '3.17.2');
  assert.equal(pkg.dependencies['wx-server-sdk'], '4.0.2');
  let dbCalls = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(result.builds.closed.target, 'index.js'), 'utf8'), {
    module,
    exports: module.exports,
    process: {
      env: {
        MOODSKY_PRIVATE_PILOT_ENABLED: 'true',
        MOODSKY_PILOT_ACCOUNT_INDEX_VERIFIED: 'true',
        MOODSKY_PILOT_OPERATOR_FINGERPRINT: operatorFingerprint('synthetic_a'),
        MOODSKY_PILOT_RECEIPT_KEY_BASE64: Buffer.alloc(32).toString('base64'),
      },
    },
    require(name) {
      if (name === 'wx-server-sdk') {
        return {
          DYNAMIC_CURRENT_ENV: settings.environmentId,
          init() {},
          getWXContext: () => ({
            ENV: settings.environmentId,
            APPID: settings.appId,
            OPENID: 'synthetic_a',
          }),
        };
      }
      if (name === '@cloudbase/node-sdk') {
        dbCalls++;
        throw Error('Native SDK must stay closed');
      }
      return require(name);
    },
    Buffer,
  });
  const call = (action) =>
    module.exports.main({
      request: { apiVersion: '1', requestId: 'req_closed_bundle', action, payload: {} },
    });
  assert.equal((await call('system.health')).data.pilot.configured, false);
  assert.equal((await call('account.session')).error.code, 'NOT_IMPLEMENTED');
  assert.equal(dbCalls, 0);
});

test('packaged active pilot rejects stale WX identity from reused process environment and caller metadata', async () => {
  const output = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-pilot-context-')),
    'package',
  );
  const { builds } = buildPrivatePilot({ outputRoot: output });
  let nativeCalls = 0,
    wxContextReads = 0;
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ['2026-10-25T04:00:00.000Z']));
    }
    static now() {
      return new RealDate('2026-10-25T04:00:00.000Z').getTime();
    }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(builds.active.target, 'index.js'), 'utf8'), {
    module,
    exports: module.exports,
    Buffer,
    Date: FixedDate,
    process: {
      env: {
        WX_OPENID: 'synthetic_a',
        WX_APPID: settings.appId,
        TCB_ENV: settings.environmentId,
        TCB_SOURCE: 'wx_client',
        MOODSKY_PRIVATE_PILOT_ENABLED: 'true',
        MOODSKY_PILOT_ACCOUNT_INDEX_VERIFIED: 'true',
        MOODSKY_PILOT_OPERATOR_FINGERPRINT: operatorFingerprint('synthetic_a'),
        MOODSKY_PILOT_RECEIPT_KEY_BASE64: Buffer.alloc(32, 0x42).toString('base64'),
        MOODSKY_PILOT_TEST_DATE: '2026-10-25',
        MOODSKY_PILOT_EXPIRES_AT: '2026-10-25T08:00:00.000Z',
      },
    },
    require(name) {
      if (name === 'wx-server-sdk') {
        return {
          DYNAMIC_CURRENT_ENV: settings.environmentId,
          init() {},
          getWXContext() {
            wxContextReads++;
            throw Error('Stale API not permitted');
          },
        };
      }
      if (name === '@cloudbase/node-sdk') {
        nativeCalls++;
        throw Error('No database access allowed');
      }
      return require(name);
    },
  });
  const event = {
    request: {
      apiVersion: '1',
      requestId: 'req_context_gate',
      action: 'account.session',
      payload: {},
    },
    userInfo: { OPENID: 'synthetic_a' },
    tcbContext: { WX_OPENID: 'synthetic_a' },
  };
  assert.equal((await module.exports.main(event, undefined)).error.code, 'FORBIDDEN');
  assert.equal(
    (
      await module.exports.main(event, {
        environment: JSON.stringify({
          WX_OPENID: 'synthetic_a',
          WX_APPID: settings.appId,
          TCB_ENV: settings.environmentId,
          TCB_SOURCE: 'web',
        }),
      })
    ).error.code,
    'FORBIDDEN',
  );
  assert.equal(
    (
      await module.exports.main(event, {
        environment: JSON.stringify({
          WX_OPENID: 'synthetic_b',
          WX_APPID: settings.appId,
          TCB_ENV: settings.environmentId,
          TCB_SOURCE: 'wx_client',
        }),
      })
    ).error.code,
    'FORBIDDEN',
  );
  assert.equal(nativeCalls, 0);
  assert.equal(wxContextReads, 0);
});
