// W6-JF sample collector. Local production entry + offline SDK transport only.
// Usage: node tools/week6-jf/collect-samples.cjs [outputDir]
const fs = require('node:fs');
const path = require('node:path');
const { withTaskWorld } = require('./local-world.cjs');
const { databaseFixture } = require('../../tests/helpers/w2-database');
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const { DEFAULT_TASKS } = require('../../miniprogram/shared/task-catalogue');
const { clientCapabilities } = require('../../miniprogram/modules/system/capabilities');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
} = require('../../cloudfunctions/moodsky/production/config');

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const identity = (who) => ({
  APPID: APP_ID,
  ENV: ENV_ID,
  SOURCE: 'wx_client',
  OPENID: 'synthetic_w6_jf_' + who,
  identityFromCurrentInvocation: true,
});
const template = (id, extra = {}) => ({
  _id: id,
  enabled: true,
  title: '合成任务 ' + id,
  steps: ['合成步骤'],
  durationMin: 5,
  tags: [],
  ...extra,
});
const seedOf = (rows) => Object.fromEntries(rows.map((row) => ['task_templates:' + row._id, row]));
const SECRET_KEYS = new Set(['scope', 'sessionScope', 'openid', 'ownerId', 'accountId']);
function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) {
      output[key] = '<redacted>';
    } else if (key === 'receipt' && typeof entry === 'string') {
      output[key] = '<receipt-redacted>';
    } else if (key === 'jobId' && typeof entry === 'string') {
      output[key] = '<jobId-redacted>';
    } else if (key === 'items' && Array.isArray(entry)) {
      output[key] = entry.map(redact);
    } else {
      output[key] = redact(entry);
    }
  }
  return output;
}
const countRows = (world, collection) => world.count(collection);
const responseOf = (response) => redact(response);
const taskIds = (response) =>
  response.ok && response.data && Array.isArray(response.data.items)
    ? response.data.items.map((item) => item.taskId)
    : [];
