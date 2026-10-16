/*
 * CloudBase Web authentication seam for the data-maintenance console.
 *
 * The browser never supplies uid, OPENID or role in a business request. The
 * CloudBase SDK owns the session and the cloud function resolves the trusted
 * identity again before checking operator_roles. Keeping this seam small makes
 * the first-week demo runnable without putting a CloudBase secret in the repo.
 */
(function registerAuth(root) {
  const API_VERSION = '1';
  const BUSINESS_ERROR_CODES = new Set([
    'INVALID_REQUEST',
    'INVALID_INPUT',
    'API_VERSION_UNSUPPORTED',
    'ACTION_NOT_FOUND',
    'UNAUTHENTICATED',
    'ACCOUNT_DISABLED',
    'FORBIDDEN',
    'CONFLICT',
    'NOT_IMPLEMENTED',
    'CLOUD_NOT_CONFIGURED',
    'NETWORK_ERROR',
    'INVALID_RESPONSE',
    'INTERNAL_ERROR',
  ]);
  const DEFAULT_CONFIG = Object.freeze({
    envId: '',
    region: 'ap-shanghai',
    provider: 'wechat',
    redirectTo: '',
    sdkVersion: '3.x (pin after environment validation)',
  });

  function getAuth(app) {
    if (!app) {
      throw new Error('CloudBase app is not initialized.');
    }
    // Web SDK v3 exposes app.auth; older v2 builds expose app.auth().
    return typeof app.auth === 'function' ? app.auth({ persistence: 'local' }) : app.auth;
  }

  function createCloudBaseApp(cloudbase, config = {}) {
    if (!cloudbase || typeof cloudbase.init !== 'function') {
      throw new Error('CloudBase Web SDK is unavailable.');
    }
    if (!config.envId) {
      throw new Error('Missing CloudBase environment id.');
    }
    return cloudbase.init({
      env: config.envId,
      region: config.region || DEFAULT_CONFIG.region,
      auth: { detectSessionInUrl: true },
    });
  }

  function makeClientError(code, message, requestId, cause) {
    const error = new Error(message || code);
    error.code = code;
    if (requestId) {
      error.requestId = requestId;
    }
    if (cause) {
      error.cause = cause;
    }
    return error;
  }

  function nextRequestId() {
    const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
      return 'admin_' + cryptoObject.randomUUID();
    }
    return 'admin_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function extractEnvelope(result) {
    if (result && result.result && typeof result.result === 'object') {
      return result.result;
    }
    // Some CloudBase SDK builds expose the function result as data.
    if (result && result.data && typeof result.data === 'object') {
      return result.data;
    }
    return result;
  }

  function validateApiEnvelope(result, expectedRequestId) {
    const envelope = extractEnvelope(result);
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw makeClientError('INVALID_RESPONSE', '云函数返回格式无效。', expectedRequestId);
    }
    if (envelope.apiVersion !== API_VERSION) {
      throw makeClientError(
        'INVALID_RESPONSE',
        '云函数返回的接口版本无效。',
        envelope.requestId || expectedRequestId,
      );
    }
    if (
      typeof envelope.requestId !== 'string' ||
      !envelope.requestId ||
      (expectedRequestId && envelope.requestId !== expectedRequestId)
    ) {
      throw makeClientError(
        'INVALID_RESPONSE',
        '云函数返回的请求标识无法关联。',
        envelope.requestId || expectedRequestId,
      );
    }
    if (typeof envelope.ok !== 'boolean') {
      throw makeClientError('INVALID_RESPONSE', '云函数返回缺少成功状态。', envelope.requestId);
    }
    if (envelope.ok) {
      if (Object.prototype.hasOwnProperty.call(envelope, 'error')) {
        throw makeClientError(
          'INVALID_RESPONSE',
          '云函数成功回执包含错误字段。',
          envelope.requestId,
        );
      }
      return envelope;
    }
    const responseError = envelope.error;
    if (
      !responseError ||
      typeof responseError !== 'object' ||
      typeof responseError.code !== 'string' ||
      !responseError.code ||
      typeof responseError.message !== 'string' ||
      !responseError.message
    ) {
      throw makeClientError('INVALID_RESPONSE', '云函数失败回执格式无效。', envelope.requestId);
    }
    const code = BUSINESS_ERROR_CODES.has(responseError.code)
      ? responseError.code
      : 'INTERNAL_ERROR';
    throw makeClientError(code, responseError.message, envelope.requestId);
  }

  function createClient({ cloudbase, config = {}, storage, location, navigate } = {}) {
    const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
    let app = null;
    let auth = null;
    const clear = () => {
      if (storage && typeof storage.removeItem === 'function') {
        storage.removeItem('moodsky.admin.session');
      }
    };
    const ensure = () => {
      if (!app) {
        app = createCloudBaseApp(cloudbase, resolvedConfig);
        auth = getAuth(app);
      }
      return { app, auth };
    };

    return {
      config: resolvedConfig,
      isConfigured: Boolean(resolvedConfig.envId && cloudbase),
      async session() {
        const { auth: currentAuth } = ensure();
        if (typeof currentAuth.getSession !== 'function') {
          return null;
        }
        const result = await currentAuth.getSession();
        if (result && result.error) {
          throw result.error;
        }
        return result && result.data ? result.data : null;
      },
      async signIn() {
        const { auth: currentAuth } = ensure();
        if (typeof currentAuth.signInWithOAuth !== 'function') {
          throw new Error('This CloudBase SDK does not expose OAuth login.');
        }
        const result = await currentAuth.signInWithOAuth({
          provider: resolvedConfig.provider,
          options: {
            redirectTo:
              resolvedConfig.redirectTo ||
              (location && location.href) ||
              (typeof globalThis !== 'undefined' && globalThis.location
                ? globalThis.location.href
                : undefined),
            state: 'moodsky-admin-login',
          },
        });
        if (result && result.error) {
          throw result.error;
        }
        const url = result && result.data && result.data.url;
        if (url && typeof navigate === 'function') {
          navigate(url);
        }
        return result && result.data ? result.data : null;
      },
      async verifyCallback() {
        const { auth: currentAuth } = ensure();
        if (typeof currentAuth.verifyOAuth !== 'function') {
          return this.session();
        }
        const result = await currentAuth.verifyOAuth();
        if (result && result.error) {
          throw result.error;
        }
        return result && result.data ? result.data : null;
      },
      async signOut() {
        const { auth: currentAuth } = ensure();
        try {
          if (typeof currentAuth.signOut === 'function') {
            await currentAuth.signOut();
          }
        } finally {
          // CloudBase owns the real session; only clear the old demo marker.
          clear();
        }
      },
      async call(action, payload = {}) {
        const { app: currentApp } = ensure();
        if (!currentApp || typeof currentApp.callFunction !== 'function') {
          throw makeClientError('CLOUD_NOT_CONFIGURED', 'CloudBase callFunction 不可用。');
        }
        // Deliberately no uid, OPENID, role or ownerId is copied into data.
        const outgoingRequestId = nextRequestId();
        let result;
        try {
          result = await currentApp.callFunction({
            name: 'moodsky',
            data: {
              apiVersion: API_VERSION,
              requestId: outgoingRequestId,
              action,
              payload,
            },
          });
        } catch (error) {
          const code =
            error && typeof error.code === 'string' && BUSINESS_ERROR_CODES.has(error.code)
              ? error.code
              : 'NETWORK_ERROR';
          throw makeClientError(
            code,
            error && error.message ? error.message : '云函数请求失败。',
            outgoingRequestId,
            error,
          );
        }
        return validateApiEnvelope(result, outgoingRequestId);
      },
    };
  }

  function createDemoClient({ role = 'data_operator', status = 'active' } = {}) {
    let signedIn = false;
    let current = { role, status };
    const ensureAllowed = () => {
      if (!signedIn) {
        throw makeClientError('UNAUTHENTICATED', 'UNAUTHENTICATED');
      }
      if (current.status !== 'active') {
        throw makeClientError('ACCOUNT_DISABLED', 'ACCOUNT_DISABLED');
      }
      if (current.role !== 'data_operator') {
        throw makeClientError('FORBIDDEN', 'FORBIDDEN');
      }
    };
    return {
      isDemo: true,
      config: { ...DEFAULT_CONFIG, sdkVersion: 'demo adapter (no CloudBase call)' },
      async session() {
        return signedIn ? { user: { uid: 'synthetic-operator' }, ...current } : null;
      },
      async signIn() {
        signedIn = true;
        return this.session();
      },
      async verifyCallback() {
        return this.session();
      },
      async signOut() {
        signedIn = false;
      },
      setRole(roleName, accountStatus = 'active') {
        current = { role: roleName, status: accountStatus };
      },
      async call(action, payload = {}) {
        ensureAllowed();
        if (!action.startsWith('admin.')) {
          throw makeClientError('FORBIDDEN', 'FORBIDDEN');
        }
        return {
          apiVersion: API_VERSION,
          requestId: nextRequestId(),
          ok: true,
          data: { simulated: true, action, payload },
        };
      },
    };
  }

  root.MoodSkyAdminAuth = Object.freeze({
    DEFAULT_CONFIG,
    validateApiEnvelope,
    createCloudBaseApp,
    createClient,
    createDemoClient,
  });
})(globalThis);
