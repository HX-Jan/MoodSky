// Synthetic DB only. Candidate decorations are injected here, never in production.
const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFixture } = require('./helpers/w2-database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { createProductionCleanup } = require('../cloudfunctions/moodsky/production/cleanup');
const { createDecorationService } = require('../cloudfunctions/moodsky/services/decorations');
const { createCloudJournalRepository } = require('../tools/journal-storage/cloudbase-candidate');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const { createRequest } = require('../miniprogram/services/api');
const { STICKER_CATALOG, BACKGROUND_CATALOG } = require('../miniprogram/modules/review/demo-data');
const catalogue = require('../docs/week4/jiaqi-zhu/assets/service-catalogue.json');
const {
  readProductionConfig,
  accountId,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');
const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const now = () => new Date('2026-11-02T04:00:00Z');
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
};
async function world() {
  const f = databaseFixture({
    'task_templates:synthetic_task': {
      _id: 'synthetic_task',
      enabled: true,
      title: '合成任务',
      steps: ['合成步骤'],
      durationMin: 5,
      tags: [],
    },
  });
  const scopes = {};
  const call = async (who, action, payload = {}, request = createRequest(action, payload)) => {
    const result = await createProductionEntry({
      readConfig: () => config,
      openDatabase: () => f.db,
      now,
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_client',
        OPENID: who,
        identityFromCurrentInvocation: true,
      }),
    })({ ...request, sessionScope: scopes[who] });
    if (action === 'account.session' && result.ok) {
      scopes[who] = result.data.scope;
    }
    return result;
  };
  for (const who of ['synthetic_a', 'synthetic_b']) {
    ok(await call(who, 'account.session'));
  }
  function withCatalogue(assetCatalogue = catalogue) {
    const decorate = createDecorationService({
      repository: createCloudJournalRepository(f.db, { sourceRevisionsEnabled: true }),
      catalogue: assetCatalogue,
      receiptPolicy: createSyntheticReceiptPolicy(),
      now,
    });
    return (payload, requestId = 'req_w4_decor_original', who = 'synthetic_a') =>
      decorate({
        payload,
        requestId,
        actor: { accountId: accountId(config, who), status: 'active' },
      });
  }
  return {
    ...f,
    call,
    decorate: withCatalogue(),
    withCatalogue,
    revisions: () => f.inspect()['accounts:' + accountId(config, 'synthetic_a')].sourceRevisions,
  };
}
const replacement = (targetEntryId) => ({
  operation: 'replace',
  month: '2026-11',
  expectedVersion: 0,
  stickers: [{ stickerId: 'STICKER_STAR', targetEntryId }],
  backgroundId: 'BACKGROUND_SKY_DAY',
});
async function save(f, who = 'synthetic_a') {
  return ok(
    await f.call(who, 'journal.upsert', {
      date: '2026-11-02',
      weather: 'CUSTOM',
      weatherName: '合成天气',
      tags: [],
      text: 'SYNTHETIC_PRIVATE_' + who,
      expectedVersion: 0,
    }),
  ).entry;
}
test('W4 H03/H04 the delivered catalogue matches the client and production stays closed to the candidate', async () => {
  assert.deepEqual(catalogue.stickers, STICKER_CATALOG);
  assert.deepEqual(catalogue.backgrounds, BACKGROUND_CATALOG);
  const f = await world();
  const before = f.inspect();
  for (const [action, payload] of [
    ['review.decorations', { operation: 'get', month: '2026-11' }],
    ['campus.favorites', { operation: 'get' }],
    ['campus.correctPlace', { placeId: 'synthetic_place', text: '合成纠错' }],
  ]) {
    const result = await f.call('synthetic_a', action, payload);
    assert.equal(result.error.code, 'NOT_IMPLEMENTED', JSON.stringify(result));
  }
  assert.deepEqual(f.inspect(), before);
});
test('W4 H03 an original decoration request stays recoverable after assets are withdrawn', async () => {
  const f = await world();
  const entry = await save(f);
  const request = replacement(entry.id);
  const saved = await f.decorate(request);
  assert.equal(saved.version, 1);
  assert.equal(saved.stickers.length, 1);
  assert.equal(saved.backgroundId, request.backgroundId);
  const afterWithdrawal = f.withCatalogue({
    stickers: catalogue.stickers.filter((id) => id !== request.stickers[0].stickerId),
    backgrounds: catalogue.backgrounds.filter((id) => id !== request.backgroundId),
  });
  const get = { operation: 'get', month: request.month };
  const revisions = f.revisions();
  assert.deepEqual(await afterWithdrawal(get), {
    month: request.month,
    version: saved.version,
    stickers: [],
    backgroundId: null,
  });
  assert.deepEqual(await afterWithdrawal(request), await afterWithdrawal(get));
  assert.deepEqual(f.revisions(), revisions);
  await assert.rejects(afterWithdrawal({ ...request, expectedVersion: saved.version }), {
    code: 'CONFLICT',
  });
  const beforeRejected = f.inspect();
  await assert.rejects(
    afterWithdrawal({ ...request, expectedVersion: saved.version }, 'req_w4_decor_new'),
    { code: 'INVALID_INPUT' },
  );
  assert.deepEqual(f.inspect(), beforeRejected);
  assert.deepEqual(await f.decorate(get), saved);
});
test('W4 H03/H04 tasks, preferences and candidate decorations each revoke previous exports; delete removes bound targets', async () => {
  const f = await world();
  const entry = await save(f);
  for (const change of [
    () =>
      f
        .call('synthetic_a', 'tasks.transition', { taskId: 'synthetic_task', transition: 'select' })
        .then(ok),
    () =>
      f
        .call('synthetic_a', 'account.preferences', { operation: 'set', decorationsEnabled: false })
        .then(ok),
    () => f.decorate(replacement(entry.id)),
  ]) {
    const job = ok(await f.call('synthetic_a', 'account.requestExport', { format: 'json' }));
    await change();
    assert.equal(
      ok(await f.call('synthetic_a', 'account.exportStatus', { jobId: job.jobId })).state,
      'expired',
    );
    assert.equal(
      (await f.call('synthetic_a', 'account.downloadExport', { jobId: job.jobId })).error.code,
      'CONFLICT',
    );
  }
  assert.deepEqual(f.revisions(), {
    journals: 1,
    tasks: 1,
    preferences: 1,
    decorations: 1,
    favorites: 0,
  });
  await f.decorate(replacement(entry.id));
  assert.equal(f.revisions().decorations, 1);
  const get = { operation: 'get', month: '2026-11' };
  assert.equal((await f.decorate(get)).stickers.length, 1); // preference off does not delete configuration
  const job = ok(await f.call('synthetic_a', 'account.requestExport', { format: 'json' }));
  const exported = ok(await f.call('synthetic_a', 'account.downloadExport', { jobId: job.jobId }));
  const doc = JSON.parse(exported.content);
  assert.equal(doc.data.preferences.decorationsEnabled, false);
  assert.equal(doc.data.taskHistory.length, 1);
  assert.deepEqual(doc.data.monthDecorations[0].stickers, [
    { stickerId: 'STICKER_STAR', targetDate: '2026-11-02' },
  ]);
  assert.equal(doc.data.monthDecorations[0].backgroundId, 'BACKGROUND_SKY_DAY');
  assert.doesNotMatch(exported.content, /acct_|scope_|ownerId|targetEntryId/);
  assert.equal(
    (await f.call('synthetic_b', 'account.downloadExport', { jobId: job.jobId })).error.code,
    'FORBIDDEN',
  );
  ok(await f.call('synthetic_a', 'journal.delete', { date: '2026-11-02', expectedVersion: 1 }));
  assert.deepEqual((await f.decorate(get)).stickers, []);
  assert.deepEqual((await f.decorate(replacement(entry.id))).stickers, []);
  const fresh = ok(await f.call('synthetic_a', 'account.requestExport', { format: 'json' }));
  const content = JSON.parse(
    ok(await f.call('synthetic_a', 'account.downloadExport', { jobId: fresh.jobId })).content,
  );
  assert.deepEqual(content.data.journals, []);
  assert.deepEqual(content.data.monthDecorations[0].stickers, []);
});
test('W4 H04 closing after mixed-module writes rejects candidate access and cleans only A while retaining public material and B', async () => {
  const f = await world();
  const entry = await save(f);
  await save(f, 'synthetic_b');
  await f.decorate(replacement(entry.id));
  ok(
    await f.call('synthetic_a', 'account.preferences', { operation: 'set', cardTextPreview: true }),
  );
  const ownerId = accountId(config, 'synthetic_a');
  for (const collection of ['favorites', 'place_corrections']) {
    f.put(collection, { _id: 'synthetic_' + collection, ownerId });
  }
  for (const collection of ['places', 'support_resources']) {
    f.put(collection, { _id: 'synthetic_public', name: '合成公开资料' });
  }
  const before = f.inspect();
  const closure = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  await assert.rejects(f.decorate({ operation: 'get', month: '2026-11' }), {
    code: 'ACCOUNT_DISABLED',
  });
  const worker = createProductionCleanup({ db: f.db, now });
  let status;
  for (let i = 0; i < 20; i++) {
    status = await worker.step(closure.cleanup.jobId);
    if (status.state === 'completed') {
      break;
    }
  }
  assert.equal(status.state, 'completed');
  assert.deepEqual(await worker.step(closure.cleanup.jobId), status);
  const after = f.inspect();
  for (const [key, row] of Object.entries(after)) {
    if (row.ownerId === ownerId) {
      assert.ok(key.startsWith('cleanup_jobs:'), key);
    }
  }
  for (const [key, value] of Object.entries(before)) {
    if (
      key.startsWith('places:') ||
      key.startsWith('support_resources:') ||
      key.startsWith('task_templates:') ||
      value.ownerId === accountId(config, 'synthetic_b')
    ) {
      assert.deepEqual(after[key], value, key);
    }
  }
  assert.equal((await f.call('synthetic_a', 'account.session')).error.code, 'ACCOUNT_DISABLED');
});
