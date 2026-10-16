const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createJournalController, readEntry } = require('../miniprogram/modules/journal/controller');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');
const { AppError } = require('../miniprogram/shared/result');
const now = () => new Date('2026-10-15T04:00:00.000Z');
const date = '2026-10-15';
const entry = (extra = {}) => ({
  id: 'synthetic_entry_001',
  date,
  weather: 'SUNNY',
  tags: [],
  text: '',
  version: 1,
  createdAt: '2026-10-15T04:00:00.000Z',
  updatedAt: '2026-10-15T04:00:00.000Z',
  ...extra,
});
const envelope = (value) => ({ ok: true, data: { entry: value } });
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(options = {}) {
  const clock = options.now || now;
  const memory = createMemoryJournalService({ now: clock, seedEntries: options.seedEntries || [] });
  const submitted = [];
  const changes = [];
  const snapshots = [];
  const service = {
    ...memory,
    submit(request) {
      submitted.push(request);
      return options.submit ? options.submit(request, memory) : memory.submit(request);
    },
    get: options.get || memory.get,
  };
  const controller = createJournalController({
    service,
    now: clock,
    isDemo: true,
    onChange: (state) => snapshots.push(state),
    onChanged: (change) => changes.push(change),
  });
  return { controller, memory, service, submitted, changes, snapshots };
}
test('new form requires a weather choice and a completed read before any write', async () => {
  const f = fixture();
  f.controller.chooseWeather('SUNNY');
  assert.equal(await f.controller.save(), false);
  assert.equal(f.submitted.length, 0);
  f.controller.reset();
  await f.controller.loadDate();
  assert.equal(f.controller.getState().canSave, false);
  assert.equal(await f.controller.save(), false);
  assert.equal(f.submitted.length, 0);
});
test('weather is single-choice and snapshots cannot mutate the controller', async () => {
  const f = fixture();
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  f.controller.chooseWeather('RAINY');
  const state = f.controller.getState();
  assert.equal(state.weather, 'RAINY');
  assert.equal(state.weatherOptions.filter((item) => item.selected).length, 1);
  state.tags.push('REST');
  assert.deepEqual(f.controller.getState().tags, []);
  assert.equal(f.controller.chooseWeather('UNKNOWN'), false);
});
test('at most five known distinct tags can be selected and unselecting frees a slot', async () => {
  const f = fixture();
  await f.controller.loadDate();
  for (const id of ['STUDY', 'REST', 'EXERCISE', 'SOCIAL', 'ALONE_TIME']) {
    assert.equal(f.controller.toggleTag(id), true);
  }
  assert.equal(f.controller.toggleTag('CALM'), false);
  assert.equal(f.controller.getState().tagCount, 5);
  f.controller.toggleTag('REST');
  assert.equal(f.controller.toggleTag('CALM'), true);
  assert.equal(f.controller.toggleTag('UNKNOWN'), false);
});
test('1000 emoji code points can be submitted but 1001 cannot dispatch a write', async () => {
  const f = fixture();
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  f.controller.setText('😀'.repeat(1000));
  assert.equal(f.controller.getState().textCount, 1000);
  assert.equal(f.controller.getState().canSave, true);
  assert.equal(await f.controller.save(), true);
  f.controller.setText('😀'.repeat(1001));
  assert.equal(f.controller.getState().canSave, false);
  assert.equal(await f.controller.save(), false);
  assert.equal(f.submitted.length, 1);
  assert.equal(f.controller.getState().text.length, 2002);
});
test('weather alone saves with empty optional fields and notifies only after confirmed success', async () => {
  const f = fixture();
  await f.controller.loadDate();
  f.controller.chooseWeather('CLOUDY');
  assert.equal(await f.controller.save(), true);
  const state = f.controller.getState();
  assert.equal(state.entry.version, 1);
  assert.equal(state.entry.text, '');
  assert.deepEqual(state.entry.tags, []);
  assert.equal(f.changes.length, 1);
  assert.match(state.notice, /本地演示/);
});
test('creation includes day 29 but excludes day 30 and future dates', async () => {
  for (const [selected, allowed] of [
    ['2026-09-16', true],
    ['2026-09-15', false],
    ['2026-10-16', false],
  ]) {
    const f = fixture();
    await f.controller.loadDate(selected);
    f.controller.chooseWeather('SUNNY');
    assert.equal(f.controller.getState().canSave, allowed);
    assert.equal(await f.controller.save(), allowed);
    assert.equal(f.submitted.length, allowed ? 1 : 0);
  }
});
test('an existing old entry can be edited with its current version and stable id', async () => {
  const old = entry({ date: '2025-01-01', version: 3, createdAt: '2025-01-01T04:00:00.000Z' });
  const f = fixture({ seedEntries: [old] });
  await f.controller.loadDate(old.date);
  f.controller.setText('合成旧记录编辑');
  assert.equal(f.controller.getState().canSave, true);
  assert.equal(await f.controller.save(), true);
  assert.equal(f.submitted[0].payload.expectedVersion, 3);
  assert.equal(f.controller.getState().entry.version, 4);
  assert.equal(f.controller.getState().entry.id, old.id);
});
test('an uncertain save locks edits and retries the exact immutable request without increasing version again', async () => {
  const f = fixture();
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  f.controller.setText('合成失败重试');
  f.memory.failNext('after-save');
  assert.equal(await f.controller.save(), false);
  const original = f.submitted[0];
  assert.equal(Object.isFrozen(original), true);
  assert.equal(Object.isFrozen(original.payload), true);
  assert.equal(f.controller.getState().pendingRetry, true);
  assert.equal(f.controller.setText('不得替换原请求'), false);
  assert.equal(f.controller.chooseWeather('RAINY'), false);
  assert.equal(f.changes.length, 0);
  assert.equal(await f.controller.retry(), true);
  assert.equal(f.submitted[1], original);
  assert.equal(f.controller.getState().entry.version, 1);
  assert.equal(f.changes.length, 1);
});
test('rapid duplicate save clicks dispatch a single write and inputs stay locked while pending', async () => {
  const wait = deferred();
  const f = fixture({
    submit: (request, memory) => wait.promise.then(() => memory.submit(request)),
  });
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  const first = f.controller.save();
  assert.equal(f.controller.getState().phase, 'saving');
  assert.equal(await f.controller.save(), false);
  assert.equal(f.controller.toggleTag('REST'), false);
  assert.equal(f.submitted.length, 1);
  wait.resolve();
  assert.equal(await first, true);
  assert.equal(f.submitted.length, 1);
});
test('a conflict preserves draft and requires explicit discard confirmation before a reread', async () => {
  const f = fixture({ seedEntries: [entry({ text: '合成初始值' })] });
  await f.controller.loadDate();
  f.controller.setText('合成本机草稿');
  await f.memory.submit(
    f.memory.createSaveRequest({
      date,
      weather: 'RAINY',
      tags: [],
      text: '合成另一设备版本',
      expectedVersion: 1,
    }),
  );
  assert.equal(await f.controller.save(), false);
  assert.equal(f.controller.getState().text, '合成本机草稿');
  assert.equal(f.controller.getState().requiresReload, true);
  assert.equal(f.controller.getState().canDelete, false);
  await f.controller.loadDate();
  assert.equal(f.controller.getState().confirm, 'reload');
  f.controller.cancelConfirm();
  assert.equal(f.controller.getState().text, '合成本机草稿');
  await f.controller.loadDate();
  await f.controller.confirmReload();
  assert.equal(f.controller.getState().text, '合成另一设备版本');
  assert.equal(f.controller.getState().entry.version, 2);
});
test('delete requires confirmation, cancellation does not write, and success reloads current state', async () => {
  const f = fixture({ seedEntries: [entry()] });
  await f.controller.loadDate();
  assert.equal(f.controller.requestDelete(), true);
  assert.equal(f.submitted.length, 0);
  f.controller.cancelConfirm();
  assert.equal(f.submitted.length, 0);
  f.controller.requestDelete();
  assert.equal(await f.controller.confirmDelete(), true);
  assert.equal(f.submitted[0].action, 'journal.delete');
  assert.equal(f.submitted[0].payload.expectedVersion, 1);
  assert.equal(f.controller.getState().entry, null);
  assert.equal(f.controller.getState().loaded, true);
  assert.equal(f.changes[0].kind, 'deleted');
});
test('replaying an uncertain delete never deletes a recreated entry and rereads that new entry', async () => {
  const f = fixture({ seedEntries: [entry()] });
  await f.controller.loadDate();
  f.memory.failNext('after-save');
  f.controller.requestDelete();
  assert.equal(await f.controller.confirmDelete(), false);
  const original = f.submitted[0];
  const created = await f.memory.submit(
    f.memory.createSaveRequest({
      date,
      weather: 'RAINY',
      tags: [],
      text: '合成重建记录',
      expectedVersion: 0,
    }),
  );
  assert.equal(await f.controller.retry(), true);
  assert.equal(f.submitted[1], original);
  assert.equal(f.controller.getState().entry.id, created.data.entry.id);
  assert.equal(f.controller.getState().entry.version, 3);
});
test('a malformed save result remains uncertain instead of showing a false success', async () => {
  const f = fixture({ submit: async () => envelope(null) });
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  f.controller.setText('合成输入');
  assert.equal(await f.controller.save(), false);
  assert.equal(f.controller.getState().errorCode, 'INVALID_RESPONSE');
  assert.equal(f.controller.getState().pendingRetry, true);
  assert.equal(f.controller.getState().text, '合成输入');
  assert.equal(f.changes.length, 0);
});
test('an edit response cannot silently change identity, creation time or version progression', async () => {
  for (const change of [
    { version: 1 },
    { version: 3 },
    { id: 'different_synthetic_entry' },
    { createdAt: '2026-10-14T04:00:00.000Z' },
  ]) {
    const f = fixture({
      seedEntries: [entry()],
      submit: async (request) => envelope(entry({ ...request.payload, version: 2, ...change })),
    });
    await f.controller.loadDate();
    f.controller.setText('synthetic edit');
    assert.equal(await f.controller.save(), false);
    const state = f.controller.getState();
    assert.equal(state.errorCode, 'INVALID_RESPONSE');
    assert.equal(state.pendingRetry, true);
    assert.equal(state.text, 'synthetic edit');
    assert.equal(state.entry.id, entry().id);
    assert.equal(state.entry.version, 1);
    assert.equal(f.changes.length, 0);
  }
});

