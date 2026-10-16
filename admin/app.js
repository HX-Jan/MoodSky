function validateAdminResponse(result) {
  const envelope =
    result && result.result && typeof result.result === 'object' ? result.result : result;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    const error = new Error('云函数返回格式无效。');
    error.code = 'INVALID_RESPONSE';
    throw error;
  }
  if (envelope.apiVersion !== '1') {
    const error = new Error('云函数返回的接口版本无效。');
    error.code = 'INVALID_RESPONSE';
    error.requestId = envelope.requestId;
    throw error;
  }
  if (typeof envelope.requestId !== 'string' || !envelope.requestId) {
    const error = new Error('云函数返回的请求标识无效。');
    error.code = 'INVALID_RESPONSE';
    throw error;
  }
  if (typeof envelope.ok !== 'boolean') {
    const error = new Error('云函数返回缺少成功状态。');
    error.code = 'INVALID_RESPONSE';
    error.requestId = envelope.requestId;
    throw error;
  }
  if (envelope.ok) {
    if (Object.prototype.hasOwnProperty.call(envelope, 'error')) {
      const error = new Error('云函数成功回执包含错误字段。');
      error.code = 'INVALID_RESPONSE';
      error.requestId = envelope.requestId;
      throw error;
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
    const error = new Error('云函数失败回执格式无效。');
    error.code = 'INVALID_RESPONSE';
    error.requestId = envelope.requestId;
    throw error;
  }
  const error = new Error(responseError.message);
  error.code = responseError.code;
  error.requestId = envelope.requestId;
  throw error;
}

