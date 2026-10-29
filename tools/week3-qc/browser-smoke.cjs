// Optional local browser acceptance. All identities, places and transport are synthetic.
// PLAYWRIGHT_MODULE may point to a locally installed playwright package directory.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createRouter } = require('../../cloudfunctions/moodsky/router');
const { createMemoryRepositories } = require('../../tests/support/campus-repository');
const fixtures = require('../../tests/support/campus-fixtures');
const root = path.resolve(__dirname, '../..');
const repositories = createMemoryRepositories({ places: fixtures.places });
let enabled = true;
let signedIn = true;
let grant = true;
let network = '';
const calls = [];
const checks = [];
const router = createRouter({
  repositories,
  now: () => fixtures.NOW,
  resolveAccount: async () => ({ id: 'synthetic_internal_operator', status: 'active' }),
  resolveOperatorRoles: async () => (grant ? ['data_operator'] : []),
});
const server = http.createServer(async (req, res) => {
  const filename = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!filename.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  if (filename === path.join(root, 'admin/config.js')) {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(
      'globalThis.MOODSKY_ADMIN_CONFIG = ' +
        JSON.stringify({ envId: 'synthetic-local-only', placeMaintenanceEnabled: enabled }) +
        ';',
    );
    return;
  }
  try {
    res.setHeader(
      'Content-Type',
      filename.endsWith('.js')
        ? 'text/javascript'
        : filename.endsWith('.css')
          ? 'text/css'
          : 'text/html; charset=utf-8',
    );
    res.end(await fs.readFile(filename));
  } catch (_error) {
    res.writeHead(404).end();
  }
});
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_EXECUTABLE_PATH
        ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
        : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error('Browser error:', error.message);
    });
    await page.exposeFunction('__qcSession', () =>
      signedIn
        ? { data: { session: {}, user: { id: 'synthetic-web-user', role: 'data_operator' } } }
        : { data: {} },
    );
    await page.exposeFunction('__qcCall', async ({ data }) => {
      calls.push(data.action);
      if (data.action === 'admin.updatePlace' && network === 'before') {
        throw new Error('synthetic network loss');
      }
      const result = await router(data, { OPENID: 'synthetic-server-identity' });
      if (data.action === 'admin.updatePlace' && network === 'after') {
        throw new Error('synthetic response loss');
      }
      return { result };
    });
    await page.addInitScript(() => {
      let listener = () => {};
      globalThis.__qcInvalidate = () => listener('SIGNED_OUT');
      globalThis.cloudbase = {
        init: () => ({
          auth: {
            getSession: () => globalThis.__qcSession(),
            onAuthStateChange: (callback) => {
              listener = callback;
              return { data: { subscription: { unsubscribe() {} } } };
            },
            signOut: async () => ({ data: {} }),
          },
          callFunction: (request) => globalThis.__qcCall(request),
        }),
      };
    });
    const url = 'http://127.0.0.1:' + server.address().port + '/admin/places.html';
    await page.goto(url);
    await page.locator('#consolePanel').waitFor({ state: 'visible' });
    checks.push('SDK session opens candidate console; browser role grants no server permission');
    await page.waitForFunction(() =>
      globalThis.document.getElementById('loginNotice').textContent.includes('当前 SDK 会话已确认'),
    );
    await page.click('#listButton');
    await page.getByRole('button', { name: /^图书馆 ·/ }).click();
    await page.locator('#placeForm [name=name]').fill('浏览器合成修改');
    await page.click('#saveButton');
    await page.waitForFunction(() =>
      globalThis.document
        .getElementById('actionNotice')
        .textContent.includes('已保存，并重新读取确认'),
    );
    assert.equal(repositories._state.places[0].name, '浏览器合成修改');
    assert.deepEqual(calls.slice(-2), ['admin.updatePlace', 'admin.getPlace']);
    checks.push(
      'actual HTML list → detail → edit → save → frontend reread matches memory repository',
    );
    await page.locator('#placeForm [name=name]').fill('保留的合成草稿');
    grant = false;
    await page.click('#saveButton');
    await page.waitForFunction(() =>
      globalThis.document.getElementById('actionNotice').textContent.includes('没有资料维护权限'),
    );
    assert.equal(await page.locator('#placeForm [name=name]').inputValue(), '保留的合成草稿');
    checks.push('server FORBIDDEN retains draft and renders no success');
    grant = true;
    network = 'after';
    const before = calls.filter((action) => action === 'admin.updatePlace').length;
    await page.click('#saveButton');
    await page.waitForFunction(
      () =>
        !globalThis.document.getElementById('verifyButton').classList.contains('hidden') &&
        !globalThis.document.getElementById('verifyButton').disabled,
    );
    assert.equal(await page.locator('#saveButton').isDisabled(), true);
    await page.click('#verifyButton');
    await page.waitForFunction(() =>
      globalThis.document.getElementById('actionNotice').textContent.includes('原保存结果仍未确认'),
    );
    assert.equal(calls.filter((action) => action === 'admin.updatePlace').length, before + 1);
    assert.equal(await page.locator('#placeForm [name=name]').inputValue(), '保留的合成草稿');
    checks.push(
      'lost write response keeps inputs, blocks duplicate writes and offers read-only verification',
    );
    page.on('dialog', (dialog) => dialog.accept());
    network = '';
    await page.click('#discardButton');
    await page.waitForFunction(
      () => !globalThis.document.getElementById('placeForm').elements.name.disabled,
    );
    assert.equal(await page.locator('#placeForm [name=name]').inputValue(), '保留的合成草稿');
    checks.push('explicit discard rereads confirmed current storage before editing resumes');
    await page.locator('#placeForm [name=name]').fill('失效前的草稿');
    signedIn = false;
    await page.evaluate(() => globalThis.__qcInvalidate());
    await page.locator('#consolePanel').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#placeForm [name=name]').inputValue(), '');
    checks.push('SDK sign-out event closes console and clears private form values');
    signedIn = true;
    enabled = false;
    const callCount = calls.length;
    await page.reload();
    await page.waitForFunction(() =>
      globalThis.document.getElementById('loginNotice').textContent.includes('当前 SDK 会话已确认'),
    );
    assert.equal(await page.locator('#consolePanel').isHidden(), true);
    assert.equal(calls.length, callCount);
    checks.push(
      'default-disabled readiness gate keeps SDK login available and sends no business call',
    );
    enabled = true;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator('#consolePanel').waitFor({ state: 'visible' });
    await page.click('#listButton');
    await page.getByRole('button', { name: /^保留的合成草稿 ·/ }).click();
    assert.equal(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
    checks.push('390px viewport fits place list and edit form without horizontal overflow');
    assert.deepEqual(errors, []);
    checks.push('no uncaught browser errors');
    if (process.env.QC_SCREENSHOT) {
      await page.screenshot({ path: process.env.QC_SCREENSHOT, fullPage: true });
    }
    console.log(
      JSON.stringify(
        {
          environment: 'local synthetic SDK transport + actual router + memory repository',
          browser: await browser.version(),
          checks,
          cloudCalls: 0,
          productionWrites: 0,
        },
        null,
        2,
      ),
    );
    await context.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
