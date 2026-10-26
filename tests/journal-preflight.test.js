const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { inspectJournalSnapshot } = require('../tools/week2-integration/journal-preflight');
const {
  createCloudJournalRepository,
  dayId,
} = require('../tools/journal-storage/cloudbase-candidate');
const { databaseFixture } = require('./helpers/w2-database');
const sample = require('../tools/week2-integration/fixtures/journal-preflight.synthetic.json');
const snapshot = () => globalThis.structuredClone(sample);
const codes = (result) => result.findings.map((finding) => finding.code);

function storage(input) {
  return databaseFixture(
    Object.fromEntries([
      ['accounts:' + input.accountId, input.account],
      ...input.journals.map((row) => ['journals:' + row._id, row]),
    ]),
  );
}

test('preflight reads active and deleted rows without mutating data, returning private fields, or enabling services', async () => {
  const input = snapshot(),
    before = snapshot();
  const result = await inspectJournalSnapshot(input);
  assert.equal(result.status, 'eligible_for_review');
  assert.equal(result.mayOpenPrivateServices, false);
  assert.equal(result.migrationExecuted, false);
  assert.equal(result.completenessIndependentlyVerified, false);
  assert.deepEqual(result.summary, { rows: 2, checkedRows: 2, active: 1, deleted: 1 });
  assert.deepEqual(input, before);
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic_preflight_owner|synthetic_preflight_entry|SIMULATED preflight writing|REST|SUNNY|2026-10/,
  );
  const empty = await inspectJournalSnapshot({ ...input, journals: [] });
  assert.equal(empty.status, 'eligible_for_review');
  assert.equal(empty.summary.checkedRows, 0);
});

test('preflight rejects the same malformed storage rows as the actual candidate reader', async () => {
  for (const change of [
    { text: null },
    { text: '😀'.repeat(1001) },
    { tags: undefined },
    { weather: 'INVALID' },
    { createdAt: '2026-02-30T00:00:00.000Z' },
    { updatedAt: '2026-10-19T00:00:00.000Z' },
    { entryId: 'bad/path' },
  ]) {
    const input = snapshot();
    Object.assign(input.journals[0], change);
    const f = storage(input),
      before = f.inspect();
    await assert.rejects(createCloudJournalRepository(f.db).readDay(input.accountId, '2026-10-20'));
    const result = await inspectJournalSnapshot(input);
    assert.equal(result.status, 'blocked');
    assert.ok(codes(result).includes('STORED_ROW_INVALID'));
    assert.deepEqual(f.inspect(), before);
  }
  const input = snapshot();
  input.journals[1].text = 'SIMULATED deleted private residue';
  assert.ok(codes(await inspectJournalSnapshot(input)).includes('STORED_ROW_INVALID'));
});

test('preflight detects stray keys that a deterministic lookup sees as empty, duplicate days and reused entry IDs', async () => {
  const misplaced = snapshot();
  misplaced.journals[0]._id = 'synthetic_legacy_random_id';
  const f = storage(misplaced);
  assert.equal(
    await createCloudJournalRepository(f.db).readDay(misplaced.accountId, '2026-10-20'),
    undefined,
  );
  assert.ok(codes(await inspectJournalSnapshot(misplaced)).includes('ROW_KEY_MISMATCH'));
  const duplicateDay = snapshot();
  duplicateDay.journals.push({ ...duplicateDay.journals[0] });
  assert.ok(codes(await inspectJournalSnapshot(duplicateDay)).includes('DUPLICATE_DAY'));
  const duplicateEntry = snapshot();
  duplicateEntry.journals[1] = {
    ...duplicateEntry.journals[0],
    date: '2026-10-21',
    _id: dayId(duplicateEntry.accountId, '2026-10-21'),
  };
  assert.ok(codes(await inspectJournalSnapshot(duplicateEntry)).includes('DUPLICATE_ENTRY_ID'));
  const foreign = snapshot();
  foreign.journals[0].ownerId = 'synthetic_other';
  assert.ok(codes(await inspectJournalSnapshot(foreign)).includes('ROW_SCOPE_INVALID'));
});

test('preflight blocks legacy, disabled, corrupt, incomplete, excessive and exhausted material without partial approval', async () => {
  for (const [change, code] of [
    [{ journalLayout: undefined }, 'LAYOUT_NOT_ENABLED'],
    [{ status: 'disabled' }, 'ACCOUNT_NOT_ACTIVE'],
    [{ _id: 'synthetic_other' }, 'ACCOUNT_MATERIAL_INVALID'],
    [{ journalRevision: -1 }, 'ACCOUNT_MATERIAL_INVALID'],
    [{ operationFence: Number.MAX_SAFE_INTEGER }, 'ACCOUNT_COUNTER_EXHAUSTED'],
  ]) {
    const input = snapshot();
    Object.assign(input.account, change);
    const result = await inspectJournalSnapshot(input);
    assert.equal(result.status, 'blocked');
    assert.ok(codes(result).includes(code));
    assert.equal(result.mayOpenPrivateServices, false);
  }
  const incomplete = await inspectJournalSnapshot({ ...snapshot(), complete: false });
  assert.deepEqual(codes(incomplete), ['COMPLETE_SNAPSHOT_REQUIRED']);
  assert.equal(incomplete.summary.checkedRows, 0);
  const excessive = await inspectJournalSnapshot(snapshot(), { maxRows: 1 });
  assert.deepEqual(codes(excessive), ['ROW_LIMIT_EXCEEDED']);
  assert.equal(excessive.summary.checkedRows, 0);
  const exhausted = snapshot();
  exhausted.journals[0].version = Number.MAX_SAFE_INTEGER;
  assert.ok(codes(await inspectJournalSnapshot(exhausted)).includes('DAY_VERSION_EXHAUSTED'));
  for (const value of [null, {}, { journals: 'bad' }]) {
    assert.equal((await inspectJournalSnapshot(value)).status, 'blocked');
  }
});

