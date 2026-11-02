// Read only this invocation's platform context. Never merge identity from the
// process environment: reused function instances can retain another caller.
function readInvocationIdentity(context) {
  let fresh = {};
  try {
    if (typeof context?.environment === 'string') {
      fresh = JSON.parse(context.environment);
    } else if (typeof context?.environ === 'string') {
      fresh = {};
      for (const pair of context.environ.split(';')) {
        const index = pair.indexOf('=');
        if (index < 1) {
          continue;
        }
        const key = pair.slice(0, index);
        if (!['WX_APPID', 'WX_OPENID', 'TCB_ENV', 'SCF_NAMESPACE', 'TCB_SOURCE'].includes(key)) {
          continue;
        }
        if (Object.hasOwn(fresh, key)) {
          return {};
        }
        fresh[key] = pair.slice(index + 1);
      }
    } else {
      return {};
    }
    if (!fresh || typeof fresh !== 'object' || Array.isArray(fresh)) {
      return {};
    }
    const pick = (key) => (typeof fresh[key] === 'string' ? fresh[key] : undefined);
    return {
      APPID: pick('WX_APPID'),
      OPENID: pick('WX_OPENID'),
      ENV: pick('TCB_ENV') || pick('SCF_NAMESPACE') || context.namespace,
      SOURCE: pick('TCB_SOURCE'),
      identityFromCurrentInvocation: true,
    };
  } catch {
    return {};
  }
}
module.exports = { readInvocationIdentity };
