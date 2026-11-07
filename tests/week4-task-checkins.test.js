// W4 JF03 — task + place check-in composite candidate.
// Owner: Jiawei Fang. Local synthetic doubles only: no cloud function, database
// or network call is made in this file. The task domain runs on the repository's
// in-memory task store; the check-in half is the real services/checkins.js
// candidate. Neither real cloud storage nor a second real account is exercised.
const test = require('node:test');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { createPersistentService } = require('../cloudfunctions/moodsky/services/checkins');
const { createTasksDomain } = require('../cloudfunctions/moodsky/services/tasks-candidate');
const { createMemoryTasksStore } = require('../cloudfunctions/moodsky/stores/tasks-store');
const {
  createTransactionalTasksStore,
  historyId,
  receiptId,
  TASK_LAYOUT,
} = require('../cloudfunctions/moodsky/stores/transactional-tasks');
const { databaseFixture } = require('./helpers/w2-database');
const {
  createTaskCheckinService,
  COMPOSITE_ACTIONS,
  DELEGATED_ACTIONS,
} = require('../cloudfunctions/moodsky/services/task-checkins');
const {
  PENDING_QUOTA,
  PENDING_TTL_MS,
} = require('../cloudfunctions/moodsky/stores/task-checkin-links');
const { businessDate } = require('../cloudfunctions/moodsky/shared/date');

