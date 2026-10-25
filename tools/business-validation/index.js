const config = require('./config');
const { operatorFingerprint } = require('../h03-probe/index');
const { createValidationDatabase } = require('./database');
const { runValidation, inspectValidation } = require('./suite');
const { timingSafeEqual } = require('node:crypto');
function createValidationEntry({ context, fingerprint, openDatabase }) {
  return async (event) => {
    const error = (code) => ({
      ok: false,
      error: { code, message: '云隔离验证尚未完成，请保留批次。' },
    });
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        return error('INVALID_REQUEST');
      }
      const request = { ...event };
      delete request.userInfo;
      delete request.tcbContext;
      if (
        Object.keys(request).some((k) => !['operation', 'runId'].includes(k)) ||
        !['run', 'inspect'].includes(request.operation) ||
        request.runId !== config.runId
      ) {
        return error('INVALID_REQUEST');
      }
      const trusted = context();
      const expected = fingerprint();
      if (
        trusted?.ENV !== config.environmentId ||
        trusted?.APPID !== config.appId ||
        typeof trusted?.OPENID !== 'string' ||
        !trusted.OPENID ||
        typeof expected !== 'string' ||
        !/^[a-f0-9]{64}$/.test(expected) ||
        !timingSafeEqual(
          Buffer.from(operatorFingerprint(trusted.OPENID), 'hex'),
          Buffer.from(expected, 'hex'),
        )
      ) {
        return error('FORBIDDEN');
      }
      const db = openDatabase();
      const data =
        request.operation === 'run' ? await runValidation(db) : await inspectValidation(db);
      return { ok: true, runId: config.runId, data };
    } catch (caught) {
      return error(caught?.code === 'CONFLICT' ? 'CONFLICT' : 'INTERNAL_ERROR');
    }
  };
}
let cloud;
exports.main = createValidationEntry({
  context() {
    if (!cloud) {
      cloud = require('wx-server-sdk');
      cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    }
    return cloud.getWXContext();
  },
  fingerprint: () => process.env[config.operatorSetting],
  openDatabase: () =>
    createValidationDatabase(
      require('@cloudbase/node-sdk').init({ env: config.environmentId }).database(),
    ),
});
exports.createValidationEntry = createValidationEntry;
