// W2 回顾前端任务（Zhifeng Dai）：
// - W2 Z02 月历与月份档案接入正式 service（空月 / 有记录月 / 切月 / 网络失败）
// - W2 Z03 详情与记录变化同步（跨页刷新 / 旧 ID / 缓存不复活 / 账号切换无残留 / 页面卸载）
// - W2 Z04 distribution 与 timeline 的 service 适配（0/2/3 条 / 跨窗口 / 分母 / 阻塞标识）
// - W2 Z05 装饰降级与回顾验收（可用 / 未实现 / 素材降级 / 旧月份响应隔离）
// 全部使用合成样本与候选后端（candidate-router）验证，不改动生产契约。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { AppError } = require('../miniprogram/shared/result');
const { backendClient } = require('./helpers/backend-client');
const { reviewErrorMessage } = require('../miniprogram/modules/review/reader');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function load(name, f, { query = {}, reader, enabled = true, cloudDecorationService } = {}) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: { navigateTo: () => {}, navigateBack() {}, switchTab() {} },
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return enabled
          ? { cloudEnabled: true, cloudEnvId: 'synthetic_no_network', journalDemo: true } // cloud true must override demo flag.
          : { cloudEnabled: false, journalDemo: true };
      }
      if (id.endsWith('/review/reader')) {
        if (!enabled) {
          return localRequire(id); // demo mode keeps the real reader module (unused by demo flow).
        }
        return { reviewReader: reader || f.reader, reviewErrorMessage };
      }
      if (id.endsWith('/review/demo-store')) {
        if (!enabled) {
          return localRequire(id); // demo mode uses the real demo review store singleton.
        }
        return {
          reviewStore: {
            subscribe() {
              throw new Error('No synthetic subscription in cloud mode');
            },
          },
        };
      }
      if (id.endsWith('/review/demo-service')) {
        if (!enabled) {
          return localRequire(id); // demo mode uses the real demo review service singleton.
        }
        const forbidden = () => {
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
      if (id.endsWith('/review/service')) {
        // W2 Z05：云模式装饰走正式 review.decorations 契约；测试注入受控替身。
        if (cloudDecorationService) {
          return cloudDecorationService;
        }
        return new Proxy(
          {},
          {
            get() {
              throw new Error('cloud universe must not probe decorations unexpectedly');
            },
          },
        );
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  page.onLoad(query);
  return { page };
}

test('W2 Z02 cloud calendar renders an empty month as blank grid and empty archive', async () => {
  const f = backendClient();
  const universe = load('universe', f).page;
  universe._reloadAll('2026-09');
  await settle();
  assert.equal(universe.data.month, '2026-09');
  assert.equal(universe.data.monthRecordCount, 0);
  assert.equal(universe.data.monthSummary, '本月暂无记录');
  assert.equal(universe.data.calendarError, '');
  const days = universe.data.weeks.flat().filter((cell) => !cell.blank);
  assert.equal(days.length, 30); // 2026-09 有 30 天，无记录日保持留白
  assert.ok(days.every((cell) => !cell.recorded && !cell.id));

  const month = load('review/month', f, { query: { month: '2026-09' } }).page;
  await settle();
  assert.equal(month.data.loading, false);
  assert.equal(month.data.recordCount, 0);
  assert.deepEqual(month.data.cards, []);
  assert.equal(month.data.error, '');
  universe.onUnload();
  month.onUnload();
});

test('W2 Z02 cloud calendar network failure keeps the page empty and recovers on retry', async () => {
  const f = backendClient();
  await f.save({ text: 'SYNTHETIC october entry' });
  let failing = true;
  const reader = {
    ...f.reader,
    calendar: async (month) => {
      if (failing) {
        throw new AppError('NETWORK_ERROR', 'SYNTHETIC network failure');
      }
      return f.reader.calendar(month);
    },
  };
  const universe = load('universe', f, { reader }).page;
  universe._reloadAll('2026-10');
  await settle();
  assert.match(universe.data.calendarError, /连接失败，请重新读取。/);
  assert.equal(universe.data.weeks.length, 0);
  assert.equal(universe.data.monthRecordCount, 0);

  failing = false;
  await universe.onRetry();
  await settle();
  assert.equal(universe.data.calendarError, '');
  assert.equal(universe.data.monthRecordCount, 1);
  universe.onUnload();
});

test('W2 Z02 late cloud calendar response cannot replace a newer month selection', async () => {
  const f = backendClient();
  await f.save({});
  const pending = deferred();
  let firstCalendar = true;
  const reader = {
    ...f.reader,
    calendar: (month) => {
      if (firstCalendar) {
        firstCalendar = false; // 挂起首次（onLoad）月历响应，制造“迟到响应”。
        return pending.promise;
      }
      return f.reader.calendar(month);
    },
  };
  const universe = load('universe', f, { reader }).page;
  await settle();
  universe._reloadAll('2026-09');
  await settle();
  assert.equal(universe.data.month, '2026-09');
  assert.equal(universe.data.monthRecordCount, 0);

  pending.resolve(await f.reader.calendar('2026-10'));
  await settle();
  // 迟到的首次响应被序列令牌丢弃，当前视图仍是 2026-09。
  assert.equal(universe.data.month, '2026-09');
  assert.equal(universe.data.monthRecordCount, 0);
  universe.onUnload();
});

test('W2 Z03 delete syncs universe, archive and detail; recreated records open fresh ids only', async () => {
  const f = backendClient();
  const saved = await f.save({ text: 'SYNTHETIC first body' });
  const universe = load('universe', f).page;
  const month = load('review/month', f, { query: { month: '2026-10' } }).page;
  const detail = load('review/detail', f, {
    query: { month: '2026-10', date: '2026-10-18', id: saved.data.entry.id },
  }).page;
  const fresh = load('review/detail', f, { query: { month: '2026-10', date: '2026-10-18' } }).page;
  universe._reloadAll('2026-10');
  await settle();
  assert.equal(universe.data.monthRecordCount, 1);
  assert.equal(month.data.recordCount, 1);
  assert.equal(detail.data.phase, 'ready');
  assert.equal(fresh.data.phase, 'ready');

  await f.call('journal.delete', { date: '2026-10-18', expectedVersion: 1 });
  // 模拟跨页返回：各页在 onShow 重新读取，而不是依赖缓存。
  universe.onShow();
  month.onShow();
  detail.onShow();
  fresh.onShow();
  await settle();
  assert.equal(universe.data.monthRecordCount, 0);
  assert.equal(universe.data.monthSummary, '本月暂无记录');
  assert.equal(month.data.recordCount, 0);
  assert.deepEqual(month.data.cards, []);
  // 已删除记录不会从缓存复活：详情进入“不存在”态，而非继续展示正文。
  assert.equal(detail.data.phase, 'missing');
  assert.equal(fresh.data.phase, 'missing');
  assert.equal(detail.data.text, '');

  const recreated = await f.save({ text: 'SYNTHETIC recreated body' });
  assert.notEqual(recreated.data.entry.id, saved.data.entry.id);
  universe.onShow();
  detail.onShow();
  fresh.onShow();
  await settle();
  assert.equal(universe.data.monthRecordCount, 1);
  // 旧 ID 按约定进入“过期”态；不带 id 的新入口读到重建后的内容。
  assert.equal(detail.data.phase, 'stale');
  assert.equal(detail.data.text, '');
  assert.equal(fresh.data.phase, 'ready');
  assert.equal(fresh.data.text, 'SYNTHETIC recreated body');
  universe.onUnload();
  month.onUnload();
  detail.onUnload();
  fresh.onUnload();
});

test('W2 Z03 account switch clears prior private review content on the next show', async () => {
  const f = backendClient();
  const saved = await f.save({ text: 'SYNTHETIC a-private body' });
  const universe = load('universe', f).page;
  const month = load('review/month', f, { query: { month: '2026-10' } }).page;
  const detail = load('review/detail', f, {
    query: { month: '2026-10', date: '2026-10-18', id: saved.data.entry.id },
  }).page;
  universe._reloadAll('2026-10');
  await settle();
  assert.equal(detail.data.phase, 'ready');

  f.setActor('b');
  universe.onShow();
  month.onShow();
  detail.onShow();
  await settle();
  assert.equal(universe.data.monthRecordCount, 0);
  assert.equal(month.data.recordCount, 0);
  assert.equal(detail.data.phase, 'missing');
  const rendered = JSON.stringify([universe.data, month.data, detail.data]);
  assert.ok(!rendered.includes('a-private body'));
  universe.onUnload();
  month.onUnload();
  detail.onUnload();
});

test('W2 Z03 unloaded detail page discards a late cloud response', async () => {
  const f = backendClient();
  const saved = await f.save({ text: 'SYNTHETIC late body' });
  const pending = deferred();
  const reader = {
    ...f.reader,
    getEntry: (date) => (date === '2026-10-18' ? pending.promise : f.reader.getEntry(date)),
  };
  const detail = load('review/detail', f, {
    query: { month: '2026-10', date: '2026-10-18', id: saved.data.entry.id },
    reader,
  }).page;
  detail.onUnload();
  pending.resolve(await f.reader.getEntry('2026-10-18'));
  await settle();
  assert.equal(detail.data.phase, 'loading'); // 未完成即卸载，保持初始态且不渲染正文
  assert.equal(detail.data.text, '');
});

test('W2 Z04 cloud insights derive statistics from actual records across windows', async () => {
  const f = backendClient();
  const page = load('review/insights', f).page;
  await settle();
  // 0 条记录：分布为空态，趋势未达门槛，分母为 0。
  assert.match(page.data.metaText, /实际记录 0 条/);
  assert.equal(page.data.distributionEmpty, true);
  assert.ok(page.data.distRows.every((row) => row.count === 0 && row.ratioText === '—'));
  assert.match(page.data.trendText, /不足 3 条/);

  page.onWindowTap({ currentTarget: { dataset: { days: 30 } } });
  await settle();
  assert.match(page.data.metaText, /窗口 30 天/);
  assert.equal(page.data.distributionEmpty, true);

  // 2 条记录：9-25 在 30 天窗口内、7 天窗口外，验证窗口过滤与 1/2 分母。
  await f.save({ text: 'SYNTHETIC sunny' });
  await f.save({ text: 'SYNTHETIC rainy', date: '2026-09-25', weather: 'RAINY' });
  page.onShow();
  await settle();
  assert.match(page.data.metaText, /实际记录 2 条/);
  assert.equal(page.data.distributionEmpty, false);
  assert.match(page.data.trendText, /不足 3 条/);
  const rainy = page.data.distRows.find((row) => row.label === '雨天');
  assert.equal(rainy.count, 1);
  assert.equal(rainy.ratioText, '1/2 条');
  assert.equal(rainy.percent, 50);

  page.onWindowTap({ currentTarget: { dataset: { days: 7 } } });
  await settle();
  assert.match(page.data.metaText, /窗口 7 天 · 实际记录 1 条/);

  // 3 条记录：达到趋势展示门槛；分母始终是实际记录数而不是窗口天数。
  await f.save({ text: 'SYNTHETIC cloudy', date: '2026-10-17', weather: 'CLOUDY' });
  page.onWindowTap({ currentTarget: { dataset: { days: 30 } } });
  await settle();
  assert.match(page.data.trendText, /已达到趋势展示的记录数量门槛/);
  assert.match(page.data.metaText, /实际记录 3 条/);
  assert.equal(
    page.data.distRows.reduce((sum, row) => sum + row.count, 0),
    3,
  );

  page.onWindowTap({ currentTarget: { dataset: { days: 90 } } });
  await settle();
  assert.match(page.data.metaText, /窗口 90 天 · 实际记录 3 条/);
  page.onUnload();
});

test('W2 Z04 production review entries stay explicitly blocked without fabricated statistics', async () => {
  // 生产路由未接入 review 域：页面必须保留“尚未开放”的阻塞标识，
  // 且不得用本地统计结果冒充云端返回。
  const f = backendClient(undefined, { production: true });
  const insights = load('review/insights', f).page;
  await settle();
  assert.match(insights.data.error, /回顾服务尚未开放，请稍后再试。/);
  assert.equal(insights.data.distRows.length, 0);
  assert.equal(insights.data.timelineItems.length, 0);
  assert.equal(insights.data.metaText, '');

  const universe = load('universe', f).page;
  await settle();
  assert.match(universe.data.calendarError, /回顾服务尚未开放，请稍后再试。/);
  assert.equal(universe.data.weeks.length, 0);
  const actions = f.requests.map((request) => request.action);
  assert.ok(actions.every((action) => action.startsWith('review.')));
  insights.onUnload();
  universe.onUnload();
});

test('W2 Z05 cloud decorations stay explicitly unimplemented and isolate stale month responses', async () => {
  const f = backendClient();
  await f.save({});
  const pending = deferred();
  let mode = 'pending';
  let submits = 0;
  const decorationService = {
    createDecorationRequest: (input) => ({ action: 'review.decorations', payload: input }),
    submit: async (request) => {
      submits += 1;
      if (mode === 'pending') {
        return pending.promise;
      }
      if (mode === 'unimplemented') {
        throw new AppError('NOT_IMPLEMENTED', 'SYNTHETIC decorations not implemented');
      }
      if (mode === 'unavailable') {
        throw new AppError('NETWORK_ERROR', 'SYNTHETIC decorations network');
      }
      return {
        ok: true,
        data: {
          month: request.payload.month,
          version: 3,
          stickers: [{ stickerId: 'SYNTHETIC_S1' }],
          backgroundId: null,
        },
      };
    },
  };
  const universe = load('universe', f, { cloudDecorationService: decorationService }).page;
  universe._reloadAll('2026-10');
  await settle();

  universe.onToggleDecorationPanel();
  await settle();
  // 面板展开期间切月：挂起的旧月份探测必须被隔离。
  universe._reloadAll('2026-09');
  await settle();
  mode = 'ok';
  pending.resolve({
    ok: true,
    data: {
      month: '2026-10',
      version: 3,
      stickers: [{ stickerId: 'SYNTHETIC_S1' }],
      backgroundId: null,
    },
  });
  await settle();
  assert.notEqual(universe.data.decorationState, 'available');
  assert.equal(universe.data.decorationStickers.length, 0);

  // 重新展开面板，按当前月份 2026-09 探测并渲染。
  universe.onToggleDecorationPanel();
  universe.onToggleDecorationPanel();
  await settle();
  assert.equal(universe.data.decorationState, 'available');
  assert.equal(universe.data.decorationVersion, 3);
  assert.equal(universe.data.decorationStickers[0].title, '贴纸');
  assert.equal(universe.data.decorationStickers[0].key, 'SYNTHETIC_S1|');

  // 云端未实现：状态明确标识，且之后重开面板不再重复请求。
  mode = 'unimplemented';
  universe.onToggleDecorationPanel();
  universe.onToggleDecorationPanel();
  await settle();
  assert.equal(universe.data.decorationState, 'unimplemented');
  assert.match(universe.data.decorationStateText, /尚未开放/);
  assert.equal(universe.data.decorationStickers.length, 0);
  const submitsBefore = submits;
  universe.onToggleDecorationPanel();
  universe.onToggleDecorationPanel();
  await settle();
  assert.equal(submits, submitsBefore);
  assert.equal(universe.data.decorationState, 'unimplemented');

  // 装饰探测不影响月历：仅有 review 类请求，正文只在详情页读取。
  assert.equal(universe.data.monthRecordCount, 0);
  assert.equal(universe.data.calendarError, '');
  assert.ok(
    f.requests.every((request) =>
      ['review.calendar', 'review.monthArchive', 'review.decorations'].includes(request.action),
    ),
  );
  universe.onUnload();
});

test('W2 Z05 cloud decoration read failure degrades without touching the calendar', async () => {
  const f = backendClient();
  await f.save({});
  const decorationService = {
    createDecorationRequest: (input) => ({ action: 'review.decorations', payload: input }),
    submit: async () => {
      throw new AppError('NETWORK_ERROR', 'SYNTHETIC decorations network down');
    },
  };
  const universe = load('universe', f, { cloudDecorationService: decorationService }).page;
  universe._reloadAll('2026-10');
  await settle();
  universe.onToggleDecorationPanel();
  await settle();
  assert.equal(universe.data.decorationState, 'unavailable');
  assert.match(universe.data.decorationStateText, /已降级为默认展示/);
  assert.equal(universe.data.decorationStickers.length, 0);
  assert.equal(universe.data.monthRecordCount, 1);
  assert.equal(universe.data.calendarError, '');
  universe.onUnload();
});

test('cloud decoration content clears on hide and late reads cannot restore it', async () => {
  const pending = deferred();
  let delayed = false;
  const decorationService = {
    createDecorationRequest: (payload) => ({ payload }),
    submit: async ({ payload }) => {
      if (delayed) {
        await pending.promise;
      }
      return {
        ok: true,
        data: {
          month: payload.month,
          version: 1,
          stickers: [{ stickerId: 'PRIVATE_ASSET' }],
          backgroundId: 'PRIVATE_BACKGROUND',
        },
      };
    },
  };
  const universe = load('universe', backendClient(), {
    cloudDecorationService: decorationService,
  }).page;
  universe._reloadAll('2026-10');
  universe.onToggleDecorationPanel();
  await settle();
  assert.equal(universe.data.decorationState, 'available');
  universe.onHide();
  assert.equal(universe.data.decorationStickers.length, 0);
  assert.equal(universe.data.decorationBackground, '');
  assert.equal(universe.data.decorationVersion, 0);
  delayed = true;
  universe.onShow();
  await settle();
  assert.equal(universe.data.decorationState, 'loading');
  universe.onHide();
  pending.resolve();
  await settle();
  assert.equal(universe.data.decorationStickers.length, 0);
  assert.equal(universe.data.decorationBackground, '');
  assert.equal(universe.data.decorationState, '');
  universe.onUnload();
});

test('cloud decoration month switches clear old content and isolate late failures', async () => {
  const pending = deferred();
  const decorationService = {
    createDecorationRequest: (payload) => ({ payload }),
    submit: async ({ payload }) => {
      if (payload.month === '2026-09') {
        await pending.promise;
        throw new AppError('NOT_IMPLEMENTED', 'SYNTHETIC old month error');
      }
      if (payload.month === '2026-08') {
        throw new AppError('NETWORK_ERROR', 'SYNTHETIC current month error');
      }
      return {
        ok: true,
        data: {
          month: payload.month,
          version: 2,
          stickers: [{ stickerId: 'STICKER_STAR' }],
          backgroundId: null,
        },
      };
    },
  };
  const universe = load('universe', backendClient(), {
    cloudDecorationService: decorationService,
  }).page;
  universe._reloadAll('2026-10');
  universe.onToggleDecorationPanel();
  await settle();
  universe._reloadAll('2026-09');
  assert.equal(universe.data.decorationStickers.length, 0);
  assert.equal(universe.data.decorationState, 'loading');
  await settle();
  universe._reloadAll('2026-08');
  await settle();
  assert.equal(universe.data.decorationState, 'unavailable');
  const current = universe.data.decorationStateText;
  pending.resolve();
  await settle();
  assert.equal(universe.data.decorationState, 'unavailable');
  assert.equal(universe.data.decorationStateText, current);
  universe.onUnload();
});

test('cloud decoration responses reject malformed placements and can explicitly retry after a gate', async () => {
  let doc = { month: '2026-10', version: 1, stickers: [], backgroundId: null };
  let gate = true;
  const decorationService = {
    createDecorationRequest: (payload) => ({ payload }),
    submit: async () => {
      if (gate) {
        throw new AppError('NOT_IMPLEMENTED', 'SYNTHETIC gate');
      }
      return { ok: true, data: doc };
    },
  };
  const universe = load('universe', backendClient(), {
    cloudDecorationService: decorationService,
  }).page;
  universe._reloadAll('2026-10');
  universe.onToggleDecorationPanel();
  await settle();
  assert.equal(universe.data.decorationState, 'unimplemented');
  gate = false;
  await universe.onRetryDecoration();
  assert.equal(universe.data.decorationState, 'available');
  for (const bad of [
    { stickers: [{ stickerId: 'bad/path' }] },
    { stickers: [{ stickerId: 'STICKER_STAR', targetEntryId: '' }] },
    { stickers: [{ stickerId: 'STICKER_STAR' }, { stickerId: 'STICKER_STAR' }] },
    { stickers: Array.from({ length: 7 }, (_, i) => ({ stickerId: 'ASSET_' + i })) },
    { backgroundId: 'bad/path' },
    { version: 0, stickers: [{ stickerId: 'STICKER_STAR' }] },
  ]) {
    doc = { month: '2026-10', version: 1, stickers: [], backgroundId: null, ...bad };
    await universe.onRetryDecoration();
    assert.equal(universe.data.decorationState, 'unavailable');
    assert.equal(universe.data.decorationStickers.length, 0);
    assert.equal(universe.data.decorationVersion, 0);
  }
  universe.onUnload();
});

test('W2 Z05 demo decorations keep the available state with asset-failure degradation', async () => {
  // 回归：演示模式的装饰可用状态、素材失败降级与偏好开关（W1 Z05 语义保持不变）。
  const universe = load('universe', null, { enabled: false }).page;
  universe._reloadAll('2026-10');
  await settle();
  assert.ok(universe._demo);
  assert.equal(universe.data.monthRecordCount, 5); // 演示种子在 2026-10 有 5 条（10-01/09/12/15/16）

  universe.onToggleDecorationPanel();
  await settle();
  // 可用状态：装饰服务可达；未配置的月份返回 version 0 的默认视图。
  assert.equal(universe.data.decorationVersion, 0);
  assert.deepEqual(universe.data.decorationStickers, []);

  universe.onAddSticker();
  await settle();
  assert.equal(universe.data.decorationVersion, 1);
  assert.equal(universe.data.decorationStickers.length, 1);
  assert.equal(universe.data.decorationStickers[0].degraded, false);

  universe.onSimulateAssetFailure();
  await settle();
  assert.equal(universe.data.decorationFailed, true);
  assert.equal(universe.data.decorationStickers[0].degraded, true);
  assert.match(universe.data.decorationNote, /已模拟素材加载失败/);

  universe.onToggleDecoration();
  await settle();
  assert.equal(universe.data.decorationEnabled, false);
  assert.match(universe.data.decorationNote, /装饰已关闭/);
  assert.equal(universe.data.monthRecordCount, 5); // 偏好开关不影响月历
  universe.onUnload();
});
