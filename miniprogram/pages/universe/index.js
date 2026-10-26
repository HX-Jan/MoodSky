// Weather Universe · 回顾与天气宇宙（Zhifeng Dai）。
// 演示模式（journalDemo 且云关闭）下提供：月历（W1 Z02）、月份档案/分布时间线入口（Z03/Z04）、
// 装饰与素材失败降级（W1 Z05）。云模式走校验后的私人只读服务，未连接时不展示模拟记录。
const environment = require('../../config/environment.local');
const { isExperience } = require('../../config/experience');
const { businessDate } = require('../../shared/date');
const { AppError } = require('../../shared/result');
const { reviewStore } = require('../../modules/review/demo-store');
const { reviewDemoService } = require('../../modules/review/demo-service');
const { STICKER_CATALOG } = require('../../modules/review/demo-data');
const { LIMITS } = require('../../shared/constants');
const { syncTab } = require('../../modules/presentation/jiaqi-design');
const { reviewReader, reviewErrorMessage } = require('../../modules/review/reader');
const reviewCloudService = require('../../modules/review/service');
const { weatherView } = require('../../modules/review/presentation');

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const STICKER_LABELS = Object.freeze({
  STICKER_STAR: '星星',
  STICKER_MOON: '月亮',
  STICKER_LEAF: '叶子',
  STICKER_UMBRELLA: '雨伞',
  STICKER_CAT: '小猫',
  STICKER_BALLOON: '气球',
});
const BACKGROUND_LABELS = Object.freeze({
  BACKGROUND_SKY_DAY: '晴空',
  BACKGROUND_SKY_NIGHT: '夜空',
});

function readCloudDecoration(result, month) {
  const doc = result && result.data;
  const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const seen = new Set();
  if (
    !result ||
    result.ok !== true ||
    !doc ||
    Array.isArray(doc) ||
    doc.month !== month ||
    !Number.isSafeInteger(doc.version) ||
    doc.version < 0 ||
    !Array.isArray(doc.stickers) ||
    doc.stickers.length > LIMITS.staticStickers ||
    (doc.backgroundId !== null && !validId(doc.backgroundId)) ||
    (doc.version === 0 && (doc.stickers.length > 0 || doc.backgroundId !== null)) ||
    doc.stickers.some((sticker) => {
      if (
        !sticker ||
        Array.isArray(sticker) ||
        !validId(sticker.stickerId) ||
        (sticker.targetEntryId !== undefined && !validId(sticker.targetEntryId))
      ) {
        return true;
      }
      const key = sticker.stickerId + '|' + (sticker.targetEntryId || '');
      if (seen.has(key)) {
        return true;
      }
      seen.add(key);
      return false;
    })
  ) {
    throw new AppError('INVALID_RESPONSE', '装饰结果不完整。');
  }
  return doc;
}

function monthOf(date) {
  return date.slice(0, 7);
}

function shiftMonth(month, offset) {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = Math.max(0, Math.min(9999 * 12 + 11, year * 12 + monthNumber - 1 + offset));
  return (
    String(Math.floor(shifted / 12)).padStart(4, '0') +
    '-' +
    String((shifted % 12) + 1).padStart(2, '0')
  );
}

function monthLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return year + '年' + monthNumber + '月';
}

// 生成真实月份网格：起始留白 + 每日格子。无记录日期只保留日期数字，不显示任何天气标识，
// 明确区别于“阴天”（CLOUDY 只在有记录的日期出现）。
function buildWeeks(month, entries, today) {
  const first = new Date(month + '-01T00:00:00.000Z');
  const firstWeekday = (first.getUTCDay() + 6) % 7;
  first.setUTCMonth(first.getUTCMonth() + 1);
  first.setUTCDate(0);
  const daysInMonth = first.getUTCDate();
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const cells = [];
  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ key: 'lead-' + index, blank: true });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = month + '-' + String(day).padStart(2, '0');
    const entry = byDate.get(date);
    const isToday = date === today;
    if (entry) {
      const view = weatherView(entry.weather, entry.weatherName);
      cells.push({
        key: entry.id,
        date,
        day,
        recorded: true,
        id: entry.id,
        icon: view.icon,
        label: view.label,
        weather: entry.weather,
        isToday,
      });
    } else {
      cells.push({ key: date, date, day, recorded: false, isToday });
    }
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: 'tail-' + cells.length, blank: true });
  }
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

