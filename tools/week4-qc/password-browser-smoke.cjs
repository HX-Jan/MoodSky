// Synthetic credentials and SDK transport only. External network is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.QC_BROWSER_OUTPUT;
let mode = 'fail',
  signedIn = false,
  method = 'password',
  enabled = false,
  signoutsFail = false;
let attempts = 0,
  businessCalls = 0,
  release;
const checks = [],
  errors = [];
const sessionData = () => ({ session: {}, user: { id: 'synthetic-user', role: 'data_operator' } });
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/admin/config.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(
      'globalThis.MOODSKY_ADMIN_CONFIG=' +
        JSON.stringify({
          envId: 'synthetic-only',
          loginMethod: method,
          placeMaintenanceEnabled: enabled,
          catalogueMaintenanceEnabled: enabled,
        }) +
        ';',
    );
    return;
  }
  if (!/^\/admin\/[a-z.-]+$/.test(pathname)) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.setHeader(
      'Content-Type',
      pathname.endsWith('.js')
        ? 'text/javascript'
        : pathname.endsWith('.css')
          ? 'text/css'
          : 'text/html; charset=utf-8',
    );
    res.end(await fs.readFile(path.join(root, pathname)));
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
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.exposeFunction('__passwordSession', () =>
      signedIn ? { data: sessionData() } : { data: {} },
    );
    await page.exposeFunction('__passwordSignIn', async (input) => {
      attempts++;
      assert.deepEqual(input, { username: 'synthetic-user', password: 'synthetic-password' });
      if (mode === 'hold') {
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      if (mode === 'fail') {
        return { error: new Error('synthetic-private-error') };
      }
      if (mode === 'mismatch') {
        return { data: sessionData() };
      }
      signedIn = true;
      return { data: sessionData() };
    });
    await page.exposeFunction('__passwordSignOut', () => {
      if (signoutsFail) {
        throw new Error('synthetic-private-error');
      }
      signedIn = false;
      return { data: {} };
    });
    await page.exposeFunction('__passwordCall', ({ data }) => {
      businessCalls++;
      return {
        result: {
          apiVersion: '1',
          requestId: data.requestId,
          ok: false,
          error: { code: 'FORBIDDEN', message: 'Synthetic server rejection' },
        },
      };
    });
    await page.addInitScript(() => {
      globalThis.cloudbase = {
        init: () => ({
          auth: {
            getSession: () => globalThis.__passwordSession(),
            signInWithPassword: (input) => globalThis.__passwordSignIn(input),
            signOut: () => globalThis.__passwordSignOut(),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          },
          callFunction: (input) => globalThis.__passwordCall(input),
        }),
      };
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    const login = base + '/admin/login.html';
    const notice = (text) =>
      page.waitForFunction(
        (value) => globalThis.document.getElementById('loginNotice').textContent.includes(value),
        text,
      );
    const fill = async () => {
      await page.fill('#username', 'synthetic-user');
      await page.fill('#password', 'synthetic-password');
    };
    await page.goto(base + '/admin/places.html');
    await notice('登录未确认');
    await page.click('#loginButton');
    await page.waitForURL(login + '?returnTo=places.html');
    await page.waitForFunction(() => !globalThis.document.getElementById('submitButton').disabled);
    checks.push('actual places login button reaches password form with a fixed return page');
    if (output) {
      await fs.mkdir(output, { recursive: true });
      await page.screenshot({ path: path.join(output, 'password-login.png') });
    }
    await fill();
    await page.click('#submitButton');
    await notice('登录未确认');
    assert.equal(await page.inputValue('#password'), '');
    assert.equal(
      await page
        .locator('body')
        .textContent()
        .then((x) => x.includes('synthetic-private-error')),
      false,
    );
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(globalThis.localStorage).includes('synthetic-password'),
      ),
      false,
    );
    assert.equal(businessCalls, 0);
    checks.push(
      'failed login clears password, hides raw SDK errors and stores no application credentials',
    );
    mode = 'hold';
    await fill();
    await page.click('#submitButton');
    await page.waitForFunction(() => globalThis.document.getElementById('submitButton').disabled);
    const before = attempts;
    await page.locator('#passwordForm').dispatchEvent('submit');
    assert.equal(attempts, before);
    mode = 'mismatch';
    release();
    await notice('登录未确认');
    assert.equal(page.url(), login + '?returnTo=places.html');
    checks.push('pending login blocks duplicate submits and mismatched reread never navigates');
    await fill();
    await page.evaluate(() =>
      globalThis.dispatchEvent(new globalThis.PageTransitionEvent('pagehide')),
    );
    assert.equal(await page.inputValue('#password'), '');
    assert.equal(await page.inputValue('#username'), '');
    await page.evaluate(() =>
      globalThis.dispatchEvent(new globalThis.PageTransitionEvent('pageshow', { persisted: true })),
    );
    await notice('请输入应用测试账号');
    assert.equal(attempts, before);
    checks.push(
      'page lifecycle handlers clear credentials and recheck session without replaying login',
    );
    mode = 'success';
    enabled = true;
    await fill();
    await page.click('#submitButton');
    await page.waitForURL(base + '/admin/places.html');
    await notice('当前 SDK 会话已确认');
    await page.click('#listButton');
    await page.waitForFunction(() =>
      globalThis.document.getElementById('actionNotice').textContent.includes('没有资料维护权限'),
    );
    assert.equal(businessCalls, 1);
    checks.push(
      'password success and matching session return to places; server FORBIDDEN still blocks browser role',
    );
    signedIn = false;
    enabled = false;
    await page.goto(login + '?returnTo=https%3A%2F%2Fexample.invalid');
    await page.waitForFunction(() => !globalThis.document.getElementById('submitButton').disabled);
    await fill();
    await page.click('#submitButton');
    await page.waitForURL(base + '/admin/index.html');
    checks.push('untrusted return target falls back to the same-directory admin index');
    await page.goto(login + '?returnTo=catalogue.html');
    await notice('已有已登录的应用会话');
    signoutsFail = true;
    await page.click('#logoutButton');
    await notice('尚未确认退出');
    assert.equal(await page.locator('#passwordForm').isHidden(), true);
    signoutsFail = false;
    await page.click('#logoutButton');
    await notice('SDK 已确认退出');
    await fill();
    await page.click('#submitButton');
    await page.waitForURL(base + '/admin/catalogue.html');
    await notice('当前 SDK 会话已确认');
    assert.equal(await page.locator('#consolePanel').isHidden(), true);
    assert.equal(businessCalls, 1);
    checks.push(
      'existing session requires confirmed signout for switching; default-disabled catalogue makes no business call',
    );
    method = 'oauth';
    signedIn = false;
    await page.goto(login);
    await notice('账号登录尚未就绪');
    assert.equal(await page.locator('#passwordForm').isHidden(), true);
    checks.push('password form remains disabled when another login method is configured');
    assert.deepEqual(errors, []);
    const report = {
      date: '2026-11-07',
      environment: 'synthetic SDK transport, actual HTML and login navigation',
      browser: browser.version(),
      checks,
      uncaughtErrors: errors,
      realCloudCalls: 0,
      realIdentityVerified: false,
      businessWrites: 0,
    };
    if (output) {
      await fs.writeFile(
        path.join(output, 'password-browser.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
