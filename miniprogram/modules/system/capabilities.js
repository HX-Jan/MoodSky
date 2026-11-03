const UNAVAILABLE_MESSAGE = '当前版本尚未开放此功能。';

function clientStage(config, envVersion = '') {
  if (envVersion === 'release') {
    return { code: 'online', label: '线上版' };
  }
  if (envVersion === 'trial') {
    return { code: 'candidate', label: '候选版' };
  }
  if (envVersion === 'develop') {
    return { code: 'development', label: '开发版' };
  }
  if (config?.releaseProfile === 'production') {
    return { code: 'candidate', label: '正式候选配置' };
  }
  if (config?.cloudFunctionName === 'moodsky-private-pilot') {
    return { code: 'candidate', label: '受限候选测试' };
  }
  return { code: 'development', label: '本地开发' };
}

function trustedCloudReady(config) {
  return Boolean(
    config &&
    config.cloudEnabled === true &&
    typeof config.cloudEnvId === 'string' &&
    config.cloudEnvId.trim() &&
    config.trustedSessionEnabled === true,
  );
}

function productionReady(config) {
  return trustedCloudReady(config);
}

function clientCapabilities(config, envVersion = '') {
  const ready = productionReady(config);
  const stage = clientStage(config, envVersion);
  const taskReady = trustedCloudReady(config);
  const taskCandidate = taskReady || config?.releaseProfile !== 'production';
  return {
    stage,
    accountData: {
      state: ready ? 'available' : 'unavailable',
      label: ready ? '已开放' : '未开放',
      description: ready ? '偏好、导出与注销需登录后使用。' : UNAVAILABLE_MESSAGE,
    },
    campus: {
      state: 'readOnly',
      label: '公开资料只读',
      description: '收藏、纠错与定位仍未开放。',
    },
    tasks: {
      state: taskCandidate ? 'available' : 'unavailable',
      label: taskCandidate ? '候选可用' : '未开放',
      description: taskCandidate
        ? taskReady
          ? '可进入本人任务历史；操作仍受账号会话校验。'
          : '仅用于当前开发或受限测试范围。'
        : UNAVAILABLE_MESSAGE,
    },
  };
}

module.exports = {
  UNAVAILABLE_MESSAGE,
  clientCapabilities,
  clientStage,
  productionReady,
  trustedCloudReady,
};
