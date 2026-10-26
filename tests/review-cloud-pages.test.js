const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { reviewErrorMessage } = require('../miniprogram/modules/review/reader');
const { backendClient } = require('./helpers/backend-client');
const { createSessionState } = require('../miniprogram/services/session-state');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function load(name, f, { query = {}, reader = f.reader, enabled = true, sessionState } = {}) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(filename);
  const urls = [];
  let definition;
  let demoReads = 0;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: { navigateTo: ({ url }) => urls.push(url), navigateBack() {}, switchTab() {} },
    require(id) {
      if (id.endsWith('/review/session-boundary') && sessionState) {
        const boundary = localRequire(id);
        return {
          ...boundary,
          subscribeReviewSession: (listener) =>
            boundary.subscribeReviewSession(listener, sessionState),
        };
      }
      if (id.endsWith('/config/environment.local')) {
        return { cloudEnabled: enabled, journalDemo: true }; // cloud true must override demo flag.
      }
      if (id.endsWith('/review/reader')) {
        return { reviewReader: reader, reviewErrorMessage };
      }
      if (id.endsWith('/review/demo-store')) {
        return {
          reviewStore: {
            subscribe() {
              demoReads++;
              throw new Error('No synthetic subscription in cloud mode');
            },
          },
        };
      }
      if (id.endsWith('/review/demo-service')) {
        const forbidden = () => {
          demoReads++;
          throw new Error('No demo service in cloud mode');
        };
        return {
          reviewDemoService: {
            calendar: forbidden,
            monthArchive: forbidden,
            getEntry: forbidden,
            distribution: forbidden,
            timeline: forbidden,
            decorations: forbidden,
          },
          createReviewDemoService: forbidden,
        };
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    updates: 0,
    setData(value) {
      Object.assign(this.data, value);
      this.updates++;
    },
  };
  page.onLoad(query);
  return { page, urls, demoReads: () => demoReads };
}

for (const name of ['universe', 'review/month', 'review/detail', 'review/insights']) {
  for (const change of ['clear', 'switch', 'switch-back']) {
    test(
      'cloud ' + name + ' clears visible and late private data on session ' + change,
      async () => {
        const f = backendClient();
        const state = createSessionState();
        const scopeA = 'scope_' + 'a'.repeat(64);
        state.accept(scopeA);
        const saved = await f.save({
          weather: 'CUSTOM',
          weatherName: '合成私有彩虹',
          text: 'SYNTHETIC session A writing',
        });
        const reader = { ...f.reader };
        let hold = false;
        const pending = [];
        for (const method of ['calendar', 'monthArchive', 'getEntry', 'insights']) {
          reader[method] = async (...args) => {
            const result = await f.reader[method](...args);
            if (hold) {
              await new Promise((resolve) => pending.push(resolve));
            }
            return result;
          };
        }
        const { page } = load(name, f, {
          reader,
          sessionState: state,
          query: { month: '2026-10', date: '2026-10-18', id: saved.data.entry.id },
        });
        if (name === 'universe') {
          page._reloadAll('2026-10');
        }
        await settle();
        assert.match(JSON.stringify(page.data), /合成私有彩虹/);
        state.clear();
        assert.doesNotMatch(JSON.stringify(page.data), /合成私有彩虹|SYNTHETIC session A writing/);
        state.accept(scopeA);
        await page.onRetry();
        assert.match(JSON.stringify(page.data), /合成私有彩虹/);
        hold = true;
        const inflight = name === 'universe' ? page._loadMonth('2026-10') : page._reload();
        await settle();
        assert.equal(pending.length, 1);
        f.setActor('b');
        if (change === 'clear') {
          state.clear();
        } else {
          state.accept('scope_' + 'b'.repeat(64));
        }
        if (change === 'switch-back') {
          f.setActor('a');
          state.accept(scopeA);
        }
        pending[0]();
        await inflight;
        assert.doesNotMatch(JSON.stringify(page.data), /合成私有彩虹|SYNTHETIC session A writing/);
        const error = page.data.calendarError || page.data.error || page.data.errorMessage;
        assert.match(error, /登录/);
        // A deliberate new read works in the new session; old results never reappear by themselves.
        hold = false;
        if (change === 'clear') {
          state.accept('scope_' + 'b'.repeat(64));
        }
        await page.onRetry();
        if (change === 'switch-back') {
          assert.match(JSON.stringify(page.data), /合成私有彩虹/);
        } else {
          assert.doesNotMatch(
            JSON.stringify(page.data),
            /合成私有彩虹|SYNTHETIC session A writing/,
          );
        }
        page.onUnload();
        const updates = page.updates;
        state.clear();
        assert.equal(page.updates, updates);
      },
    );
  }
}

