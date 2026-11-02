(function bootstrapPlaces(root) {
  const doc = root.document;
  const byId = (id) => doc.getElementById(id);
  const config = root.MOODSKY_ADMIN_CONFIG || {};
  const configured = Boolean(config.envId && root.cloudbase && !root.MOODSKY_ADMIN_SDK_LOAD_ERROR);
  const enabled = configured && config.placeMaintenanceEnabled === true;
  const notice = (id, text, kind = '') => {
    byId(id).textContent = text;
    byId(id).className = 'notice' + (kind ? ' notice--' + kind : '');
  };
  byId('readiness').textContent = enabled
    ? '地点维护候选已启用；每次资料操作仍由服务端验证身份和运营权限。'
    : '地点维护尚未启用。需先接通 Web 身份映射、运营权限和地点服务。';
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
  let view = {};
  let campus = '';
  let loggingOut = false;
  const form = byId('placeForm');
  const signedIn = () => session.isCurrent(session.capture());
  function renderIdentity() {
    const authenticated = signedIn();
    byId('identityText').textContent = authenticated
      ? 'Web 登录会话已确认；资料权限由服务端核验。'
      : '未确认登录会话';
    byId('consolePanel').classList.toggle('hidden', !authenticated || !enabled);
    byId('logoutButton').disabled = loggingOut;
  }
  function render(state) {
    view = state;
    renderIdentity();
    const locked = state.busy || state.loading;
    byId('placeList').replaceChildren();
    for (const place of state.items) {
      const li = doc.createElement('li');
      const button = doc.createElement('button');
      button.className = 'button button--quiet';
      button.textContent = place.name + ' · ' + place.campus + ' · ' + place.verificationState;
      button.disabled = locked || state.dirty || state.pending;
      button.addEventListener('click', () => controller.select(place.placeId));
      li.appendChild(button);
      byId('placeList').appendChild(li);
    }
    byId('listButton').disabled = locked || state.dirty || state.pending;
    byId('filterForm').elements.campus.disabled = locked || state.dirty || state.pending;
    byId('previousPage').disabled = locked || state.dirty || state.pending || state.page <= 1;
    byId('nextPage').disabled = locked || state.dirty || state.pending || !state.hasMore;
    byId('pageText').textContent = '第 ' + state.page + ' 页';
    byId('detailPanel').classList.toggle('hidden', !state.selected);
    for (const field of form.elements) {
      if (!field.name) {
        continue;
      }
      field.disabled = locked || state.pending || !state.selected?.updatedAt;
      const value = state.draft?.[field.name];
      if (field.type === 'checkbox') {
        field.checked = value === true;
      } else if (field.value !== (value || '')) {
        field.value = value || '';
      }
    }
    byId('recordMeta').textContent = state.selected
      ? state.selected.placeId +
        ' · ' +
        state.selected.verificationState +
        ' · 版本：' +
        (state.selected.updatedAt || '缺失，只读')
      : '';
    byId('saveButton').disabled = !state.canSave;
    byId('discardButton').disabled = locked;
    byId('verifyButton').classList.toggle('hidden', !state.pending);
    byId('verifyButton').disabled = locked;
    byId('observedText').textContent = state.observed
      ? '当前存储资料（请与草稿核对）：' + JSON.stringify(state.observed)
      : '';
    notice('actionNotice', state.notice, state.noticeType);
  }
  const controller = root.MoodSkyAdminPlaces.createPlaceController({
    api: client,
    session,
    enabled,
    publish: render,
  });
  session.subscribe(renderIdentity);
  byId('loginButton').disabled = false;
  byId('refreshSession').disabled = false;
  byId('loginButton').addEventListener('click', async () => {
    try {
      await client.signIn();
      notice('loginNotice', '已发起微信授权，等待回调。');
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
      notice('loginNotice', '未确认 SDK 退出，请重新执行退出操作。', 'error');
    } finally {
      loggingOut = false;
      renderIdentity();
    }
  });
  const readPage = (page) => controller.list({ ...(campus ? { campus } : {}), page, pageSize: 20 });
  byId('filterForm').addEventListener('submit', (event) => {
    event.preventDefault();
    campus = byId('filterForm').elements.campus.value.trim();
    readPage(1);
  });
  byId('previousPage').addEventListener('click', () => readPage(view.page - 1));
  byId('nextPage').addEventListener('click', () => readPage(view.page + 1));
  form.addEventListener('input', (event) => {
    const field = event.target;
    if (!field.name) {
      return;
    }
    let value = field.type === 'checkbox' ? field.checked : field.value;
    if (['openHours', 'address'].includes(field.name) && !value) {
      value = null;
    }
    if (field.name === 'validUntil' && Number.isFinite(Date.parse(value))) {
      value = new Date(value).toISOString();
    }
    controller.edit(field.name, value);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    controller.save();
  });
  byId('verifyButton').addEventListener('click', () => controller.verifySaved());
  byId('discardButton').addEventListener('click', () => {
    if (
      view.selected &&
      root.confirm('放弃当前草稿并重新读取？未确认的保存可能已生效，请读取后核对。')
    ) {
      controller.select(view.selected.placeId, true);
    }
  });
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) {
      controller.suspend();
    } else {
      refresh();
    }
  });
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
      notice('loginNotice', 'OAuth 回调未确认，请重新登录。', 'error');
    }
  })();
})(globalThis);