test('NOT_IMPLEMENTED preserves input but never claims a successful write', async () => {
  const f = fixture({
    submit: async () => {
      throw new AppError('NOT_IMPLEMENTED', 'synthetic-private-server-message');
    },
  });
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  f.controller.setText('合成内容');
  assert.equal(await f.controller.save(), false);
  assert.equal(f.controller.getState().pendingRetry, false);
  assert.equal(f.controller.getState().text, '合成内容');
  assert.equal(f.controller.getState().entry, null);
  assert(!f.controller.getState().notice.includes('synthetic-private'));
  assert.equal(f.changes.length, 0);
});
test('account disablement clears sensitive state and never carries a draft into another account', async () => {
  const f = fixture({
    submit: async () => {
      throw new AppError('ACCOUNT_DISABLED', 'synthetic-private-message');
    },
  });
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  f.controller.setText('合成私密草稿');
  await f.controller.save();
  const state = f.controller.getState();
  assert.equal(state.text, '');
  assert.equal(state.weather, '');
  assert.equal(state.entry, null);
  assert.equal(state.loaded, false);
  assert.equal(state.pendingRetry, false);
});
test('reset prevents a late successful write response from repopulating cleared state', async () => {
  const wait = deferred();
  const f = fixture({
    submit: (request, memory) => wait.promise.then(() => memory.submit(request)),
  });
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  f.controller.setText('合成旧会话');
  const action = f.controller.save();
  f.controller.reset();
  wait.resolve();
  assert.equal(await action, false);
  assert.equal(f.controller.getState().text, '');
  assert.equal(f.controller.getState().entry, null);
  assert.equal(f.changes.length, 0);
});
test('a late read from an older generation cannot overwrite a newer selected date', async () => {
  const a = deferred();
  const b = deferred();
  const f = fixture({ get: (selected) => (selected === date ? a.promise : b.promise) });
  const first = f.controller.loadDate(date);
  f.controller.reset();
  const second = f.controller.loadDate('2026-10-14');
  b.resolve(envelope(null));
  assert.equal(await second, true);
  a.resolve(envelope(entry()));
  assert.equal(await first, false);
  assert.equal(f.controller.getState().date, '2026-10-14');
  assert.equal(f.controller.getState().entry, null);
});
test('dispose drops pending input and prevents later page updates', async () => {
  const wait = deferred();
  const f = fixture({ get: () => wait.promise });
  const load = f.controller.loadDate();
  f.controller.dispose();
  const count = f.snapshots.length;
  wait.resolve(envelope(entry()));
  await load;
  assert.equal(f.snapshots.length, count);
  assert.equal(f.controller.getState().text, '');
});
test('response projection rejects missing required fields and never returns internal identity fields', () => {
  const safe = readEntry(
    envelope({ ...entry(), ownerId: 'synthetic-internal', OPENID: 'synthetic-private' }),
    date,
  );
  assert.equal(safe.ownerId, undefined);
  assert.equal(safe.OPENID, undefined);
  for (const changed of [
    { tags: undefined },
    { text: undefined },
    { version: Number.MAX_SAFE_INTEGER + 1 },
    { date: '2026-10-14' },
    { createdAt: 'bad' },
  ]) {
    assert.throws(() => readEntry(envelope(entry(changed)), date), { code: 'INVALID_RESPONSE' });
  }
});
test('a malformed read cannot enable saving over an unknown server record', async () => {
  const f = fixture({ get: async () => envelope({ date }) });
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  assert.equal(f.controller.getState().loaded, false);
  assert.equal(await f.controller.save(), false);
  assert.equal(f.submitted.length, 0);
});
test('a confirmed deletion with a failed follow-up read is not resubmitted as an unknown write', async () => {
  let reads = 0;
  const memory = createMemoryJournalService({ now, seedEntries: [entry()] });
  const f = fixture({
    get: async (selected) => {
      reads++;
      if (reads > 1) {
        throw new AppError('NETWORK_ERROR', 'synthetic');
      }
      return memory.get(selected);
    },
    submit: (request) => memory.submit(request),
  });
  await f.controller.loadDate();
  f.controller.requestDelete();
  assert.equal(await f.controller.confirmDelete(), true);
  const state = f.controller.getState();
  assert.equal(state.loaded, false);
  assert.equal(state.pendingRetry, false);
  assert.equal(state.entry, null);
  assert.equal(await f.controller.retry(), false);
  assert.equal(f.submitted.length, 1);
});
test('the page selects the demo adapter only with an explicit flag and disabled cloud', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/today/index.js'),
    'utf8',
  );
  for (const [config, expected] of [
    [{ journalDemo: true, cloudEnabled: false }, true],
    [{ journalDemo: true, cloudEnabled: true }, false],
    [{ cloudEnabled: false }, false],
  ]) {
    let definition;
    let demos = 0;
    let chosen;
    let disposed = 0;
    let refreshed = 0;
    const real = { kind: 'real' };
    const demo = { kind: 'demo', clear() {} };
    vm.runInNewContext(source, {
      Page: (value) => {
        definition = value;
      },
      require(name) {
        if (name === '../../config/environment.local') {
          return config;
        }
        if (name === '../../modules/journal/service') {
          return real;
        }
        if (name === '../../shared/constants') {
          return require('../miniprogram/shared/constants');
        }
        if (name === '../../modules/journal/demo-session') {
          return {
            getSharedDemoService() {
              demos++;
              return demo;
            },
            clearSharedDemoService() {},
          };
        }
        if (name === '../../modules/journal/controller') {
          return {
            createJournalController(options) {
              chosen = options.service;
              return {
                loadDate() {},
                refreshToday() {
                  refreshed++;
                },
                dispose() {
                  disposed++;
                },
              };
            },
          };
        }
        throw new Error('Unexpected page dependency.');
      },
    });
    const page = { ...definition, setData() {} };
    page.onShow();
    page.onLoad();
    page.onShow();
    assert.equal(refreshed, 1);
    assert.equal(demos, expected ? 1 : 0);
    assert.equal(chosen, expected ? demo : real);
    page.onUnload();
    assert.equal(disposed, 1);
  }
});