test('cloud-mode review pages use actual frontend clients and backend data without demo reads', async () => {
  const f = backendClient();
  const saved = await f.save({ text: 'SYNTHETIC private detail', weather: 'CLOUDY' });
  const pages = ['universe', 'review/month', 'review/detail', 'review/insights'].map((name) => ({
    name,
    ...load(name, f, { query: { month: '2026-10', date: '2026-10-18', id: saved.data.entry.id } }),
  }));
  pages[0].page._reloadAll('2026-10');
  await settle();
  for (const item of pages) {
    assert.equal(item.page.data.isDemo, false, item.name);
    assert.equal(item.demoReads(), 0, item.name);
  }
  const [universe, month, detail, insights] = pages.map((item) => item.page);
  assert.equal(universe.data.monthRecordCount, 1);
  assert.equal(universe.data.weeks.flat().filter((cell) => cell.recorded).length, 1);
  assert.equal(universe.data.calendarError, '');
  assert.equal(month.data.cards[0].id, saved.data.entry.id);
  assert.doesNotMatch(JSON.stringify(month.data), /private detail|ownerId/);
  assert.equal(detail.data.phase, 'ready');
  assert.equal(detail.data.text, 'SYNTHETIC private detail');
  assert.equal(insights.data.timelineItems.length, 1);
  assert.match(insights.data.metaText, /实际记录 1 条/);
  assert.equal(insights.data.error, '');
  for (const { page } of pages) {
    page.onUnload();
  }
});

test('cloud review reload failure removes old private views and never falls back to demo samples', async () => {
  const f = backendClient();
  await f.save({ text: 'SYNTHETIC must disappear' });
  for (const name of ['universe', 'review/month', 'review/detail', 'review/insights']) {
    f.setActor('a');
    const loaded = load(name, f, { query: { month: '2026-10', date: '2026-10-18' } });
    if (name === 'universe') {
      loaded.page._reloadAll('2026-10');
    }
    await settle();
    f.setActor('disabled');
    if (name === 'universe') {
      await loaded.page._loadMonth('2026-10');
    } else {
      await loaded.page._reload();
    }
    const data = loaded.page.data;
    assert.doesNotMatch(JSON.stringify(data), /must disappear|合成演示：/);
    if (name === 'universe') {
      assert.equal(data.weeks.length, 0);
      assert.match(data.calendarError, /停用/);
    }
    if (name === 'review/month') {
      assert.equal(data.cards.length, 0);
      assert.match(data.error, /停用/);
    }
    if (name === 'review/detail') {
      assert.equal(data.phase, 'error');
      assert.equal(data.text, '');
      assert.match(data.errorMessage, /停用/);
    }
    if (name === 'review/insights') {
      assert.equal(data.timelineItems.length, 0);
      assert.equal(data.distRows.length, 0);
      assert.match(data.error, /停用/);
    }
    assert.equal(loaded.demoReads(), 0);
    loaded.page.onUnload();
  }
});

test('cloud review hides private results on hide and rereads after show', async () => {
  const f = backendClient();
  await f.save({ text: 'SYNTHETIC private hidden' });
  for (const name of ['universe', 'review/month', 'review/detail', 'review/insights']) {
    const { page } = load(name, f, { query: { month: '2026-10', date: '2026-10-18' } });
    if (name === 'universe') {
      page._reloadAll('2026-10');
    }
    await settle();
    page.onHide();
    assert.equal(page._suspended, true);
    assert.doesNotMatch(JSON.stringify(page.data), /private hidden/);
    assert.equal((page.data.cards || page.data.weeks || page.data.timelineItems || []).length, 0);
    const count = f.requests.length;
    await page.onRetry();
    assert.equal(f.requests.length, count);
    page.onShow();
    await settle();
    assert.ok(f.requests.length > count);
    page.onUnload();
  }
});

