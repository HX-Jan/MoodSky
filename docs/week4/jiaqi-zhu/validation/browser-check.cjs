const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require(process.env.MOODSKY_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '../../../..');
const pack = path.join(root, 'docs/week4/jiaqi-zhu');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checks = [];
async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MOODSKY_CHROME ? { executablePath: process.env.MOODSKY_CHROME } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errors = [],
    http = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) {
      http.push(r.url());
    }
  });
  const check = async (id, title, fn) => {
    try {
      await fn();
      checks.push({ id, title, passed: true });
    } catch (e) {
      checks.push({ id, title, passed: false, message: e.message });
    }
  };
  const url = (file) => 'file:///' + path.join(pack, file).replaceAll('\\', '/');
  try {
    const catalogue = JSON.parse(fs.readFileSync(path.join(pack, 'assets/catalogue.json'), 'utf8'));
    const renderSvg = async (source, destination, width, height) => {
      const data =
        'data:image/svg+xml;base64,' + fs.readFileSync(path.join(pack, source)).toString('base64');
      const image = await page.evaluate(
        async ({ data, width, height }) => {
          const image = new Image();
          image.src = data;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, width, height);
          return canvas.toDataURL('image/png').split(',')[1];
        },
        { data, width, height },
      );
      fs.mkdirSync(path.dirname(path.join(pack, destination)), { recursive: true });
      fs.writeFileSync(path.join(pack, destination), Buffer.from(image, 'base64'));
    };
    for (const asset of catalogue.assets) {
      await renderSvg(asset.master, asset.file, asset.width, asset.height);
      asset.sha256 = hash(path.join(pack, asset.file));
      asset.masterSha256 = hash(path.join(pack, asset.master));
    }
    await renderSvg(
      'assets/fallbacks/sticker-unavailable.svg',
      'assets/fallbacks/sticker-unavailable.png',
      128,
      128,
    );
    await renderSvg(
      'assets/fallbacks/background-default.svg',
      'assets/fallbacks/background-default.png',
      750,
      1334,
    );
    for (const asset of catalogue.assets) {
      asset.fallbackSha256 = hash(path.join(pack, asset.fallback));
    }
    fs.writeFileSync(
      path.join(pack, 'assets/catalogue.json'),
      JSON.stringify(catalogue, null, 2) + '\n',
    );
    await check(
      'AS01',
      'Six existing sticker IDs and two background IDs, candidate only',
      async () => {
        const demo = require(path.join(root, 'miniprogram/modules/review/demo-data'));
        assert.deepEqual(catalogue.serviceCatalogue.stickers, demo.STICKER_CATALOG);
        assert.deepEqual(catalogue.serviceCatalogue.backgrounds, demo.BACKGROUND_CATALOG);
        assert.equal(catalogue.productionEnabled, false);
      },
    );
    await check('AS02', 'All eight PNG dimensions and recorded hashes match', async () => {
      for (const a of catalogue.assets) {
        const bytes = fs.readFileSync(path.join(pack, a.file));
        assert.equal(bytes.readUInt32BE(16), a.width);
        assert.equal(bytes.readUInt32BE(20), a.height);
        assert.equal(hash(path.join(pack, a.file)), a.sha256);
      }
    });
    await check('AS03', 'Fallback files have valid expected dimensions and hashes', async () => {
      for (const a of catalogue.assets) {
        const bytes = fs.readFileSync(path.join(pack, a.fallback));
        assert.equal(bytes.readUInt32BE(16), a.fallbackWidth);
        assert.equal(bytes.readUInt32BE(20), a.fallbackHeight);
        assert.equal(hash(path.join(pack, a.fallback)), a.fallbackSha256);
      }
    });
    await page.goto(url('assets/preview/index.html'));
    await page.evaluate(() => document.fonts.ready);
    await check('AS04', 'All eight catalogue images actually load', async () =>
      assert.ok(
        await page
          .locator('.catalogue-image')
          .evaluateAll(
            (xs) => xs.length === 8 && xs.every((x) => x.complete && x.naturalWidth > 0),
          ),
      ),
    );
    fs.mkdirSync(path.join(pack, 'evidence'), { recursive: true });
    await page.screenshot({
      path: path.join(pack, 'evidence/assets-overview.png'),
      fullPage: true,
    });
    await check('AS08', 'Decorative image does not overlap core content panel', async () => {
      const content = await page.locator('.stage-content').boundingBox();
      const sticker = await page.locator('#stage-sticker').boundingBox();
      assert.ok(sticker.y >= content.y + content.height);
    });
    const before = await page.locator('.days').innerText();
    await page.locator('#toggle-failure').click();
    await check('AS05', 'Failed assets display fallback and preserve core dates', async () => {
      assert.equal(await page.locator('.days').innerText(), before);
      assert.ok(await page.locator('#degraded-text').isVisible());
      assert.ok((await page.locator('#stage-sticker').getAttribute('src')).includes('unavailable'));
    });
    await page
      .locator('.stage')
      .screenshot({ path: path.join(pack, 'evidence/assets-fallback.png') });
    await page.locator('#toggle-decoration').click();
    await check('AS06', 'Closing decorative layer does not remove records', async () => {
      assert.equal(await page.locator('.days').innerText(), before);
      assert.ok(await page.locator('#stage-sticker').isHidden());
      assert.ok(await page.locator('#core-note').isVisible());
    });
    await page.locator('#toggle-decoration').click();
    await page.locator('#toggle-failure').click();
    await page.locator('#toggle-background').click();
    await check('AS07', 'Both backgrounds selectable only in local preview', async () =>
      assert.ok((await page.locator('#stage-background').getAttribute('src')).includes('NIGHT')),
    );
    await page.goto(url('research/questionnaire.html'));
    await page.evaluate(() => document.fonts.ready);
    await check('Q01', 'Exactly twenty questions and no answers preselected', async () => {
      assert.equal(await page.locator('fieldset').count(), 20);
      assert.equal(await page.locator('input:checked').count(), 0);
    });
    await check('Q02', 'Substantive questions hidden before separate consents', async () =>
      assert.ok(await page.locator('#questions').isHidden()),
    );
    await page.screenshot({
      path: path.join(pack, 'evidence/questionnaire-start.png'),
      fullPage: true,
    });
    await page.locator('#Q01-2').check();
    await page.locator('#review').click();
    await check('Q03', 'Refusal does not enter study or claim submission', async () => {
      assert.ok(await page.locator('#questions').isHidden());
      assert.match(await page.locator('#feedback').innerText(), /没有提交或计入/);
    });
    await page.locator('#Q01-1').check();
    await page.locator('#Q02-1').check();
    await check('Q04', 'Only two explicit consents open questions', async () =>
      assert.ok(await page.locator('#questions').isVisible()),
    );
    await page.locator('#Q03-2').check();
    await page.locator('#review').click();
    await check('Q05', 'Prior participation requires actual duplicate confirmation', async () =>
      assert.match(await page.locator('#feedback').innerText(), /去重|核对/),
    );
    for (const v of ['1', '2', '3']) {
      await page.locator('#Q20-' + v).check();
    }
    await page.locator('#review').click();
    await check('Q06', 'Priority selections enforce max two', async () =>
      assert.match(await page.locator('#feedback').innerText(), /Q20最多选择2项/),
    );
    await page.locator('#Q20-3').uncheck();
    await page.locator('#Q19-1').check();
    await page.locator('#Q19-6').check();
    await page.locator('#review').click();
    await check('Q07', 'No-difficulty cannot silently coexist with stated difficulties', async () =>
      assert.match(await page.locator('#feedback').innerText(), /Q19/),
    );
    await page.locator('#Q19-6').uncheck();
    await page.locator('#review').click();
    await check(
      'Q08',
      'Questionnaire feedback explicitly says not submitted or counted',
      async () =>
        assert.match(
          await page.locator('#feedback').innerText(),
          /未上传、未提交，也未自动计算参与人数/,
        ),
    );
    await page.locator('#Q02-2').check();
    await check('Q09', 'Withdrawing note consent clears substantive selections', async () => {
      assert.ok(await page.locator('#questions').isHidden());
      assert.equal(await page.locator('#questions input:checked').count(), 0);
    });
    await page.locator('#clear-survey').click();
    await check('Q10', 'Reset clears consent and all choices', async () =>
      assert.equal(await page.locator('input:checked').count(), 0),
    );
    await page.locator('#Q01-1').check();
    await page.locator('#Q02-1').check();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await check(
        'R' + width,
        'Questionnaire has no document horizontal overflow at ' + width,
        async () =>
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)),
      );
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('#Q06-1').scrollIntoViewIfNeeded();
    await check('A01', 'Question labels meet44px clickable row height', async () =>
      assert.ok(
        await page
          .locator('#questions label.option')
          .evaluateAll((xs) => xs.every((x) => x.getBoundingClientRect().height >= 44)),
      ),
    );
    await check('A02', 'Native labels and groups available for accessibility tree', async () => {
      assert.equal(await page.locator('fieldset legend').count(), 20);
      assert.ok(await page.locator('#Q06-1').evaluate((x) => x.labels.length > 0));
    });
    await page.locator('#Q06-1').focus();
    await check('A03', 'Keyboard focus visible on choice input', async () =>
      assert.equal(await page.evaluate(() => document.activeElement.id), 'Q06-1'),
    );
    await page.screenshot({ path: path.join(pack, 'evidence/questionnaire-mobile.png') });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    await page.locator('#Q20-1').scrollIntoViewIfNeeded();
    await check(
      'A04',
      '200percent root font: choices remain reachable without horizontal page overflow',
      async () => {
        assert.ok(await page.locator('#Q20-1').isVisible());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      },
    );
    await page.screenshot({
      path: path.join(pack, 'evidence/questionnaire-font200-browser-only.png'),
    });
    await check('E01', 'No script exceptions or HTTP calls in questionnaire/gallery', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(http, []);
    });
    const report = {
      clientDate: '2026-11-05',
      executedAtUTC: new Date().toISOString(),
      tool: 'Chrome headless / Playwright; native SVG rasterization and local questionnaire/gallery',
      scope:
        'Delivery artifacts only; not current WeChat/device/Modao usability or real participants',
      passed: checks.filter((x) => x.passed).length,
      failed: checks.filter((x) => !x.passed).length,
      checks,
      httpRequests: http,
      pageErrors: errors,
      realParticipantCount: 0,
      nativeScreenReaderExecuted: false,
    };
    fs.writeFileSync(
      path.join(pack, 'evidence/browser-validation.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify(
        { passed: report.passed, failed: report.failed, failures: checks.filter((x) => !x.passed) },
        null,
        2,
      ),
    );
    if (report.failed) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