const DAY_ONE = Date.parse('2026-11-06T04:00:00.000Z'); // 2026-11-06 12:00 Asia/Shanghai
const DAY_TWO = Date.parse('2026-11-07T04:00:00.000Z');
const DAY_THREE = Date.parse('2026-11-08T04:00:00.000Z');
const OWNER = 'A';
const OTHER = 'B';
const QUIET = 'place_quiet_fixture';
const WALK = 'tpl_walk_fixture';
const WATER = 'tpl_water_fixture';
const TEMPLATES = [
  {
    _id: WALK,
    enabled: true,
    title: '合成任务：走十分钟',
    steps: ['仅测试'],
    durationMin: 10,
    tags: ['outdoor'],
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  {
    _id: WATER,
    enabled: true,
    title: '合成任务：喝一杯水',
    steps: ['仅测试'],
    durationMin: 2,
    tags: ['indoor'],
    createdAt: '2026-10-02T00:00:00.000Z',
  },
];

function place(patch = {}) {
  return {
    placeId: QUIET,
    name: '合成地点，仅隔离测试',
    enabled: true,
    isSynthetic: false,
    source: 'SYNTHETIC fixture, not real verified material',
    verifiedAt: '2026-10-01T00:00:00Z',
    validUntil: '2027-01-01T00:00:00Z',
    openState: 'OPEN',
    ...patch,
  };
}

// Serialized copy-on-write transactions over one document map. The real
// candidate is wired to a CloudBase transaction; this double only proves the
// service never holds state between calls.
function createDatabase() {
  const docs = new Map();
  let tail = Promise.resolve();
  const database = {
    docs,
    runTransaction(work) {
      const result = tail.then(async () => {
        const draft = new Map(
          [...docs].map(([key, row]) => [key, globalThis.structuredClone(row)]),
        );
        const tx = {
          collection(name) {
            return {
              doc(id) {
                const key = name + ':' + id;
                return {
                  async get() {
                    return {
                      data: draft.has(key) ? globalThis.structuredClone(draft.get(key)) : null,
                    };
                  },
                  async set({ data }) {
                    draft.set(key, { ...globalThis.structuredClone(data), _id: id });
                  },
                };
              },
            };
          },
        };
        const value = await work(tx);
        docs.clear();
        for (const [key, row] of draft) {
          docs.set(key, row);
        }
        return globalThis.structuredClone(value);
      });
      tail = result.catch(() => {});
      return result;
    },
  };
  return database;
}

function setup({ capacity } = {}) {
  const database = createDatabase();
  const accounts = { [OWNER]: 'active', [OTHER]: 'active' };
  for (const owner of [OWNER, OTHER]) {
    database.docs.set('accounts:' + owner, { _id: owner, status: 'active' });
  }
  const places = { [QUIET]: place() };
  let instant = DAY_ONE;
  // The composite precheck and services/checkins.js read the same place. Tests
  // can arm a one-shot failure on the second read to simulate a place that closes
  // between the precheck and the check-in half.
  let failSecondPlaceRead = false;
  let placeReads = 0;
  const findPlace = async (_tx, placeId) => {
    const row = places[placeId] || null;
    if (failSecondPlaceRead) {
      placeReads += 1;
      if (placeReads === 2) {
        failSecondPlaceRead = false;
        placeReads = 0;
        return null;
      }
    }
    return row;
  };
  const armCheckinFailure = () => {
    failSecondPlaceRead = true;
    placeReads = 0;
  };
  const resolveIdentity = async (binding) =>
    typeof binding === 'string' && Object.hasOwn(accounts, binding) ? binding : null;
  const resolveActive = async (tx, owner) =>
    (await tx.collection('accounts').doc(owner).get()).data?.status === 'active';
  const resolveDisabled = async (tx, owner) =>
    (await tx.collection('accounts').doc(owner).get()).data?.status === 'disabled';
  const tasksStore = createMemoryTasksStore({ templates: TEMPLATES });
  const tasksDomain = createTasksDomain({ store: tasksStore, clock: () => new Date(instant) });
  const makeCheckins = () =>
    createPersistentService({
      database,
      resolveIdentity,
      resolveActive,
      resolveDisabled,
      findPlace,
      now: () => instant,
    });
  const makeService = (checkins = makeCheckins()) =>
    createTaskCheckinService({
      database,
      tasksDomain,
      checkins,
      findPlace,
      resolveIdentity,
      resolveActive,
      resolveDisabled,
      now: () => instant,
      ...(capacity === undefined ? {} : { capacity }),
    });
  const clock = (value) => {
    instant = value;
  };
  async function setStatus(owner, status) {
    accounts[owner] = status;
    await database.runTransaction(async (tx) => {
      await tx.collection('accounts').doc(owner).set({ data: { status } });
    });
  }
  return {
    database,
    accounts,
    places,
    tasksStore,
    tasksDomain,
    service: makeService(),
    makeService,
    clock,
    setStatus,
    armCheckinFailure,
  };
}

// Same wiring as the transactional-store case, extracted so the zero-write,
// pending-recovery and account-gate tests can inspect task_history,
// campus_checkin_states and task_checkin_links with one fixture.
function setupLinked({ fail } = {}) {
  const fixture = databaseFixture(
    {
      ['accounts:' + OWNER]: {
        _id: OWNER,
        status: 'active',
        journalLayout: 'deterministic-days-v1',
        taskLayout: TASK_LAYOUT,
        journalRevision: 0,
        operationFence: 0,
        exportEpoch: 0,
      },
      ['task_templates:' + WALK]: {
        _id: WALK,
        enabled: true,
        title: '合成任务：走十分钟',
        steps: ['仅测试'],
        durationMin: 10,
        tags: [],
      },
    },
    typeof fail === 'function' ? { fail } : undefined,
  );
  const db = fixture.db;
  const places = { [QUIET]: place() };
  let instant = DAY_ONE;
  let failSecondPlaceRead = false;
  let placeReads = 0;
  const findPlace = async (_tx, placeId) => {
    const row = places[placeId] || null;
    if (failSecondPlaceRead) {
      placeReads += 1;
      if (placeReads === 2) {
        failSecondPlaceRead = false;
        placeReads = 0;
        return null;
      }
    }
    return row;
  };
  const resolveIdentity = async (binding) => (binding === OWNER ? OWNER : null);
  const resolveActive = async (tx, owner) =>
    (await tx.collection('accounts').doc(owner).get()).data?.status === 'active';
  const resolveDisabled = async (tx, owner) =>
    (await tx.collection('accounts').doc(owner).get()).data?.status === 'disabled';
  const tasksDomain = createTasksDomain({
    store: createTransactionalTasksStore({ db }),
    clock: () => new Date(instant),
  });
  const makeService = () =>
    createTaskCheckinService({
      database: db,
      tasksDomain,
      checkins: createPersistentService({
        database: db,
        resolveIdentity,
        resolveActive,
        resolveDisabled,
        findPlace,
        now: () => instant,
      }),
      findPlace,
      resolveIdentity,
      resolveActive,
      resolveDisabled,
      now: () => instant,
    });
  const docId = createHash('sha256').update(OWNER).digest('hex');
  const rows = () => fixture.inspect();
  const setStatus = (status) => {
    const account = rows()['accounts:' + OWNER];
    fixture.put('accounts', { ...account, status });
  };
  return {
    fixture,
    places,
    service: makeService(),
    clock: (value) => {
      instant = value;
    },
    armCheckinFailure: () => {
      failSecondPlaceRead = true;
      placeReads = 0;
    },
    setStatus,
    rows,
    taskRows: () => Object.entries(rows()).filter(([key]) => key.startsWith('task_history:')),
    checkinDoc: () => rows()['campus_checkin_states:' + docId],
    linkDoc: () => rows()['task_checkin_links:' + docId],
  };
}

const req = (id, taskId = WALK, placeId = QUIET) => ({
  requestId: 'req_task_checkin_' + id,
  payload: { taskId, placeId },
});
const complete = (service, id, binding = OWNER, taskId = WALK, placeId = QUIET) =>
  service.completeWithCheckin(req(id, taskId, placeId), binding);

test('T01 linked completion persists task, check-in and one link row', async () => {
  const { service, accounts } = setup();
  const result = await complete(service, '001');
  assert.equal(result.taskId, WALK);
  assert.equal(result.placeId, QUIET);
  assert.equal(result.linkedDate, '2026-11-06');
  assert.deepEqual(result.task, {
    taskId: WALK,
    date: '2026-11-06',
    state: 'completed',
    replayed: false,
  });
  assert.equal(result.checkin.placeId, QUIET);
  assert.equal(result.checkin.date, '2026-11-06');
  assert.equal(result.checkin.duplicated, false);
  assert.equal(result.checkin.placeName, '合成地点，仅隔离测试');
  assert.equal(result.created, true);
  assert.equal(result.replayed, false);
  assert.ok(Number.isFinite(Date.parse(result.linkedAt)));
  assert.equal(accounts[OWNER], 'active');

  const taskHistory = await service.taskHistory(
    { payload: { from: '2026-11-06', to: '2026-11-06' } },
    OWNER,
  );
  assert.equal(taskHistory.entries.length, 1);
  assert.equal(taskHistory.entries[0].state, 'completed');
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 1);
  const links = await service.linkHistory({ payload: {} }, OWNER);
  assert.equal(links.total, 1);
  assert.equal(links.items[0].requestId, req('001').requestId);
  assert.equal(links.items[0].linkedDate, '2026-11-06');
  assert.equal(links.items[0].duplicated, false);
  assert.equal((await service.linkHistory({ payload: {} }, OTHER)).total, 0);
});

