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

// This build decision never grants server permissions. Production remains closed
// until the release owner selects the scope supported by the target cloud.
function taskMode(config) {
  const mode = config?.taskMode;
  if (mode !== undefined && !['closed', 'readOnly', 'enabled'].includes(mode)) {
    return 'closed';
  }
  if (config?.releaseProfile === 'production') {
    if (!trustedCloudReady(config)) {
      return 'closed';
    }
    return mode || 'closed';
  }
  return mode || 'enabled';
}

function clientCapabilities(config, envVersion = '') {
  const ready = productionReady(config);
  const stage = clientStage(config, envVersion);
  const mode = taskMode(config);
  const taskCandidate = mode !== 'closed';
  const taskReady = trustedCloudReady(config) && mode === 'enabled';
  return {
    stage,
    accountData: {
      state: ready ? 'available' : 'unavailable',
      label: ready ? '已开放' : '未开放',
      description: ready ? '偏好、导出与注销需登录后使用。' : UNAVAILABLE_MESSAGE,
    },
    campus: {
      state: 'readOnly',
      label: '可浏览',
      description: '浏览推荐地点，打卡以页面提示为准。',
    },
    tasks: {
      state: mode === 'readOnly' ? 'readOnly' : taskCandidate ? 'available' : 'unavailable',
      historyAvailable: mode === 'enabled' && taskCandidate,
      label: mode === 'readOnly' ? '仅浏览建议' : taskCandidate ? '可使用' : '未开放',
      description:
        mode === 'readOnly'
          ? '仅浏览任务建议，选择、完成和历史暂未开放。'
          : taskCandidate
            ? taskReady
              ? '登录后可查看自己的任务记录。'
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
  taskMode,
};