test('date navigation handles leap days, month boundaries and the current-day upper bound', async () => {
  const reads = [];
  const f = fixture({
    get: async (selected) => {
      reads.push(selected);
      return envelope(null);
    },
  });
  await f.controller.loadDate('2024-03-01');
  assert.equal(await f.controller.moveDate(-1), true);
  assert.equal(f.controller.getState().date, '2024-02-29');
  assert.equal(await f.controller.moveDate(1), true);
  assert.equal(f.controller.getState().date, '2024-03-01');
  assert.equal(await f.controller.moveDate('today'), true);
  assert.equal(f.controller.getState().date, date);
  assert.equal(f.controller.getState().canNextDate, false);
  assert.equal(f.controller.getState().canReturnToday, false);
  const count = reads.length;
  assert.equal(await f.controller.moveDate(1), false);
  assert.equal(await f.controller.moveDate('today'), false);
  assert.equal(await f.controller.moveDate('unknown'), false);
  assert.equal(reads.length, count);
});

test('changing dates preserves the current draft until the specific destination is confirmed', async () => {
  const reads = [];
  const f = fixture({
    get: async (selected) => {
      reads.push(selected);
      return envelope(null);
    },
  });
  await f.controller.loadDate();
  f.controller.chooseWeather('RAINY');
  f.controller.setText('synthetic unsaved draft');
  assert.equal(await f.controller.moveDate(-1), false);
  const confirmation = f.controller.getState();
  assert.equal(confirmation.date, date);
  assert.equal(confirmation.confirmationDate, '2026-10-14');
  assert.equal(confirmation.confirmationAction, '放弃输入并查看 2026-10-14');
  assert.equal(confirmation.inputLocked, true);
  assert.equal(await f.controller.moveDate(-1), false);
  assert.equal(reads.length, 1);
  f.controller.cancelConfirm();
  assert.equal(f.controller.getState().confirmationDate, '');
  assert.equal(f.controller.getState().text, 'synthetic unsaved draft');
  await f.controller.moveDate(-1);
  assert.equal(await f.controller.confirmReload(), true);
  assert.equal(f.controller.getState().date, '2026-10-14');
  assert.equal(f.controller.getState().text, '');
  assert.equal(f.controller.getState().confirmationDate, '');
  assert.deepEqual(reads, [date, '2026-10-14']);
});

