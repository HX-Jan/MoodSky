const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

test('packaged cloud entry keeps private services disabled and excludes local fixtures', async () => {
  const build = esbuild.buildSync({
    entryPoints: [path.resolve(__dirname, '../cloudfunctions/moodsky/index.js')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['wx-server-sdk'],
  });
  const source = build.outputFiles[0].text;
  assert.doesNotMatch(
    source,
    /deterministic-days-v1|synthetic-offline|SIMULATED_NO_NETWORK|createMemoryJournalRepository|createJournalService|createReviewService|createDecorationService|createReceiptPolicy|createCleanupService|createExportService|createRepository|createIdentityServices|createAccountDomain|createTasksDomain|createMemoryTasksStore/,
  );
  let context = {};
  let initialized = 0;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require(id) {
      if (id === 'wx-server-sdk') {
        return {
          DYNAMIC_CURRENT_ENV: 'synthetic_dynamic',
          init() {
            initialized++;
          },
          getWXContext: () => context,
          database() {
            throw new Error('Default packaged entry must not construct business stores');
          },
        };
      }
      assert.equal(id, 'node:crypto');
      return require(id);
    },
  });
  const event = (action, payload = {}) => ({
    apiVersion: '1',
    requestId: 'req_bundle_default',
    action,
    payload,
  });
  assert.equal((await module.exports.main(event('system.health'))).ok, true);
  assert.equal(
    (await module.exports.main(event('journal.get', { date: '2026-10-18' }))).error.code,
    'UNAUTHENTICATED',
  );
  context = { OPENID: 'synthetic_trusted' };
  for (const [action, payload] of [
    ['journal.upsert', { date: '2026-10-18', weather: 'SUNNY', expectedVersion: 0 }],
    ['journal.get', { date: '2026-10-18' }],
    ['journal.delete', { date: '2026-10-18', expectedVersion: 1 }],
    ['review.calendar', { month: '2026-10' }],
    ['review.decorations', { month: '2026-10', operation: 'get' }],
  ]) {
    const result = await module.exports.main(event(action, payload));
    assert.equal(result.ok, false, action);
    assert.equal(result.error.code, 'NOT_IMPLEMENTED', action);
  }
  const injection = await module.exports.main({
    ...event('journal.get'),
    journalRepository: {},
    decorationCatalogue: {},
  });
  assert.equal(injection.error.code, 'INVALID_REQUEST');
  assert.equal(initialized, 1);
});