test('T02 same task + same place + same day does not create a second record', async () => {
  const { service } = setup();
  const first = await complete(service, '001');
  const second = await complete(service, '002');
  assert.equal(second.replayed, true);
  assert.equal(second.created, false);
  assert.equal(second.linkedDate, first.linkedDate);
  assert.equal(second.task.replayed, false); // the first execution's value is kept
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal(
    (await service.taskHistory({ payload: { from: '2026-11-06', to: '2026-11-06' } }, OWNER))
      .entries.length,
    1,
  );
  // The equivalent requestId is a committed receipt, not an absent one: replay,
  // status lookup and the "same id, changed payload" conflict all keep working.
  const status = await service.linkStatus({ payload: { requestId: req('002').requestId } }, OWNER);
  assert.equal(status.status, 'committed');
  assert.equal(status.result.created, false);
  assert.equal(status.result.replayed, true);
  const replay = await complete(service, '002');
  assert.equal(replay.created, false);
  assert.equal(replay.replayed, true);
  await assert.rejects(complete(service, '002', OWNER, WATER), { code: 'CONFLICT' });
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
});

test('T03 a new business day records a new task row, visit and link', async () => {
  const { service, clock } = setup();
  await complete(service, '001');
  clock(DAY_TWO);
  const second = await complete(service, '002');
  assert.equal(second.created, true);
  assert.equal(second.linkedDate, '2026-11-07');
  assert.equal(second.task.date, '2026-11-07');
  assert.equal(second.checkin.date, '2026-11-07');
  const links = await service.linkHistory({ payload: {} }, OWNER);
  assert.equal(links.total, 2);
  assert.equal(links.items[0].linkedDate, '2026-11-07');
  assert.equal(links.items[1].linkedDate, '2026-11-06');
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 2);
});

test('T04 the same requestId replays the stored result without new writes', async () => {
  const { service } = setup();
  const first = await complete(service, '001');
  const replay = await complete(service, '001');
  assert.deepEqual(replay, { ...first, created: false, replayed: true });
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal(
    (await service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER)).status,
    'committed',
  );
});

test('T05 the same requestId with a different payload is a conflict', async () => {
  const { service, places } = setup();
  places.place_other_fixture = place({ placeId: 'place_other_fixture' });
  await complete(service, '001');
  await assert.rejects(complete(service, '001', OWNER, WALK, 'place_other_fixture'), {
    code: 'CONFLICT',
  });
  await assert.rejects(complete(service, '001', OWNER, WATER), { code: 'CONFLICT' });
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 1);
  const status = await service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER);
  assert.equal(status.status, 'committed');
  assert.equal(status.result.placeId, QUIET);
});