test('cancelling a date switch after an uncertain write retains the original retry request', async () => {
  const f = fixture();
  await f.controller.loadDate();
  f.controller.chooseWeather('SUNNY');
  f.controller.setText('synthetic uncertain draft');
  f.memory.failNext('after-save');
  assert.equal(await f.controller.save(), false);
  assert.equal(await f.controller.moveDate(-1), false);
  const state = f.controller.getState();
  assert.equal(state.pendingRetry, true);
  assert.equal(state.confirmationDate, '2026-10-14');
  assert.equal(state.date, date);
  f.controller.cancelConfirm();
  assert.equal(f.controller.getState().canRetry, true);
  assert.equal(await f.controller.retry(), true);
  assert.equal(f.submitted[0], f.submitted[1]);
  assert.equal(f.controller.getState().entry.version, 1);
});

test('returning to today restores the saved record rather than carrying another date draft', async () => {
  const f = fixture({ seedEntries: [entry({ text: 'synthetic saved today' })] });
  await f.controller.loadDate();
  await f.controller.moveDate(-1);
  f.controller.chooseWeather('RAINY');
  f.controller.setText('synthetic yesterday draft');
  await f.controller.moveDate('today');
  assert.equal(f.controller.getState().date, '2026-10-14');
  assert.equal(f.controller.getState().confirmationDate, date);
  await f.controller.confirmReload();
  assert.equal(f.controller.getState().date, date);
  assert.equal(f.controller.getState().text, 'synthetic saved today');
  assert.equal(f.controller.getState().entry.version, 1);
  assert.equal(f.submitted.length, 0);
});

