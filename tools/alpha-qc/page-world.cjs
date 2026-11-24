// Actual task Page/controller and production entry; only platform/transport are synthetic.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers/promises');
const { createSessionState } = require('../../miniprogram/services/session-state');
const { createLocalStorage } = require('../../tests/helpers/local-storage');
const { createCloudTaskController } = require('../../miniprogram/modules/tasks/cloud');
const { createJournalController } = require('../../miniprogram/modules/journal/controller');
const event = (dataset) => ({ currentTarget: { dataset } });
async function taskPage(world, mode, { removeVisitGuard = false } = {}) {
  const state = createSessionState();
  state.accept(await world.login());
  const navigations = [];
  const pages = [];
  const wx = {
    ...createLocalStorage(),
    navigateTo: ({ url }) => navigations.push(url),
    switchTab: ({ url }) => navigations.push(url),
    navigateBack: () => pages.pop(),
    showToast() {},
  };
  const call = (action, payload) => world.call(world.request(action, payload));
  const service = {
    suggestions: () => call('tasks.suggestions'),
    quickChoice: () => call('tasks.quickChoice'),
    history: (input) => call('tasks.history', input),
    createTransitionRequest: (input) => world.request('tasks.transition', input),
    submit: (request) => world.call(request),
  };
  function load(name, query = {}) {
    const file = path.resolve(__dirname, '../../miniprogram/pages', name, 'index.js');
    let source = fs.readFileSync(file, 'utf8');
    if (removeVisitGuard && name === 'tasks') {
      const guard = 'sequence === this._connectSequence &&';
      if (!source.includes(guard)) {
        throw new Error('The mutation target changed; inspect the current task Page');
      }
      // In-memory counterexample only: never edit production files or submit this variant.
      source = source.replace(guard, '');
    }
    const local = createRequire(file);
    let definition;
    vm.runInNewContext(source, {
      Page: (value) => {
        definition = value;
      },
      wx,
      getCurrentPages: () => pages,
      require(id) {
        if (id.endsWith('/config/environment.local')) {
          return {
            releaseProfile: 'production',
            taskMode: mode,
            cloudEnabled: true,
            cloudEnvId: 'synthetic-alpha-qc',
            trustedSessionEnabled: true,
          };
        }
        if (id.endsWith('/services/session-state')) {
          return { cloudSessionState: state };
        }
        if (id.endsWith('/services/api')) {
          return { createRequest: world.request, call: world.call };
        }
        if (id.endsWith('/modules/journal/service')) {
          return {
            get: (date) => call('journal.get', { date }),
            createSaveRequest: (payload) => world.request('journal.upsert', payload),
            createDeleteRequest: (payload) => world.request('journal.delete', payload),
            submit: (request) => world.call(request),
          };
        }
        if (id.endsWith('/modules/journal/controller')) {
          return {
            createJournalController: (options) =>
              createJournalController({ ...options, now: () => world.now, sessionState: state }),
          };
        }
        if (id.endsWith('/modules/tasks/cloud')) {
          return {
            createCloudTaskController: (options) =>
              createCloudTaskController({ ...options, now: () => world.now }),
          };
        }
        if (id.endsWith('/modules/tasks/service')) {
          return {
            ...service,
            createPrivateTaskService: () => ({ ...service, suggestions: () => call('tasks.mine') }),
          };
        }
        if (id.endsWith('/modules/account/cloud-session')) {
          return {
            createCloudSession: () => ({ ...state, refresh: async () => true, dispose() {} }),
            ensureCloudSession: async () => true,
          };
        }
        return local(id);
      },
    });
    const page = {
      ...definition,
      route: 'pages/' + name + '/index',
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(value) {
        Object.assign(this.data, value);
      },
    };
    pages.push(page);
    page.onLoad(query);
    page.onShow();
    return page;
  }
  const page = load('tasks');
  async function settled(predicate = () => page.data.taskListLoaded) {
    for (let i = 0; i < 200; i++) {
      await setImmediate();
      if (predicate()) {
        return;
      }
    }
    throw new Error('Local task Page did not settle');
  }
  await settled(() => mode === 'closed' || page.data.taskListLoaded);
  return { page, navigations, settled, event, load, pages };
}
module.exports = { taskPage, event };
