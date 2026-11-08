// Local synthetic transport, actual HTML/auth/controller/router and memory repository.
// No CloudBase environment or real identity is used. External HTTP is blocked.
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
const output = process.env.QC_BROWSER_OUTPUT;
const repositories = createMemoryRepositories(fixtures);
let enabled = true,
  signedIn = true,
  grant = true,
  lostReview = false;
const calls = [],
  checks = [],
  errors = [];
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
  res.setHeader(
    'Content-Type',
    filename.endsWith('.js')
      ? 'text/javascript'
      : filename.endsWith('.css')
        ? 'text/css'
        : 'text/html; charset=utf-8',
  );
  if (filename === path.join(root, 'admin/config.js')) {
    res.end(
      'globalThis.MOODSKY_ADMIN_CONFIG=' +
        JSON.stringify({
          envId: 'synthetic-local-only',
          placeMaintenanceEnabled: enabled,
          catalogueMaintenanceEnabled: enabled,
        }) +
        ';',
    );
    return;
  }
  try {
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
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) =>
      dialog.type() === 'beforeunload' ? dialog.accept() : dialog.accept(),
    );
    await page.exposeFunction('__qcSession', () =>
      signedIn
        ? { data: { session: {}, user: { id: 'synthetic_web_operator', role: 'data_operator' } } }
        : { data: {} },
    );
    await page.exposeFunction('__qcSignOut', () => {
      signedIn = false;
      return { data: {} };
    });
    await page.exposeFunction('__qcCall', async ({ data }) => {
      calls.push(data.action);
      const result = await router(data, { OPENID: 'synthetic_server_identity' });
      if (data.action === 'admin.reviewCorrection' && lostReview) {
        throw new Error('synthetic lost response');
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
            signOut: () => globalThis.__qcSignOut(),
            onAuthStateChange(callback) {
              listener = callback;
              return { data: { subscription: { unsubscribe() {} } } };
            },
          },
          callFunction: (request) => globalThis.__qcCall(request),
        }),
      };
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    const waitText = (id, text) =>
      page.waitForFunction(
        ([name, value]) => globalThis.document.getElementById(name).textContent.includes(value),
        [id, text],
      );
    await page.goto(base + '/admin/places.html');
    await waitText('loginNotice', '当前 SDK 会话已确认');
    await page.click('#listButton');
    await page.getByRole('button', { name: /^图书馆 ·/ }).click();
    await page.locator('[name=recommendationReason]').fill('合成理由：安静短休');
    await page.locator('[name=directions]').fill('合成文字方位：从广场向东');
    await page.locator('[name=entryRestrictions]').fill('合成限制：以现场开放安排为准');
    await page.click('#saveButton');
    await waitText('actionNotice', '已保存，并重新读取确认');
    assert.equal(repositories._state.places[0].directions, '合成文字方位：从广场向东');
    checks.push(
      'places actual form saves all three metadata fields and rereads exact stored values',
    );
    if (output) {
      await fs.mkdir(output, { recursive: true });
      await page.screenshot({ path: path.join(output, 'places.png'), fullPage: true });
    }
    await page.click('a[href="catalogue.html"]');
    await waitText('loginNotice', '当前 SDK 会话已确认');
    await page.click('#listButton');
    await waitText('actionNotice', '保存服务尚未接通');
    assert.equal(await page.locator('#catalogueList li').count(), 3);
    await page.selectOption('#kind', 'resources');
    await page.click('#listButton');
    await page.waitForFunction(() =>
      globalThis.document.querySelector('#catalogueList').textContent.includes('心理支持热线'),
    );
    assert.equal(await page.locator('#reviewPanel').isHidden(), true);
    checks.push(
      'reachable catalogue navigation reads templates/resources and exposes read-only capability',
    );
    await page.selectOption('#kind', 'corrections');
    await page.click('#listButton');
    await page.getByRole('button', { name: /^p_library · pending/ }).click();
    await page.selectOption('[name=decision]', 'approved');
    await page.locator('[name=note]').fill('合成审核备注');
    grant = false;
    await page.click('#reviewButton');
    await waitText('actionNotice', '没有资料维护权限');
    assert.equal(await page.locator('[name=note]').inputValue(), '合成审核备注');
    assert.equal(
      repositories._state.writeLog.filter((x) => x.collection === 'corrections').length,
      0,
    );
    checks.push('server FORBIDDEN retains review draft without a write or success');
    grant = true;
    lostReview = true;
    await page.click('#reviewButton');
    await waitText('actionNotice', '网络请求未完成');
    assert.equal(await page.locator('#reviewButton').isDisabled(), true);
    await page.click('#verifyButton');
    await waitText('actionNotice', '原提交结果仍未确认');
    assert.equal(await page.locator('[name=note]').inputValue(), '合成审核备注');
    assert.equal(calls.filter((x) => x === 'admin.reviewCorrection').length, 2);
    assert.equal(
      repositories._state.writeLog.filter((x) => x.collection === 'corrections').length,
      1,
    );
    checks.push(
      'lost review response blocks duplicate writes; explicit verification reads only and retains draft',
    );
    lostReview = false;
    await page.click('#discardButton');
    await waitText('actionNotice', '审核仅记录');
    await page.getByRole('button', { name: /^p_library · approved/ }).click();
    assert.equal(await page.locator('#reviewButton').isDisabled(), true);
    assert.equal(repositories._state.places[0].openHours, fixtures.places[0].openHours);
    checks.push('discard+reread shows terminal review; approval does not edit place');
    repositories._state.corrections.push({
      _id: 'synthetic_second',
      ownerId: 'synthetic_owner',
      placeId: 'p_library',
      text: '<img src=x onerror=alert(1)> 合成纠错',
      status: 'pending',
      createdAt: '2026-10-22T00:00:00Z',
    });
    await page.click('#listButton');
    await page.getByRole('button', { name: /^p_library · pending/ }).click();
    await page.selectOption('[name=decision]', 'rejected');
    await page.locator('[name=note]').fill('合成拒绝理由');
    await page.click('#reviewButton');
    await waitText('actionNotice', '审核状态已重新读取确认');
    assert.equal(repositories._state.corrections[1].status, 'rejected');
    assert.equal(await page.locator('#correctionText img').count(), 0);
    checks.push(
      'confirmed review requires matching frontend reread and renders correction text safely',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
    if (output) {
      await page.locator('#reviewPanel').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, 'catalogue-mobile.png') });
    }
    checks.push('390px viewport has no horizontal overflow');
    signedIn = false;
    await page.evaluate(() => globalThis.__qcInvalidate());
    await page.locator('#consolePanel').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[name=note]').inputValue(), '');
    assert.equal(await page.locator('#catalogueList li').count(), 0);
    checks.push('session invalidation clears review fields and private queue');
    signedIn = true;
    await page.click('#refreshSession');
    await waitText('loginNotice', '当前 SDK 会话已确认');
    await page.click('#logoutButton');
    await waitText('loginNotice', 'SDK 已确认退出');
    assert.equal(await page.locator('#consolePanel').isHidden(), true);
    checks.push('explicit SDK logout closes console');
    signedIn = true;
    enabled = false;
    const before = calls.length;
    await page.reload();
    await waitText('loginNotice', '当前 SDK 会话已确认');
    assert.equal(await page.locator('#consolePanel').isHidden(), true);
    assert.equal(calls.length, before);
    checks.push('default-disabled catalogue sends no business calls');
    assert.deepEqual(errors, []);
    const report = {
      environment: 'local synthetic SDK transport, actual HTML/auth/router, memory repository',
      browser: await browser.version(),
      checks,
      uncaughtErrors: errors,
      realCloudCalls: 0,
      productionWrites: 0,
    };
    if (output) {
      await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
    }
    console.log(JSON.stringify(report, null, 2));
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
