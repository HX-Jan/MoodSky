// Local synthetic production-entry verification. No wx SDK, credentials or network.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createMemoryDatabase } = require('../week6-xy/memory-database');
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
} = require('../../cloudfunctions/moodsky/production/config');
const { PLACES } = require('../../miniprogram/shared/campus-checkins');

const ACTORS = { A: 'SIMULATED_C2H_A', B: 'SIMULATED_C2H_B' };
const DATE = '2026-11-23';
const TEXT = { A: 'SIMULATED_C2H_A private record', B: 'SIMULATED_C2H_B private record' };

async function runWorkbench({ entryFactory = createProductionEntry } = {}) {
  const memory = createMemoryDatabase();
  const config = readProductionConfig({
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '44'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '55'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '66'.repeat(32),
    // Only this disposable memory world allows synthetic history seeding.
    MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED: 'false',
  });
  const scopes = {},
    cases = [];
  let sequence = 0;
  const now = () => new Date('2026-11-23T02:00:00Z');
  const call = async (actor, action, payload = {}, scope = scopes[actor]) => {
    const request = {
      apiVersion: '1',
      requestId: 'req_c2h_' + ++sequence,
      action,
      payload,
      ...(scope ? { sessionScope: scope } : {}),
    };
    const response = await entryFactory({
      readConfig: () => config,
      openDatabase: () => memory.db,
      now,
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_devtools',
        OPENID: ACTORS[actor],
        identityFromCurrentInvocation: true,
      }),
    })(request);
    return { request, response };
  };
  const must = (pair) => {
    if (!pair.response.ok) {
      throw new Error('Fixture setup failed: ' + pair.response.error.code);
    }
    return pair.response.data;
  };
  const add = (id, actor, pair, expected, passed, facts = {}) => {
    cases.push({
      id,
      actor,
      request: pair.request,
      response: pair.response,
      expected,
      passed: Boolean(passed),
      facts,
    });
  };
  const denied = (pair, code) => !pair.response.ok && pair.response.error.code === code;
  for (const actor of ['A', 'B']) {
    scopes[actor] = must(await call(actor, 'account.session')).scope;
    must(
      await call(actor, 'journal.upsert', {
        date: DATE,
        weather: actor === 'A' ? 'SUNNY' : 'RAINY',
        tags: [],
        text: TEXT[actor],
        expectedVersion: 0,
      }),
    );
    must(await call(actor, 'campus.checkIn', { placeId: PLACES[actor === 'A' ? 0 : 1].placeId }));
  }
  for (const [actor, id, place] of [
    ['A', 'H01', 0],
    ['B', 'H02', 1],
  ]) {
    const pair = await call(actor, 'campus.checkinHistory', { page: 1, pageSize: 10 });
    const items = pair.response.data?.items;
    add(
      id,
      actor,
      pair,
      'one own history row',
      pair.response.ok && items?.length === 1 && items[0].placeId === PLACES[place].placeId,
    );
  }
  let pair = await call('B', 'campus.checkinHistory', {
    page: 1,
    pageSize: 10,
    ownerId: accountId(config, ACTORS.A),
  });
  add('H03', 'B', pair, 'INVALID_REQUEST for client ownership', denied(pair, 'INVALID_REQUEST'));
  pair = await call('B', 'campus.checkinHistory', { page: 1, pageSize: 10 }, scopes.A);
  add(
    'H04',
    'B',
    pair,
    'UNAUTHENTICATED for A scope under B identity',
    denied(pair, 'UNAUTHENTICATED'),
  );
  const jobs = {};
  for (const [actor, id] of [
    ['A', 'E01'],
    ['B', 'E02'],
  ]) {
    jobs[actor] = must(await call(actor, 'account.requestExport', { format: 'json' })).jobId;
    pair = await call(actor, 'account.downloadExport', { jobId: jobs[actor] });
    const content = pair.response.data?.content || '';
    const own = content.includes(TEXT[actor]);
    const other = content.includes(TEXT[actor === 'A' ? 'B' : 'A']);
    add(
      id,
      actor,
      pair,
      'own JSON export, no other account content',
      pair.response.ok && own && !other,
      { containsOwn: own, containsOther: other },
    );
  }
  for (const [action, id] of [
    ['account.exportStatus', 'E03'],
    ['account.downloadExport', 'E04'],
  ]) {
    pair = await call('B', action, { jobId: jobs.A });
    add(id, 'B', pair, 'FORBIDDEN for A export job', denied(pair, 'FORBIDDEN'));
  }
  must(
    await call('A', 'journal.upsert', {
      date: DATE,
      weather: 'SUNNY',
      tags: [],
      text: TEXT.A + ' edited',
      expectedVersion: 1,
    }),
  );
  pair = await call('A', 'account.downloadExport', { jobId: jobs.A });
  add('E05', 'A', pair, 'CONFLICT after source modification', denied(pair, 'CONFLICT'));
  pair = await call('B', 'account.downloadExport', { jobId: jobs.B });
  add(
    'E06',
    'B',
    pair,
    'B export remains available',
    pair.response.ok && pair.response.data.content.includes(TEXT.B),
  );
  const oldScope = scopes.A;
  must(await call('A', 'account.close', { confirm: 'CLOSE' }));
  pair = await call('A', 'account.downloadExport', { jobId: jobs.A });
  add('L01', 'A', pair, 'ACCOUNT_DISABLED after deactivation', denied(pair, 'ACCOUNT_DISABLED'));
  pair = await call('B', 'journal.get', { date: DATE });
  add(
    'L02',
    'B',
    pair,
    'B private record remains available',
    pair.response.ok && pair.response.data.entry?.text === TEXT.B,
  );
  const registration = must(await call('A', 'account.registration'));
  pair = await call('A', 'account.register', {
    confirm: 'REGISTER',
    previousScope: registration.previousScope,
  });
  const newScope = pair.response.data?.scope;
  add(
    'L03',
    'A',
    pair,
    'explicit registration yields a distinct scope',
    pair.response.ok && newScope !== oldScope,
  );
  scopes.A = newScope;
  pair = await call('A', 'account.downloadExport', { jobId: jobs.A });
  add('L04', 'A', pair, 'FORBIDDEN for predecessor export', denied(pair, 'FORBIDDEN'));
  pair = await call('A', 'journal.get', { date: DATE });
  add(
    'L05',
    'A',
    pair,
    'new account has no predecessor record',
    pair.response.ok && pair.response.data.entry === null,
  );
  pair = await call('A', 'journal.get', { date: DATE }, oldScope);
  add('L06', 'A', pair, 'UNAUTHENTICATED for predecessor scope', denied(pair, 'UNAUTHENTICATED'));
  return {
    layer: 'LOCAL_PRODUCTION_ENTRY_MEMORY_DB',
    fixtureBusinessDate: DATE,
    actors: ['independent synthetic A', 'independent synthetic B'],
    cases,
    passed: cases.filter((row) => row.passed).length,
    failed: cases.filter((row) => !row.passed).length,
    realCloud: false,
    realPhone: false,
    independentAcceptance: false,
  };
}