test('T06 a disabled account is rejected before every read and write', async () => {
  const { service, setStatus } = setup();
  await complete(service, '001');
  await setStatus(OWNER, 'disabled');
  const checks = [
    complete(service, '002'),
    service.linkHistory({ payload: {} }, OWNER),
    service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER),
    service.taskHistory({ payload: { from: '2026-11-06', to: '2026-11-06' } }, OWNER),
    service.transition(
      { requestId: 'req_task_checkin_003', payload: { taskId: WATER, transition: 'select' } },
      OWNER,
    ),
    service.checkin({ requestId: 'req_task_checkin_004', payload: { placeId: QUIET } }, OWNER),
    service.checkinHistory({ payload: {} }, OWNER),
  ];
  for (const pending of checks) {
    await assert.rejects(pending, { code: 'ACCOUNT_DISABLED' });
  }
  await setStatus(OWNER, 'active');
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 1);
  // The rejected transition must not have written a task_history row for WATER.
  const history = await service.taskHistory(
    { payload: { from: '2026-11-06', to: '2026-11-06' } },
    OWNER,
  );
  assert.equal(history.entries.filter((entry) => entry.taskId === WATER).length, 0);
});

test('T07 an unavailable place fails the precheck and writes nothing at all', async () => {
  const { service, places } = setup();
  places[QUIET].openState = 'CLOSED';
  await assert.rejects(complete(service, '001'), {
    code: 'NOT_FOUND',
    message: '地点不可打卡。',
  });
  // New order: the place is judged before the pending intent or either half, so
  // there is no task row, no visit and not even a pending intent to recover.
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 0);
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 0);
  const status = await service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER);
  assert.equal(status.status, 'absent');
  const tasks = await service.taskHistory(
    { payload: { from: '2026-11-06', to: '2026-11-06' } },
    OWNER,
  );
  assert.equal(tasks.entries.length, 0);

  places[QUIET].openState = 'OPEN';
  const recovered = await complete(service, '001');
  assert.equal(recovered.created, true);
  assert.equal(recovered.replayed, false);
  // Nothing ran before the precheck succeeded, so this is a first completion.
  assert.equal(recovered.task.replayed, false);
  assert.equal(recovered.linkedDate, '2026-11-06');
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal(
    (await service.taskHistory({ payload: { from: '2026-11-06', to: '2026-11-06' } }, OWNER))
      .entries.length,
    1,
  );
});

test('T08 a rejected task transition writes no check-in or link row', async () => {
  const { service } = setup();
  await service.transition(
    { requestId: 'req_task_checkin_010', payload: { taskId: WALK, transition: 'skip' } },
    OWNER,
  );
  await assert.rejects(complete(service, '011'), { code: 'CONFLICT' });
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 0);
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 0);
  assert.equal(
    (await service.linkStatus({ payload: { requestId: req('011').requestId } }, OWNER)).status,
    'pending',
  );
});

test('T09 history pages newest first and reports hasMore', async () => {
  const { service, clock } = setup();
  await complete(service, '001');
  clock(DAY_TWO);
  await complete(service, '002');
  clock(DAY_THREE);
  await complete(service, '003');
  const first = await service.linkHistory({ payload: { page: 1, pageSize: 2 } }, OWNER);
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 2);
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].linkedDate, '2026-11-08');
  assert.equal(first.items[1].linkedDate, '2026-11-07');
  const second = await service.linkHistory({ payload: { page: 2, pageSize: 2 } }, OWNER);
  assert.equal(second.items.length, 1);
  assert.equal(second.hasMore, false);
  assert.equal(second.items[0].linkedDate, '2026-11-06');
});

test('T10 a reopened service reads the committed link and 打卡记录', async () => {
  const { service, makeService } = setup();
  const first = await complete(service, '001');
  const reopened = makeService();
  const links = await reopened.linkHistory({ payload: {} }, OWNER);
  assert.equal(links.total, 1);
  const status = await reopened.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER);
  assert.equal(status.status, 'committed');
  assert.deepEqual(status.result, { ...first, created: false, replayed: true });
  assert.equal((await reopened.checkinHistory({ payload: {} }, OWNER)).total, 1);
});

