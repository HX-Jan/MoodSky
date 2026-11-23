// Review-only reproducer: actual PR page and production entry, synthetic data.
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('Pass the absolute PR237 checkout path.');
const load = createRequire(path.join(root, 'package.json'));
const { createSessionState } = load('./miniprogram/services/session-state');
const { createCloudSession } = load('./miniprogram/modules/account/cloud-session');
const { createRequest } = load('./miniprogram/services/api');
const file = path.join(root, 'miniprogram/pages/login/index.js');
const localRequire = createRequire(file);
const state = createSessionState();
const sent = [];
let definition;
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  Page: (page) => {
    definition = page;
  },
  wx: { setStorageSync() {} },
  require: (id) => {
    if (id === '../../config/environment.local')
      return { releaseProfile: 'production', phoneLoginEnabled: true };
    if (id === '../../services/session-state') return { cloudSessionState: state };
    if (id === '../../services/api')
      return {
        createRequest,
        call: async (request) => {
          sent.push(request.action);
          if (request.action === 'account.registration')
            return {
              ok: true,
              data: { canRegister: true, previousScope: 'scope_' + 'a'.repeat(64) },
            };
          throw Object.assign(new Error('账号已注销。'), { code: 'ACCOUNT_DISABLED' });
        },
      };
    if (id === '../../modules/account/cloud-session')
      return { createCloudSession: (options) => createCloudSession({ state, ...options }) };
    return localRequire(id);
  },
});
const page = {
  ...definition,
  data: structuredClone(definition.data),
  setData(patch) {
    Object.assign(this.data, patch);
  },
};
page.data.agreed = true;
(async () => {
  await page.onPhoneLogin({ detail: { code: 'synthetic_verified_phone_code' } });
  await page.onWechatLogin();
  const result = {
    pr: 237,
    head: '98c0659a73a1c6a5fbb7cb4b284b68ee3776ab2f',
    phoneLoginEnabled: true,
    authenticated: Boolean(state.capture()),
    sentActions: sent,
    registrationAvailable: page.data.registrationAvailable,
    notice: page.data.wechatLoginNotice,
    expected:
      'A deactivated original WeChat account can discover and explicitly register a fresh empty account',
    reproduced: !page.data.registrationAvailable && !sent.includes('account.registration'),
    realCloud: false,
    realPhone: false,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.reproduced) throw new Error('Counterexample did not reproduce');
})();
