const test = require('node:test');
const assert = require('node:assert/strict');
const {
  exportStatus,
  planClaim,
  authorizeRead,
} = require('../tools/export-candidate/access-policy');
function fixture() {
  const sourceRevisions = { journals: 3, favorites: 2, tasks: 1, preferences: 1, decorations: 0 };
  return {
    actorId: 'synthetic_actor',
    account: { id: 'synthetic_actor', status: 'active', exportEpoch: 1 },
    sourceRevisions,
    now: new Date('2026-10-18T01:00:00.000Z'),
    job: {
      id: 'synthetic_job',
      ownerId: 'synthetic_actor',
      accountEpoch: 1,
      sourceRevisions: { ...sourceRevisions },
      state: 'ready',
      format: 'json',
      fileId: 'synthetic_private_file',
      createdAt: '2026-10-18T00:00:00.000Z',
      readyAt: '2026-10-18T00:01:00.000Z',
      expiresAt: '2026-10-19T00:01:00.000Z',
      internalSecret: 'SYNTHETIC secret metadata',
    },
  };
}
const forbidden = (fn) => assert.throws(fn, { code: 'FORBIDDEN' });

test('export policy status never exposes a file handle, source vector, identity or internal error', () => {
  const f = fixture();
  assert.deepEqual(exportStatus(f), { jobId: 'synthetic_job', state: 'ready', format: 'json' });
  const original = JSON.stringify(f);
  const planned = planClaim(f);
  assert.equal(planned.expiresAt, '2026-10-18T01:05:00.000Z');
  assert.equal(planned.scope, 'export_read');
  assert.deepEqual(authorizeRead(f, planned), { fileId: 'synthetic_private_file' });
  assert.equal(JSON.stringify(f), original);
});

test('export policy denies disabled accounts and uses one failure for missing/foreign jobs', () => {
  const f = fixture();
  assert.throws(() => exportStatus({ ...f, account: { ...f.account, status: 'disabled' } }), {
    code: 'ACCOUNT_DISABLED',
  });
  for (const job of [null, { ...f.job, ownerId: 'synthetic_other' }]) {
    forbidden(() => exportStatus({ ...f, job }));
  }
  assert.throws(() => exportStatus({ ...f, actorId: 'synthetic_other' }), {
    code: 'UNAUTHENTICATED',
  });
});

test('export policy credentials expire exactly at five minutes and cannot outlive the file', () => {
  const f = fixture();
  const credential = planClaim(f);
  assert.deepEqual(authorizeRead({ ...f, now: new Date('2026-10-18T01:04:59.999Z') }, credential), {
    fileId: 'synthetic_private_file',
  });
  forbidden(() => authorizeRead({ ...f, now: new Date(credential.expiresAt) }, credential));
  const short = { ...f, job: { ...f.job, expiresAt: '2026-10-18T01:01:00.000Z' } };
  assert.equal(planClaim(short).expiresAt, short.job.expiresAt);
  forbidden(() => planClaim({ ...short, now: new Date(short.job.expiresAt) }));
  forbidden(() => planClaim({ ...f, job: { ...f.job, expiresAt: '2026-10-19T00:01:00.001Z' } }));
});

test('export policy invalidates all five source domains and old account epochs at both claim and read', () => {
  const f = fixture();
  const credential = planClaim(f);
  for (const domain of Object.keys(f.sourceRevisions)) {
    const changed = {
      ...f,
      sourceRevisions: { ...f.sourceRevisions, [domain]: f.sourceRevisions[domain] + 1 },
    };
    assert.equal(exportStatus(changed).state, 'expired');
    forbidden(() => planClaim(changed));
    forbidden(() => authorizeRead(changed, credential));
  }
  const reactivated = { ...f, account: { ...f.account, exportEpoch: 2 } };
  assert.equal(exportStatus(reactivated).state, 'expired');
  forbidden(() => authorizeRead(reactivated, credential));
});

test('export policy fails closed for malformed provenance, overlong credentials and revoked capabilities', () => {
  const f = fixture();
  const credential = planClaim(f);
  for (const changed of [
    { ...credential, ownerId: 'synthetic_other' },
    { ...credential, jobId: 'synthetic_other_job' },
    { ...credential, scope: 'cleanup_status' },
    { ...credential, revoked: true },
    { ...credential, revoked: 'true' },
    { ...credential, expiresAt: '2026-10-18T01:05:00.001Z' },
    { ...credential, issuedAt: '2026-10-18T01:00:00.001Z' },
    { ...credential, sourceRevisions: { journals: 3 } },
  ]) {
    forbidden(() => authorizeRead(f, changed));
  }
  forbidden(() => planClaim({ ...f, sourceRevisions: { journals: 3 } }));
  forbidden(() => authorizeRead({ ...f, job: { ...f.job, revoked: true } }, credential));
  forbidden(() => exportStatus({ ...f, now: new Date(NaN) }));
});

test('export policy pending/processing remain unclaimable while failed/expired never produce grants', () => {
  const f = fixture();
  for (const state of ['pending', 'processing']) {
    assert.throws(() => planClaim({ ...f, job: { ...f.job, state } }), { code: 'CONFLICT' });
  }
  for (const state of ['expired', 'failed']) {
    forbidden(() => planClaim({ ...f, job: { ...f.job, state } }));
  }
});

test('export policy treats file references as opaque server handles and rejects malformed revocation flags', () => {
  const f = fixture();
  f.job.fileId = 'cloud://synthetic-environment/private/synthetic-file.json';
  assert.equal(authorizeRead(f, planClaim(f)).fileId, f.job.fileId);
  forbidden(() => planClaim({ ...f, job: { ...f.job, revoked: 'false' } }));
});
