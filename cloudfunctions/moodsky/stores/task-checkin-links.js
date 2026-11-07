// W4 JF03 — task + place check-in link persistence (opt-in candidate).
//
// The link record is the only new persisted fact: "this task was completed and
// this place was checked in for the same owner". Ordinary task completion lives
// in task_history (stores/transactional-tasks.js) and place check-ins live in
// campus_checkin_states (services/checkins.js); this module never duplicates or
// rewrites either of them.
//
// One deterministic document per owner mirrors services/checkins.js: reads and
// writes happen inside one injected transaction, so "read the current state,
// then write" cannot interleave for the same owner. No collection is created or
// deployed by this module; the caller assembles the database and identity seams.
//
// The document keeps two separate lists on purpose:
//   links[]     committed associations only; this is what the capacity limit
//               (MAX_LINKS) counts and what check-in history lists.
//   requests[]  request mapping: pending intents (with a small, age-reaped
//               quota) plus committed receipts for same-day equivalent dedupes.
//               Keeping the receipt means replay and status lookup stay correct
//               for a requestId that was answered by an existing association.
const { createHash } = require('node:crypto');
const { AppError } = require('../shared/result');
const { isBusinessDate } = require('../shared/date');

const LINK_COLLECTION = 'task_checkin_links';
const LINK_LAYOUT = 'task-checkin-links-v1';
const MAX_LINKS = 500;
// A pending intent is not an association. It gets its own small quota so failed
// requests cannot permanently exhaust the 500 committed rows, and it is reaped
// by age so an abandoned intent cannot block later legal requests forever.
const PENDING_QUOTA = 50;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
// Intersection of the two existing request-id rules: services/checkins.js accepts
// /^req_[A-Za-z0-9_-]{1,100}$/ and services/tasks-candidate.js requires the
// forwarded id to be 8-80 characters. Total length here is 8-80, so the same id
// can be forwarded to both halves without rewriting it.
const REQUEST_ID_PATTERN = /^req_[A-Za-z0-9_-]{4,76}$/;
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LINK_STATUSES = Object.freeze(['pending', 'committed']);
const RESULT_FIELDS = Object.freeze([
  'taskId',
  'placeId',
  'linkedDate',
  'task',
  'checkin',
  'linkedAt',
  'created',
  'replayed',
]);
const TASK_FIELDS = Object.freeze(['taskId', 'date', 'state', 'replayed']);
const CHECKIN_FIELDS = Object.freeze(['placeId', 'date', 'completedAt', 'placeName', 'duplicated']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalidLayout(message = '任务打卡关联存储格式无效。') {
  throw new AppError('CONFLICT', message);
}
function isInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function checkResult(row, result) {
  if (
    !isPlainObject(result) ||
    !hasOnlyKeys(result, RESULT_FIELDS) ||
    result.taskId !== row.taskId ||
    result.placeId !== row.placeId ||
    (result.linkedDate !== null && !isBusinessDate(result.linkedDate)) ||
    !isInstant(result.linkedAt) ||
    result.created !== true ||
    result.replayed !== false ||
    !isPlainObject(result.task) ||
    !hasOnlyKeys(result.task, TASK_FIELDS) ||
    result.task.taskId !== row.taskId ||
    result.task.state !== 'completed' ||
    !isBusinessDate(result.task.date) ||
    typeof result.task.replayed !== 'boolean' ||
    !isPlainObject(result.checkin) ||
    !hasOnlyKeys(result.checkin, CHECKIN_FIELDS) ||
    result.checkin.placeId !== row.placeId ||
    !isBusinessDate(result.checkin.date) ||
    !isInstant(result.checkin.completedAt) ||
    (result.checkin.placeName !== null && typeof result.checkin.placeName !== 'string') ||
    typeof result.checkin.duplicated !== 'boolean'
  ) {
    invalidLayout();
  }
  if (
    (result.linkedDate === null &&
      (result.task.date === result.checkin.date ||
        Date.parse(result.linkedAt) < Date.parse(result.checkin.completedAt))) ||
    (result.linkedDate !== null &&
      (result.linkedDate !== result.task.date || result.linkedDate !== result.checkin.date))
  ) {
    invalidLayout();
  }
}
// The digest must stay a machine-readable copy of (taskId, placeId): it is the
// exact comparison used for "same requestId, changed payload -> CONFLICT".
function checkDigest(row) {
  let digest;
  try {
    digest = JSON.parse(row.digest);
  } catch (_error) {
    invalidLayout();
  }
  if (
    !Array.isArray(digest) ||
    digest.length !== 2 ||
    typeof digest[0] !== 'string' ||
    typeof digest[1] !== 'string' ||
    digest[0] !== row.taskId ||
    digest[1] !== row.placeId
  ) {
    invalidLayout();
  }
}
function checkRowBase(row) {
  if (
    !isPlainObject(row) ||
    !REQUEST_ID_PATTERN.test(row.requestId || '') ||
    typeof row.digest !== 'string' ||
    !TASK_ID_PATTERN.test(row.taskId || '') ||
    typeof row.placeId !== 'string' ||
    !row.placeId.trim() ||
    !LINK_STATUSES.includes(row.status) ||
    !isInstant(row.createdAt)
  ) {
    invalidLayout();
  }
  checkDigest(row);
}
function checkLink(row) {
  checkRowBase(row);
  if (row.status !== 'committed') {
    invalidLayout();
  }
  checkResult(row, row.result);
}
function checkRequest(row) {
  checkRowBase(row);
  if (row.status === 'committed') {
    checkResult(row, row.result);
  }
}
function normalizeState(data, owner) {
  if (data === null || data === undefined) {
    return {
      layout: LINK_LAYOUT,
      owner,
      ownerId: owner,
      links: [],
      requests: [],
      revision: 0,
    };
  }
  if (
    !isPlainObject(data) ||
    data.layout !== LINK_LAYOUT ||
    data.owner !== owner ||
    (data.ownerId !== undefined && data.ownerId !== owner) ||
    !Array.isArray(data.links) ||
    data.links.length > MAX_LINKS ||
    !Array.isArray(data.requests) ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0
  ) {
    invalidLayout();
  }
  const seen = new Set();
  for (const row of data.links) {
    checkLink(row);
    if (seen.has(row.requestId)) {
      invalidLayout();
    }
    seen.add(row.requestId);
  }
  for (const row of data.requests) {
    checkRequest(row);
    if (seen.has(row.requestId)) {
      invalidLayout();
    }
    seen.add(row.requestId);
  }
  return {
    layout: LINK_LAYOUT,
    owner,
    ownerId: owner,
    links: data.links,
    requests: data.requests,
    revision: data.revision,
  };
}
function project(row) {
  return {
    requestId: row.requestId,
    taskId: row.taskId,
    placeId: row.placeId,
    linkedDate: row.result.linkedDate,
    taskDate: row.result.task.date,
    checkinDate: row.result.checkin.date,
    checkinAt: row.result.checkin.completedAt,
    placeName: row.result.checkin.placeName,
    duplicated: row.result.checkin.duplicated,
    linkedAt: row.result.linkedAt,
  };
}
function findRow(state, requestId) {
  return (
    state.links.find((row) => row.requestId === requestId) ||
    state.requests.find((row) => row.requestId === requestId)
  );
}
function pendingCount(state) {
  return state.requests.filter((row) => row.status === 'pending').length;
}
// Reaping only touches pending intents: committed receipts and committed links
// keep replay/status semantics. Returns whether anything was removed.
function reapExpiredPending(state, instant) {
  const before = state.requests.length;
  state.requests = state.requests.filter(
    (row) => row.status !== 'pending' || instant - Date.parse(row.createdAt) <= PENDING_TTL_MS,
  );
  if (state.requests.length === before) {
    return false;
  }
  state.revision++;
  return true;
}

function createTaskCheckinLinkStore({
  database,
  resolveIdentity,
  resolveActive,
  resolveDisabled,
  now = Date.now,
  capacity = MAX_LINKS,
} = {}) {
  if (!database || typeof database.runTransaction !== 'function') {
    throw new TypeError('Task check-in link store requires transactional storage.');
  }
  if (typeof resolveIdentity !== 'function' || typeof resolveActive !== 'function') {
    throw new TypeError('Task check-in link store requires identity seams.');
  }
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new TypeError('Task check-in link store capacity must be a positive integer.');
  }
  // Driving the stored document past MAX_LINKS would make normalizeState reject
  // it on the next read, so a larger configured capacity is clamped instead of
  // bricking the owner's link document.
  const linkLimit = Math.min(capacity, MAX_LINKS);
  const docId = (owner) => createHash('sha256').update(owner).digest('hex');
  const save = (doc, state) =>
    doc.set({
      data: {
        layout: state.layout,
        owner: state.owner,
        // domains/cleanup.js pages owner-scoped collections by ownerId; the
        // deterministic _id stays sha256(owner), exactly like checkins.js.
        ownerId: state.ownerId,
        links: state.links,
        requests: state.requests,
        revision: state.revision,
      },
    });
  async function ownerOf(binding) {
    const owner = await resolveIdentity(binding);
    if (!owner) {
      throw new AppError('UNAUTHENTICATED', '请先登录。');
    }
    return owner;
  }
  async function run(binding, work) {
    const owner = await ownerOf(binding);
    return database.runTransaction(async (tx) => {
      if (!(await resolveActive(tx, owner))) {
        throw new AppError('ACCOUNT_DISABLED', '账号已停用。');
      }
      const doc = tx.collection(LINK_COLLECTION).doc(docId(owner));
      const state = normalizeState((await doc.get()).data, owner);
      return work({ doc, state, owner });
    });
  }
  function findEquivalent(state, row, linkedDate) {
    return state.links.find(
      (candidate) =>
        candidate.taskId === row.taskId &&
        candidate.placeId === row.placeId &&
        candidate.result.linkedDate === linkedDate,
    );
  }
  return {
    // Identity + active-account gate for delegated actions that do not touch the
    // link document themselves.
    async assertActive(binding) {
      const owner = await ownerOf(binding);
      await database.runTransaction(async (tx) => {
        if (!(await resolveActive(tx, owner))) {
          throw new AppError('ACCOUNT_DISABLED', '账号已停用。');
        }
      });
      return owner;
    },
    // Reads the request mapping and, when absent, runs the caller's place
    // precheck inside this same transaction *before* writing a durable "pending"
    // intent. A rejected precheck therefore leaves no intent row at all, while a
    // committed replay or a same-day equivalent association is answered without
    // re-reading the place: it already happened and must replay even if the
    // place was closed afterwards.
    prepare(binding, { requestId, digest, taskId, placeId, date }, precheck) {
      return run(binding, async ({ tx, doc, state, owner }) => {
        const prior = findRow(state, requestId);
        if (prior) {
          if (prior.digest !== digest) {
            throw new AppError('CONFLICT', '同一请求不能改变任务或地点。');
          }
          if (prior.status === 'committed') {
            return { owner, replay: prior.result };
          }
          // A pending intent is retried: re-check the place so an unavailable
          // place fails as NOT_FOUND instead of relying on the check-in half.
          if (typeof precheck === 'function') {
            await precheck(tx);
          }
          return { owner };
        }
        reapExpiredPending(state, now());
        const equivalent = isBusinessDate(date)
          ? findEquivalent(state, { taskId, placeId }, date)
          : undefined;
        if (equivalent) {
          state.requests.push({
            requestId,
            digest,
            taskId,
            placeId,
            status: 'committed',
            createdAt: new Date(now()).toISOString(),
            result: equivalent.result,
          });
          state.revision++;
          await save(doc, state);
          return { owner, replay: equivalent.result };
        }
        // Only a genuinely new execution reaches the place precheck. It runs
        // before the pending write and before either business half, so a failed
        // precheck performs no write in any collection touched by this service.
        if (typeof precheck === 'function') {
          await precheck(tx);
        }
        if (state.links.length >= linkLimit) {
          throw new AppError('CONFLICT', '任务打卡关联存储容量已满，请联系维护者。');
        }
        if (pendingCount(state) >= PENDING_QUOTA) {
          throw new AppError('CONFLICT', '待确认的任务打卡请求过多，请稍后重试。');
        }
        state.requests.push({
          requestId,
          digest,
          taskId,
          placeId,
          status: 'pending',
          createdAt: new Date(now()).toISOString(),
        });
        state.revision++;
        await save(doc, state);
        return { owner };
      });
    },
    // Commits the first-execution result. An equivalent committed link for the
    // same task + place + business day wins over a second row: this request is
    // recorded as a committed receipt instead, so it still replays and reports
    // "committed" if the client asks again.
    commit(binding, { requestId, result }) {
      return run(binding, async ({ doc, state }) => {
        const link = state.links.find((row) => row.requestId === requestId);
        if (link) {
          // Another concurrent call with the same requestId already committed.
          return { result: link.result, replayed: true };
        }
        const index = state.requests.findIndex((row) => row.requestId === requestId);
        if (index < 0) {
          invalidLayout('任务打卡关联请求不存在，尚未提交。');
        }
        const row = state.requests[index];
        if (row.status === 'committed') {
          return { result: row.result, replayed: true };
        }
        checkResult(row, result);
        const equivalent =
          result.linkedDate === null ? undefined : findEquivalent(state, row, result.linkedDate);
        if (equivalent) {
          row.status = 'committed';
          row.result = equivalent.result;
          state.revision++;
          await save(doc, state);
          return { result: equivalent.result, replayed: true };
        }
        if (state.links.length >= linkLimit) {
          throw new AppError('CONFLICT', '任务打卡关联存储容量已满，请联系维护者。');
        }
        state.links.push({
          requestId,
          digest: row.digest,
          taskId: row.taskId,
          placeId: row.placeId,
          status: 'committed',
          createdAt: row.createdAt,
          result,
        });
        state.requests.splice(index, 1);
        state.revision++;
        await save(doc, state);
        return { result, replayed: false };
      });
    },
    find(binding, requestId) {
      return run(binding, async ({ state }) => {
        const row = findRow(state, requestId);
        if (!row) {
          return { status: 'absent' };
        }
        return row.status === 'pending'
          ? { status: 'pending' }
          : { status: 'committed', result: row.result };
      });
    },
    history(binding, { page, pageSize }) {
      return run(binding, async ({ state }) => {
        const rows = state.links
          .filter((row) => row.status === 'committed')
          .sort(
            (left, right) =>
              Date.parse(right.result.linkedAt) - Date.parse(left.result.linkedAt) ||
              left.requestId.localeCompare(right.requestId),
          );
        return {
          items: rows.slice((page - 1) * pageSize, page * pageSize).map(project),
          page,
          pageSize,
          total: rows.length,
          hasMore: page * pageSize < rows.length,
        };
      });
    },
    // Server-only lifecycle seam; not exposed through the page transport.
    cleanupDisabled(owner) {
      if (typeof resolveDisabled !== 'function') {
        return Promise.reject(new AppError('NOT_IMPLEMENTED', '未接入可信停用围栏。'));
      }
      return database.runTransaction(async (tx) => {
        if (!(await resolveDisabled(tx, owner))) {
          throw new AppError('FORBIDDEN', '账号未停用。');
        }
        const doc = tx.collection(LINK_COLLECTION).doc(docId(owner));
        const data = (await doc.get()).data;
        if (!data) {
          return { removed: 0, sharedRetained: true };
        }
        if (data.owner !== owner) {
          throw new AppError('FORBIDDEN', '记录归属不匹配。');
        }
        const state = normalizeState(data, owner);
        // "removed" counts the committed associations; pending intents and
        // equivalent receipts are deleted with the same document.
        const removed = state.links.length;
        // Preserve a monotonic revision as a tombstone, mirroring checkins.js.
        await doc.set({
          data: {
            layout: LINK_LAYOUT,
            owner,
            ownerId: owner,
            links: [],
            requests: [],
            revision: state.revision + (removed ? 1 : 0),
          },
        });
        return { removed, sharedRetained: true };
      });
    },
  };
}

module.exports = {
  createTaskCheckinLinkStore,
  LINK_COLLECTION,
  LINK_LAYOUT,
  MAX_LINKS,
  PENDING_QUOTA,
  PENDING_TTL_MS,
  REQUEST_ID_PATTERN,
  TASK_ID_PATTERN,
};
