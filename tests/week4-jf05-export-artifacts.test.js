// W4 JF05 follow-up - the candidate export worker and formatter must carry the
// opt-in task_checkin_links association into the final JSON/Markdown artifact,
// while the default path keeps the undeployed collection isolated. Synthetic
// local doubles only: no real cloud, storage or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { createExportPreparation } = require('../tools/export-candidate/preparation');
const { createExportPublication } = require('../tools/export-candidate/publication');
const { formatExport } = require('../tools/export-candidate/formatter');
const { LINK_LAYOUT } = require('../cloudfunctions/moodsky/stores/task-checkin-links');
const { databaseFixture } = require('./helpers/w2-database');

const NOW = () => new Date('2026-11-07T04:00:00.000Z');
const OWNER = 'synthetic_w4_artifacts_owner';
const OTHER = 'synthetic_w4_artifacts_other';
const COLLECTION = 'task_checkin_links';
const account = (id) => ({
  _id: id,
  status: 'active',
  operationFence: 0,
  exportEpoch: 1,
  journalRevision: 1,
});
const journal = (id, ownerId) => ({
  _id: id,
  ownerId,
  entryId: 'entry_' + id,
  date: '2026-11-05',
  weather: 'SUNNY',
  tags: ['REST'],
  text: 'W4 合成导出记录。',
  version: 1,
  state: 'active',
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
});
const linkId = (ownerId) => createHash('sha256').update(ownerId).digest('hex');
// A committed association as stores/task-checkin-links.js persists it: the
// internal request/digest/revision/layout fields must never reach the artifact.
const linkRow = (taskId, placeId, linkedDate, linkedAt) => ({
  requestId: 'req_' + taskId,
  digest: JSON.stringify([taskId, placeId]),
  taskId,
  placeId,
  status: 'committed',
  createdAt: '2026-11-05T00:00:00.000Z',
  result: { taskId, placeId, linkedDate, linkedAt },
});
const requestRow = (taskId, placeId) => ({
  requestId: 'req_w4_artifacts_pending',
  digest: JSON.stringify([taskId, placeId]),
  taskId,
  placeId,
  status: 'pending',
  createdAt: '2026-11-05T00:00:00.000Z',
});
const linkDoc = (ownerId, links, requests = []) => ({
  _id: linkId(ownerId),
  layout: LINK_LAYOUT,
  owner: ownerId,
  ownerId,
  links,
  requests,
  revision: 1,
});
const seed = ({ links = true, other = true } = {}) => {
  const rows = {
    ['accounts:' + OWNER]: account(OWNER),
    ['journals:journal_owner']: journal('journal_owner', OWNER),
    // A deployed place check-in keeps the 地点打卡 section present, so the new
    // section's position is checked against a real heading instead of -1.
    ['place_checkins:checkin_owner']: {
      _id: 'checkin_owner',
      ownerId: OWNER,
      placeId: 'place_owner_a',
      date: '2026-11-05',
      completedAt: '2026-11-05T01:00:00.000Z',
    },
  };
  if (other) {
    rows['accounts:' + OTHER] = account(OTHER);
  }
  if (links) {
    rows[COLLECTION + ':' + linkId(OWNER)] = linkDoc(
      OWNER,
      [
        linkRow('tpl_owner_a', 'place_owner_a', '2026-11-05', '2026-11-05T01:00:00.000Z'),
        // 20:00Z is already 2026-11-08 in the business timezone, and a null
        // linkedDate marks a cross-day association.
        linkRow('tpl_owner_b', 'place_owner_b', null, '2026-11-07T20:00:00.000Z'),
      ],
      [requestRow('tpl_owner_pending', 'place_owner_pending')],
    );
    if (other) {
      rows[COLLECTION + ':' + linkId(OTHER)] = linkDoc(OTHER, [
        linkRow('tpl_other', 'place_other', '2026-11-05', '2026-11-06T02:00:00.000Z'),
      ]);
    }
  }
  return rows;
};
const readSourceState = async (id, tx) => {
  const row = (await tx.collection('accounts').doc(id).get()).data;
  return {
    ownerId: id,
    status: row.status,
    epoch: row.exportEpoch,
    revisions: { journals: 1, favorites: 0, tasks: 0, preferences: 0, decorations: 0 },
  };
};
// The job records the candidate association version only in opt-in mode, so a
// job created for an opt-in preparation must use the same channel.
const service = (db, extra = {}) =>
  createExportService({ db, readSourceState, maxRecords: 100, now: NOW, ...extra });