test('refreshing the client day across Shanghai midnight preserves drafts and makes no requests', async () => {
  let time = new Date('2026-10-15T15:59:59.000Z');
  let reads = 0;
  const f = fixture({
    now: () => time,
    get: async () => {
      reads++;
      return envelope(null);
    },
  });
  await f.controller.loadDate('2026-09-16');
  f.controller.chooseWeather('SUNNY');
  f.controller.setText('synthetic day-29 draft');
  assert.equal(f.controller.getState().canSave, true);
  time = new Date('2026-10-15T16:00:00.000Z');
  assert.equal(f.controller.refreshToday(), true);
  const state = f.controller.getState();
  assert.equal(state.today, '2026-10-16');
  assert.equal(state.date, '2026-09-16');
  assert.equal(state.text, 'synthetic day-29 draft');
  assert.equal(state.canSave, false);
  assert.equal(state.isOlderNewDate, true);
  assert.equal(reads, 1);
  assert.equal(f.submitted.length, 0);
});

test('day refresh during a pending read does not cancel it or unlock navigation early', async () => {
  let time = new Date('2026-10-15T15:59:59.000Z');
  const wait = deferred();
  const f = fixture({ now: () => time, get: () => wait.promise });
  const reading = f.controller.loadDate();
  assert.equal(f.controller.getState().recordStatus, '正在读取');
  assert.equal(f.controller.getState().canPreviousDate, false);
  time = new Date('2026-10-15T16:00:00.000Z');
  f.controller.refreshToday();
  assert.equal(await f.controller.moveDate(-1), false);
  wait.resolve(envelope(entry()));
  assert.equal(await reading, true);
  const state = f.controller.getState();
  assert.equal(state.today, '2026-10-16');
  assert.equal(state.date, date);
  assert.equal(state.recordStatus, '已有记录');
  assert.equal(state.canNextDate, true);
});