Page({
  data: {
    isExperience: isExperience(environment),
    isDemo: false,
    reviewEnabled: false,
    weekdays: WEEKDAYS,
    month: '',
    monthLabel: '',
    weeks: [],
    monthRecordCount: 0,
    monthSummary: '',
    calendarBusy: false,
    calendarError: '',
    today: '',
    decorationEnabled: true,
    decorationPanel: false,
    decorationVersion: 0,
    decorationStickers: [],
    decorationBackground: '',
    decorationFailed: false,
    decorationNote: '',
    decorationBusy: false,
    decorationLoading: false,
    decorationReady: false,
    decorationLimit: LIMITS.staticStickers,
    decorationState: '',
    decorationStateText: '',
  },
  onLoad() {
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this._demo = isDemo;
    this._enabled = isDemo || environment.cloudEnabled === true;
    this._service = isDemo ? reviewDemoService : reviewReader;
    this._requestSeq = 0;
    this._decorationSeq = 0;
    this._assetFailed = false;
    this.setData({ isDemo, reviewEnabled: this._enabled, today: businessDate() });
    if (isDemo) {
      this._unsubscribe = reviewStore.subscribe(() => this._onSourceChanged());
    }
    if (this._enabled) {
      this._reloadAll(monthOf(businessDate()));
    }
  },
  onShow() {
    syncTab(this, 2);
    this._suspended = false;
    if (this._enabled && this._currentMonth && !this.data.calendarBusy) {
      this.setData({ today: businessDate() });
      this._reloadAll(this._currentMonth);
    }
  },
  onToggleDecorationPanel() {
    const panel = !this.data.decorationPanel;
    this.setData({ decorationPanel: panel });
    if (
      panel &&
      !this._demo &&
      this._enabled &&
      this._currentMonth &&
      this.data.decorationState !== 'unimplemented'
    ) {
      this._loadCloudDecoration(this._currentMonth);
    }
  },
  onHide() {
    if (!this._demo) {
      this._suspended = true;
      this._requestSeq += 1;
      this._decorationSeq += 1;
      this.setData({
        weeks: [],
        monthRecordCount: 0,
        monthSummary: '',
        calendarBusy: false,
        decorationState: '',
        decorationStateText: '',
        decorationVersion: 0,
        decorationStickers: [],
        decorationBackground: '',
        decorationLoading: false,
      });
    }
  },
  onRetry() {
    return this._loadMonth(this._currentMonth);
  },
  onUnload() {
    this._demo = false;
    this._enabled = false;
    this._requestSeq += 1;
    this._decorationSeq += 1;
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  },
  // 回顾失效事件（W1 Z05）：记录保存/编辑/删除后重新读取当前月份与装饰状态。
  _onSourceChanged() {
    if (this._demo && this._currentMonth) {
      this._reloadAll(this._currentMonth);
    }
  },
  _reloadAll(month) {
    if (!this._enabled) {
      return;
    }
    if (this._currentMonth !== month) {
      this._decorationNote = '';
    }
    this._currentMonth = month;
    this._loadMonth(month);
    if (this._demo) {
      this._loadDecoration(month);
    } else if (this.data.decorationPanel) {
      this._loadCloudDecoration(month);
    }
  },
  async _loadMonth(month) {
    if (!this._enabled || this._suspended) {
      return;
    }
    const token = ++this._requestSeq;
    this.setData({
      calendarBusy: true,
      calendarError: '',
      month,
      monthLabel: monthLabel(month),
      weeks: [],
      monthRecordCount: 0,
      monthSummary: '',
    });
    try {
      const result = await this._service.calendar(month);
      if (token !== this._requestSeq) {
        return; // 丢弃迟到的旧月份响应，不覆盖当前视图（R15）。
      }
      const data = result.data;
      this.setData({
        month: data.month,
        monthLabel: monthLabel(data.month),
        weeks: buildWeeks(data.month, data.entries, this.data.today),
        monthRecordCount: data.recordCount,
        monthSummary:
          data.recordCount > 0 ? '本月 ' + data.recordCount + ' 条记录' : '本月暂无记录',
        calendarBusy: false,
      });
    } catch (error) {
      if (token !== this._requestSeq) {
        return;
      }
      this.setData({
        calendarBusy: false,
        calendarError: reviewErrorMessage(error),
        weeks: [],
        monthRecordCount: 0,
        monthSummary: '',
      });
    }
  },
  onPreviousMonth() {
    if (!this._currentMonth || this.data.calendarBusy) {
      return;
    }
    this._reloadAll(shiftMonth(this._currentMonth, -1));
  },
  onNextMonth() {
    if (!this._currentMonth || this.data.calendarBusy) {
      return;
    }
    this._reloadAll(shiftMonth(this._currentMonth, 1));
  },
  onMonthPick(event) {
    if (typeof event.detail.value === 'string' && /^\d{4}-\d{2}$/.test(event.detail.value)) {
      this._reloadAll(event.detail.value);
    }
  },
  // 仅记录日期可进入详情；空日期不绑定 id，点击被忽略，保持留白。
  onDayTap(event) {
    const { date, id } = event.currentTarget.dataset;
    if (!id || this.data.calendarBusy || this.data.calendarError || !this._enabled) {
      return;
    }
    wx.navigateTo({
      url: '/pages/review/detail/index?month=' + this._currentMonth + '&date=' + date + '&id=' + id,
    });
  },
  onOpenArchive() {
    wx.navigateTo({
      url: '/pages/review/archive/index?month=' + (this._currentMonth || monthOf(businessDate())),
    });
  },
  onOpenInsights() {
    wx.navigateTo({ url: '/pages/review/insights/index' });
  },
  // ---------- 装饰与素材失败降级（W1 Z05 / W2 Z05） ----------
  // Cloud reads remain separate from the demo's versioned write state.
  async _loadCloudDecoration(month) {
    if (!this._enabled || this._suspended || this._demo || !month) {
      return;
    }
    const token = ++this._decorationSeq;
    this.setData({
      decorationState: 'loading',
      decorationStateText: '正在读取本月装饰…',
      decorationVersion: 0,
      decorationStickers: [],
      decorationBackground: '',
    });
    try {
      const result = await reviewCloudService.submit(
        reviewCloudService.createDecorationRequest({ operation: 'get', month }),
      );
      if (token !== this._decorationSeq || month !== this._currentMonth) {
        return;
      }
      const doc = readCloudDecoration(result, month);
      this.setData({
        decorationState: 'available',
        decorationStateText: '',
        decorationVersion: doc.version,
        decorationBackground: doc.backgroundId
          ? BACKGROUND_LABELS[doc.backgroundId] || '已设置背景'
          : '默认背景（未设置）',
        decorationStickers: doc.stickers.map((sticker) => ({
          key: sticker.stickerId + '|' + (sticker.targetEntryId || ''),
          title: STICKER_LABELS[sticker.stickerId] || '贴纸',
          caption: sticker.targetEntryId ? '绑定某日记录' : '月份装饰',
          degraded: false,
        })),
      });
    } catch (error) {
      if (token !== this._decorationSeq || month !== this._currentMonth) {
        return;
      }
      this.setData({
        decorationState:
          error && error.code === 'NOT_IMPLEMENTED' ? 'unimplemented' : 'unavailable',
        decorationStateText:
          error && error.code === 'NOT_IMPLEMENTED'
            ? '云端装饰服务尚未开放，装饰暂不可读写；月历、档案与统计不受影响。'
            : '装饰状态读取失败，已降级为默认展示；月历与记录不受影响。',
        decorationStickers: [],
        decorationBackground: '',
      });
    }
  },
  async _loadDecoration(month) {
    if (!this._enabled || this._suspended || !month) {
      return;
    }
    const token = ++this._decorationSeq;
    this._decorationReadyMonth = '';
    this._rawStickers = [];
    this._rawBackgroundId = null;
    this.setData({
      decorationLoading: true,
      decorationReady: false,
      decorationVersion: 0,
      decorationStickers: [],
      decorationBackground: '',
      decorationNote: '正在读取本月装饰…',
    });
    if (this._demo) {
      try {
        const result = await reviewDemoService.decorations({ operation: 'get', month });
        if (token !== this._decorationSeq) {
          return;
        }
        this._renderDecoration(result.data);
      } catch (_error) {
        if (token !== this._decorationSeq) {
          return;
        }
        // 装饰读取失败不影响月历；按降级规则显示默认状态。
        this.setData({
          decorationStickers: [],
          decorationBackground: '',
          decorationNote: '装饰状态读取失败，已降级为默认背景；月历与记录不受影响。',
        });
      } finally {
        if (token === this._decorationSeq) {
          this.setData({ decorationLoading: false });
        }
      }
      return;
    }
    try {
      const result = await reviewCloudService.submit(
        reviewCloudService.createDecorationRequest({ operation: 'get', month }),
      );
      // 旧月份响应隔离：令牌失效或已切月时丢弃，不渲染到当前月份。
      if (token !== this._decorationSeq || month !== this._currentMonth) {
        return;
      }
      const doc = result.data;
      if (
        !doc ||
        doc.month !== month ||
        !Number.isSafeInteger(doc.version) ||
        doc.version < 0 ||
        !Array.isArray(doc.stickers) ||
        (doc.backgroundId !== null && typeof doc.backgroundId !== 'string')
      ) {
        throw new AppError('INVALID_RESPONSE', '装饰结果不完整。');
      }
      this.setData({
        decorationState: 'available',
        decorationStateText: '',
        decorationVersion: doc.version,
        decorationBackground: doc.backgroundId || '默认背景（未设置）',
        decorationStickers: doc.stickers.map((sticker) => ({
          key: sticker.stickerId + '|' + (sticker.targetEntryId || ''),
          title: sticker.stickerId,
          caption: sticker.targetEntryId ? '绑定某日记录' : '月份装饰',
          degraded: false,
        })),
      });
    } finally {
      if (token === this._decorationSeq) {
        this.setData({ decorationLoading: false });
      }
    }
  },
  onRetryDecoration() {
    if (
      !this._demo &&
      this._enabled &&
      !this._suspended &&
      this.data.decorationState !== 'loading'
    ) {
      return this._loadCloudDecoration(this._currentMonth);
    }
    if (
      this._demo &&
      this._currentMonth &&
      !this.data.decorationBusy &&
      !this.data.decorationLoading
    ) {
      return this._loadDecoration(this._currentMonth);
    }
  },
  _renderDecoration(doc) {
    if (
      !doc ||
      doc.month !== this._currentMonth ||
      !Number.isSafeInteger(doc.version) ||
      doc.version < 0 ||
      !Array.isArray(doc.stickers)
    ) {
      throw new Error('装饰结果不完整，请重新读取。');
    }
    this._decorationReadyMonth = doc.month;
    // 保留服务端原始装饰数据，供再次替换时使用；界面展示与原始数据分离，降级不影响数据。
    this._rawStickers = doc.stickers.map((sticker) => ({ ...sticker }));
    this._rawBackgroundId = doc.backgroundId;
    const stickers = doc.stickers.map((sticker) => ({
      key: sticker.stickerId + '|' + (sticker.targetEntryId || ''),
      title: this._assetFailed ? '素材未加载' : STICKER_LABELS[sticker.stickerId] || '贴纸',
      caption: sticker.targetEntryId ? '绑定某日记录' : '月份装饰',
      degraded: this._assetFailed,
    }));
    this.setData({
      decorationReady: true,
      decorationEnabled: reviewDemoService.getDecorationsPreference(),
      decorationVersion: doc.version,
      decorationStickers: stickers,
      decorationBackground: this._assetFailed
        ? '默认背景'
        : BACKGROUND_LABELS[doc.backgroundId] || '默认背景（未设置）',
      decorationFailed: this._assetFailed,
      decorationNote: this._decorationNote || '',
    });
  },
  onToggleDecoration() {
    if (!this._demo) {
      return;
    }
    const enabled = reviewDemoService.setDecorationsPreference(!this.data.decorationEnabled);
    // 关闭装饰属于偏好：不删除配置、不改日记；月历与记录展示不受影响。
    this._decorationNote = enabled
      ? '装饰已开启。'
      : '装饰已关闭：不再显示装饰内容，配置仍保留，记录与月历不受影响。';
    this._loadDecoration(this._currentMonth);
  },
  onSimulateAssetFailure() {
    if (!this._demo) {
      return;
    }
    this._assetFailed = !this._assetFailed;
    // 素材加载失败降级：以天气文字与默认背景呈现，核心回顾功能保持可用。
    this._decorationNote = this._assetFailed
      ? '已模拟素材加载失败：贴纸与背景降级为文字与默认样式，回顾功能不受影响。'
      : '素材已恢复。';
    this._loadDecoration(this._currentMonth);
  },
  async onAddSticker() {
    if (
      !this._demo ||
      this.data.decorationBusy ||
      this.data.decorationLoading ||
      !this.data.decorationReady ||
      !this.data.decorationEnabled ||
      this._decorationReadyMonth !== this._currentMonth
    ) {
      return;
    }
    const stickers = this._rawStickers || [];
    const stickerId = STICKER_CATALOG.find(
      (id) => !stickers.some((sticker) => sticker.stickerId === id && !sticker.targetEntryId),
    );
    if (stickers.length >= LIMITS.staticStickers || !stickerId) {
      this._decorationNote =
        '本月最多添加 ' + LIMITS.staticStickers + ' 枚贴纸，可重置后重新添加。';
      this.setData({ decorationNote: this._decorationNote });
      return;
    }
    const month = this._currentMonth;
    const token = ++this._decorationSeq;
    this.setData({ decorationBusy: true });
    try {
      const result = await reviewDemoService.decorations({
        operation: 'replace',
        month,
        expectedVersion: this.data.decorationVersion,
        stickers: [...stickers, { stickerId }],
        backgroundId: this._rawBackgroundId || null,
      });
      if (token !== this._decorationSeq) {
        return;
      }
      this._decorationNote = '已添加演示贴纸（合成素材，正式素材安排在后续周）。';
      this._renderDecoration(result.data);
    } catch (error) {
      if (token !== this._decorationSeq) {
        return;
      }
      this._decorationNote =
        error && error.code === 'CONFLICT'
          ? '装饰版本已变化，已为你读取最新状态，请重试。'
          : error && error.message
            ? error.message
            : '装饰更新失败。';
      this._loadDecoration(this._currentMonth);
    } finally {
      if (this._demo) {
        this.setData({ decorationBusy: false });
      }
    }
  },
  async onResetDecoration() {
    if (
      !this._demo ||
      this.data.decorationBusy ||
      this.data.decorationLoading ||
      !this.data.decorationReady ||
      !this.data.decorationEnabled ||
      this._decorationReadyMonth !== this._currentMonth
    ) {
      return;
    }
    const month = this._currentMonth;
    const token = ++this._decorationSeq;
    this.setData({ decorationBusy: true });
    try {
      const result = await reviewDemoService.decorations({
        operation: 'reset',
        month,
        expectedVersion: this.data.decorationVersion,
      });
      if (token !== this._decorationSeq) {
        return;
      }
      this._decorationNote = '装饰已重置为空；日记与偏好不受影响。';
      this._renderDecoration(result.data);
    } catch (error) {
      if (token !== this._decorationSeq) {
        return;
      }
      this._decorationNote =
        error && error.code === 'CONFLICT'
          ? '装饰版本已变化，已为你读取最新状态，请重试。'
          : error && error.message
            ? error.message
            : '装饰重置失败。';
      this._loadDecoration(this._currentMonth);
    } finally {
      if (this._demo) {
        this.setData({ decorationBusy: false });
      }
    }
  },
});