function redact(report) {
  return JSON.parse(
    JSON.stringify(report, (key, value) => {
      if (['sessionScope', 'previousScope', 'scope'].includes(key)) {
        return '<synthetic-scope>';
      }
      if (key === 'receipt') {
        return '<redacted-receipt>';
      }
      if (key === 'content') {
        return '<omitted; content ownership checked in facts>';
      }
      if (key === 'text') {
        return '<omitted synthetic record text>';
      }
      if (key === 'ownerId') {
        return '<synthetic-owner>';
      }
      return value;
    }),
  );
}
async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--out' || !path.isAbsolute(args[1])) {
    throw new Error('Usage: node tools/alpha-h/ab-workbench.cjs --out <new absolute directory>');
  }
  const output = args[1];
  if (fs.existsSync(output) && fs.readdirSync(output).length) {
    throw new Error('Choose a new empty output directory.');
  }
  const report = redact(await runWorkbench());
  report.executedAt = new Date().toISOString();
  report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
  }).trim();
  report.sourceWorktreeDirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
    }).trim(),
  );
  report.executor = 'not supplied; fill your own execution record, not an independent signature';
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const csv = (value) => '"' + String(value).replaceAll('"', '""') + '"';
  fs.writeFileSync(
    path.join(output, 'results.csv'),
    [
      ['case', 'actor', 'action', 'expected', 'actual', 'passed'],
      ...report.cases.map((row) => [
        row.id,
        row.actor,
        row.request.action,
        row.expected,
        row.response.ok ? 'ok' : row.response.error.code,
        row.passed,
      ]),
    ]
      .map((row) => row.map(csv).join(','))
      .join('\n') + '\n',
  );
  console.log(
    JSON.stringify({
      cases: report.cases.length,
      passed: report.passed,
      failed: report.failed,
      output,
    }),
  );
  if (report.failed) {
    process.exitCode = 1;
  }
}
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { runWorkbench, redact };
