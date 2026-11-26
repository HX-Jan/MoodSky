const { AppError } = require('../shared/result');
const { digest, same, sessionScope } = require('./config');
const { createProductionAccounts } = require('./accounts');
const fail = (message, code = 'CONFLICT') => {
  throw new AppError(code, message);
};
const TTL = 7 * 86400000;
const CHALLENGE_TTL = 5 * 60000;
const ACCOUNT = /^acct_[a-f0-9]{64}$/;
const PHONE_LABEL = /^1[3-9]\d\*{4}\d{4}$/;

// Only a server-verified phone code selects an account. Decision tickets are
// short-lived, signed, and bound to that phone, WeChat and prior account.
function createPhoneLogin({ db, config, now, exchangePhone }) {
  const accounts = createProductionAccounts({ db, config, now });
  const phoneKey = (value) => digest(config.identityKey, 'verified-phone-v1', value);
  function sign(kind, value) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return body + '.' + digest(config.sessionKey, kind, body);
  }
  function read(kind, token, openid) {
    if (typeof token !== 'string' || !token || token.length > 2048) {
      fail('请重新授权手机号。', 'UNAUTHENTICATED');
    }
    const [body, signature, extra] = token.split('.');
    if (!body || extra !== undefined || !same(signature, digest(config.sessionKey, kind, body))) {
      fail('请重新授权手机号。', 'UNAUTHENTICATED');
    }
    let value;
    try {
      value = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      fail('请重新授权手机号。', 'UNAUTHENTICATED');
    }
    if (
      !same(value?.wx, phoneKey(openid)) ||
      !Number.isSafeInteger(value?.expires) ||
      value.expires <= now().getTime()
    ) {
      fail('手机号授权已过期，请重新验证。', 'UNAUTHENTICATED');
    }
    return value;
  }
  async function resolve(openid, token) {
    const value = read('phone-session-v1', token, openid);
    if (!ACCOUNT.test(value.ownerId)) {
      fail('请重新授权手机号。', 'UNAUTHENTICATED');
    }
    const row = (await db.collection('accounts').doc(value.ownerId).get()).data;
    if (
      !row ||
      row.identityKind !== 'wechat-hmac-v1' ||
      !['active', 'disabled'].includes(row.status)
    ) {
      fail('账号不可用。', 'UNAUTHENTICATED');
    }
    return {
      id: value.ownerId,
      status: row.status,
      ...(PHONE_LABEL.test(value.phoneLabel) ? { phoneLabel: value.phoneLabel } : {}),
    };
  }
  function checkedMapping(mapping, indexId) {
    if (
      mapping &&
      (mapping.identityKind !== 'verified-phone-index-v1' ||
        mapping.openid !== indexId ||
        mapping.status !== 'mapping' ||
        !ACCOUNT.test(mapping.ownerId))
    ) {
      fail('手机号关联状态尚未就绪，请稍后重试。');
    }
    return mapping;
  }
  function challenge(openid, key, ownerId, purpose, phoneLabel) {
    return {
      authenticated: false,
      nextStep: purpose,
      phoneLabel,
      phoneTicket: sign('phone-decision-v1', {
        wx: phoneKey(openid),
        key,
        previousOwnerId: ownerId,
        purpose,
        phoneLabel,
        expires: now().getTime() + CHALLENGE_TTL,
      }),
    };
  }
  async function session(openid, ownerId, phoneLabel) {
    return {
      ...(await accounts.session(ownerId)),
      phoneLabel,
      phoneSession: sign('phone-session-v1', {
        ownerId,
        wx: phoneKey(openid),
        phoneLabel,
        expires: now().getTime() + TTL,
      }),
    };
  }
  async function decide(openid, payload) {
    const { mode, ticket, confirm } = payload;
    if (Object.keys(payload).length !== 3 || confirm !== (mode === 'link' ? 'LINK' : 'REGISTER')) {
      fail('请确认账号操作。', 'INVALID_INPUT');
    }
    const value = read('phone-decision-v1', ticket, openid);
    if (
      value.purpose !== mode ||
      !/^[a-f0-9]{64}$/.test(value.key) ||
      !ACCOUNT.test(value.previousOwnerId) ||
      !PHONE_LABEL.test(value.phoneLabel)
    ) {
      fail('请重新授权手机号。', 'UNAUTHENTICATED');
    }
    const ownerId = await db.runTransaction(async (tx) => {
      const indexId = 'phone_' + value.key;
      const ref = tx.collection('accounts').doc(indexId);
      const mapping = checkedMapping((await ref.get()).data, indexId);
      const write = (id, previousOwnerId) =>
        ref.set({
          data: {
            openid: indexId,
            identityKind: 'verified-phone-index-v1',
            status: 'mapping',
            ownerId: id,
            ...(previousOwnerId ? { previousOwnerId } : {}),
          },
        });
      if (mode === 'link') {
        const primary = await accounts.resolveInTransaction(tx, openid, false);
        if (
          primary?.id !== value.previousOwnerId ||
          primary.status !== 'active' ||
          (mapping && mapping.ownerId !== primary.id)
        ) {
          fail('账号关联已变化，请重新登录；记录不会自动合并。');
        }
        const row = (await tx.collection('accounts').doc(primary.id).get()).data;
        if (row.phoneKey && row.phoneKey !== value.key) {
          fail('此账号已关联其他手机号，请重新登录。');
        }
        await write(primary.id);
        await tx
          .collection('accounts')
          .doc(primary.id)
          .update({ data: { phoneKey: value.key } });
        return primary.id;
      }
      if (!mapping) {
        fail('账号状态已变化，请重新授权。');
      }
      const owner = (await tx.collection('accounts').doc(mapping.ownerId).get()).data;
      // Recover a lost confirmation without creating another generation.
      if (owner?.status === 'active' && mapping.previousOwnerId === value.previousOwnerId) {
        return mapping.ownerId;
      }
      if (
        mapping.ownerId !== value.previousOwnerId ||
        !(await accounts.canRegisterOwner(tx, mapping.ownerId))
      ) {
        fail('账号状态已变化，请重新授权。');
      }
      const identity = 'phone:' + value.key;
      const current = await accounts.resolveInTransaction(tx, identity, false);
      let next;
      if (!current) {
        // A formerly linked WeChat account becomes a new independent phone root.
        next = (await accounts.resolveInTransaction(tx, identity, true)).id;
      } else if (current.id === mapping.ownerId && current.status === 'disabled') {
        next = await accounts.registerInTransaction(
          tx,
          identity,
          sessionScope(config, mapping.ownerId),
        );
      } else {
        fail('账号状态已变化，请重新授权。');
      }
      await write(next, mapping.ownerId);
      return next;
    });
    return session(openid, ownerId, value.phoneLabel);
  }
  async function login(openid, payload) {
    if (['link', 'register'].includes(payload.mode)) {
      return decide(openid, payload);
    }
    if (
      Object.keys(payload).length !== 2 ||
      !['bind', 'login'].includes(payload.mode) ||
      typeof payload.code !== 'string' ||
      !payload.code ||
      payload.code.length > 512
    ) {
      fail('请重新授权手机号。', 'INVALID_INPUT');
    }
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
    const phoneLabel = info.purePhoneNumber.slice(0, 3) + '****' + info.purePhoneNumber.slice(-4);
    const outcome = await db.runTransaction(async (tx) => {
      const indexId = 'phone_' + key;
      const ref = tx.collection('accounts').doc(indexId);
      const mapping = checkedMapping((await ref.get()).data, indexId);
      const save = (ownerId) =>
        ref.set({
          data: {
            openid: indexId,
            identityKind: 'verified-phone-index-v1',
            status: 'mapping',
            ownerId,
          },
        });
      if (payload.mode === 'login' && mapping) {
        const owner = (await tx.collection('accounts').doc(mapping.ownerId).get()).data;
        if (owner?.status === 'disabled') {
          if (!(await accounts.canRegisterOwner(tx, mapping.ownerId))) {
            fail('账号已注销，请稍后重试。', 'ACCOUNT_DISABLED');
          }
          return challenge(openid, key, mapping.ownerId, 'register', phoneLabel);
        }
        return { ownerId: mapping.ownerId };
      }
      const primary = await accounts.resolveInTransaction(tx, openid, false);
      if (payload.mode === 'bind') {
        if (primary?.status !== 'active') {
          fail('请先使用微信登录。', 'UNAUTHENTICATED');
        }
        const row = (await tx.collection('accounts').doc(primary.id).get()).data;
        if (row.phoneKey && row.phoneKey !== key) {
          fail('此微信已关联其他手机号，暂不支持换绑。');
        }
        if (mapping && mapping.ownerId !== primary.id) {
          fail('此手机号已有账号，请使用手机号登录；记录不会合并。');
        }
        if (!mapping) {
          await save(primary.id);
        }
        await tx
          .collection('accounts')
          .doc(primary.id)
          .update({ data: { phoneKey: key } });
        return { ownerId: primary.id };
      }
      if (primary?.status === 'active') {
        const row = (await tx.collection('accounts').doc(primary.id).get()).data;
        if (!row.phoneKey) {
          return challenge(openid, key, primary.id, 'link', phoneLabel);
        }
      }
      // A new user needs one native authorization, without a preliminary login.
      const phoneAccount = await accounts.resolveInTransaction(tx, 'phone:' + key, true);
      if (phoneAccount.status !== 'active') {
        fail('手机号关联状态已变化，请重新登录。');
      }
      await save(phoneAccount.id);
      return { ownerId: phoneAccount.id };
    });
    return outcome.nextStep ? outcome : session(openid, outcome.ownerId, phoneLabel);
  }
  return { login, resolve };
}
module.exports = { createPhoneLogin };
