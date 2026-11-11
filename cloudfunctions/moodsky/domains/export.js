// W2XY03 (Phoenix-Yx), revised in PR31. Internal snapshot/job helpers, not public handlers.
const { createHash } = require('node:crypto');
const { notImplemented } = require('../shared/result');
const { REQUEST_ID_PATTERN } = require('../shared/validation');
const {
  storageOptions,
  database,
  identity,
  account,
  fail,
  sourceState,
  ownerPage,
} = require('./storage-support');
const { LINK_COLLECTION, linkDocumentId } = require('../stores/task-checkin-links');
// Deployed collections only. The production export walks every entry here
// unconditionally, so a collection that no environment has created must never
// be added to this map.
const SOURCES = {
  journals: [
    'ownerId',
    'date',
    'weather',
    'weatherName',
    'tags',
    'text',
    'version',
    'state',
    'createdAt',
    'updatedAt',
  ],
  campus_checkin_states: ['ownerId', 'owner', 'visits', 'requests', 'revision'],
  place_checkins: ['ownerId', 'placeId', 'date', 'completedAt'],
  favorites: ['ownerId', 'placeId', 'placeName', 'createdAt'],
  task_history: ['ownerId', 'taskId', 'taskTitle', 'date', 'state', 'createdAt'],
  preferences: ['ownerId', 'cardTextPreview', 'decorationsEnabled', 'profile', 'updatedAt'],
  month_decorations: ['ownerId', 'month', 'version', 'stickers', 'backgroundId'],
};
// W4 JF03 link document: one owner document holding the committed
// associations. database/collections.json declares task_checkin_links as
// SOURCE PLAN ONLY / Not deployed, so no environment is guaranteed to have it.
// It stays out of SOURCES and is read only when the caller explicitly passes
// includeCandidateSources: true; the default production path never queries it.
const CANDIDATE_SOURCES = { [LINK_COLLECTION]: ['ownerId', 'links'] };
// wx-server-sdk reports "database collection not exists" with this errCode. An
// opt-in candidate read must fail loudly (CONFLICT) when the collection is
// absent instead of looking like an owner with no associations.
const MISSING_COLLECTION_CODE = -502005;
const isMissingCollection = (error) =>
  error?.errCode === MISSING_COLLECTION_CODE ||
  error?.code === MISSING_COLLECTION_CODE ||
  /collection (?:does not exist|not exist)/i.test(error?.errMsg || error?.message || '');

// The candidate association version travels as a SEPARATE field, never as a
// sixth entry in `revisions`: sourceState() fixes that contract at the five
// deployed domains, so adding a key there would break every stored account and
// every existing check. Only an opt-in export calls this. The owner document is
// absent whenever the collection was never written for that owner; that is
// revision 0 (no associations yet), not an error.
async function readCandidateRevision(tx, ownerId) {
  let data;
  try {
    data = (await tx.collection(LINK_COLLECTION).doc(linkDocumentId(ownerId)).get()).data;
  } catch (error) {
    // An undeployed collection fails the opt-in export explicitly; it is never
    // treated as an owner without associations.
    if (isMissingCollection(error)) {
      return fail('CONFLICT');
    }
    throw error;
  }
  if (data === null || data === undefined) {
    return 0;
  }
  if (
    !data ||
    data.ownerId !== ownerId ||
    data.owner !== ownerId ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0
  ) {
    return fail('CONFLICT');
  }
  return data.revision;
}

