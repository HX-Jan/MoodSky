// Sanitized share-link diagnostics for test builds only.
//
// Purpose: let an independent tester prove on real devices that a shared
// path carries no sender-private data and that a receiving page loads from
// the receiver's own session. Every entry is keys-and-enums only; values of
// unexpected parameters are never recorded. Logging is dead code unless a
// test build opts in through `shareDiagnostics: true`, and it stays off in
// production profile builds even then.
const ALLOWED_KEYS = Object.freeze(['fromShare', 'date', 'month', 'days', 'view']);
const SAFE_VALUES = Object.freeze({
  fromShare: (value) => value === 'page',
  date: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
  month: (value) => /^\d{4}-\d{2}$/.test(value),
  days: (value) => ['7', '30', '90'].includes(value),
  view: (value) => ['suggestions', 'history'].includes(value),
});
const SHA_PATTERN = /^[a-f0-9]{40}$/;

function diagnosticsEnabled(config) {
  return !!config && config.shareDiagnostics === true && config.releaseProfile !== 'production';
}

function diagnosticsContext(config) {
  const buildCommit = typeof config?.buildCommit === 'string' ? config.buildCommit : '';
  return {
    buildSha: SHA_PATTERN.test(buildCommit) ? buildCommit : 'unknown',
    environmentLabel: 'test',
    timestamp: new Date().toISOString(),
  };
}

function emit(entry) {
  try {
    console.log('[share-diagnostics] ' + JSON.stringify(entry));
  } catch (_error) {
    // Diagnostics must never break sharing or navigation.
  }
}

function classifyOptions(options) {
  const names = [];
  const unexpectedKeys = [];
  const allowed = {};
  for (const key of Object.keys(options || {})) {
    names.push(key);
    if (ALLOWED_KEYS.includes(key)) {
      allowed[key] = options[key];
    } else {
      unexpectedKeys.push(key);
    }
  }
  return { names, allowed, allowedKeys: Object.keys(allowed), unexpectedKeys };
}

function safePairs(pairs) {
  const kept = [];
  const unexpectedKeys = [];
  for (const pair of pairs) {
    const [key, rawValue = ''] = pair.split('=');
    let decoded = rawValue;
    try {
      decoded = decodeURIComponent(rawValue);
    } catch (_error) {
      unexpectedKeys.push(key);
      continue;
    }
    if (ALLOWED_KEYS.includes(key) && SAFE_VALUES[key]?.(decoded)) {
      kept.push(key + '=' + rawValue);
    } else {
      unexpectedKeys.push(key);
    }
  }
  return { kept, unexpectedKeys };
}

function redactPath(path) {
  const stripped = String(path || '').replace(/^\//, '');
  const [route, query = ''] = stripped.split('?');
  const { kept, unexpectedKeys } = safePairs(query ? query.split('&').filter(Boolean) : []);
  return {
    route,
    safePath: '/' + route + (kept.length ? '?' + kept.join('&') : ''),
    queryKeys: [...kept.map((pair) => pair.split('=')[0]), ...unexpectedKeys],
    unexpectedKeys,
  };
}

function logShareSend(config, { path }) {
  if (!diagnosticsEnabled(config)) {
    return;
  }
  try {
    const { route, safePath, queryKeys, unexpectedKeys } = redactPath(path);
    const entry = {
      event: 'share_send',
      route,
      safePath,
      queryKeys,
      ...diagnosticsContext(config),
    };
    if (unexpectedKeys.length) {
      entry.unexpectedKeyCount = unexpectedKeys.length;
      entry.unexpectedKeys = unexpectedKeys;
    }
    emit(entry);
  } catch (_error) {
    // Diagnostics must never break sharing or navigation.
  }
}

function logShareReceive(config, { route, options, sessionResolution }) {
  if (!diagnosticsEnabled(config)) {
    return;
  }
  try {
    const { names, unexpectedKeys } = classifyOptions(options);
    const entry = {
      event: 'share_receive',
      route,
      optionKeys: names,
      fromShare: options?.fromShare === 'page',
      sessionResolution,
      ...diagnosticsContext(config),
    };
    if (unexpectedKeys.length) {
      entry.unexpectedKeyCount = unexpectedKeys.length;
      entry.unexpectedKeys = unexpectedKeys;
    }
    emit(entry);
  } catch (_error) {
    // Diagnostics must never break sharing or navigation.
  }
}

module.exports = {
  ALLOWED_KEYS,
  diagnosticsEnabled,
  logShareReceive,
  logShareSend,
  redactPath,
};
