const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.MOODSKY_PLAYWRIGHT || 'playwright');
const pack = path.resolve(__dirname, '..');
const output = path.join(pack, 'evidence');
const checks = [];
async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MOODSKY_CHROME ? { executablePath: process.env.MOODSKY_CHROME } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1040 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  const network = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) {
      network.push(request.url());
    }
  });
  const click = (action) => page.locator(`[data-action="${action}"]`).first().click();
  const state = () => page.evaluate(() => window.w3Prototype.inspect());
  const shot = (name) =>
    page.locator('.device').screenshot({ path: path.join(output, name + '.png') });
  const check = async (id, title, callback) => {
    try {
      await callback();
      checks.push({ id, title, passed: true });
    } catch (error) {
      checks.push({ id, title, passed: false, message: error.message });
    }
  };
  const reset = () => page.locator('#reset-demo').click();
  try {
    await page.goto('file:///' + path.join(pack, 'preview/index.html').replaceAll('\\', '/'));
    await page.evaluate(() => document.fonts.ready);
    await check('B01', 'Seven current choices with no eighth heavy-rain item', async () => {
      assert.equal(await page.locator('.weather-choice').count(), 7);
      assert.deepEqual(
        await page.locator('.weather-label, .weather-choice > span').allTextContents(),
        ['晴天', '多云', '阴天', '雨天', '雷雨', '台风', '自定义'],
      );
    });
    await check('B02', 'Mandatory weather disables save while body optional', async () =>
      assert.ok(await page.locator('[data-action="save"]').isDisabled()),
    );
    await shot('proposal-today-seven');
    await page.screenshot({ path: path.join(output, 'proposal-desk.png'), fullPage: true });
    for (const [code, label] of [
      ['SUNNY', '晴天'],
      ['PARTLY_CLOUDY', '多云'],
      ['CLOUDY', '阴天'],
      ['RAINY', '雨天'],
      ['STORMY', '雷雨'],
      ['TYPHOON', '台风'],
    ]) {
      await reset();
      await click('weather:' + code);
      await click('save');
      await click('open-entry');
      await check('W-' + code, 'Weather-only save/detail round trip ' + code, async () => {
        const s = await state();
        assert.equal(s.entry.weather, code);
        assert.equal(s.entry.text, '');
        assert.equal(s.entry.weatherName, undefined);
        assert.match(await page.locator('.saved-weather').innerText(), new RegExp(label));
      });
    }
    await reset();
    await click('weather:CUSTOM');
    await check('C01', 'Empty CUSTOM name blocks save and explains requirement', async () => {
      assert.ok(await page.locator('[data-action="save"]').isDisabled());
      assert.match(await page.locator('#custom-name-error').innerText(), /1—20/);
    });
    await page.locator('#custom-name').fill('   ');
    await check('C02', 'Whitespace-only name blocks save', async () =>
      assert.ok(await page.locator('[data-action="save"]').isDisabled()),
    );
    await page.locator('#custom-name').fill('🌱'.repeat(20));
    await check('C03', '20 emoji code points accepted and counter correct', async () => {
      assert.equal(await page.locator('#custom-name-count').innerText(), '20/20');
      assert.equal(await page.locator('[data-action="save"]').isDisabled(), false);
    });
    await page.locator('#custom-name').fill('🌱'.repeat(21));
    await check('C04', '21 code points rejected', async () =>
      assert.ok(await page.locator('[data-action="save"]').isDisabled()),
    );
    await page.locator('#custom-name').fill('  合成雨后彩虹🌈  ');
    await shot('proposal-custom-editor');
    await click('save');
    await check('C05', 'CUSTOM trim preserved in local entry separate from body', async () => {
      const s = await state();
      assert.equal(s.entry.weatherName, '合成雨后彩虹🌈');
      assert.equal(s.entry.text, '');
    });
    await click('nav:universe');
    await check('C06', 'Archive shows private name but hides body', async () => {
      assert.match(
        await page
          .locator('.list-record')
          .allTextContents()
          .then((x) => x.join(' ')),
        /合成雨后彩虹🌈/,
      );
      assert.equal((await state()).records.find((x) => x.weather === 'CUSTOM').text, '');
    });
    await shot('proposal-universe-custom');
    await click('detail:2026-10-28');
    await click('edit-selected');
    await check('C07', 'Editing retains original date and custom name', async () => {
      assert.equal((await state()).date, '2026-10-28');
      assert.equal(await page.locator('#custom-name').inputValue(), '合成雨后彩虹🌈');
    });
    await click('weather:RAINY');
    await click('save');
    await check('C08', 'Switching to standard weather removes CUSTOM metadata', async () =>
      assert.equal((await state()).entry.weatherName, undefined),
    );
    await reset();
    await click('weather:CUSTOM');
    await page.locator('#custom-name').fill('合成未知结果');
    await page.locator('#scenario-uncertain').click();
    await click('save');
    const original = (await state()).pending;
    await check('R01', 'Unknown result freezes original request including CUSTOM', async () => {
      assert.equal(original.weatherName, '合成未知结果');
      assert.equal(original.requestId, 'w3-demo-1');
      assert.ok(await page.locator('#custom-name').isDisabled());
    });
    await shot('proposal-unknown-result');
    await click('nav:me');
    await check('R02', 'Unknown result blocks navigation', async () =>
      assert.equal((await state()).page, 'today'),
    );
    await click('retry-save');
    await check('R03', 'Retry reuses ID/payload with one date record', async () => {
      const s = await state();
      assert.deepEqual(s.retryIds, [original.requestId]);
      assert.equal(s.entry.weatherName, original.weatherName);
      assert.equal(s.records.filter((x) => x.date === '2026-10-28').length, 1);
    });
    await click('edit-entry');
    await page.locator('#custom-name').fill('合成待保存');
    await page.locator('#journal-text').fill('合成练习正文，不是真实日记');
    await click('nav:me');
    await check('D01', 'Leaving dirty saved-entry editor requires choice', async () =>
      assert.ok(await page.locator('#discard-dialog').evaluate((x) => x.open)),
    );
    await page.screenshot({ path: path.join(output, 'proposal-unsaved-dialog.png') });
    await page.locator('#keep-draft').click();
    await check('D02', 'Keep retains name and body', async () => {
      assert.equal(await page.locator('#custom-name').inputValue(), '合成待保存');
      assert.match(await page.locator('#journal-text').inputValue(), /合成练习正文/);
    });
    await click('nav:me');
    await page.locator('#discard-draft').click();
    await check(
      'M01',
      'Me proposal does not expose synthetic account export/closure buttons',
      async () => {
        const text = await page.locator('.screen').innerText();
        assert.match(text, /独立网页/);
        assert.equal(
          await page.locator('[data-action="export-info"],[data-action="closure-info"]').count(),
          0,
        );
      },
    );
    await shot('proposal-me');
    await click('nav:privacy');
    for (const code of [
      'unavailable',
      'export_processing',
      'export_ready',
      'export_expired',
      'account_disabled',
      'cleanup_processing',
      'cleanup_done',
    ]) {
      await page.locator('#lifecycle-state').selectOption(code);
      await check('L-' + code, 'Lifecycle explanation only: ' + code, async () => {
        assert.equal((await state()).lifecycleState, code);
        assert.equal(
          await page.locator('[data-action="export-info"],[data-action="closure-info"]').count(),
          0,
        );
        assert.match(await page.locator('.screen').innerText(), /没有真实操作/);
      });
    }
    await shot('proposal-lifecycle-copy');
    await click('nav:campus');
    await check('P01', 'Campus fixed simulation does not display private CUSTOM name', async () => {
      const text = await page.locator('.screen').innerText();
      assert.match(text, /固定模拟/);
      assert.ok(!text.includes('合成未知结果'));
    });
    await shot('proposal-campus');
    await click('nav:tasks');
    await click('task:skip');
    await check('T01', 'Skipping task has no journal penalty', async () => {
      assert.match(await page.locator('.feedback').innerText(), /不影响任何记录/);
      assert.equal((await state()).entry.weatherName, '合成未知结果');
    });
    await shot('proposal-task-skip');
    await reset();
    await page.locator('#service-mode').selectOption('unavailable');
    await click('weather:CUSTOM');
    await page.locator('#custom-name').fill('合成保留输入');
    await click('save');
    await check('F01', 'Unimplemented save keeps custom input and no fake success', async () => {
      assert.equal((await state()).entry, null);
      assert.equal(await page.locator('#custom-name').inputValue(), '合成保留输入');
      assert.match(await page.locator('.feedback').innerText(), /没有保存/);
    });
    await shot('proposal-unimplemented');
    await click('nav:universe');
    await page.locator('#discard-draft').click();
    await check('F02', 'Unavailable review is not a confirmed empty month', async () => {
      assert.equal(await page.locator('.calendar-grid').count(), 0);
      assert.match(await page.locator('.screen').innerText(), /尚未连接/);
    });
    await reset();
    await page.locator('#scenario-loading').click();
    await check('F03', 'Read failure is explicit, retry keeps selected month', async () => {
      const month = (await state()).month;
      assert.match(await page.locator('.feedback').innerText(), /读取失败/);
      await click('review-retry');
      assert.equal((await state()).month, month);
    });
    await reset();
    await page.locator('[data-action="weather:CUSTOM"]').focus();
    await page.keyboard.press('Enter');
    await check('A01', 'Keyboard selected control retains focus and pressed state', async () => {
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.action),
        'weather:CUSTOM',
      );
      assert.equal(
        await page.locator('[data-action="weather:CUSTOM"]').getAttribute('aria-pressed'),
        'true',
      );
    });
    await check('A02', 'CUSTOM input has native label and error/help association', async () => {
      assert.equal(await page.locator('label[for="custom-name"]').count(), 1);
      assert.match(
        await page.locator('#custom-name').getAttribute('aria-describedby'),
        /custom-name-error/,
      );
    });
    await page.locator('#custom-name').fill('合成'.repeat(10));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1040 });
      await check('V' + width, 'No document horizontal overflow at ' + width, async () =>
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ),
      );
    }
    await page.setViewportSize({ width: 390, height: 1040 });
    await check('A03', 'Prototype date navigation hits at least44px', async () => {
      const boxes = await page.locator('.date-controls button').evaluateAll((xs) =>
        xs.map((x) => ({
          w: x.getBoundingClientRect().width,
          h: x.getBoundingClientRect().height,
        })),
      );
      assert.ok(boxes.every((x) => x.w >= 44 && x.h >= 44));
    });
    await page.evaluate(() => {
      const entries = [...document.querySelectorAll('.device *')].map((el) => ({
        el,
        size: parseFloat(getComputedStyle(el).fontSize),
      }));
      for (const { el, size } of entries) {
        el.style.fontSize = size * 2 + 'px';
      }
    });
    await check(
      'A04',
      '200percent CSS font override: draft input and save remain reachable',
      async () => {
        await page.locator('#custom-name').scrollIntoViewIfNeeded();
        assert.ok(await page.locator('#custom-name').isVisible());
        await page.locator('[data-action="save"]').scrollIntoViewIfNeeded();
        assert.ok(await page.locator('[data-action="save"]').isVisible());
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        );
      },
    );
    await shot('proposal-font200-browser-only');
    await check('A05', 'All weather assets loaded', async () =>
      assert.ok(
        await page
          .locator('.weather-choice img')
          .evaluateAll((xs) => xs.every((x) => x.complete && x.naturalWidth > 0)),
      ),
    );
    await check('E01', 'No JS exceptions or HTTP service requests', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(network, []);
    });
    const report = {
      clientDate: '2026-10-28',
      executedAtUTC: new Date().toISOString(),
      tool: 'Chrome headless / Playwright; local independent W3 prototype',
      sourceCommit: JSON.parse(fs.readFileSync(path.join(pack, 'data/baseline.json'), 'utf8'))
        .sourceCommit,
      scope:
        'Browser design proposal only; no native WeChat, phone, real cloud, screen reader or participants',
      fontEnlargementScope:
        'CSS computed font override200% in browser, not native system font setting or full WCAG certification',
      passed: checks.filter((x) => x.passed).length,
      failed: checks.filter((x) => !x.passed).length,
      checks,
      pageErrors: errors,
      httpRequests: network,
    };
    fs.writeFileSync(
      path.join(output, 'browser-validation.json'),
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
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