function createExportService(options = {}) {
  const {
    db,
    readSourceState,
    maxRecords,
    pageSize = 100,
    now = () => new Date(),
    includeCandidateSources = false,
  } = storageOptions(options, arguments.length, 'createExportService');
  // Candidate sources are opt-in only. A malformed flag is rejected instead of
  // being coerced to a truthy value that would query an undeployed collection.
  if (typeof includeCandidateSources !== 'boolean') {
    throw new TypeError(
      'createExportService({ includeCandidateSources }) must be a boolean; candidate sources are opt-in only.',
    );
  }
  const state = async (ownerId, tx) => {
    database(db);
    if (typeof readSourceState !== 'function') {
      return notImplemented();
    }
    const accountDocument = tx.collection('accounts').doc(ownerId);
    const owner = account((await accountDocument.get()).data, ownerId, 'active');
    return {
      source: sourceState(await readSourceState(ownerId, tx), ownerId),
      accountDocument,
      owner,
    };
  };
  async function gatherExportData(ownerId) {
    identity(ownerId);
    if (
      !Number.isSafeInteger(maxRecords) ||
      maxRecords < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      return fail();
    }
    database(db, ['collection']);
    // The source fence and the candidate association version are read in the
    // same transaction, so a snapshot can never pair one version with the other's
    // source state.
    const before = await db.runTransaction(async (tx) => ({
      source: (await state(ownerId, tx)).source,
      candidateRevision: includeCandidateSources
        ? await readCandidateRevision(tx, ownerId)
        : undefined,
    }));
    async function readOwnerCollection(collection, fields) {
      const records = [];
      let cursor = '',
        scanned = 0;
      while (true) {
        const rows = await ownerPage(db, collection, ownerId, cursor, pageSize);
        scanned += rows.length;
        if (scanned > maxRecords) {
          return fail();
        } // Never return a silently truncated file.
        for (const row of rows) {
          if (collection === 'journals') {
            if (!['active', 'deleted'].includes(row.state)) {
              return fail('CONFLICT');
            }
            if (row.state === 'deleted') {
              continue;
            }
          }
          const projected = Object.fromEntries(
            fields.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]),
          );
          if (collection === 'journals') {
            projected.id = row.entryId || row._id;
          }
          records.push(projected);
        }
        if (rows.length < pageSize) {
          break;
        }
        cursor = rows.at(-1)._id;
      }
      return records;
    }
    const result = {};
    for (const [collection, fields] of Object.entries(SOURCES)) {
      result[collection] = await readOwnerCollection(collection, fields);
    }
    if (includeCandidateSources) {
      for (const [collection, fields] of Object.entries(CANDIDATE_SOURCES)) {
        try {
          result[collection] = await readOwnerCollection(collection, fields);
        } catch (error) {
          // An opt-in candidate collection that the environment never created
          // fails the export explicitly; it is never treated as an empty source.
          if (isMissingCollection(error)) {
            return fail('CONFLICT');
          }
          throw error;
        }
      }
    }
    if (result.preferences.length > 1) {
      return fail('CONFLICT');
    }
    const taskCheckins = includeCandidateSources
      ? result.task_checkin_links.flatMap((row) => {
          if (row.ownerId !== ownerId || !Array.isArray(row.links)) {
            return fail('CONFLICT');
          }
          return row.links.map((link) => {
            // Only committed associations are exportable. A pending intent or a
            // malformed row must fail the whole export (the existing CONFLICT
            // convention) instead of being silently skipped or emitted as if it
            // were a finished association.
            if (
              !link ||
              link.status !== 'committed' ||
              typeof link.taskId !== 'string' ||
              typeof link.placeId !== 'string' ||
              typeof link.result !== 'object' ||
              link.result === null ||
              (link.result.linkedDate !== null && typeof link.result.linkedDate !== 'string') ||
              typeof link.result.linkedAt !== 'string'
            ) {
              return fail('CONFLICT');
            }
            return {
              ownerId,
              taskId: link.taskId,
              placeId: link.placeId,
              linkedDate: link.result.linkedDate,
              linkedAt: link.result.linkedAt,
            };
          });
        })
      : [];
    const after = await db.runTransaction(async (tx) => ({
      source: (await state(ownerId, tx)).source,
      candidateRevision: includeCandidateSources
        ? await readCandidateRevision(tx, ownerId)
        : undefined,
    }));
    // The candidate version is part of the snapshot fence: an association written
    // while the sources were being paged must fail the export instead of yielding
    // a file that silently omits it.
    if (
      before.candidateRevision !== after.candidateRevision ||
      JSON.stringify(before.source) !== JSON.stringify(after.source)
    ) {
      return fail('CONFLICT');
    }
    return {
      ownerId,
      accountStatus: 'active',
      sourceRevision: before.source.revisions.journals,
      sourceRevisions: before.source.revisions,
      ...(includeCandidateSources ? { candidateRevision: before.candidateRevision } : {}),
      accountEpoch: before.source.epoch,
      journals: result.journals,
      favorites: result.favorites,
      ...(result.place_checkins.length ? { checkins: result.place_checkins } : {}),
      ...(result.campus_checkin_states.length
        ? {
            campusCheckins: result.campus_checkin_states.flatMap((row) => {
              if (row.owner !== ownerId || !Array.isArray(row.visits)) {
                return fail('CONFLICT');
              }
              return row.visits.map((visit) => ({ ...visit, ownerId }));
            }),
          }
        : {}),
      ...(taskCheckins.length ? { taskCheckins } : {}),
      taskHistory: result.task_history,
      preferences: result.preferences[0] || null,
      monthDecorations: result.month_decorations,
    };
  }
  async function createExportJob(ownerId, format, requestId) {
    identity(ownerId);
    if (
      !['json', 'markdown'].includes(format) ||
      typeof requestId !== 'string' ||
      !REQUEST_ID_PATTERN.test(requestId)
    ) {
      return fail();
    }
    database(db);
    const timestamp = now().toISOString();
    const jobId = createHash('sha256')
      .update(JSON.stringify(['export-job', ownerId, requestId]))
      .digest('hex')
      .slice(0, 32);
    return db.runTransaction(async (tx) => {
      // Read the source fence inside the write transaction, including every SDK retry.
      const { source, owner, accountDocument } = await state(ownerId, tx);
      // Opt-in only: the default path never reads the undeployed collection, and a
      // job created without it must not look replay-identical to one created with it.
      const candidateRevision = includeCandidateSources
        ? await readCandidateRevision(tx, ownerId)
        : undefined;
      const document = tx.collection('export_jobs').doc(jobId);
      const existing = (await document.get()).data;
      if (existing) {
        if (
          existing.ownerId !== ownerId ||
          existing.format !== format ||
          existing.accountEpoch !== source.epoch ||
          JSON.stringify(existing.sourceRevisions) !== JSON.stringify(source.revisions) ||
          (includeCandidateSources && existing.candidateRevision !== candidateRevision) ||
          !['pending', 'processing', 'ready', 'expired', 'failed'].includes(existing.state)
        ) {
          return fail('CONFLICT');
        }
        return { jobId, state: existing.state, format: existing.format };
      }
      // A snapshot read does not lock the account. Join every lifecycle writer's fence
      // before creating a job, so disabling or mutating sources cannot pass this commit.
      if (owner.operationFence === undefined) {
        return notImplemented();
      }
      if (
        !Number.isSafeInteger(owner.operationFence) ||
        owner.operationFence < 0 ||
        owner.operationFence === Number.MAX_SAFE_INTEGER
      ) {
        return fail('CONFLICT');
      }
      const fenced = await accountDocument.update({
        data: { operationFence: owner.operationFence + 1 },
      });
      if (fenced.stats?.updated !== 1) {
        return fail('CONFLICT');
      }
      await document.set({
        data: {
          ownerId,
          format,
          state: 'pending',
          accountEpoch: source.epoch,
          sourceRevisions: source.revisions,
          ...(includeCandidateSources ? { candidateRevision } : {}),
          fileId: null,
          expiresAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      return { jobId, state: 'pending', format };
    });
  }
  return { gatherExportData, createExportJob };
}
module.exports = { createExportService, readCandidateRevision, ...createExportService() };