const preparation = (db, extra = {}) =>
  createExportPreparation({
    db,
    readSourceState,
    maxRecords: 100,
    maxBytes: 1048576,
    now: NOW,
    ...extra,
  });
// The worker output is private material, so the assertion lives on artifact.content.
async function artifact(db, ownerId, format, extra = {}) {
  const job = await service(db, extra).createExportJob(
    ownerId,
    format,
    'req_w4_artifacts_' + format,
  );
  return (await preparation(db, extra).prepare(ownerId, job.jobId)).artifact;
}
const queriedCollections = (f) =>
  f.calls.filter(({ operation }) => operation === 'query').map(({ collection }) => collection);
// Markdown escapes ids exactly like the 收藏地点 / 地点打卡 sections do, so a
// presence check compares the unescaped text.
const unescapeMarkdown = (value) => value.replace(/\\/g, '');
const codedError = (message, errCode) =>
  Object.assign(new Error(message), { errCode, errMsg: message });

test('JF05-W4-ART-01 the default preparation exports both formats without reading the candidate collection', async () => {
  for (const format of ['json', 'markdown']) {
    const f = databaseFixture(seed());
    const accessed = [];
    const db = {
      ...f.db,
      collection(name) {
        accessed.push(name);
        return f.db.collection(name);
      },
    };
    const output = await artifact(db, OWNER, format);

    assert.equal(accessed.includes(COLLECTION), false, JSON.stringify(accessed));
    assert.equal(queriedCollections(f).includes(COLLECTION), false, JSON.stringify(f.calls));
    // Sanity check that the recording double is effective: the deployed sources
    // were read, and the link document really is in the store.
    assert.ok(queriedCollections(f).includes('journals'), JSON.stringify(accessed));
    assert.ok(f.inspect()[COLLECTION + ':' + linkId(OWNER)]);
    // Compare unescaped text so an escaped id cannot hide the association.
    assert.equal(unescapeMarkdown(output.content).includes('tpl_owner'), false);
    if (format === 'json') {
      const document = JSON.parse(output.content);
      assert.equal(Object.hasOwn(document.data, 'taskCheckins'), false);
      assert.doesNotMatch(output.content, /taskCheckins/);
    } else {
      assert.doesNotMatch(output.content, /任务打卡关联|taskCheckins/);
    }
  }
});