test('cloud detail rejects a stale card after delete/recreate and clears its prior body', async () => {
  const f = backendClient();
  const saved = await f.save({ text: 'SYNTHETIC first body' });
  const { page } = load('review/detail', f, {
    query: { date: '2026-10-18', id: saved.data.entry.id },
  });
  await settle();
  await f.call('journal.delete', { date: '2026-10-18', expectedVersion: 1 });
  await f.save({ text: 'SYNTHETIC new body' });
  await page._reload();
  assert.equal(page.data.phase, 'stale');
  assert.equal(page.data.text, '');
  assert.equal(page.data.tags.length, 0);
  page.onUnload();
});

test('cloud archive opens only the selected valid month without inventing an all-time directory', async () => {
  const f = backendClient();
  const { page, urls, demoReads } = load('review/archive', f, { query: { month: '2026-09' } });
  assert.equal(page.data.months.length, 0);
  assert.equal(f.requests.length, 0);
  page.onOpenSelectedMonth();
  assert.equal(urls[0], '/pages/review/month/index?month=2026-09');
  page.onMonthPick({ detail: { value: '2026-13' } });
  assert.equal(page.data.selectedMonth, '2026-09');
  page.onMonthPick({ detail: { value: '2026-10' } });
  assert.equal(page.data.selectedMonth, '2026-10');
  assert.equal(demoReads(), 0);
  page.onUnload();
});

test('cloud statistics reject inconsistent source snapshots and ignore fixture selection events', async () => {
  const f = backendClient();
  const reader = {
    ...f.reader,
    insights: async () => {
      const error = new Error('SYNTHETIC private error');
      error.code = 'CONFLICT';
      throw error;
    },
  };
  const { page, demoReads } = load('review/insights', f, { reader });
  await settle();
  page.onSampleTap({ currentTarget: { dataset: { id: 'three' } } });
  assert.equal(page.data.sampleId, 'live');
  assert.match(page.data.error, /发生变化/);
  assert.doesNotMatch(page.data.error, /SYNTHETIC/);
  assert.equal(page.data.timelineItems.length, 0);
  assert.equal(demoReads(), 0);
  page.onUnload();
});

test('cloud review discards pending private responses after hiding and avoids duplicate initial show reads', async () => {
  const f = backendClient();
  await f.save({ text: 'SYNTHETIC late body' });
  for (const [name, method, input] of [
    ['universe', 'calendar', '2026-10'],
    ['review/month', 'monthArchive', '2026-10'],
    ['review/detail', 'getEntry', '2026-10-18'],
    ['review/insights', 'insights', 7],
  ]) {
    const result = await f.reader[method](input);
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    let reads = 0;
    const reader = {
      ...f.reader,
      [method]: () => {
        reads++;
        return pending;
      },
    };
    const { page } = load(name, f, { reader, query: { month: '2026-10', date: '2026-10-18' } });
    page.onShow();
    assert.equal(reads, 1, name);
    page.onHide();
    const updates = page.updates;
    finish(result);
    await settle();
    assert.equal(page.updates, updates, name);
    assert.doesNotMatch(JSON.stringify(page.data), /late body/);
    page.onUnload();
  }
});

test('calendar month navigation preserves low-year leap February and clamps four-digit year bounds', async () => {
  const f = backendClient();
  const { page } = load('universe', f);
  page._reloadAll('0000-02');
  await settle();
  assert.equal(page.data.weeks.flat().filter((cell) => !cell.blank).length, 29);
  page._reloadAll('0000-01');
  await settle();
  page.onPreviousMonth();
  await settle();
  assert.equal(page.data.month, '0000-01');
  page._reloadAll('9999-12');
  await settle();
  page.onNextMonth();
  await settle();
  assert.equal(page.data.month, '9999-12');
  assert.equal(page.data.weeks.flat().filter((cell) => !cell.blank).length, 31);
  page.onUnload();
});