function fallbackOf(ids) {
  const defaults = DEFAULT_TASKS.map((row) => row._id);
  return ids.length === defaults.length && ids.every((id, index) => id === defaults[index]);
}
async function templateScenario(rows) {
  return withTaskWorld({ seed: seedOf(rows), tasksWritesEnabled: true }, async (world) => {
    const response = await world.send(
      world.request('tasks.suggestions', {}, 'req_w6_jf_templates'),
    );
    const ids = taskIds(response);
    return {
      request: {
        action: 'tasks.suggestions',
        payload: {},
        requestId: 'req_w6_jf_templates',
      },
      response: responseOf(response),
      itemIds: ids,
      itemCount: ids.length,
      builtInFallback: response.ok ? fallbackOf(ids) : null,
      writeCounts: {
        task_history: countRows(world, 'task_history'),
        request_receipts: countRows(world, 'request_receipts'),
      },
    };
  });
}
async function readFailureScenario() {
  const fixture = databaseFixture(
    {},
    {
      fail: ({ collection, operation }) => collection === 'task_templates' && operation === 'query',
    },
  );
  const entry = createProductionEntry({
    tasksWritesEnabled: true,
    readIdentity: () => identity('a'),
    readConfig: () => config,
    openDatabase: () => fixture.db,
    now: () => new Date('2026-11-18T04:00:00.000Z'),
  });
  const response = await entry({
    apiVersion: '1',
    requestId: 'req_w6_jf_template_read_failure',
    action: 'tasks.suggestions',
    payload: {},
  });
  return {
    layer: 'local fixture (injected query failure)',
    request: { action: 'tasks.suggestions', payload: {} },
    response: responseOf(response),
    storageRows: Object.keys(fixture.inspect()).length,
  };
}
async function modeClosed() {
  const base = {
    releaseProfile: 'production',
    cloudEnabled: true,
    cloudEnvId: 'synthetic-w6-jf',
    trustedSessionEnabled: true,
  };
  const capability = clientCapabilities({ ...base, taskMode: 'closed' }).tasks;
  return {
    clientCapability: capability,
    serviceCalls: 0,
    request: null,
    response: null,
    note: 'closed is a client build scope; pages/tasks/index.js returns before creating a controller.',
  };
}
async function modeReadOnly() {
  return withTaskWorld({ seed: {}, tasksWritesEnabled: false }, async (world) => {
    await world.login('a');
    const suggestions = await world.send(world.request('tasks.suggestions'));
    const mine = await world.send(world.request('tasks.mine'));
    const write = await world.send(
      world.request(
        'tasks.transition',
        { taskId: DEFAULT_TASKS[0]._id, transition: 'select', expectedDate: '2026-11-18' },
        'req_w6_jf_readonly_write',
      ),
    );
    return {
      clientCapability: clientCapabilities(
        {
          releaseProfile: 'production',
          cloudEnabled: true,
          cloudEnvId: 'synthetic-w6-jf',
          trustedSessionEnabled: true,
          taskMode: 'readOnly',
        },
        'release',
      ).tasks,
      suggestions: responseOf(suggestions),
      mine: responseOf(mine),
      rejectedWrite: responseOf(write),
      writeCounts: {
        task_history: countRows(world, 'task_history'),
        request_receipts: countRows(world, 'request_receipts'),
      },
    };
  });
}
async function modeEnabled() {
  const seed = seedOf([template('synthetic_one'), template('synthetic_two')]);
  return withTaskWorld({ seed, tasksWritesEnabled: true }, async (world) => {
    await world.login('a');
    const counts = () => ({
      task_history: countRows(world, 'task_history'),
      request_receipts: countRows(world, 'request_receipts'),
    });
    const suggestions = await world.send(world.request('tasks.suggestions'));
    const suggestionsCounts = counts();
    const selectPayload = {
      taskId: 'synthetic_one',
      transition: 'select',
      expectedDate: '2026-11-18',
    };
    const select = await world.send(
      world.request('tasks.transition', selectPayload, 'req_w6_jf_enabled_select'),
    );
    const selectCounts = counts();
    const complete = await world.send(
      world.request(
        'tasks.transition',
        { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
        'req_w6_jf_enabled_complete',
      ),
    );
    const completeCounts = counts();
    const replay = await world.send(
      world.request('tasks.transition', selectPayload, 'req_w6_jf_enabled_select'),
    );
    const replayCounts = counts();
    const history = await world.send(
      world.request('tasks.history', { from: '2026-11-18', to: '2026-11-18' }),
    );
    return {
      clientCapability: clientCapabilities(
        {
          releaseProfile: 'production',
          cloudEnabled: true,
          cloudEnvId: 'synthetic-w6-jf',
          trustedSessionEnabled: true,
          taskMode: 'enabled',
        },
        'release',
      ).tasks,
      suggestions: responseOf(suggestions),
      select: responseOf(select),
      complete: responseOf(complete),
      replay: responseOf(replay),
      history: responseOf(history),
      countsAfter: {
        suggestions: suggestionsCounts,
        select: selectCounts,
        complete: completeCounts,
        replay: replayCounts,
      },
      writeCounts: {
        task_history: countRows(world, 'task_history'),
        request_receipts: countRows(world, 'request_receipts'),
      },
    };
  });
}
async function transitions() {
  const seed = seedOf([
    template('synthetic_one'),
    template('synthetic_two'),
    template('synthetic_three'),
  ]);
  return withTaskWorld({ seed, tasksWritesEnabled: true }, async (world) => {
    await world.login('a');
    const steps = [];
    const counts = () => ({
      task_history: countRows(world, 'task_history'),
      request_receipts: countRows(world, 'request_receipts'),
    });
    const send = async (action, payload, requestId) => {
      const response = await world.send(world.request(action, payload, requestId));
      steps.push({
        request: { action, payload, requestId },
        response: responseOf(response),
        countsAfter: counts(),
      });
      return response;
    };
    await send(
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
      'req_w6_jf_matrix_01_select',
    );
    await send(
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
      'req_w6_jf_matrix_02_complete',
    );
    // Same requestId as the previous complete: a true lost-response replay.
    await send(
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
      'req_w6_jf_matrix_02_complete',
    );
    await send(
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'skip', expectedDate: '2026-11-18' },
      'req_w6_jf_matrix_04_terminal_conflict',
    );
    const day1History = await world.send(
      world.request('tasks.history', { from: '2026-11-18', to: '2026-11-18' }),
    );
    world.setNow('2026-11-19T04:00:00.000Z');
    const replayAfterMidnight = await world.send(
      world.request(
        'tasks.transition',
        { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
        'req_w6_jf_matrix_01_select',
      ),
    );
    await send(
      'tasks.transition',
      { taskId: 'synthetic_two', transition: 'select', expectedDate: '2026-11-19' },
      'req_w6_jf_matrix_05_day2_select',
    );
    await send(
      'tasks.transition',
      {
        taskId: 'synthetic_two',
        transition: 'replace',
        replacementTaskId: 'synthetic_three',
        expectedDate: '2026-11-19',
      },
      'req_w6_jf_matrix_06_replace',
    );
    await send(
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'skip', expectedDate: '2026-11-19' },
      'req_w6_jf_matrix_07_skip',
    );
    await send(
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
      'req_w6_jf_matrix_08_stale_date',
    );
    const day2History = await world.send(
      world.request('tasks.history', { from: '2026-11-18', to: '2026-11-19' }),
    );
    return {
      steps,
      day1History: responseOf(day1History),
      replayAfterMidnight: responseOf(replayAfterMidnight),
      day2History: responseOf(day2History),
      writeCounts: {
        task_history: countRows(world, 'task_history'),
        request_receipts: countRows(world, 'request_receipts'),
      },
    };
  });
}
async function isolation() {
  const seed = seedOf([template('synthetic_one')]);
  return withTaskWorld({ seed, tasksWritesEnabled: true }, async (world) => {
    await world.login('a');
    await world.login('b');
    const aSelect = await world.send(
      world.request(
        'tasks.transition',
        { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
        'req_w6_jf_isolation_a',
      ),
      'a',
    );
    const bMine = await world.send(world.request('tasks.mine'), 'b');
    const bHistory = await world.send(
      world.request('tasks.history', { from: '2026-11-18', to: '2026-11-18' }),
      'b',
    );
    const bSelect = await world.send(
      world.request(
        'tasks.transition',
        { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
        'req_w6_jf_isolation_b',
      ),
      'b',
    );
    const aHistory = await world.send(
      world.request('tasks.history', { from: '2026-11-18', to: '2026-11-18' }),
      'a',
    );
    return {
      aSelect: responseOf(aSelect),
      bMine: responseOf(bMine),
      bHistory: responseOf(bHistory),
      bSelect: responseOf(bSelect),
      aHistory: responseOf(aHistory),
      writeCounts: {
        task_history: countRows(world, 'task_history'),
        request_receipts: countRows(world, 'request_receipts'),
      },
    };
  });
}

async function emptyCatalogueWrite() {
  return withTaskWorld({ seed: {}, tasksWritesEnabled: true }, async (world) => {
    await world.login('a');
    const suggestions = await world.send(world.request('tasks.suggestions'));
    const select = await world.send(
      world.request(
        'tasks.transition',
        { taskId: 'moodsky_01_walk', transition: 'select', expectedDate: '2026-11-18' },
        'req_w6_jf_empty_catalogue_select',
      ),
    );
    const history = await world.send(
      world.request('tasks.history', { from: '2026-11-18', to: '2026-11-18' }),
    );
    return {
      request: {
        action: 'tasks.transition',
        payload: {
          taskId: 'moodsky_01_walk',
          transition: 'select',
          expectedDate: '2026-11-18',
        },
        requestId: 'req_w6_jf_empty_catalogue_select',
      },
      suggestions: responseOf(suggestions),
      select: responseOf(select),
      history: responseOf(history),
      writeCounts: {
        task_history: countRows(world, 'task_history'),
        request_receipts: countRows(world, 'request_receipts'),
      },
    };
  });
}
async function terminalReplay() {
  return withTaskWorld(
    { seed: seedOf([template('synthetic_one')]), tasksWritesEnabled: true },
    async (world) => {
      await world.login('a');
      const select = await world.send(
        world.request(
          'tasks.transition',
          { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
          'req_w6_jf_terminal_select',
        ),
      );
      const complete = await world.send(
        world.request(
          'tasks.transition',
          { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
          'req_w6_jf_terminal_complete',
        ),
      );
      const before = {
        task_history: countRows(world, 'task_history'),
        request_receipts: countRows(world, 'request_receipts'),
      };
      // New requestId, same terminal target: the history row must not change, but
      // the service commits a new receipt for this request.
      const replay = await world.send(
        world.request(
          'tasks.transition',
          { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
          'req_w6_jf_terminal_replay_new_id',
        ),
      );
      return {
        select: responseOf(select),
        complete: responseOf(complete),
        before,
        replay: responseOf(replay),
        after: {
          task_history: countRows(world, 'task_history'),
          request_receipts: countRows(world, 'request_receipts'),
        },
      };
    },
  );
}
async function accountBoundaries() {
  const { COLLECTIONS } = require('../../cloudfunctions/moodsky/production/cleanup');
  const { accountId } = require('../../cloudfunctions/moodsky/production/config');
  const ownerA = accountId(config, 'synthetic_w6_jf_a');
  const ownerB = accountId(config, 'synthetic_w6_jf_b');
  const seed = seedOf([template('synthetic_one')]);
  for (const collection of COLLECTIONS) {
    seed[collection + ':a_' + collection] = {
      _id: 'a_' + collection,
      ownerId: ownerA,
      synthetic: collection,
    };
    seed[collection + ':b_' + collection] = {
      _id: 'b_' + collection,
      ownerId: ownerB,
      synthetic: collection,
    };
  }
  const fixture = databaseFixture(seed);
  const scopes = {};
  const clock = new Date('2026-11-18T04:00:00.000Z');
  let serial = 0;
  const call = async (who, action, payload = {}, requestId) => {
    const entry = createProductionEntry({
      tasksWritesEnabled: true,
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_client',
        OPENID: 'synthetic_w6_jf_' + who,
        identityFromCurrentInvocation: true,
      }),
      readConfig: () => config,
      openDatabase: () => fixture.db,
      now: () => clock,
    });
    const response = await entry({
      apiVersion: '1',
      requestId: requestId || 'req_w6_jf_account_' + ++serial,
      action,
      payload,
      ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
    });
    if (action === 'account.session' && response.ok) {
      scopes[who] = response.data.scope;
    }
    return response;
  };
  const rowsOf = (collection, ownerIdValue) =>
    Object.entries(fixture.inspect())
      .filter(
        ([key, row]) =>
          key.startsWith(collection + ':') &&
          (ownerIdValue === undefined || row.ownerId === ownerIdValue),
      )
      .map(([, row]) => row);
  const countsForA = () =>
    Object.fromEntries(
      COLLECTIONS.map((collection) => [collection, rowsOf(collection, ownerA).length]),
    );

  await call('a', 'account.session');
  await call('b', 'account.session');
  const defaults = await call('a', 'account.preferences', { operation: 'get' });
  const set = await call('a', 'account.preferences', {
    operation: 'set',
    cardTextPreview: true,
  });
  const reread = await call('a', 'account.preferences', { operation: 'get' });
  const bDefaults = await call('b', 'account.preferences', { operation: 'get' });
  const select = await call(
    'a',
    'tasks.transition',
    { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
    'req_w6_jf_account_select',
  );
  const close = await call('a', 'account.close', { confirm: 'CLOSE' }, 'req_w6_jf_account_close');
  const closeData = close.ok ? close.data : null;
  const repeatPending = await call(
    'a',
    'account.close',
    { confirm: 'CLOSE' },
    'req_w6_jf_account_close_repeat',
  );
  const privateDenied = [];
  for (const [action, payload] of [
    ['account.session', {}],
    ['account.preferences', { operation: 'get' }],
    ['journal.get', { date: '2026-11-18' }],
    ['tasks.mine', {}],
    ['tasks.history', { from: '2026-11-18', to: '2026-11-18' }],
    ['account.requestExport', { format: 'json' }],
    ['account.exportStatus', { jobId: 'synthetic_export' }],
    ['account.downloadExport', { jobId: 'synthetic_export' }],
    ['tasks.transition', { taskId: 'synthetic_one', transition: 'complete' }],
  ]) {
    const response = await call('a', action, payload);
    privateDenied.push({
      action,
      ok: response.ok,
      code: response.error ? response.error.code : null,
    });
  }
  const publicSuggestions = await call('a', 'tasks.suggestions');
  const receiptGuards = {};
  if (closeData) {
    const wrongJob = await call('a', 'account.cleanupStatus', {
      jobId: 'synthetic_other_job',
      receipt: closeData.receipt,
    });
    receiptGuards.wrongJobId = wrongJob.error ? wrongJob.error.code : null;
    const forged = await call('a', 'account.cleanupStatus', {
      jobId: closeData.cleanup.jobId,
      receipt: 'forged_receipt',
    });
    receiptGuards.forgedReceipt = forged.error ? forged.error.code : null;
    const bNoToken = await call('b', 'account.cleanupStatus', {
      jobId: closeData.cleanup.jobId,
    });
    receiptGuards.secondAccountWithoutToken = bNoToken.error ? bNoToken.error.code : null;
  }
  const cleanupSteps = [];
  let completed = null;
  if (closeData) {
    for (let count = 0; count < COLLECTIONS.length + 5; count++) {
      const response = await call('a', 'account.cleanupStatus', {
        jobId: closeData.cleanup.jobId,
        receipt: closeData.receipt,
      });
      cleanupSteps.push({
        ok: response.ok,
        state: response.ok ? response.data.state : null,
        progress: response.ok ? response.data.progress : null,
        code: response.error ? response.error.code : null,
      });
      if (response.ok && response.data.state === 'completed') {
        completed = response.data;
        break;
      }
    }
  }
  const repeatCompleted = await call(
    'a',
    'account.close',
    { confirm: 'CLOSE' },
    'req_w6_jf_account_close_after',
  );
  const bPrivate = await call('b', 'account.preferences', { operation: 'get' });
  const bMine = await call('b', 'tasks.mine', {});
  const cleanupJobs = rowsOf('cleanup_jobs', ownerA);
  return {
    layer: 'LOCAL_PRODUCTION_ENTRY_LOCAL_FIXTURE',
    clock: '2026-11-18T04:00:00.000Z',
    realCloud: false,
    preferences: {
      aDefaults: responseOf(defaults),
      aSet: responseOf(set),
      aReread: responseOf(reread),
      bDefaults: responseOf(bDefaults),
    },
    taskSelect: responseOf(select),
    close: {
      response: responseOf(close),
      repeatPending: {
        ok: repeatPending.ok,
        sameJob: Boolean(
          repeatPending.ok &&
          closeData &&
          repeatPending.data.cleanup.jobId === closeData.cleanup.jobId,
        ),
        state: repeatPending.ok ? repeatPending.data.cleanup.state : null,
        code: repeatPending.error ? repeatPending.error.code : null,
      },
      repeatAfterCleanup: {
        ok: repeatCompleted.ok,
        sameJob: Boolean(
          repeatCompleted.ok &&
          closeData &&
          repeatCompleted.data.cleanup.jobId === closeData.cleanup.jobId,
        ),
        state: repeatCompleted.ok ? repeatCompleted.data.cleanup.state : null,
        code: repeatCompleted.error ? repeatCompleted.error.code : null,
      },
      jobCount: cleanupJobs.length,
      exportAccessRevoked: cleanupJobs.length ? cleanupJobs[0].exportAccessRevoked : null,
    },
    privateDenied,
    publicSuggestions: responseOf(publicSuggestions),
    receiptGuards,
    cleanup: {
      steps: cleanupSteps,
      completedState: completed ? completed.state : null,
      progress: completed ? completed.progress : null,
      residualBefore: countsForA(),
      residualAfter: completed ? countsForA() : null,
      bRowsAfter: Object.fromEntries(
        COLLECTIONS.map((collection) => [collection, rowsOf(collection, ownerB).length]),
      ),
      publicTemplateRows: rowsOf('task_templates', undefined).length,
      accountStatusA: (fixture.inspect()['accounts:' + ownerA] || {}).status || null,
      accountStatusB: (fixture.inspect()['accounts:' + ownerB] || {}).status || null,
    },
    secondAccount: {
      privateRead: responseOf(bPrivate),
      mine: responseOf(bMine),
    },
  };
}

function toCsv(rows) {
  const headers = [
    'scenario',
    'mode',
    'tasksWritesEnabled',
    'seedRows',
    'request',
    'ok',
    'errorCode',
    'readOnly',
    'itemCount',
    'itemIds',
    'builtInFallback',
    'taskHistoryRows',
    'receiptRows',
    'notes',
  ];
  const escape = (value) => {
    const text = value === undefined || value === null ? '' : String(value);
    return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  return (
    [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
    ].join('\n') + '\n'
  );
}

async function main() {
  const outputDir = process.argv[2] || path.resolve(__dirname, '../../docs/week6/jiawei-fang');
  fs.mkdirSync(outputDir, { recursive: true });
  const samples = {
    task: 'W6-JF',
    owner: 'Jiawei Fang',
    layer: 'LOCAL_PRODUCTION_ENTRY_OFFLINE_SDK',
    realCloud: false,
    clock: {
      firstBusinessDay: '2026-11-18',
      secondBusinessDay: '2026-11-19',
      timezone: 'Asia/Shanghai',
      instant: '2026-11-18T04:00:00.000Z',
    },
    templates: 'Synthetic rows; DEFAULT_TASKS only when a successful read is empty',
    redactedFields: ['scope', 'sessionScope', 'openid', 'ownerId', 'accountId', 'receipt', 'jobId'],
    modes: {
      closed: await modeClosed(),
      readOnly: await modeReadOnly(),
      enabled: await modeEnabled(),
    },
    templateReads: {
      empty: await templateScenario([]),
      oneOfficial: await templateScenario([template('synthetic_one')]),
      twoOfficial: await templateScenario([template('synthetic_one'), template('synthetic_two')]),
      fiveOfficial: await templateScenario(
        ['b', 'e', 'a', 'd', 'c'].map((suffix) => template('synthetic_' + suffix)),
      ),
      disabledOnly: await templateScenario([template('synthetic_off', { enabled: false })]),
      malformed: await templateScenario([template('synthetic_broken', { title: '' })]),
      readFailure: await readFailureScenario(),
    },
    transitions: await transitions(),
    terminalReplay: await terminalReplay(),
    emptyCatalogueWrite: await emptyCatalogueWrite(),
    isolation: await isolation(),
  };
  fs.writeFileSync(
    path.join(outputDir, 'task-mode-samples.json'),
    JSON.stringify(samples, null, 2) + '\n',
  );
  const account = await accountBoundaries();
  fs.writeFileSync(
    path.join(outputDir, 'account-boundaries.json'),
    JSON.stringify(account, null, 2) + '\n',
  );

  const csv = [];
  const add = (scenario, mode, enabled, seedRows, request, response, counts, notes) => {
    const data = response && response.ok ? response.data : null;
    csv.push({
      scenario,
      mode,
      tasksWritesEnabled: enabled,
      seedRows,
      request,
      ok: response ? response.ok : '',
      errorCode: response && response.error ? response.error.code : '',
      readOnly: data && typeof data.readOnly === 'boolean' ? data.readOnly : '',
      itemCount: data && Array.isArray(data.items) ? data.items.length : '',
      itemIds:
        data && Array.isArray(data.items) ? data.items.map((item) => item.taskId).join('|') : '',
      builtInFallback:
        data && Array.isArray(data.items) ? fallbackOf(data.items.map((item) => item.taskId)) : '',
      taskHistoryRows: counts ? counts.task_history : '',
      receiptRows: counts ? counts.request_receipts : '',
      notes,
    });
  };
  add(
    'client-closed',
    'closed',
    '',
    0,
    'no request',
    null,
    null,
    'client capability unavailable; page returns before controller',
  );
  const seedRows = {
    empty: 0,
    oneOfficial: 1,
    twoOfficial: 2,
    fiveOfficial: 5,
    disabledOnly: 1,
    malformed: 2,
    readFailure: 1,
  };
  for (const [name, scenario] of Object.entries(samples.templateReads)) {
    add(
      'template-' + name,
      'enabled',
      true,
      seedRows[name],
      'tasks.suggestions',
      scenario.response,
      scenario.writeCounts,
      scenario.layer ||
        (scenario.builtInFallback
          ? 'built-in fallback'
          : scenario.response.ok
            ? 'official rows'
            : 'invalid official row fails the whole read'),
    );
  }
  add(
    'mode-readOnly-suggestions',
    'readOnly',
    false,
    0,
    'tasks.suggestions',
    samples.modes.readOnly.suggestions,
    samples.modes.readOnly.writeCounts,
    'public suggestions readable; readOnly true',
  );
  add(
    'mode-readOnly-write',
    'readOnly',
    false,
    0,
    'tasks.transition',
    samples.modes.readOnly.rejectedWrite,
    samples.modes.readOnly.writeCounts,
    'write refused before storage',
  );
  add(
    'mode-enabled-suggestions',
    'enabled',
    true,
    2,
    'tasks.suggestions',
    samples.modes.enabled.suggestions,
    samples.modes.enabled.countsAfter.suggestions,
    'official rows win; readOnly false',
  );
  add(
    'mode-enabled-select',
    'enabled',
    true,
    2,
    'tasks.transition/select',
    samples.modes.enabled.select,
    samples.modes.enabled.countsAfter.select,
    'selected',
  );
  add(
    'mode-enabled-complete',
    'enabled',
    true,
    2,
    'tasks.transition/complete',
    samples.modes.enabled.complete,
    samples.modes.enabled.countsAfter.complete,
    'completed',
  );
  add(
    'mode-enabled-replay',
    'enabled',
    true,
    2,
    'tasks.transition/select',
    samples.modes.enabled.replay,
    samples.modes.enabled.countsAfter.replay,
    'replayed true; same requestId, no new receipt',
  );
  add(
    'empty-catalogue-select',
    'enabled',
    true,
    0,
    'tasks.transition/select built-in',
    samples.emptyCatalogueWrite.select,
    samples.emptyCatalogueWrite.writeCounts,
    'empty enabled read falls back to built-ins, which are writable',
  );
  add(
    'terminal-replay-new-request-id',
    'enabled',
    true,
    1,
    'tasks.transition/complete',
    samples.terminalReplay.replay,
    samples.terminalReplay.after,
    'new requestId same terminal: history unchanged, receipt +1',
  );
  fs.writeFileSync(path.join(outputDir, 'mode-template-results.csv'), toCsv(csv));
  console.log(
    JSON.stringify({
      outputDir,
      samples: path.join(outputDir, 'task-mode-samples.json'),
      csv: path.join(outputDir, 'mode-template-results.csv'),
      templateRows: Object.keys(samples.templateReads).length,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