test('preflight captures caller material before awaiting its actual reader', async () => {
  const input = snapshot();
  const pending = inspectJournalSnapshot(input);
  input.account.status = 'disabled';
  input.journals[0].ownerId = 'synthetic_changed';
  input.journals[0].text = null;
  assert.equal((await pending).status, 'eligible_for_review');
  assert.equal(input.account.status, 'disabled');
  assert.equal(input.journals[0].text, null);
});

test('preflight CLI inspects an explicit local file and gives bounded, sanitized failures', () => {
  const root = path.resolve(__dirname, '..');
  const cli = path.join(root, 'tools/week2-integration/journal-preflight.js');
  const file = path.join(root, 'tools/week2-integration/fixtures/journal-preflight.synthetic.json');
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 5000 });
  const good = run('--input', file);
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).status, 'eligible_for_review');
  for (const [args, code] of [
    [['--input', file, '--max-rows', '1'], 'ROW_LIMIT_EXCEEDED'],
    [['--input', path.join(root, 'README.md')], 'INPUT_JSON_INVALID'],
    [['--input', 'PRIVATE_NONEXISTENT_SOURCE_NAME'], 'INPUT_FILE_UNREADABLE'],
    [['--unknown', 'PRIVATE_ARGUMENT'], 'INPUT_ARGUMENTS_INVALID'],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).findings[0].code, code);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /PRIVATE_|SIMULATED preflight writing|synthetic_preflight_owner/,
    );
  }
});

test('preflight CLI rejects damaged UTF-8 instead of checking silently replaced private text', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-preflight-'));
  const file = path.join(directory, 'PRIVATE_DAMAGED_SNAPSHOT.json');
  t.after(() => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  });
  const cli = path.resolve(__dirname, '../tools/week2-integration/journal-preflight.js');
  const input = snapshot();
  const marker = 'PRIVATE_BAD_ENCODING_MARKER';
  input.journals[0].text = marker;
  const encoded = Buffer.from(JSON.stringify(input));
  const offset = encoded.indexOf(marker);
  assert.ok(offset > 0);
  for (const bytes of [[0xff], [0xe4], [0xc0, 0xaf], [0xed, 0xa0, 0x80]]) {
    const damaged = Buffer.concat([
      encoded.subarray(0, offset),
      Buffer.from(bytes),
      encoded.subarray(offset + marker.length),
    ]);
    fs.writeFileSync(file, damaged);
    const result = spawnSync(process.execPath, [cli, '--input', file], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).findings[0].code, 'INPUT_ENCODING_INVALID');
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_|synthetic_preflight_owner/);
    assert.deepEqual(fs.readFileSync(file), damaged);
  }
});

test('preflight CLI preserves valid Unicode and accepts a UTF-8 BOM at the exact file limit', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-preflight-'));
  const file = path.join(directory, 'synthetic-snapshot.json');
  t.after(() => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  });
  const cli = path.resolve(__dirname, '../tools/week2-integration/journal-preflight.js');
  const run = (source) =>
    spawnSync(process.execPath, [cli, '--input', source], { encoding: 'utf8', timeout: 5000 });
  const input = snapshot();
  input.journals[0].text = '合成备份😀\uFFFD';
  const encoded = Buffer.from('\uFEFF' + JSON.stringify(input));
  const maximum = Buffer.concat([encoded, Buffer.alloc(8 * 1024 * 1024 - encoded.length, 0x20)]);
  fs.writeFileSync(file, maximum);
  const accepted = run(file);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).status, 'eligible_for_review');
  assert.doesNotMatch(accepted.stdout + accepted.stderr, /合成备份|synthetic_preflight_owner/);
  assert.deepEqual(fs.readFileSync(file), maximum);
  fs.appendFileSync(file, ' ');
  const oversized = run(file);
  assert.equal(oversized.status, 2, oversized.stderr);
  assert.equal(JSON.parse(oversized.stdout).findings[0].code, 'INPUT_FILE_LIMIT');
  const nonFile = run(directory);
  assert.equal(nonFile.status, 2, nonFile.stderr);
  assert.equal(JSON.parse(nonFile.stdout).findings[0].code, 'INPUT_FILE_LIMIT');
});
