(function bootstrapPasswordLogin(root) {
  const doc = root.document;
  const byId = (id) => doc.getElementById(id);
  const config = root.MOODSKY_ADMIN_CONFIG || {};
  const form = byId('passwordForm');
  const username = byId('username');
  const password = byId('password');
  const submit = byId('submitButton');
  const logout = byId('logoutButton');
  const refresh = byId('refreshButton');
  const proceed = byId('continueLink');
  const notice = (text, error = false) => {
    byId('loginNotice').textContent = text;
    byId('loginNotice').className = 'notice' + (error ? ' notice--error' : '');
  };
  const url = new root.URL(root.location.href);
  const secure =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  if (
    !secure ||
    !config.envId ||
    config.loginMethod !== 'password' ||
    !root.cloudbase ||
    root.MOODSKY_ADMIN_SDK_LOAD_ERROR
  ) {
    notice('账号登录尚未就绪，请核对后台登录配置并使用 HTTPS 或本机预览地址。', true);
    return;
  }
  const requested = url.searchParams.get('returnTo');
  const target = new root.URL(
    ['places.html', 'catalogue.html', 'index.html'].includes(requested) ? requested : 'index.html',
    url,
  ).toString();
  proceed.href = target;
  const client = root.MoodSkyAdminAuth.createClient({ cloudbase: root.cloudbase, config });
  let generation = 0;
  let working = false;
  let suspended = doc.hidden;
  let signedIn = false;
  let uncertainLogout = false;
  const principal = (data) => data?.session && (data.user?.id || data.user?.uid);
  function clear() {
    password.value = '';
    username.value = '';
  }
  function render() {
    form.classList.toggle('hidden', signedIn || uncertainLogout);
    proceed.classList.toggle('hidden', !signedIn || uncertainLogout);
    logout.classList.toggle('hidden', !signedIn && !uncertainLogout);
    username.disabled =
      password.disabled =
      submit.disabled =
        working || signedIn || uncertainLogout;
    logout.disabled = refresh.disabled = working;
  }
  async function inspect() {
    if (working || suspended) {
      return;
    }
    const token = ++generation;
    working = true;
    render();
    try {
      const data = await client.session();
      if (token !== generation || suspended) {
        return;
      }
      const id = principal(data);
      signedIn = typeof id === 'string' && Boolean(id);
      notice(
        uncertainLogout
          ? '尚未确认退出，请重试退出后再切换账号。'
          : signedIn
            ? '已有已登录的应用会话，可继续进入；切换账号请先退出。'
            : '请输入应用测试账号。登录不代表已获得资料维护权限。',
      );
    } catch (_error) {
      if (token === generation && !suspended) {
        signedIn = false;
        notice('会话状态未确认，请重新检查或登录。', true);
      }
    } finally {
      working = false;
      render();
      if (token !== generation && !suspended) {
        inspect();
      }
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (working || suspended || signedIn || uncertainLogout) {
      return;
    }
    const credentials = { username: username.value, password: password.value };
    password.value = '';
    const token = ++generation;
    working = true;
    render();
    notice('正在登录…');
    try {
      const acknowledged = await client.signInWithPassword(credentials);
      const observed = await client.session();
      if (token !== generation || suspended) {
        return;
      }
      if (principal(acknowledged) !== principal(observed)) {
        throw new Error('SESSION_CHANGED');
      }
      signedIn = true;
      clear();
      root.location.replace(target);
    } catch (_error) {
      if (token === generation && !suspended) {
        notice(
          '登录未确认，请核对应用账号、密码及登录方式；如需验证码，请由负责人核对登录策略。',
          true,
        );
      }
    } finally {
      credentials.username = credentials.password = '';
      working = false;
      render();
      if (token !== generation && !suspended) {
        inspect();
      }
    }
  });
  logout.addEventListener('click', async () => {
    if (working || suspended) {
      return;
    }
    const token = ++generation;
    working = true;
    signedIn = false;
    uncertainLogout = true;
    clear();
    render();
    try {
      await client.signOut();
      if (token !== generation || suspended) {
        return;
      }
      uncertainLogout = false;
      notice('SDK 已确认退出，可登录另一个应用账号。');
    } catch (_error) {
      if (token === generation && !suspended) {
        notice('尚未确认退出，请重试退出后再切换账号。', true);
      }
    } finally {
      working = false;
      render();
      if (token !== generation && !suspended) {
        inspect();
      }
    }
  });
  refresh.addEventListener('click', inspect);
  function suspend() {
    generation++;
    suspended = true;
    clear();
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) {
      suspend();
    } else {
      suspended = false;
      inspect();
    }
  });
  root.addEventListener('pagehide', suspend);
  root.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      suspended = false;
      inspect();
    }
  });
  inspect();
})(globalThis);