test('T11 payload, pagination and identity boundaries stay narrow', async () => {
  const { service, places } = setup();
  places.place_other_fixture = place({ placeId: 'place_other_fixture' });
  await assert.rejects(
    service.completeWithCheckin(
      {
        requestId: 'req_task_checkin_020',
        payload: { taskId: WALK, placeId: QUIET, transition: 'complete' },
      },
      OWNER,
    ),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(
    service.completeWithCheckin(
      { requestId: 'req_task_checkin_021', payload: { taskId: WALK } },
      OWNER,
    ),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(
    service.completeWithCheckin(
      { requestId: 'short', payload: { taskId: WALK, placeId: QUIET } },
      OWNER,
    ),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(service.linkStatus({ payload: { requestId: 'short' } }, OWNER), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(
    service.linkStatus({ payload: { requestId: req('001').requestId, x: 1 } }, OWNER),
    {
      code: 'INVALID_INPUT',
    },
  );
  await assert.rejects(service.linkHistory({ payload: { pageSize: 51 } }, OWNER), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(service.completeWithCheckin(req('022'), 'not-a-user'), {
    code: 'UNAUTHENTICATED',
  });
  await assert.rejects(service.linkHistory({ payload: {} }, null), { code: 'UNAUTHENTICATED' });
  await assert.rejects(service.handle({ action: 'tasks.none' }, OWNER), {
    code: 'NOT_IMPLEMENTED',
  });
  await assert.rejects(service.handle({ action: 'tasks.suggestions' }, OWNER), {
    code: 'NOT_IMPLEMENTED',
  });
});

test('T12 delegated old actions keep their exact payload and result shape', async () => {
  const { service, tasksDomain, database } = setup();
  const selected = await service.handle(
    {
      action: 'tasks.transition',
      requestId: 'req_task_checkin_030',
      payload: { taskId: WALK, transition: 'select' },
    },
    OWNER,
  );
  assert.deepEqual(selected, {
    taskId: WALK,
    date: '2026-11-06',
    state: 'selected',
    replayed: false,
  });
  // The frozen task protocol has no place field: the domain rejects it instead
  // of the composite silently dropping or accepting it.
  await assert.rejects(
    service.handle(
      {
        action: 'tasks.transition',
        requestId: 'req_task_checkin_031',
        payload: { taskId: WALK, transition: 'complete', placeId: QUIET },
      },
      OWNER,
    ),
    { code: 'INVALID_INPUT' },
  );
  const visit = await service.handle(
    { action: 'campus.checkin', requestId: 'req_task_checkin_032', payload: { placeId: QUIET } },
    OWNER,
  );
  assert.deepEqual(Object.keys(visit).sort(), ['duplicated', 'visit']);
  assert.equal(visit.visit.placeId, QUIET);
  assert.equal(visit.duplicated, false);
  const checkinHistory = await service.handle(
    { action: 'campus.checkinHistory', payload: { page: 1, pageSize: 10 } },
    OWNER,
  );
  assert.equal(checkinHistory.total, 1);
  assert.equal(checkinHistory.items.length, 1);
  const taskHistory = await service.handle(
    { action: 'tasks.history', payload: { from: '2026-11-06', to: '2026-11-06' } },
    OWNER,
  );
  assert.ok(Array.isArray(taskHistory.entries));
  assert.ok(taskHistory.nextCursor === null || typeof taskHistory.nextCursor === 'string');
  assert.equal(typeof tasksDomain.handle, 'function');
  const forwarded = [];
  const withPublic = createTaskCheckinService({
    database,
    tasksDomain,
    checkins: {
      complete: async () => ({ visit: {}, duplicated: false }),
      history: async () => ({ items: [] }),
    },
    resolveIdentity: async () => OWNER,
    resolveActive: async () => true,
    publicSuggestions: async (request) => {
      forwarded.push(request);
      return { items: [], notice: 'synthetic' };
    },
  });
  const publicResult = await withPublic.handle(
    { action: 'tasks.suggestions', payload: {}, actor: { accountId: 'x' } },
    OWNER,
  );
  assert.deepEqual(publicResult, { items: [], notice: 'synthetic' });
  assert.deepEqual(forwarded[0], { action: 'tasks.suggestions', payload: {} });
});

test('T13 the link lifecycle cleans a disabled account and keeps a tombstone', async () => {
  const { service, setStatus } = setup();
  await complete(service, '001');
  await setStatus(OWNER, 'disabled');
  assert.deepEqual(await service.cleanupDisabled(OWNER), { removed: 1, sharedRetained: true });
  assert.deepEqual(await service.cleanupDisabled(OWNER), { removed: 0, sharedRetained: true });
  await assert.rejects(service.cleanupDisabled(OTHER), { code: 'FORBIDDEN' });
  await setStatus(OWNER, 'active');
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 0);
});

test('T14 the candidate capacity rejects new links instead of truncating', async () => {
  const { service, clock } = setup({ capacity: 1 });
  await complete(service, '001');
  clock(DAY_TWO);
  await assert.rejects(complete(service, '002'), { code: 'CONFLICT' });
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
  assert.deepEqual(COMPOSITE_ACTIONS, [
    'tasks.checkin',
    'tasks.checkinHistory',
    'tasks.checkinStatus',
  ]);
  assert.deepEqual(DELEGATED_ACTIONS, [
    'tasks.transition',
    'tasks.history',
    'campus.checkin',
    'campus.checkinHistory',
  ]);
});

test('T15 halves split across midnight are reported with linkedDate null', async () => {
  const env = setupLinked();
  // The place passes the precheck, then fails the check-in half: the task half
  // is committed on DAY_ONE and the association stays pending.
  env.armCheckinFailure();
  await assert.rejects(complete(env.service, '001'), { code: 'CONFLICT' });
  assert.equal(env.taskRows().length, 1);
  assert.equal(env.taskRows()[0][1].state, 'completed');
  assert.equal(env.checkinDoc(), undefined);
  assert.equal(env.linkDoc().links.length, 0);
  assert.equal(env.linkDoc().requests.length, 1);

  env.clock(DAY_TWO);
  const recovered = await complete(env.service, '001');
  assert.equal(recovered.task.date, '2026-11-06');
  assert.equal(recovered.checkin.date, '2026-11-07');
  assert.equal(recovered.linkedDate, null);
  assert.equal(recovered.replayed, false);
  assert.equal(recovered.task.replayed, true);
  // Task once, visit once (on the retry day), one link with both dates.
  assert.equal(env.taskRows().length, 1);
  assert.equal(env.taskRows()[0][1].state, 'completed');
  assert.equal(env.checkinDoc().visits.length, 1);
  assert.equal(env.checkinDoc().visits[0].date, '2026-11-07');
  assert.equal(env.linkDoc().links.length, 1);
  const links = await env.service.linkHistory({ payload: {} }, OWNER);
  assert.equal(links.total, 1);
  assert.equal(links.items[0].linkedDate, null);
  assert.equal(links.items[0].taskDate, '2026-11-06');
  assert.equal(links.items[0].checkinDate, '2026-11-07');
});

test('T16 the same requestId replays after a same-day clock advance', async () => {
  const { service, clock } = setup();
  clock(DAY_ONE);
  assert.equal(businessDate(new Date(DAY_ONE)), '2026-11-06');
  const result = await complete(service, '001');
  assert.equal(result.linkedDate, businessDate(new Date(DAY_ONE)));
  clock(DAY_ONE + 12 * 60 * 60 * 1000);
  const replay = await complete(service, '001');
  assert.equal(replay.linkedDate, '2026-11-06');
  assert.equal(replay.replayed, true);
});

test('T17 the composite commits through the transactional task store with all three records aligned', async () => {
  const env = setupLinked();
  const requestId = req('001').requestId;
  const result = await complete(env.service, '001');
  assert.equal(result.created, true);
  const rows = env.rows();
  assert.equal(env.taskRows().length, 1);
  const taskRow = rows['task_history:' + historyId(OWNER, WALK, '2026-11-06')];
  assert.equal(taskRow.state, 'completed');
  assert.ok(rows['request_receipts:' + receiptId(OWNER, 'tasks.transition', requestId)]);
  const checkinRow = env.checkinDoc();
  assert.equal(checkinRow.visits.length, 1);
  assert.equal(checkinRow.visits[0].placeId, QUIET);
  assert.equal(checkinRow.visits[0].date, '2026-11-06');
  const linkRow = env.linkDoc();
  assert.equal(linkRow.links.length, 1);
  assert.equal(linkRow.links[0].status, 'committed');
  assert.equal(linkRow.links[0].requestId, requestId);
  assert.equal(linkRow.links[0].digest, JSON.stringify([WALK, QUIET]));
  assert.equal(linkRow.links[0].result.linkedDate, '2026-11-06');
  // domains/cleanup.js pages owner-scoped collections by ownerId; without this
  // field the link document would survive an account deletion.
  assert.equal(linkRow.ownerId, OWNER);
  assert.deepEqual(linkRow.requests, []);
  const replay = await complete(env.service, '001');
  assert.equal(replay.replayed, true);
  assert.equal(env.taskRows().length, 1);
  assert.equal(env.checkinDoc().visits.length, 1);
  assert.equal(env.linkDoc().links.length, 1);
  assert.equal(
    (await env.service.linkStatus({ payload: { requestId } }, OWNER)).status,
    'committed',
  );
});

test('T18 a failed precheck consumes no pending intent and no committed capacity', async () => {
  const { service, places, clock } = setup({ capacity: 1 });
  places[QUIET].openState = 'CLOSED';
  await assert.rejects(complete(service, '001'), { code: 'NOT_FOUND' });
  // The precheck failed before the request mapping was written, so there is no
  // pending intent left behind to consume either quota.
  assert.equal(
    (await service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER)).status,
    'absent',
  );
  places[QUIET].openState = 'OPEN';
  const first = await complete(service, '002');
  assert.equal(first.created, true);
  // A same-day equivalent replay records a receipt but no association row.
  const duplicate = await complete(service, '003');
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.replayed, true);
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
  // The single committed slot is consumed by the association, not by the failed
  // precheck: a genuinely new association on the next day is rejected.
  clock(DAY_TWO);
  await assert.rejects(complete(service, '004'), (error) => {
    assert.equal(error.code, 'CONFLICT');
    assert.match(error.message, /容量已满/);
    return true;
  });
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
});

test('T19 pending quota fails closed with its own message and is reclaimed by age', async () => {
  const env = setupLinked();
  // Each request passes the precheck, completes (or replays) the task half and
  // then fails the check-in half, leaving one pending intent per request.
  for (let index = 0; index < PENDING_QUOTA; index += 1) {
    env.armCheckinFailure();
    await assert.rejects(complete(env.service, 'p' + String(index).padStart(3, '0')), {
      code: 'CONFLICT',
    });
  }
  await assert.rejects(complete(env.service, 'overflow'), (error) => {
    assert.equal(error.code, 'CONFLICT');
    assert.match(error.message, /待确认/);
    assert.doesNotMatch(error.message, /容量已满/);
    return true;
  });
  // The overflow request failed before writing anything: the quota is exactly
  // the 50 pending intents and the task half still ran once.
  assert.equal(env.linkDoc().requests.length, PENDING_QUOTA);
  assert.equal(env.taskRows().length, 1);
  assert.equal(env.checkinDoc(), undefined);
  assert.equal(
    (await env.service.linkStatus({ payload: { requestId: req('overflow').requestId } }, OWNER))
      .status,
    'absent',
  );

  env.clock(DAY_ONE + PENDING_TTL_MS + 1);
  const recovered = await complete(env.service, 'after_ttl');
  assert.equal(recovered.created, true);
  assert.equal(recovered.task.date, '2026-11-07');
  assert.equal(env.taskRows().length, 2);
  assert.equal(env.checkinDoc().visits.length, 1);
  assert.equal(env.linkDoc().links.length, 1);
  assert.equal((await env.service.linkHistory({ payload: {} }, OWNER)).total, 1);
});

test('T20 concurrent calls with one requestId create once and report one replay', async () => {
  const { service } = setup();
  const [left, right] = await Promise.all([complete(service, '001'), complete(service, '001')]);
  const created = [left, right].filter((response) => response.created === true);
  const replayed = [left, right].filter((response) => response.replayed === true);
  assert.equal(created.length, 1);
  assert.equal(replayed.length, 1);
  assert.equal(created[0].replayed, false);
  assert.equal(replayed[0].created, false);
  assert.deepEqual(replayed[0], { ...created[0], created: false, replayed: true });
  assert.equal((await service.linkHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal((await service.checkinHistory({ payload: {} }, OWNER)).total, 1);
  assert.equal(
    (await service.taskHistory({ payload: { from: '2026-11-06', to: '2026-11-06' } }, OWNER))
      .entries.length,
    1,
  );
});

test('T21 a valid task with a nonexistent place is NOT_FOUND and leaves zero task, visit and link rows', async () => {
  const env = setupLinked();
  delete env.places[QUIET];
  await assert.rejects(complete(env.service, '001'), {
    code: 'NOT_FOUND',
    message: '地点不可打卡。',
  });
  assert.equal(env.taskRows().length, 0);
  assert.equal(env.checkinDoc(), undefined);
  assert.equal(env.linkDoc(), undefined);
  assert.equal(
    Object.keys(env.rows()).some((key) => key.startsWith('request_receipts:')),
    false,
  );
  // The task page helper of this fixture does not implement gte(); the task row
  // count is asserted directly above, while the other two read paths are used.
  assert.equal((await env.service.checkinHistory({ payload: {} }, OWNER)).total, 0);
  assert.equal((await env.service.linkHistory({ payload: {} }, OWNER)).total, 0);
  assert.equal(
    (await env.service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER)).status,
    'absent',
  );
});

test('T22 a place invalidated after the precheck fails as pending and the same requestId completes once', async () => {
  const env = setupLinked();
  env.armCheckinFailure();
  await assert.rejects(complete(env.service, '001'), (error) => {
    assert.equal(error.code, 'CONFLICT');
    assert.match(error.message, /任务已完成，打卡尚未确认，请用原请求标识重试/);
    return true;
  });
  // Task half committed; the check-in half wrote nothing; the association is a
  // pending intent, never a success and never a committed link.
  assert.equal(env.taskRows().length, 1);
  assert.equal(env.taskRows()[0][1].state, 'completed');
  assert.equal(env.checkinDoc(), undefined);
  const pending = env.linkDoc();
  assert.equal(pending.links.length, 0);
  assert.equal(pending.requests.length, 1);
  assert.equal(pending.requests[0].requestId, req('001').requestId);
  assert.equal(pending.requests[0].status, 'pending');
  assert.equal(
    (await env.service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER)).status,
    'pending',
  );

  const recovered = await complete(env.service, '001');
  assert.equal(recovered.created, true);
  assert.equal(recovered.replayed, false);
  assert.equal(recovered.task.replayed, true);
  // Task once, one visit with its real content, one committed link.
  assert.equal(env.taskRows().length, 1);
  assert.equal(env.taskRows()[0][1].state, 'completed');
  assert.equal(env.checkinDoc().visits.length, 1);
  assert.equal(env.checkinDoc().visits[0].placeId, QUIET);
  assert.equal(env.checkinDoc().visits[0].date, '2026-11-06');
  const committed = env.linkDoc();
  assert.equal(committed.links.length, 1);
  assert.equal(committed.links[0].requestId, req('001').requestId);
  assert.equal(committed.links[0].status, 'committed');
  assert.deepEqual(committed.requests, []);
  // Repeating the same click must not create a second visit or a second link.
  const replay = await complete(env.service, '001');
  assert.equal(replay.replayed, true);
  assert.equal(env.checkinDoc().visits.length, 1);
  assert.equal(env.linkDoc().links.length, 1);
  assert.equal(
    (await env.service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER)).status,
    'committed',
  );
});

test('T23 a disabled account is rejected before the composite writes anything', async () => {
  const env = setupLinked();
  env.setStatus('disabled');
  await assert.rejects(complete(env.service, '001'), { code: 'ACCOUNT_DISABLED' });
  assert.equal(env.taskRows().length, 0);
  assert.equal(env.checkinDoc(), undefined);
  assert.equal(env.linkDoc(), undefined);
  await assert.rejects(env.service.linkHistory({ payload: {} }, OWNER), {
    code: 'ACCOUNT_DISABLED',
  });
  // Re-enabling is a manual operation; nothing was left behind by the rejected
  // write and no automatic recovery path runs.
  env.setStatus('active');
  assert.equal((await env.service.linkHistory({ payload: {} }, OWNER)).total, 0);
  assert.equal(
    (await env.service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER)).status,
    'absent',
  );
});

