// Local production entry + synthetic database only. No SDK connection is opened.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const { databaseFixture } = require(path.join(root, 'tests/helpers/w2-database'));
const { createProductionEntry } = require(path.join(root, 'cloudfunctions/moodsky/production'));
const { readProductionConfig, APP_ID, ENV_ID } = require(
  path.join(root, 'cloudfunctions/moodsky/production/config'),
);
const { PLACES } = require(path.join(root, 'miniprogram/shared/campus-checkins'));
const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const f = databaseFixture({});
let now = new Date('2026-11-17T15:59:59Z'),
  paused = false,
  seq = 0;
const scopes = {},
  samples = [];
async function call(who, action, payload = {}, id, record = true) {
  const entry = createProductionEntry({
    readIdentity: () => ({
      APPID: APP_ID,
      ENV: ENV_ID,
      SOURCE: 'wx_client',
      OPENID: who,
      identityFromCurrentInvocation: true,
    }),
    readConfig: () => ({ ...config, campusCheckinWritesPaused: paused }),
    openDatabase: () => f.db,
    now: () => now,
  });
  const request = {
    apiVersion: '1',
    action,
    payload,
    requestId: id || 'req_w6_' + ++seq,
    ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
  };
  const result = await entry(request);
  if (action === 'account.session' && result.ok) scopes[who] = result.data.scope;
  if (record)
    samples.push({
      actor: who,
      clock: now.toISOString(),
      paused,
      request: { action, payload, requestId: request.requestId },
      response: result,
    });
  return result;
}
(async () => {
  assert.equal(
    (await call('synthetic-A', 'campus.checkIn', { placeId: PLACES[0].placeId })).error.code,
    'UNAUTHENTICATED',
  );
  for (const actor of ['synthetic-A', 'synthetic-B'])
    assert.equal((await call(actor, 'account.session', {}, undefined, false)).ok, true);
  const payload = { placeId: PLACES[0].placeId };
  const first = await call('synthetic-A', 'campus.checkIn', payload, 'req_w6_original');
  assert.equal(first.ok, true);
  assert.equal(
    (await call('synthetic-A', 'campus.checkIn', payload, 'req_w6_same_day')).data.date,
    '2026-11-17',
  );
  now = new Date('2026-11-17T16:00:01Z');
  paused = true;
  const replay = await call('synthetic-A', 'campus.checkIn', payload, 'req_w6_original');
  assert.deepEqual(replay.data, { ...first.data, replayed: true });
  assert.equal(
    (await call('synthetic-A', 'campus.checkIn', payload)).error.code,
    'NOT_IMPLEMENTED',
  );
  const status = await call('synthetic-A', 'campus.checkins');
  assert.equal(status.data.writesPaused, true);
  assert.equal(status.data.date, '2026-11-18');
  assert.equal(status.data.items.length, 0);
  const history = await call('synthetic-A', 'campus.checkinHistory', { page: 1, pageSize: 1 });
  assert.equal(history.data.total, 1);
  assert.equal(
    (await call('synthetic-B', 'campus.checkinHistory', { page: 1, pageSize: 1 })).data.total,
    0,
  );
  assert.equal(
    (await call('synthetic-A', 'campus.checkIn', { placeId: PLACES[1].placeId }, 'req_w6_original'))
      .error.code,
    'CONFLICT',
  );
  const rows = Object.keys(f.inspect()).filter((k) => k.startsWith('place_checkins:')).length;
  assert.equal(rows, 1);
  const out = path.join(root, 'docs/week6/qinghan-zhang/evidence/response-samples.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        baseline: '13afb20956f5b115cfd393487aee8bbe570ea8d3',
        environment: 'Node local production entry with synthetic database; no real cloud',
        storedCheckins: rows,
        samples,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    '9 recorded responses; original replay preserves 2026-11-17 after midnight and pause; A=1/B=0; storedCheckins=1.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