test('an uncertain save crossing midnight retains the original date and request', async () => {
  let time = new Date('2026-10-15T15:59:59.000Z');
  const f = fixture({ now: () => time });
  await f.controller.loadDate('2026-09-16');
  f.controller.chooseWeather('SUNNY');
  f.memory.failNext('after-save');
  assert.equal(await f.controller.save(), false);
  time = new Date('2026-10-15T16:00:00.000Z');
  f.controller.refreshToday();
  assert.equal(f.controller.getState().pendingRetry, true);
  assert.equal(f.controller.getState().text, '');
  assert.equal(await f.controller.retry(), true);
  assert.equal(f.submitted[0], f.submitted[1]);
  assert.equal(f.submitted[1].payload.date, '2026-09-16');
  assert.equal(f.controller.getState().entry.version, 1);
});

test('an unsuccessful read remains unknown and does not display a confirmed empty record', async () => {
  const f = fixture({
    get: async () => {
      throw new AppError('NOT_IMPLEMENTED', 'synthetic');
    },
  });
  assert.equal(f.controller.getState().recordStatus, '未读取');
  await f.controller.loadDate('2026-08-01');
  const state = f.controller.getState();
  assert.equal(state.recordStatus, '未读取');
  assert.equal(state.loaded, false);
  assert.equal(state.isOlderNewDate, false);
  assert.equal(state.canSave, false);
});

test('disposed date navigation and day refresh cannot repopulate or dispatch requests', async () => {
  let reads = 0;
  const f = fixture({
    get: async () => {
      reads++;
      return envelope(null);
    },
  });
  await f.controller.loadDate();
  f.controller.dispose();
  const count = f.snapshots.length;
  assert.equal(f.controller.refreshToday(), false);
  assert.equal(await f.controller.moveDate(-1), false);
  assert.equal(reads, 1);
  assert.equal(f.snapshots.length, count);
});
