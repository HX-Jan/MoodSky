(function bootstrapAdmin(root) {
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
        replaceUrl: (url) => root.history.replaceState(null, '', url),
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
    const isDemo = Boolean(client && client.isDemo);
    const allowed = isDemo && state.role === 'data_operator' && state.status === 'active';
    loginPanel.classList.toggle('hidden', Boolean(session));
    consolePanel.classList.toggle('hidden', !session);
    identityText.textContent = session
      ? state.role + ' · ' + state.status + (isDemo ? ' · 合成账号' : '')
      : '未登录';
    identityHint.textContent = allowed
      ? '本地合成运营角色演示；没有执行服务端授权。'
      : isDemo
        ? '当前合成角色不能提交资料。'
        : 'Web 会话不代表运营授权；真实资料提交尚未接入。';
    permissionNotice.textContent = allowed
      ? '仅模拟四类资料表单；不会写入云端。'
      : '本预览未开启真实资料提交；身份映射和服务端角色校验待验证。';
    permissionNotice.className =
      'permission ' + (allowed ? 'permission--ok' : 'permission--denied');
    doc.querySelectorAll('.form-panel form button[type="submit"]').forEach((button) => {
      button.disabled = !allowed;
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
      renderSession(client.isDemo ? session : null);
      showNotice(
        loginNotice,
        client.isDemo ? '合成运营账号已登录。' : '已发起微信授权，等待回调。',
        client.isDemo ? 'success' : '',
      );
    } catch (_error) {
      showNotice(loginNotice, '登录未完成，请核对配置或稍后重试。', 'error');
    }
  });

  byId('logoutButton').addEventListener('click', async () => {
    if (!client) {
      return;
    }
    try {
      await client.signOut();
      renderSession(null);
      showNotice(loginNotice, client.isDemo ? '已退出合成账号。' : 'SDK 已确认退出。');
    } catch (_error) {
      renderSession(null);
      showNotice(loginNotice, '未能确认 SDK 退出；当前表单已关闭，请重试退出操作。', 'error');
    }
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
        if (!client.isDemo) {
          throw new Error('NOT_IMPLEMENTED');
        }
        const result = await client.call(form.dataset.action, payload);
        if (!result || result.ok !== true) {
          throw new Error('INVALID_RESPONSE');
        }
        showNotice(actionNotice, '本地模拟提交完成；没有保存到云端。', 'success');
        form.reset();
      } catch (error) {
        const copy = {
          UNAUTHENTICATED: '登录状态已失效，请重新登录。',
          ACCOUNT_DISABLED: '账号已停用，不能维护资料。',
          FORBIDDEN: '当前身份不能提交资料，输入已保留。',
          NOT_IMPLEMENTED: '真实资料提交尚未接入，输入已保留。',
          INVALID_RESPONSE: '无法确认操作结果，输入已保留。',
        };
        showNotice(
          actionNotice,
          copy[error.code || error.message] ||
            (error.message === 'CLOUDBASE_SDK_MISSING'
              ? '页面未加载 CloudBase Web SDK，请先完成真实环境配置。'
              : '提交未完成，输入已保留。'),
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
    } catch (_error) {
      renderSession(null);
      showNotice(loginNotice, '尚未确认 CloudBase 回调，请核对 SDK 配置后重新登录。', 'error');
    }
  })();
})(globalThis);