test('JF05-W4-ART-02 an opt-in preparation exports only the owner associations into JSON and Markdown', async () => {
  const f = databaseFixture(seed());
  const output = await artifact(f.db, OWNER, 'json', { includeCandidateSources: true });
  const document = JSON.parse(output.content);
  // linkedAt descending, then taskId: the cross-day association comes first.
  assert.deepEqual(document.data.taskCheckins, [
    {
      taskId: 'tpl_owner_b',
      placeId: 'place_owner_b',
      linkedDate: null,
      linkedAt: '2026-11-07T20:00:00.000Z',
    },
    {
      taskId: 'tpl_owner_a',
      placeId: 'place_owner_a',
      linkedDate: '2026-11-05',
      linkedAt: '2026-11-05T01:00:00.000Z',
    },
  ]);
  // Exactly the four business keys; the internal account id stays out of the
  // artifact (the export is already scoped to one owner).
  assert.deepEqual(Object.keys(document.data.taskCheckins[0]).sort(), [
    'linkedAt',
    'linkedDate',
    'placeId',
    'taskId',
  ]);
  const serialized = JSON.stringify(document.data.taskCheckins);
  for (const internal of [
    'requestId',
    'digest',
    'layout',
    'requests',
    'revision',
    'links',
    'status',
    'tpl_other',
    'place_other',
    'tpl_owner_pending',
  ]) {
    assert.equal(serialized.includes(internal), false, internal);
  }
  assert.equal(Object.hasOwn(document.data, COLLECTION), false);
  assert.equal(output.content.includes('tpl_other'), false);
  assert.equal(output.content.includes('place_other'), false);

  const markdown = await artifact(f.db, OWNER, 'markdown', { includeCandidateSources: true });
  const text = unescapeMarkdown(markdown.content);
  assert.match(markdown.content, /## 任务打卡关联（2 条）/);
  // The new section sits after 地点打卡 and before 偏好设置, and the ids keep the
  // same escaping style as the existing id lists.
  assert.ok(
    markdown.content.includes(
      '- 2026-11-08 已完成任务 tpl\\_owner\\_b → 地点 place\\_owner\\_b（关联日期 跨日）',
    ),
  );
  assert.ok(
    markdown.content.includes(
      '- 2026-11-05 已完成任务 tpl\\_owner\\_a → 地点 place\\_owner\\_a（关联日期 2026-11-05）',
    ),
  );
  assert.ok(
    markdown.content.indexOf('tpl\\_owner\\_b') < markdown.content.indexOf('tpl\\_owner\\_a'),
  );
  // Both the existing section and the new one are present, so this ordering
  // assertion cannot pass on a missing heading.
  assert.match(markdown.content, /## 地点打卡（1 条）/);
  assert.ok(markdown.content.indexOf('## 地点打卡') < markdown.content.indexOf('## 任务打卡关联'));
  assert.ok(markdown.content.indexOf('## 任务打卡关联') < markdown.content.indexOf('## 偏好设置'));
  assert.ok(text.includes('tpl_owner_b') && text.includes('place_owner_b'));
  assert.equal(text.includes('tpl_other'), false);
  assert.equal(text.includes('place_other'), false);
});

test('JF05-W4-ART-03 a missing candidate collection fails the opt-in export and leaves the default export working', async () => {
  const f = databaseFixture(seed({ links: false, other: false }));
  const accessed = [];
  // Model the real CloudBase answer for an undeployed collection (errCode
  // -502005) instead of a silent empty result.
  const missing = {
    ...f.db,
    collection(name) {
      accessed.push(name);
      if (name === COLLECTION) {
        throw codedError('database collection not exists', -502005);
      }
      return f.db.collection(name);
    },
  };
  const job = await service(missing, { includeCandidateSources: true }).createExportJob(
    OWNER,
    'json',
    'req_w4_artifacts_missing',
  );
  await assert.rejects(
    preparation(missing, { includeCandidateSources: true }).prepare(OWNER, job.jobId),
    (error) => ['CONFLICT', 'INVALID_INPUT'].includes(error.code),
    'an undeployed candidate collection must fail the export, never look empty',
  );
  // The same environment still exports without the opt-in channel.
  const before = accessed.length;
  const fallback = await artifact(missing, OWNER, 'markdown');
  assert.match(fallback.content, /## 天气记录（1 条）/);
  assert.doesNotMatch(fallback.content, /任务打卡关联|taskCheckins/);
  // The opt-in attempt above is expected to reach the collection; the default
  // path must not touch it at all.
  assert.equal(accessed.slice(before).includes(COLLECTION), false, JSON.stringify(accessed));
  assert.equal(queriedCollections(f).includes(COLLECTION), false, JSON.stringify(f.calls));
});

test('JF05-W4-ART-04 permission and network errors on a deployed source are never treated as empty sources', async () => {
  for (const [label, error] of [
    ['permission', codedError('permission denied by database rules', -502003)],
    ['network', codedError('request timeout while reading the database', -1)],
  ]) {
    const f = databaseFixture(seed({ links: false, other: false }));
    const db = {
      ...f.db,
      collection(name) {
        const reference = f.db.collection(name);
        if (name !== 'journals') {
          return reference;
        }
        return Object.assign(reference, {
          where() {
            throw error;
          },
        });
      },
    };
    const job = await service(db).createExportJob(OWNER, 'json', 'req_w4_artifacts_' + label);
    await assert.rejects(
      preparation(db).prepare(OWNER, job.jobId),
      new RegExp(error.errMsg),
      label,
    );
    // Fail closed: no artifact was produced for this job.
    assert.equal(f.inspect()['export_jobs:' + job.jobId].state, 'pending');
  }
});

test('JF05-W4-ART-05 a non-boolean opt-in flag and a malformed association row fail loudly', () => {
  const f = databaseFixture({});
  for (const invalid of ['true', 1, null, {}]) {
    assert.throws(
      () => preparation(f.db, { includeCandidateSources: invalid }),
      TypeError,
      String(invalid),
    );
  }
  const snapshot = {
    ownerId: OWNER,
    accountStatus: 'active',
    sourceRevision: 0,
    journals: [],
    favorites: [],
    taskHistory: [],
    preferences: null,
    monthDecorations: [],
    taskCheckins: [{ ownerId: OWNER, taskId: 'tpl_owner_a', linkedAt: '2026-11-05T01:00:00.000Z' }],
  };
  const options = {
    format: 'json',
    accountId: OWNER,
    exportedAt: '2026-11-07T04:00:00.000Z',
    maxRecords: 100,
    maxBytes: 1048576,
  };
  // A row missing placeId/linkedDate is a contradicting snapshot: it fails
  // instead of being dropped, and the same holds for a foreign owner row.
  assert.throws(
    () => formatExport(snapshot, options),
    (error) => ['CONFLICT', 'INVALID_INPUT'].includes(error.code),
  );
  const foreign = {
    ...snapshot,
    taskCheckins: [
      {
        ownerId: OTHER,
        taskId: 'tpl_other',
        placeId: 'place_other',
        linkedDate: '2026-11-05',
        linkedAt: '2026-11-05T01:00:00.000Z',
      },
    ],
  };
  assert.throws(() => formatExport(foreign, options), { code: 'FORBIDDEN' });
  // An empty candidate source keeps the key absent instead of emitting [].
  const empty = { ...snapshot, taskCheckins: [] };
  assert.equal(
    Object.hasOwn(JSON.parse(formatExport(empty, options).content).data, 'taskCheckins'),
    false,
  );
});

// The candidate association version is a separate fence: task_checkin_links has
// no source revision, so an opt-in export must carry its own monotonic version
// through the snapshot, the job document, the formatter window and publication.
const linkKey = (ownerId) => COLLECTION + ':' + linkId(ownerId);
const addCommittedLink = (f, ownerId, taskId) => {
  const document = f.inspect()[linkKey(ownerId)];
  f.put(COLLECTION, {
    ...document,
    links: [
      ...document.links,
      // A brand new association for the same owner: the file generated from the
      // earlier snapshot cannot contain it.
      linkRow(taskId, 'place_' + taskId, '2026-11-05', '2026-11-06T01:00:00.000Z'),
    ],
    revision: document.revision + 1,
  });
  return document.revision + 1;
};
// Runs `mutate` right after the Nth committed transaction of `db`, which is how
// the two timing windows are addressed: prepare() commits guard (1),
// gather-before (2) and gather-after (3) before it formats the artifact.
const withLinkMutation = (f, nth, mutate) => {
  let transactions = 0;
  return {
    ...f.db,
    runTransaction(work) {
      return f.db.runTransaction(work).then((value) => {
        transactions += 1;
        if (transactions === nth) {
          mutate();
        }
        return value;
      });
    },
  };
};
const publishedMetadata = (jobId, prepared, fileId) => {
  const bytes = Buffer.from(prepared.artifact.content, 'utf8');
  return {
    ownerId: OWNER,
    jobId,
    fileId,
    private: true,
    immutable: true,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    mimeType: prepared.artifact.mimeType,
  };
};

test('JF05-W4-ART-06 a new association after the snapshot read fails the opt-in export before any artifact', async () => {
  const f = databaseFixture(seed());
  const optIn = { includeCandidateSources: true };
  // The snapshot itself carries the version, and the job stores the same value.
  const snapshot = await service(f.db, optIn).gatherExportData(OWNER);
  assert.equal(snapshot.candidateRevision, 1);
  assert.equal(Object.hasOwn(snapshot, 'taskCheckins'), true);
  const job = await service(f.db, optIn).createExportJob(
    OWNER,
    'json',
    'req_w4_artifacts_after_snapshot',
  );
  assert.equal(f.inspect()['export_jobs:' + job.jobId].candidateRevision, 1);
  // Window: the snapshot read has completed, the artifact has not been generated.
  const db = withLinkMutation(f, 3, () => addCommittedLink(f, OWNER, 'tpl_after_snapshot'));
  await assert.rejects(preparation(db, optIn).prepare(OWNER, job.jobId), { code: 'CONFLICT' });
  // Fail closed: the extra association was written, yet no artifact was produced.
  assert.equal(f.inspect()[linkKey(OWNER)].revision, 2);
  assert.equal(f.inspect()['export_jobs:' + job.jobId].state, 'pending');
  assert.equal(Object.hasOwn(f.inspect()['export_jobs:' + job.jobId], 'content'), false);
});

test('JF05-W4-ART-07 a new association after the file is generated fails opt-in publication', async () => {
  const f = databaseFixture(seed());
  const optIn = { includeCandidateSources: true };
  const job = await service(f.db, optIn).createExportJob(
    OWNER,
    'json',
    'req_w4_artifacts_before_publish',
  );
  const prepared = await preparation(f.db, optIn).prepare(OWNER, job.jobId);
  assert.equal(prepared.candidateRevision, 1);
  // The artifact was generated from the earlier snapshot, so it cannot contain
  // the association written below; publishing it would publish a missing record.
  assert.match(prepared.artifact.content, /tpl_owner_b/);
  assert.doesNotMatch(prepared.artifact.content, /tpl_after_prepare/);
  const revision = addCommittedLink(f, OWNER, 'tpl_after_prepare');
  assert.equal(revision, 2);
  let inspections = 0;
  const publisher = createExportPublication({
    db: f.db,
    readSourceState,
    maxBytes: 1048576,
    now: NOW,
    includeCandidateSources: true,
    inspectArtifact: async () => {
      inspections += 1;
      return publishedMetadata(job.jobId, prepared, 'synthetic_w4_private_file');
    },
  });
  await assert.rejects(publisher.publish(OWNER, job.jobId, prepared, 'synthetic_w4_private_file'), {
    code: 'CONFLICT',
  });
  // The fence rejects the publication before storage inspection and before the
  // job can advance to ready.
  assert.equal(inspections, 0);
  const stored = f.inspect()['export_jobs:' + job.jobId];
  assert.equal(stored.state, 'pending');
  assert.equal(stored.fileId, null);
  // A publisher without the candidate channel refuses a candidate artifact
  // instead of publishing it unguarded.
  const crossed = createExportPublication({
    db: f.db,
    readSourceState,
    maxBytes: 1048576,
    now: NOW,
    inspectArtifact: async () => {
      throw Error('the cross-configured publisher must not inspect storage');
    },
  });
  await assert.rejects(crossed.publish(OWNER, job.jobId, prepared, 'synthetic_w4_private_file'), {
    code: 'INVALID_INPUT',
  });
});

test('default preparation and publication reject a candidate export job', async () => {
  const f = databaseFixture(seed());
  const optIn = { includeCandidateSources: true };
  const job = await service(f.db, optIn).createExportJob(OWNER, 'json', 'req_w4_mode_mismatch');
  await assert.rejects(preparation(f.db).prepare(OWNER, job.jobId), { code: 'CONFLICT' });
  const prepared = await preparation(f.db, optIn).prepare(OWNER, job.jobId);
  delete prepared.candidateRevision;
  const publisher = createExportPublication({
    db: f.db,
    readSourceState,
    maxBytes: 1048576,
    now: NOW,
    inspectArtifact: async () => {
      assert.fail('a mismatched job must not inspect the file');
    },
  });
  await assert.rejects(publisher.publish(OWNER, job.jobId, prepared, 'synthetic_w4_wrong_mode'), {
    code: 'CONFLICT',
  });
  assert.equal(f.inspect()['export_jobs:' + job.jobId].state, 'pending');
});

test('JF05-W4-ART-08 the default export neither reads nor fails on associations written in either window', async () => {
  const f = databaseFixture(seed());
  const job = await service(f.db).createExportJob(OWNER, 'json', 'req_w4_artifacts_default_window');
  // A default job never carries the candidate version field.
  assert.equal(Object.hasOwn(f.inspect()['export_jobs:' + job.jobId], 'candidateRevision'), false);
  // Window 1: a new association right after the snapshot read.
  const db = withLinkMutation(f, 3, () => addCommittedLink(f, OWNER, 'tpl_default_after_snapshot'));
  const prepared = await preparation(db).prepare(OWNER, job.jobId);
  assert.equal(Object.hasOwn(prepared, 'candidateRevision'), false);
  // Window 2: a new association after the file was generated, before publication.
  assert.equal(addCommittedLink(f, OWNER, 'tpl_default_after_prepare'), 3);
  const publisher = createExportPublication({
    db: f.db,
    readSourceState,
    maxBytes: 1048576,
    now: NOW,
    inspectArtifact: async () =>
      publishedMetadata(job.jobId, prepared, 'synthetic_w4_default_file'),
  });
  const published = await publisher.publish(
    OWNER,
    job.jobId,
    prepared,
    'synthetic_w4_default_file',
  );
  assert.deepEqual(published, { jobId: job.jobId, state: 'ready', format: 'json' });
  // The candidate collection was never touched by the default path, not even as
  // a transaction read of its version stamp.
  assert.deepEqual(
    f.calls.filter(({ collection }) => collection === COLLECTION),
    [],
  );
  assert.doesNotMatch(prepared.artifact.content, /taskCheckins|tpl_owner|tpl_default/);
});

test('JF05-W4-ART-09 an opt-in snapshot treats an absent owner link document as revision 0', async () => {
  const f = databaseFixture(seed({ links: false }));
  const optIn = { includeCandidateSources: true };
  const snapshot = await service(f.db, optIn).gatherExportData(OWNER);
  assert.equal(snapshot.candidateRevision, 0);
  assert.equal(Object.hasOwn(snapshot, 'taskCheckins'), false);
  const job = await service(f.db, optIn).createExportJob(
    OWNER,
    'json',
    'req_w4_artifacts_absent_document',
  );
  assert.equal(f.inspect()['export_jobs:' + job.jobId].candidateRevision, 0);
  const prepared = await preparation(f.db, optIn).prepare(OWNER, job.jobId);
  assert.equal(prepared.candidateRevision, 0);
  assert.equal(prepared.artifact.content.includes('taskCheckins'), false);
});

test('JF05-W4-ART-10 a permission or network error on the candidate version read is never revision 0', async () => {
  for (const [label, error] of [
    ['permission', codedError('permission denied by database rules', -502003)],
    ['network', codedError('request timeout while reading the database', -1)],
  ]) {
    const f = databaseFixture(seed());
    // The candidate version is read inside the export transaction, so the error
    // is injected at the transactional collection handle.
    const db = {
      ...f.db,
      runTransaction(work) {
        return f.db.runTransaction((tx) =>
          work({
            collection(name) {
              if (name === COLLECTION) {
                throw error;
              }
              return tx.collection(name);
            },
          }),
        );
      },
    };
    await assert.rejects(
      service(db, { includeCandidateSources: true }).gatherExportData(OWNER),
      new RegExp(error.errMsg),
      label,
    );
  }
});
