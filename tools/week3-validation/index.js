const { randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const config = require('./config');
const operatorFingerprint = (openid) =>
  createHash('sha256')
    .update('moodsky-h03-operator:' + openid)
    .digest('hex');
const { createValidationDatabase } = require('../business-validation/database');
const suite = require('./suite');
const INSTANCE = randomBytes(16).toString('hex');

function createWeek3Entry({
  context,
  fingerprint,
  openDatabase,
  now = () => new Date(),
  instanceTag = INSTANCE,
}) {
  return async (event) => {
    const fail = (code) => ({
      ok: false,
      error: { code, message: '固定隔离验证未完成，请保留批次并检查报告。' },
    });
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        return fail('INVALID_REQUEST');
      }
      const request = { ...event };
      delete request.userInfo;
      delete request.tcbContext;
      if (
        Object.keys(request).some((key) => !['operation', 'runId', 'worker'].includes(key)) ||
        request.runId !== config.runId ||
        !['prepare', 'worker', 'read', 'inspect'].includes(request.operation) ||
        (request.operation === 'worker'
          ? !Number.isInteger(request.worker) ||
            request.worker < 0 ||
            request.worker >= config.workerCount
          : Object.hasOwn(request, 'worker'))
      ) {
        return fail('INVALID_REQUEST');
      }
      const trusted = context();
      const expected = fingerprint();
      if (
        trusted?.APPID !== config.appId ||
        trusted?.ENV !== config.environmentId ||
        typeof trusted?.OPENID !== 'string' ||
        !trusted.OPENID ||
        typeof expected !== 'string' ||
        !/^[a-f0-9]{64}$/.test(expected) ||
        !timingSafeEqual(
          Buffer.from(operatorFingerprint(trusted.OPENID), 'hex'),
          Buffer.from(expected, 'hex'),
        )
      ) {
        return fail('FORBIDDEN');
      }
      const current = now();
      if (
        request.operation !== 'inspect' &&
        (!(current instanceof Date) ||
          !Number.isFinite(current.getTime()) ||
          current.getTime() > Date.parse(config.expiresAt) ||
          current.getTime() < Date.parse('2026-10-27T00:00:00+08:00'))
      ) {
        return fail('FORBIDDEN');
      }
      const db = openDatabase();
      let data;
      if (request.operation === 'prepare') {
        data = await suite.prepare(db);
      } else if (request.operation === 'worker') {
        data = await suite.worker(db, request.worker, instanceTag);
      } else if (request.operation === 'read') {
        data = await suite.readWindows(db, instanceTag);
      } else {
        data = await suite.inspect(db);
      }
      return { ok: true, runId: config.runId, data };
    } catch (error) {
      return fail(error?.code === 'CONFLICT' ? 'CONFLICT' : 'INTERNAL_ERROR');
    }
  };
}
let cloud;
exports.main = createWeek3Entry({
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
      config,
    ),
});
exports.createWeek3Entry = createWeek3Entry;
