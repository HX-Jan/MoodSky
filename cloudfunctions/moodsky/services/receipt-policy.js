const { createHmac, timingSafeEqual } = require('node:crypto');
const { API_VERSION } = require('../shared/constants');
const { AppError } = require('../shared/result');
const CANONICAL_VERSION = 'original-json-v1';
const keyIdValid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + Array.from(value, canonical).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  }
  throw new AppError('INVALID_INPUT', '请求必须包含可序列化的原始 JSON 输入。');
}
function isoTime(value) {
  if (typeof value !== 'string') {
    return NaN;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}

function createReceiptPolicy({ activeKeyId, keys: inputKeys, maxAgeMs }) {
  if (!keyIdValid(activeKeyId) || !inputKeys || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new TypeError(
      'Receipt policy requires explicit key IDs, secret material and a reviewed lifetime.',
    );
  }
  const keys = new Map();
  for (const [id, material] of Object.entries(inputKeys)) {
    if (!keyIdValid(id) || !Buffer.isBuffer(material) || material.length < 32) {
      throw new TypeError(
        'Receipt HMAC keys must be server-provided buffers of at least 32 bytes.',
      );
    }
    keys.set(id, Buffer.from(material));
  }
  if (!keys.has(activeKeyId)) {
    throw new TypeError('Active receipt key is unavailable.');
  }
  return {
    bind(action, payload, instant) {
      const acceptedAt = instant.getTime();
      if (!Number.isSafeInteger(acceptedAt) || !Number.isSafeInteger(acceptedAt + maxAgeMs)) {
        throw new TypeError('Invalid server receipt clock.');
      }
      const encoded = canonical({
        canonicalVersion: CANONICAL_VERSION,
        apiVersion: API_VERSION,
        action,
        payload,
      });
      const digestFor = (keyId) =>
        createHmac('sha256', keys.get(keyId)).update(encoded).digest('hex');
      const stamp = {
        canonicalVersion: CANONICAL_VERSION,
        keyId: activeKeyId,
        digest: digestFor(activeKeyId),
        acceptedAt: instant.toISOString(),
        expiresAt: new Date(acceptedAt + maxAgeMs).toISOString(),
      };
      return {
        stamp,
        matches(receipt) {
          if (
            !receipt ||
            receipt.state === 'expired' ||
            receipt.canonicalVersion !== CANONICAL_VERSION ||
            !keys.has(receipt.keyId) ||
            typeof receipt.digest !== 'string' ||
            !/^[a-f0-9]{64}$/.test(receipt.digest)
          ) {
            return false;
          }
          const created = isoTime(receipt.acceptedAt);
          const expires = isoTime(receipt.expiresAt);
          if (
            !Number.isFinite(created) ||
            !Number.isFinite(expires) ||
            created > acceptedAt ||
            expires <= created ||
            expires - created > maxAgeMs ||
            acceptedAt >= expires
          ) {
            return false;
          }
          return timingSafeEqual(
            Buffer.from(receipt.digest, 'hex'),
            Buffer.from(digestFor(receipt.keyId), 'hex'),
          );
        },
      };
    },
  };
}
module.exports = { createReceiptPolicy, CANONICAL_VERSION };
