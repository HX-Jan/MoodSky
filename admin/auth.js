/*
 * CloudBase Web authentication seam for the data-maintenance console.
 *
 * The browser never supplies uid, OPENID or role in a business request. The
 * CloudBase SDK owns the session and the cloud function resolves the trusted
 * identity again before checking operator_roles. Keeping this seam small makes
 * the first-week demo runnable without putting a CloudBase secret in the repo.
 */
(function registerAuth(root) {
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

  function createClient({ cloudbase, config = {}, storage, location, navigate } = {}) {
    const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
    let app = null;
    let auth = null;
    const clear = () => {
      if (storage && typeof storage.removeItem === 'function') {
        storage.removeItem('moodsky.admin.session');
      }
    };
    const requestId = () => {
      const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
      if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
        return 'admin_' + cryptoObject.randomUUID();
      }
      return 'admin_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
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
          throw new Error('CloudBase callFunction is unavailable.');
        }
        // Deliberately no uid, OPENID, role or ownerId is copied into data.
        return currentApp.callFunction({
          name: 'moodsky',
          data: {
            apiVersion: '1',
            requestId: requestId(),
            action,
            payload,
          },
        });
      },
    };
  }

  function createDemoClient({ role = 'data_operator', status = 'active' } = {}) {
    let signedIn = false;
    let current = { role, status };
    const ensureAllowed = () => {
      if (!signedIn) {
        throw new Error('UNAUTHENTICATED');
      }
      if (current.status !== 'active') {
        throw new Error('ACCOUNT_DISABLED');
      }
      if (current.role !== 'data_operator') {
        throw new Error('FORBIDDEN');
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
          throw new Error('FORBIDDEN');
        }
        return { data: { simulated: true, action, payload } };
      },
    };
  }

  root.MoodSkyAdminAuth = Object.freeze({
    DEFAULT_CONFIG,
    createCloudBaseApp,
    createClient,
    createDemoClient,
  });
})(globalThis);