(function bootstrapAdmin(root) {
  root.MoodSkyAdminApp = Object.freeze({ validateAdminResponse });
  const doc = root.document;
  if (!doc || !root.MoodSkyAdminAuth) {
    return;
  }

  const config = root.MOODSKY_ADMIN_CONFIG || {};
  const hasEnvironment = Boolean(config.envId);
  const hasSdk = Boolean(root.cloudbase);
  const configError = hasEnvironment && !hasSdk;
  const isRealConfig = hasEnvironment && hasSdk;
  const client = isRealConfig
    ? root.MoodSkyAdminAuth.createClient({
        cloudbase: root.cloudbase,
        config,
        storage: root.localStorage,
        location: root.location,
        navigate: (url) => {
          root.location.href = url;
        },
      })
    : configError
      ? null
      : root.MoodSkyAdminAuth.createDemoClient();

  const byId = (id) => doc.getElementById(id);
  const loginPanel = byId('loginPanel');
  const consolePanel = byId('consolePanel');
  const loginNotice = byId('loginNotice');
  const actionNotice = byId('actionNotice');
  const permissionNotice = byId('permissionNotice');
  const environmentBadge = byId('environmentBadge');
  const identityText = byId('identityText');
  const identityHint = byId('identityHint');
  const demoRoleControl = byId('demoRoleControl');

  function showNotice(element, text, kind = '') {
    element.textContent = text;
    element.className = 'notice' + (kind ? ' notice--' + kind : '');
  }

  function sessionRole(session) {
    if (!session) {
      return { role: 'none', status: 'signed_out' };
    }
    return {
      role: session.role || (session.user && session.user.role) || 'unknown',
      status: session.status || 'active',
    };
  }

  function renderSession(session) {
    const state = sessionRole(session);
    const allowed = state.role === 'data_operator' && state.status === 'active';
    const isDemo = !client || client.isDemo;
    // A Web session's role is display metadata only. The cloud function must
    // resolve the trusted account and operator_roles on every write.
    const canSubmit = isDemo ? allowed : Boolean(session);
    loginPanel.classList.toggle('hidden', Boolean(session));
    consolePanel.classList.toggle('hidden', !session);
    identityText.textContent = session
      ? state.role + ' · ' + state.status + (isDemo ? ' · 合成账号' : '')
      : '未登录';
    identityHint.textContent = isDemo
      ? '合成身份仅用于演示；提交仍由演示适配器检查。'
      : '会话身份仅用于显示；每次调用由服务端可信上下文和 operator_roles 检查。';
    permissionNotice.textContent = isDemo
      ? allowed
        ? '演示适配器当前模拟资料维护权限。'
        : '当前演示身份没有资料维护权限，直接调用也会被拒绝。'
      : '服务端将在每次调用中重新检查账号和 operator_roles；页面状态不代表授权。';
    permissionNotice.className =
      'permission ' + (canSubmit ? 'permission--ok' : 'permission--denied');
    doc.querySelectorAll('.form-panel form button[type="submit"]').forEach((button) => {
      button.disabled = !canSubmit;
    });
    environmentBadge.textContent = configError
      ? '配置错误'
      : isDemo
        ? '本地演示'
        : 'CloudBase Web SDK';
    environmentBadge.className =
      'badge ' + (configError ? 'badge--error' : isDemo ? 'badge--demo' : 'badge--live');
    demoRoleControl.classList.toggle('hidden', !isDemo || !session || configError);
  }

  byId('loginButton').addEventListener('click', async () => {
    if (!client) {
      showNotice(
        loginNotice,
        '已填写 CloudBase 环境 ID，但页面没有加载 Web SDK，请先完成真实环境配置。',
        'error',
      );
      return;
    }
    try {
      const session = await client.signIn();
      renderSession(session);
      showNotice(
        loginNotice,
        client.isDemo ? '合成运营账号已登录。' : '已发起微信授权，等待回调。',
        'success',
      );
    } catch (error) {
      showNotice(loginNotice, '登录未完成：' + (error.message || '身份服务不可用。'), 'error');
    }
  });

  byId('logoutButton').addEventListener('click', async () => {
    if (!client) {
      return;
    }
    await client.signOut();
    renderSession(null);
    showNotice(loginNotice, '已退出，浏览器会话已清理。');
  });

  byId('demoRole').addEventListener('change', async (event) => {
    const states = {
      operator: ['data_operator', 'active'],
      student: ['student', 'active'],
      disabled: ['data_operator', 'disabled'],
    };
    const next = states[event.target.value];
    if (!client || !client.isDemo || !next) {
      return;
    }
    client.setRole(next[0], next[1]);
    renderSession(await client.session());
    showNotice(
      actionNotice,
      next[0] === 'data_operator' && next[1] === 'active'
        ? '演示身份已切换为授权运营。'
        : '演示身份已切换；提交按钮应保持禁用，直接调用也会被拒绝。',
      next[0] === 'data_operator' && next[1] === 'active' ? 'success' : 'error',
    );
  });

  doc.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      doc.querySelectorAll('.tab').forEach((item) => item.classList.remove('tab--active'));
      doc.querySelectorAll('.form-panel').forEach((panel) => panel.classList.add('hidden'));
      tab.classList.add('tab--active');
      byId(tab.dataset.panel).classList.remove('hidden');
    });
  });

  doc.querySelectorAll('form[data-action]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new root.FormData(form).entries());
      payload.verified = form.elements.verified ? form.elements.verified.checked : undefined;
      try {
        if (!client) {
          throw new Error('CLOUDBASE_SDK_MISSING');
        }
        const result = await client.call(form.dataset.action, payload);
        validateAdminResponse(result);
        showNotice(actionNotice, '本次操作已提交；结果仍以服务端回执为准。', 'success');
        form.reset();
      } catch (error) {
        const copy = {
          UNAUTHENTICATED: '登录状态已失效，请重新登录。',
          ACCOUNT_DISABLED: '账号已停用，不能维护资料。',
          FORBIDDEN: '服务端拒绝本次资料操作。',
          NOT_IMPLEMENTED: '资料服务尚未实现，本次没有写入数据。',
          NETWORK_ERROR: '网络请求失败，请稍后重试。',
          INVALID_RESPONSE: '服务端返回格式无效，本次没有写入数据。',
        };
        const code = error.code || error.message;
        const requestSuffix = error.requestId ? '（请求编号 ' + error.requestId + '）' : '';
        showNotice(
          actionNotice,
          (copy[code] ||
            (code === 'CLOUDBASE_SDK_MISSING'
              ? '页面未加载 CloudBase Web SDK，请先完成真实环境配置。'
              : '提交失败：' + (error.message || '身份服务不可用。'))) + requestSuffix,
          'error',
        );
      }
    });
  });

  renderSession(null);
  (async () => {
    if (configError) {
      showNotice(
        loginNotice,
        '检测到 CloudBase 环境 ID，但没有加载 Web SDK；页面已停止降级为本地演示。',
        'error',
      );
      return;
    }
    if (!client || client.isDemo) {
      return;
    }
    try {
      await client.verifyCallback();
      const session = await client.session();
      renderSession(session);
      if (session) {
        showNotice(loginNotice, '已恢复 CloudBase 登录会话。', 'success');
      }
    } catch (error) {
      renderSession(null);
      showNotice(
        loginNotice,
        'CloudBase 回调验证失败：' + (error.message || '请重新登录。'),
        'error',
      );
    }
  })();
})(globalThis);
