(function bootstrapCatalogue(root) {
  const doc = root.document,
    byId = (id) => doc.getElementById(id);
  const config = root.MOODSKY_ADMIN_CONFIG || {};
  const configured = Boolean(config.envId && root.cloudbase && !root.MOODSKY_ADMIN_SDK_LOAD_ERROR);
  const enabled = configured && config.catalogueMaintenanceEnabled === true;
  const notice = (id, text, kind = '') => {
    byId(id).textContent = text;
    byId(id).className = 'notice' + (kind ? ' notice--' + kind : '');
  };
  byId('readiness').textContent = enabled
    ? '资料候选已启用；操作仍由服务端验证运营权限。'
    : '资料维护尚未启用。需先接通 Web 身份映射、运营权限和资料服务。';
  byId('readiness').className = 'permission ' + (enabled ? 'permission--ok' : 'permission--denied');
  if (!configured) {
    notice('loginNotice', '尚未配置 CloudBase Web 登录或 SDK 加载失败。', 'error');
    return;
  }
  const client = root.MoodSkyAdminAuth.createClient({
    cloudbase: root.cloudbase,
    config,
    location: root.location,
    replaceUrl: (url) => root.history.replaceState(null, '', url),
    navigate: (url) => {
      root.location.href = url;
    },
  });
  const session = root.MoodSkyAdminSession.createSessionBoundary(client);
  let view = {},
    loggingOut = false;
  const form = byId('reviewForm');
  const signedIn = () => session.isCurrent(session.capture());
  function renderIdentity() {
    byId('identityText').textContent = signedIn()
      ? 'Web 会话已确认；资料权限由服务端核验。'
      : '未确认登录会话';
    byId('consolePanel').classList.toggle('hidden', !signedIn() || !enabled);
    byId('logoutButton').disabled = loggingOut;
  }
  function render(state) {
    view = state;
    renderIdentity();
    const locked = state.loading || state.busy;
    const navigating = locked || state.dirty || state.pending;
    byId('kind').disabled = navigating;
    byId('listButton').disabled = navigating;
    byId('previousPage').disabled = navigating || state.page <= 1;
    byId('nextPage').disabled = navigating || !state.hasMore;
    byId('pageText').textContent = '第 ' + state.page + ' 页 · 共 ' + state.total + ' 条';
    byId('catalogueList').replaceChildren();
    for (const item of state.items) {
      const li = doc.createElement('li');
      if (state.kind === 'corrections') {
        const button = doc.createElement('button');
        button.className = 'button button--quiet';
        button.textContent = item.placeId + ' · ' + item.status + ' · ' + item.text;
        button.disabled = navigating;
        button.addEventListener('click', () => controller.select(item.correctionId));
        li.appendChild(button);
      } else {
        li.textContent =
          state.kind === 'templates'
            ? (item.title || '未命名模板') +
              ' · ' +
              item.templateId +
              ' · ' +
              (item.enabled ? '启用' : '停用')
            : (item.name || '未命名资源') +
              ' · ' +
              (item.campus || '校区待核实') +
              ' · ' +
              item.verificationState +
              ' · 来源：' +
              (item.source || '待核实') +
              ' · 有效期：' +
              (item.validUntil || '待核实');
        if (item.isSynthetic) {
          li.textContent += ' · 合成示例';
        }
      }
      byId('catalogueList').appendChild(li);
    }
    byId('capabilityText').textContent =
      state.kind === 'corrections'
        ? '审核仅记录处理意见；地点资料须单独核实后维护。'
        : '当前提供只读列表，保存服务尚未接通。';
    byId('reviewPanel').classList.toggle('hidden', !state.selected);
    byId('correctionText').textContent = state.selected?.text || '';
    byId('reviewMeta').textContent = state.selected
      ? state.selected.correctionId +
        ' · ' +
        state.selected.status +
        ' · ' +
        (state.selected.reviewNote || '无处理备注')
      : '';
    for (const field of form.elements) {
      if (!field.name) {
        continue;
      }
      field.disabled = locked || state.pending || state.selected?.status !== 'pending';
      const value = state.draft?.[field.name] || '';
      if (field.value !== value) {
        field.value = value;
      }
    }
    byId('reviewButton').disabled = !state.canReview;
    byId('verifyButton').classList.toggle('hidden', !state.pending);
    byId('verifyButton').disabled = locked;
    byId('discardButton').classList.toggle('hidden', !state.dirty && !state.pending);
    byId('discardButton').disabled = locked;
    byId('observedText').textContent = state.observed
      ? '当前状态：' + state.observed.status + ' · ' + (state.observed.reviewNote || '无处理备注')
      : '';
    notice('actionNotice', state.notice, state.noticeType);
  }
  const controller = root.MoodSkyAdminCatalogue.createCatalogueController({
    api: client,
    session,
    enabled,
    publish: render,
  });
  session.subscribe(renderIdentity);
  byId('loginButton').textContent = config.loginMethod === 'password' ? '账号登录' : '微信登录';
  byId('loginButton').disabled = false;
  byId('refreshSession').disabled = false;
  byId('loginButton').addEventListener('click', async () => {
    try {
      await client.signIn();
      notice(
        'loginNotice',
        config.loginMethod === 'password'
          ? '请在账号登录页完成登录。'
          : '已发起微信授权，等待回调。',
      );
    } catch (_error) {
      notice('loginNotice', '登录未完成，请核对配置后重试。', 'error');
    }
  });
  async function refresh() {
    if (loggingOut) {
      return;
    }
    await controller.resume();
    renderIdentity();
    notice(
      'loginNotice',
      signedIn() ? '当前 SDK 会话已确认。' : '登录未确认，请重新登录。',
      signedIn() ? 'success' : 'error',
    );
  }
  byId('refreshSession').addEventListener('click', refresh);
  byId('logoutButton').addEventListener('click', async () => {
    loggingOut = true;
    session.invalidate();
    try {
      await client.signOut();
      notice('loginNotice', 'SDK 已确认退出。');
    } catch (_error) {
      notice('loginNotice', '未确认 SDK 退出，请重试。', 'error');
    } finally {
      loggingOut = false;
      renderIdentity();
    }
  });
  byId('listForm').addEventListener('submit', (event) => {
    event.preventDefault();
    controller.list(byId('kind').value);
  });
  byId('previousPage').addEventListener('click', () => controller.list(view.kind, view.page - 1));
  byId('nextPage').addEventListener('click', () => controller.list(view.kind, view.page + 1));
  form.addEventListener('input', (event) => controller.edit(event.target.name, event.target.value));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (root.confirm('确认提交该审核结果？处理意见不可反转，地点资料需要另行维护。')) {
      controller.review(true);
    }
  });
  byId('verifyButton').addEventListener('click', () => controller.verifySaved());
  byId('discardButton').addEventListener('click', () => {
    if (root.confirm('放弃审核草稿并重新读取队列？未确认的提交可能已生效。')) {
      controller.list(view.kind, view.page, true);
    }
  });
  root.addEventListener('beforeunload', (event) => {
    if (view.dirty || view.pending) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  doc.addEventListener('visibilitychange', () => (doc.hidden ? controller.suspend() : refresh()));
  root.addEventListener('pagehide', () => controller.suspend());
  root.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      refresh();
    }
  });
  (async () => {
    try {
      await client.verifyCallback();
      await refresh();
    } catch (_error) {
      session.invalidate();
      notice('loginNotice', '登录会话未确认，请重新登录。', 'error');
    }
  })();
})(globalThis);
