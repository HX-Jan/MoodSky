const test = require('node:test');
const assert = require('node:assert/strict');
const { formatExport } = require('../tools/export-candidate/formatter');
const { syntheticSnapshot } = require('../tools/export-candidate/fixture');
const options = (format = 'json') => ({
  format,
  accountId: 'synthetic_export_owner',
  exportedAt: '2026-10-18T01:00:00.000Z',
  maxRecords: 100,
  maxBytes: 1048576,
});
const invalid = (fn, code = 'INVALID_INPUT') => assert.throws(fn, { code });

test('export formatter projects only the authenticated synthetic snapshot and strips internal fields', () => {
  const snapshot = syntheticSnapshot();
  snapshot.openid = 'SYNTHETIC_SECRET_OPENID';
  snapshot.downloadToken = 'SYNTHETIC_SECRET_TOKEN';
  snapshot.journals[0].internalSecret = 'SYNTHETIC_SECRET_FIELD';
  const original = JSON.stringify(snapshot);
  const result = formatExport(snapshot, options());
  const document = JSON.parse(result.content);
  assert.equal(document.exportVersion, '1.0-candidate');
  assert.equal(document.data.journals.length, 2);
  assert.equal(document.data.journals[0].date, '2026-10-17');
  assert.equal(document.data.journals[1].text, 'SIMULATED · 今天的合成记录。');
  assert.doesNotMatch(
    result.content,
    /ownerId|openid|synthetic_export_owner|SYNTHETIC_SECRET|sourceRevision/,
  );
  assert.equal(JSON.stringify(snapshot), original);
  assert.equal(result.byteLength, Buffer.byteLength(result.content, 'utf8'));
});

test('export formatter excludes deleted data and converts live decoration links to dates', () => {
  const snapshot = syntheticSnapshot();
  snapshot.journals[2].text = 'SYNTHETIC DELETED BODY';
  const output = JSON.parse(formatExport(snapshot, options()).content);
  assert.doesNotMatch(JSON.stringify(output), /DELETED BODY|synthetic_deleted|targetEntryId/);
  assert.deepEqual(output.data.monthDecorations[0].stickers, [
    { stickerId: 'synthetic_sticker', targetDate: '2026-10-18' },
  ]);
});

test('export formatter rejects contradictory live and deleted generations before emitting private text', () => {
  for (const change of [
    (s) => {
      s.journals[2].date = s.journals[0].date;
    },
    (s) => {
      s.journals[2].id = s.journals[0].id;
    },
    (s) => {
      s.journals[2].date = '2026-02-30';
    },
    (s) => {
      s.journals[2].version = 0;
    },
  ]) {
    const snapshot = syntheticSnapshot();
    change(snapshot);
    invalid(() => formatExport(snapshot, options()), 'INVALID_INPUT');
  }
  const tombstone = syntheticSnapshot();
  delete tombstone.journals[2].id;
  assert.equal(JSON.parse(formatExport(tombstone, options()).content).data.journals.length, 2);
});

test('export formatter cannot treat a source owner or disabled account as authorization', () => {
  const snapshot = syntheticSnapshot();
  invalid(
    () => formatExport(snapshot, { ...options(), accountId: 'synthetic_other' }),
    'FORBIDDEN',
  );
  invalid(
    () => formatExport({ ...snapshot, accountStatus: 'disabled' }, options()),
    'ACCOUNT_DISABLED',
  );
  snapshot.favorites[0].ownerId = 'synthetic_other';
  invalid(() => formatExport(snapshot, options()), 'FORBIDDEN');
});

test('export formatter refuses duplicate or malformed sources instead of silently discarding records', () => {
  for (const change of [
    (s) => {
      s.journals.push({ ...s.journals[0], id: 'synthetic_duplicate' });
    },
    (s) => {
      s.journals[0].version = Number.MAX_SAFE_INTEGER + 1;
    },
    (s) => {
      s.journals[0].weather = 'UNAPPROVED';
    },
    (s) => {
      s.journals[0].createdAt = '2026-02-30T00:00:00Z';
    },
    (s) => {
      s.journals[0].createdAt = '2026-10-18T24:00:00Z';
    },
    (s) => {
      s.journals[0].updatedAt = '2026-10-17T00:00:00Z';
    },
    (s) => {
      s.favorites.push({ ...s.favorites[0] });
    },
    (s) => {
      s.taskHistory[0].state = 'available';
    },
    (s) => {
      s.monthDecorations.push({ ...s.monthDecorations[0] });
    },
    (s) => {
      s.sourceRevision = -1;
    },
  ]) {
    const snapshot = syntheticSnapshot();
    change(snapshot);
    invalid(() => formatExport(snapshot, options()));
  }
});

test('export formatter Markdown fences arbitrary writing and escapes external markup in metadata', () => {
  const snapshot = syntheticSnapshot();
  const body =
    'SIMULATED\n```\n<script>alert(1)</script>\n````\n[private link](https://example.invalid)';
  snapshot.journals[0].text = body;
  snapshot.favorites[0].placeName =
    '<img src=x onerror=alert(1)> [click](https://example.invalid)\n# injected';
  const result = formatExport(snapshot, options('markdown'));
  assert.ok(result.content.includes('`````text\n' + body + '\n`````'));
  assert.ok(result.content.includes('&lt;img'));
  assert.ok(result.content.includes('\\[click\\]\\(https://example\\.invalid\\)'));
  assert.ok(result.content.includes(' \\# injected'));
  assert.doesNotMatch(result.content, /<img src/);
  assert.match(result.content, /不提供云端领取、撤销或到期控制/);
});

test('export formatter counts UTF-8 bytes and requires caller-defined candidate limits', () => {
  const snapshot = syntheticSnapshot();
  const result = formatExport(snapshot, options());
  invalid(() => formatExport(snapshot, { ...options(), maxBytes: result.byteLength - 1 }));
  assert.equal(
    formatExport(snapshot, { ...options(), maxBytes: result.byteLength }).byteLength,
    result.byteLength,
  );
  invalid(() => formatExport(snapshot, { ...options(), maxRecords: 1 }));
  invalid(() => formatExport(snapshot, { ...options(), maxBytes: undefined }));
  invalid(() => formatExport(snapshot, options('html')));
});

test('export formatter handles empty sources and preserves absent stored preferences without inventing settings', () => {
  const snapshot = {
    ownerId: 'synthetic_export_owner',
    accountStatus: 'active',
    sourceRevision: 0,
    journals: [],
    favorites: [],
    taskHistory: [],
    preferences: null,
    monthDecorations: [],
  };
  const output = JSON.parse(formatExport(snapshot, options()).content);
  assert.equal(output.data.preferences, null);
  assert.equal(output.data.journals.length, 0);
  assert.match(formatExport(snapshot, options('markdown')).content, /尚无已保存的偏好/);
});

test('export formatter accepts trusted Date timestamps while keeping output deterministic', () => {
  const snapshot = syntheticSnapshot();
  const first = formatExport(snapshot, options());
  snapshot.journals[0].createdAt = new Date(snapshot.journals[0].createdAt);
  assert.equal(formatExport(snapshot, options()).content, first.content);
});
