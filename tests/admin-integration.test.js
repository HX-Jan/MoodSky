const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../admin/auth');
const { createClient } = globalThis.MoodSkyAdminAuth;
function client(reply) {
  return createClient({
    config: { envId: 'synthetic' },
    cloudbase: { init: () => ({ auth: {}, callFunction: reply }) },
  });
}
const success = (input) => ({
  result: { apiVersion: '1', requestId: input.data.requestId, ok: true, data: { accepted: true } },
});
for (const code of ['FORBIDDEN', 'ACCOUNT_DISABLED', 'UNAUTHENTICATED', 'NOT_IMPLEMENTED']) {
  test('admin client propagates ' + code + ' without leaking raw backend text', async () => {
    const api = client(async (input) => ({
      result: {
        apiVersion: '1',
        requestId: input.data.requestId,
        ok: false,
        error: { code, message: 'synthetic private detail' },
      },
    }));
    await assert.rejects(
      api.call('admin.updatePlace', {}),
      (error) => error.code === code && error.message === code,
    );
  });
}
test('admin client rejects mismatched, missing and malformed result envelopes', async () => {
  for (const mutation of [
    (result) => ({ ...result, requestId: 'different_request' }),
    (result) => ({ ...result, apiVersion: '0' }),
    (result) => ({ ...result, ok: 'true' }),
    (result) => ({ ...result, data: undefined }),
    (result) => ({ ...result, error: { code: 'INTERNAL_ERROR', message: 'mixed envelope' } }),
    (result) => ({ ...result, ok: false, error: { code: 'raw unsafe value' } }),
  ]) {
    const api = client(async (input) => ({ result: mutation(success(input).result) }));
    await assert.rejects(api.call('admin.updatePlace', {}), { code: 'INVALID_RESPONSE' });
  }
  await assert.rejects(client(async () => ({ data: { ok: true } })).call('admin.updatePlace', {}), {
    code: 'INVALID_RESPONSE',
  });
});
test('admin client snapshots business input and only returns a correlated success', async () => {
  let captured;
  const api = client(async (input) => {
    captured = input;
    return success(input);
  });
  const payload = { name: 'synthetic original' };
  const pending = api.call('admin.updatePlace', payload);
  payload.name = 'changed after dispatch';
  const result = await pending;
  assert.equal(captured.data.payload.name, 'synthetic original');
  assert.equal(result.requestId, captured.data.requestId);
  assert.equal(result.ok, true);
});
test('admin client rejects client identity, unsupported actions and malformed payload before dispatch', async () => {
  let calls = 0;
  const api = client(async (input) => {
    calls++;
    return success(input);
  });
  for (const field of ['uid', 'OPENID', 'ownerId', 'accountId', 'role', 'roles', 'token']) {
    await assert.rejects(api.call('admin.updatePlace', { [field]: 'synthetic' }), {
      code: 'INVALID_REQUEST',
    });
  }
  for (const payload of [null, [], 'input']) {
    await assert.rejects(api.call('admin.updatePlace', payload), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(api.call('journal.get', {}), { code: 'ACTION_NOT_FOUND' });
  assert.equal(calls, 0);
});

test('SDK logout requires a supported operation and rejects structured failure results', async () => {
  for (const auth of [{}, { signOut: async () => ({ error: { message: 'private detail' } }) }]) {
    const api = createClient({
      config: { envId: 'synthetic' },
      cloudbase: { init: () => ({ auth }) },
    });
    await assert.rejects(api.signOut(), (error) => /^SDK_SIGNOUT_/.test(error.code));
  }
});

function page({ real = false, failure = null, malformed = false, logoutFailure = false } = {}) {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        textContent: '',
        className: '',
        listeners: {},
        classList: {
          toggle(key, value) {
            value ? classes.add(key) : classes.delete(key);
          },
          contains: (key) => classes.has(key),
        },
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
      });
    }
    return elements.get(id);
  };
  let resets = 0;
  let calls = 0;
  const submit = { disabled: false };
  const form = {
    dataset: { action: 'admin.updatePlace' },
    elements: {},
    addEventListener(type, fn) {
      this[type] = fn;
    },
    reset() {
      resets++;
    },
  };
  const session = { role: 'data_operator', status: 'active' };
  const adapter = {
    isDemo: !real,
    async session() {
      return session;
    },
    async verifyCallback() {},
    async signIn() {
      return session;
    },
    async signOut() {
      if (logoutFailure) {
        throw new Error('synthetic credential detail');
      }
    },
    async call() {
      calls++;
      if (failure) {
        const error = new Error(failure);
        error.code = failure;
        throw error;
      }
      return malformed ? { data: {} } : { ok: true, data: { simulated: true } };
    },
  };
  const context = {
    document: {
      getElementById: byId,
      querySelectorAll(selector) {
        if (selector === 'form[data-action]') {
          return [form];
        }
        if (selector === '.form-panel form button[type="submit"]') {
          return [submit];
        }
        return [];
      },
    },
    MOODSKY_ADMIN_CONFIG: real ? { envId: 'synthetic' } : {},
    cloudbase: real ? {} : undefined,
    MoodSkyAdminAuth: { createClient: () => adapter, createDemoClient: () => adapter },
    FormData: class {
      entries() {
        return [['name', 'synthetic draft']];
      }
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../admin/app.js'), 'utf8'), context);
  return { byId, submit, form, resets: () => resets, calls: () => calls };
}
for (const code of ['FORBIDDEN', 'ACCOUNT_DISABLED', 'UNAUTHENTICATED', 'NOT_IMPLEMENTED']) {
  test('admin form keeps input and failure feedback for ' + code, async () => {
    const p = page({ failure: code });
    await p.form.submit({ preventDefault() {} });
    assert.equal(p.resets(), 0);
    assert.equal(p.byId('actionNotice').className, 'notice notice--error');
  });
}
test('admin form only resets after an explicit local success', async () => {
  const p = page();
  await p.form.submit({ preventDefault() {} });
  assert.equal(p.resets(), 1);
  assert.match(p.byId('actionNotice').textContent, /本地模拟/);
  const invalid = page({ malformed: true });
  await invalid.form.submit({ preventDefault() {} });
  assert.equal(invalid.resets(), 0);
});
test('Web session role never enables live submissions or claims server authorization', async () => {
  const p = page({ real: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(p.submit.disabled, true);
  assert.doesNotMatch(p.byId('identityHint').textContent, /服务端角色检查通过/);
  await p.form.submit({ preventDefault() {} });
  assert.equal(p.calls(), 0);
  assert.equal(p.resets(), 0);
  assert.match(p.byId('actionNotice').textContent, /尚未接入/);
});
test('failed SDK logout closes the form without claiming the SDK session was removed', async () => {
  const p = page({ real: true, logoutFailure: true });
  await p.byId('logoutButton').listeners.click();
  assert.match(p.byId('loginNotice').textContent, /未能确认/);
  assert.doesNotMatch(p.byId('loginNotice').textContent, /synthetic credential/);
  assert.equal(p.submit.disabled, true);
});