test('T24 tasks.checkin fails closed when findPlace is not assembled', async () => {
  const { database, tasksDomain } = setup();
  const service = createTaskCheckinService({
    database,
    tasksDomain,
    checkins: {
      complete: async () => ({ visit: {}, duplicated: false }),
      history: async () => ({ items: [] }),
    },
    resolveIdentity: async () => OWNER,
    resolveActive: async () => true,
  });
  await assert.rejects(service.completeWithCheckin(req('040'), OWNER), {
    code: 'NOT_IMPLEMENTED',
  });
  assert.deepEqual(
    [...database.docs.keys()].filter(
      (key) => key.startsWith('task_checkin_links:') || key.startsWith('campus_checkin_states:'),
    ),
    [],
  );
  assert.equal(
    (await service.taskHistory({ payload: { from: '2026-11-06', to: '2026-11-06' } }, OWNER))
      .entries.length,
    0,
  );
});

test('T25 an association-commit failure stays pending and the same requestId finishes it', async () => {
  let linkSets = 0;
  const env = setupLinked({
    fail: ({ operation, collection }) => {
      if (operation === 'set' && collection === 'task_checkin_links') {
        linkSets += 1;
        // The pending intent write succeeds; the committed link write fails.
        return linkSets === 2;
      }
      return false;
    },
  });
  await assert.rejects(complete(env.service, '001'), /SIMULATED_FAILURE/);
  // Both business halves committed, but the association did not: the stored
  // intent is pending and the composite already answered a failure.
  assert.equal(env.taskRows().length, 1);
  assert.equal(env.checkinDoc().visits.length, 1);
  assert.equal(env.linkDoc().links.length, 0);
  assert.equal(env.linkDoc().requests.length, 1);
  assert.equal(env.linkDoc().requests[0].status, 'pending');
  assert.equal(
    (await env.service.linkStatus({ payload: { requestId: req('001').requestId } }, OWNER)).status,
    'pending',
  );

  const recovered = await complete(env.service, '001');
  assert.equal(recovered.created, true);
  assert.equal(recovered.task.replayed, true);
  // The retry replays both halves' receipts and only completes the association.
  assert.equal(env.taskRows().length, 1);
  assert.equal(env.checkinDoc().visits.length, 1);
  assert.equal(env.linkDoc().links.length, 1);
  assert.equal(env.linkDoc().links[0].requestId, req('001').requestId);
  assert.deepEqual(env.linkDoc().requests, []);
});
