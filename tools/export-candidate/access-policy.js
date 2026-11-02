// Pure lifecycle policy proposal. Inputs must come from trusted server records.
// No tokens are minted here; a plain object returned by planClaim is NOT a credential.
const { AppError } = require('../../cloudfunctions/moodsky/shared/result');
const { LIMITS } = require('../../cloudfunctions/moodsky/shared/constants');
const DOMAINS = ['journals', 'favorites', 'tasks', 'preferences', 'decorations'];
const STATES = ['pending', 'processing', 'ready', 'expired', 'failed'];
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const forbidden = () => {
  throw new AppError('FORBIDDEN', '当前无法领取此导出。');
};
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return NaN;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
function revisions(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === DOMAINS.length &&
    DOMAINS.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(value, key) &&
        Number.isSafeInteger(value[key]) &&
        value[key] >= 0,
    )
  );
}
const sameRevisions = (a, b) =>
  revisions(a) && revisions(b) && DOMAINS.every((key) => a[key] === b[key]);
function context({ actorId, account, job, sourceRevisions, now }) {
  if (!validId(actorId) || !account || account.id !== actorId) {
    throw new AppError('UNAUTHENTICATED', '请先登录。');
  }
  if (account.status !== 'active') {
    throw new AppError('ACCOUNT_DISABLED', '账号已停用。');
  }
  if (
    !job ||
    job.ownerId !== actorId ||
    !validId(job.id) ||
    !STATES.includes(job.state) ||
    !['json', 'markdown'].includes(job.format) ||
    !Number.isSafeInteger(account.exportEpoch) ||
    account.exportEpoch < 0 ||
    !Number.isSafeInteger(job.accountEpoch) ||
    job.accountEpoch < 0 ||
    (job.revoked !== undefined && typeof job.revoked !== 'boolean') ||
    !revisions(job.sourceRevisions) ||
    !revisions(sourceRevisions)
  ) {
    return forbidden();
  }
  const time = now instanceof Date ? now.getTime() : NaN;
  const createdAt = instant(job.createdAt);
  if (!Number.isFinite(time) || !Number.isFinite(createdAt) || createdAt > time) {
    return forbidden();
  }
  const invalidated =
    account.exportEpoch !== job.accountEpoch ||
    !sameRevisions(job.sourceRevisions, sourceRevisions) ||
    job.revoked === true;
  let state = invalidated ? 'expired' : job.state;
  let fileExpiresAt = NaN;
  if (job.state === 'ready') {
    const readyAt = instant(job.readyAt);
    fileExpiresAt = instant(job.expiresAt);
    if (
      typeof job.fileId !== 'string' ||
      !job.fileId ||
      job.fileId.length > 2048 ||
      /[\u0000-\u001f]/.test(job.fileId) ||
      !Number.isFinite(readyAt) ||
      readyAt < createdAt ||
      readyAt > time ||
      !Number.isFinite(fileExpiresAt) ||
      fileExpiresAt <= readyAt ||
      fileExpiresAt - readyAt > LIMITS.exportFileHours * 3600000
    ) {
      return forbidden();
    }
    if (time >= fileExpiresAt) {
      state = 'expired';
    }
  }
  return { state, time, fileExpiresAt };
}
function exportStatus(input) {
  const { state } = context(input);
  return { jobId: input.job.id, state, format: input.job.format };
}
function planClaim(input) {
  const checked = context(input);
  if (['pending', 'processing'].includes(checked.state)) {
    throw new AppError('CONFLICT', '导出尚未就绪。');
  }
  if (checked.state !== 'ready') {
    return forbidden();
  }
  const expiresAt = Math.min(
    checked.fileExpiresAt,
    checked.time + LIMITS.exportCredentialSeconds * 1000,
  );
  return {
    scope: 'export_read',
    jobId: input.job.id,
    ownerId: input.actorId,
    accountEpoch: input.account.exportEpoch,
    sourceRevisions: Object.fromEntries(DOMAINS.map((key) => [key, input.sourceRevisions[key]])),
    issuedAt: new Date(checked.time).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}
function authorizeRead(input, credential) {
  const checked = context(input);
  if (
    checked.state !== 'ready' ||
    !credential ||
    credential.scope !== 'export_read' ||
    credential.revoked === true ||
    (credential.revoked !== undefined && typeof credential.revoked !== 'boolean') ||
    credential.ownerId !== input.actorId ||
    credential.jobId !== input.job.id ||
    credential.accountEpoch !== input.account.exportEpoch ||
    !sameRevisions(credential.sourceRevisions, input.sourceRevisions)
  ) {
    return forbidden();
  }
  const issuedAt = instant(credential.issuedAt);
  const expiresAt = instant(credential.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > checked.time ||
    issuedAt < instant(input.job.readyAt) ||
    expiresAt <= issuedAt ||
    checked.time >= expiresAt ||
    expiresAt > checked.fileExpiresAt ||
    expiresAt - issuedAt > LIMITS.exportCredentialSeconds * 1000
  ) {
    return forbidden();
  }
  // Internal result for a future controlled reader; never an API response or public URL.
  return { fileId: input.job.fileId };
}
module.exports = { exportStatus, planClaim, authorizeRead };
