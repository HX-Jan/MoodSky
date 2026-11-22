const { AppError } = require('../shared/result');
const { digest, same } = require('./config');
const { createProductionAccounts } = require('./accounts');
const fail = (message, code = 'CONFLICT') => {
  throw new AppError(code, message);
};
const TTL = 7 * 86400000;

// Only the server consumes the one-time WeChat phone code. Neither a submitted
// phone number nor a client-supplied owner ID can select an account.
function createPhoneLogin({ db, config, now, exchangePhone }) {
  const accounts = createProductionAccounts({ db, config, now });
  const phoneKey = (number) => digest(config.identityKey, 'verified-phone-v1', number);
  function issue(openid, ownerId) {
    const body = Buffer.from(
      JSON.stringify({ ownerId, wx: phoneKey(openid), expires: now().getTime() + TTL }),
    ).toString('base64url');
    return body + '.' + digest(config.sessionKey, 'phone-session-v1', body);
  }
  async function resolve(openid, token) {
    if (typeof token !== 'string' || token.length > 2048) {
      fail('请重新验证手机号。', 'UNAUTHENTICATED');
    }
    const [body, signature, extra] = token.split('.');
    if (
      extra !== undefined ||
      !same(signature, digest(config.sessionKey, 'phone-session-v1', body))
    ) {
      fail('请重新验证手机号。', 'UNAUTHENTICATED');
    }
    let value;
    try {
      value = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      fail('请重新验证手机号。', 'UNAUTHENTICATED');
    }
    if (
      !/^acct_[a-f0-9]{64}$/.test(value?.ownerId) ||
      !same(value.wx, phoneKey(openid)) ||
      !Number.isSafeInteger(value.expires) ||
      value.expires <= now().getTime()
    ) {
      fail('手机号登录已过期，请重新验证。', 'UNAUTHENTICATED');
    }
    const row = (await db.collection('accounts').doc(value.ownerId).get()).data;
    if (!row || !['active', 'disabled'].includes(row.status)) {
      fail('账号不可用。', 'UNAUTHENTICATED');
    }
    return { id: value.ownerId, status: row.status };
  }
  async function login(openid, payload) {
    if (
      Object.keys(payload).length !== 2 ||
      !['bind', 'login'].includes(payload.mode) ||
      typeof payload.code !== 'string' ||
      !payload.code ||
      payload.code.length > 512
    ) {
      fail('请重新授权手机号。', 'INVALID_INPUT');
    }
    const primary = await accounts.resolve(openid, false);
    if (payload.mode === 'bind' && (!primary || primary.status !== 'active')) {
      fail('请先使用微信登录。', 'UNAUTHENTICATED');
    }
    const primaryRow = primary
      ? (await db.collection('accounts').doc(primary.id).get()).data
      : null;
    // Establish an explicit primary phone before allowing a second account, so
    // choosing the WeChat phone cannot accidentally create a duplicate account.
    let result;
    try {
      result = await exchangePhone(payload.code);
    } catch {
      fail('手机号验证失败，请重新授权。', 'UNAUTHENTICATED');
    }
    const info = result?.phoneInfo;
    if (!info || String(info.countryCode) !== '86' || !/^1[3-9]\d{9}$/.test(info.purePhoneNumber)) {
      fail('目前仅支持中国大陆手机号。', 'INVALID_INPUT');
    }
    const key = phoneKey('+86' + info.purePhoneNumber);
    // Deterministic phone roots use the existing account lifecycle and fences.
    const ownerId = await db.runTransaction(async (tx) => {
      // Reserved phone_ documents are identity indexes, never login accounts.
      // Reuse the server-only account collection and its existing read denial.
      const indexId = 'phone_' + key;
      const ref = tx.collection('accounts').doc(indexId);
      const mapping = (await ref.get()).data;
      if (
        mapping &&
        (mapping.identityKind !== 'verified-phone-index-v1' ||
          mapping.openid !== indexId ||
          !/^acct_[a-f0-9]{64}$/.test(mapping.ownerId))
      ) {
        fail('手机号关联状态尚未就绪，请稍后重试。');
      }
      const saveMapping = (ownerId) =>
        ref.set({
          data: {
            openid: indexId,
            identityKind: 'verified-phone-index-v1',
            status: 'mapping',
            ownerId,
          },
        });
      // A verified existing phone account does not depend on the lifecycle of
      // an unrelated WeChat account. It can also be recovered on another WeChat.
      if (payload.mode === 'login' && mapping) {
        return mapping.ownerId;
      }
      if (!primary || primary.status !== 'active') {
        fail('请先微信登录，在「账号与数据」中绑定本微信使用的手机号。');
      }
      const accountRef = tx.collection('accounts').doc(primary.id);
      const row = (await accountRef.get()).data;
      if (row?.status !== 'active') {
        fail('账号已注销。', 'ACCOUNT_DISABLED');
      }
      if (payload.mode === 'bind') {
        if (row.phoneKey && row.phoneKey !== key) {
          fail('此微信已绑定其他手机号，暂不支持更换绑定。');
        }
        if (mapping && mapping.ownerId !== primary.id) {
          fail('此手机号已有账号，请使用手机号登录；不会合并私人记录。');
        }
        if (!mapping) {
          await saveMapping(primary.id);
        }
        await accountRef.update({ data: { phoneKey: key } });
        return primary.id;
      }
      if (!row.phoneKey || row.phoneKey !== primaryRow?.phoneKey) {
        fail('请先微信登录，在「账号与数据」中绑定本微信使用的手机号。');
      }
      const id =
        key === row.phoneKey
          ? primary.id
          : (await accounts.resolveInTransaction(tx, 'phone:' + key, true)).id;
      await saveMapping(id);
      return id;
    });
    const session = await accounts.session(ownerId); // Disabled mappings never resurrect data.
    return { ...session, phoneSession: issue(openid, ownerId) };
  }
  return { login, resolve };
}
module.exports = { createPhoneLogin };
