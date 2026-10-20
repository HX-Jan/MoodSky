// Weather Universe · 回顾与天气宇宙（Zhifeng Dai）。
// 演示模式（journalDemo 且云关闭）下提供：月历（W1 Z02）、月份档案/分布时间线入口（Z03/Z04）、
// 装饰与素材失败降级（W1 Z05）。云模式走校验后的私人只读服务，未连接时不展示模拟记录。
const environment = require('../../config/environment.local');
const { businessDate } = require('../../shared/date');
const { reviewStore } = require('../../modules/review/demo-store');
const { reviewDemoService } = require('../../modules/review/demo-service');
const { STICKER_CATALOG } = require('../../modules/review/demo-data');
const { syncTab } = require('../../modules/presentation/jiaqi-design');
const { reviewReader, reviewErrorMessage } = require('../../modules/review/reader');
const { weatherView } = require('../../modules/review/presentation');

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

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
      const view = weatherView(entry.weather);
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
    this.setData({ decorationPanel: !this.data.decorationPanel });
  },
  onHide() {
    if (!this._demo) {
      this._suspended = true;
      this._requestSeq += 1;
      this.setData({ weeks: [], monthRecordCount: 0, monthSummary: '', calendarBusy: false });
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
    this._currentMonth = month;
    this._loadMonth(month);
    if (this._demo) {
      this._loadDecoration(month);
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
  // ---------- 装饰与素材失败降级（W1 Z05） ----------
  async _loadDecoration(month) {
    if (!this._demo) {
      return;
    }
    const token = ++this._decorationSeq;
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
    }
  },
  _renderDecoration(doc) {
    // 保留服务端原始装饰数据，供再次替换时使用；界面展示与原始数据分离，降级不影响数据。
    this._rawStickers = doc.stickers.map((sticker) => ({ ...sticker }));
    this._rawBackgroundId = doc.backgroundId;
    const stickers = doc.stickers.map((sticker) => ({
      key: sticker.stickerId + '|' + (sticker.targetEntryId || ''),
      title: this._assetFailed ? '素材未加载' : sticker.stickerId,
      caption: sticker.targetEntryId ? '绑定某日记录' : '月份装饰',
      degraded: this._assetFailed,
    }));
    this.setData({
      decorationEnabled: reviewDemoService.getDecorationsPreference(),
      decorationVersion: doc.version,
      decorationStickers: stickers,
      decorationBackground: this._assetFailed
        ? '默认背景'
        : doc.backgroundId || '默认背景（未设置）',
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
    if (!this._demo || this.data.decorationBusy) {
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
        stickers: [...(this._rawStickers || []), { stickerId: STICKER_CATALOG[0] }],
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
    if (!this._demo || this.data.decorationBusy) {
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
