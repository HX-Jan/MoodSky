const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../..');
const pack = path.join(root, 'docs/week4/jiaqi-zhu');
const { fixture } = require(path.join(root, 'tests/helpers/backend-fixture'));
const { createSyntheticReceiptPolicy } = require(path.join(root, 'tests/helpers/receipt-fixture'));
const { createCandidateRouter } = require(
  path.join(root, 'cloudfunctions/moodsky/candidate-router'),
);
const { createDecorationService } = require(
  path.join(root, 'cloudfunctions/moodsky/services/decorations'),
);
const catalogue = JSON.parse(
  fs.readFileSync(path.join(pack, 'assets/service-catalogue.json'), 'utf8'),
);
const checks = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, passed: true });
  } catch (e) {
    checks.push({ name, passed: false, message: e.message });
  }
};
async function main() {
  const f = fixture();
  const routerFor = (assets) =>
    createCandidateRouter({
      journalRepository: f.repository,
      journalReceiptPolicy: createSyntheticReceiptPolicy(),
      decorationCatalogue: assets,
      now: () => new Date('2026-11-05T00:00:00.000Z'),
      resolveAccount: async () => ({ id: 'synthetic_w4_jq', status: 'active' }),
    });
  const router = routerFor(catalogue);
  let serial = 0;
  const call = (payload, id) =>
    router(
      {
        apiVersion: '1',
        requestId: id || 'w4_jq_asset_' + ++serial,
        action: 'review.decorations',
        payload,
      },
      { OPENID: 'synthetic_ide_only' },
    );
  const replace = {
    operation: 'replace',
    month: '2026-11',
    expectedVersion: 0,
    stickers: catalogue.stickers.map((stickerId) => ({ stickerId })),
    backgroundId: catalogue.backgrounds[0],
  };
  await check(
    'Catalogue accepted by actual service factory without activating production',
    async () =>
      assert.equal(
        typeof createDecorationService({ repository: f.repository, catalogue }),
        'function',
      ),
  );
  await check('Maximum six sticker IDs enforced', async () =>
    assert.throws(
      () =>
        createDecorationService({
          repository: f.repository,
          catalogue: { ...catalogue, stickers: [...catalogue.stickers, 'STICKER_SEVENTH'] },
        }),
      TypeError,
    ),
  );
  await check('Maximum two background IDs enforced', async () =>
    assert.throws(
      () =>
        createDecorationService({
          repository: f.repository,
          catalogue: { ...catalogue, backgrounds: [...catalogue.backgrounds, 'BACKGROUND_THIRD'] },
        }),
      TypeError,
    ),
  );
  await check('Empty month reads zero decoration version', async () => {
    const r = await call({ operation: 'get', month: '2026-11' });
    assert.equal(r.ok, true);
    assert.equal(r.data.version, 0);
    assert.deepEqual(r.data.stickers, []);
  });
  await check(
    'All six candidate sticker IDs and day background can be written in synthetic memory',
    async () => {
      const r = await call(replace, 'w4_jq_asset_replace');
      assert.equal(r.ok, true);
      assert.equal(r.data.version, 1);
      assert.equal(r.data.stickers.length, 6);
      assert.equal(r.data.backgroundId, catalogue.backgrounds[0]);
    },
  );
  await check('Identical request replay does not advance version', async () => {
    const r = await call(replace, 'w4_jq_asset_replace');
    assert.equal(r.ok, true);
    assert.equal(r.data.version, 1);
  });
  await check('Actual read returns chosen catalogue IDs', async () => {
    const r = await call({ operation: 'get', month: '2026-11' });
    assert.deepEqual(
      r.data.stickers.map((x) => x.stickerId),
      catalogue.stickers,
    );
  });
  await check('Withdrawn ID hidden on read without rewriting version', async () => {
    const limited = routerFor({ ...catalogue, stickers: catalogue.stickers.slice(1) });
    const r = await limited(
      {
        apiVersion: '1',
        requestId: 'w4_jq_asset_withdrawn',
        action: 'review.decorations',
        payload: { operation: 'get', month: '2026-11' },
      },
      { OPENID: 'synthetic_ide_only' },
    );
    assert.equal(r.ok, true);
    assert.equal(r.data.version, 1);
    assert.equal(r.data.stickers.length, 5);
  });
  await check('Unknown sticker rejected', async () => {
    const r = await call({
      ...replace,
      expectedVersion: 1,
      stickers: [{ stickerId: 'STICKER_UNKNOWN' }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'INVALID_INPUT');
  });
  await check('Stale expectedVersion rejected as conflict', async () => {
    const r = await call(replace);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'CONFLICT');
  });
  await check('Reset clears decorative IDs without fake journal mutation', async () => {
    const r = await call({ operation: 'reset', month: '2026-11', expectedVersion: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.data.version, 2);
    assert.deepEqual(r.data.stickers, []);
    assert.equal(r.data.backgroundId, null);
  });
  const report = {
    date: '2026-11-05',
    sourceCommit: '43a72337316e515391fd0e8b8af8f779f21c1948',
    scope:
      'Actual tracked candidate service/router and synthetic receipt/memory fixture only; no cloud, production switches, identities or database touched',
    catalogueFile: 'assets/service-catalogue.json',
    passed: checks.filter((x) => x.passed).length,
    failed: checks.filter((x) => !x.passed).length,
    checks,
    productionEnabled: false,
  };
  fs.writeFileSync(
    path.join(pack, 'evidence/asset-contract-validation.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.failed) {
    process.exitCode = 1;
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
