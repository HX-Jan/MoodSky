const {
  createAppShare,
  enableAppShare,
  prepareSharedPage,
} = require('../../modules/share/app-share');
const { createCheckinController } = require('../../modules/campus/checkin-controller');
const { createCheckinOutbox } = require('../../modules/campus/checkin-outbox');
const api = require('../../services/api');
const { ensureCloudSession } = require('../../modules/account/cloud-session');
const { syncLeaveGuard } = require('../../modules/system/leave-guard');
const {
  navigateOnce,
  resetPageNavigation,
  pausePageNavigation,
  isPageNavigationBlocked,
} = require('../../modules/system/page-navigation');
const { PLACES } = require('../../shared/campus-checkins');
const environment = require('../../config/environment.local');
const { isExperience } = require('../../config/experience');
const preview = require('../../modules/campus/simulated-weather');
const campusService = require('../../modules/campus/service');
const { cloudSessionState } = require('../../services/session-state');
const { filterAndPagePlaces } = require('../../modules/campus/presentation');
const { LIMITS } = require('../../shared/constants');
const { AppError } = require('../../shared/result');
const { businessDate, isBusinessDate } = require('../../shared/date');
const { syncTab } = require('../../modules/presentation/jiaqi-design');
const { DEMO_PLACES } = require('../../modules/campus/demo-places');
const { FIELD_NOTE_PLACES } = require('../../modules/campus/field-note-places');

const DEMO_DATE = '2026-10-16';
const FIELD_NOTE_DATE = '2026-10-21';
const PAGE_SIZE = 2;
const ALL_CAMPUS = '全部校区';
const ALL_TAG = '全部标签';
const CAMPUS_OPTIONS = [
  ALL_CAMPUS,
  '福州大学旗山校区',
  '云汀校区（合成）',
  '星河校区（合成）',
  '松风校区（合成）',
];
const CLOUD_CAMPUS_OPTIONS = [ALL_CAMPUS, '福州大学旗山校区'];
const CLOUD_TAG_OPTIONS = [
  ALL_TAG,
  ...new Set(FIELD_NOTE_PLACES.flatMap((place) => place.environmentTags)),
];
const TAG_OPTIONS = [
  ALL_TAG,
  ...new Set(DEMO_PLACES.concat(FIELD_NOTE_PLACES).flatMap((place) => place.environmentTags)),
];
const STATUS_LABELS = {
  open: '开放信息已记录',
  expired: '资料已过期，不推荐前往',
  closed: '已关闭，不推荐前往',
  unknown: '开放状态或资料有效期待确认',
};

function previewDate(mode) {
  return mode === 'field-note' ? FIELD_NOTE_DATE : DEMO_DATE;
}

function viewItem(item) {
  const derived = filterAndPagePlaces([item], {}, businessDate()).items[0] || item;
  const tags = Array.isArray(item.environmentTags) ? item.environmentTags : [];
  const isMemberRecord = item.isSynthetic === false;
  return {
    ...item,
    ...derived,
    statusLabel: STATUS_LABELS[derived.status] || STATUS_LABELS.unknown,
    tagText: tags.join(' · '),
    sourceText: item.source || '来源待补充',
    // Recommendations use written directions; old catalogue coordinates never enter page data.
    location: null,
    navigationAvailable: false,
    recommendationLabel: item.isSynthetic
      ? '合成资料，仅供预览'
      : derived.recommendable
        ? '可按文字方位自行前往'
        : STATUS_LABELS[derived.status] || STATUS_LABELS.unknown,
    verificationLabel:
      derived.status === 'expired'
        ? '资料已过期，需重新核验'
        : item.verificationStatus === 'verified' && derived.recommendable
          ? '资料已核验'
          : item.verificationStatus === 'pending_review'
            ? '成员提交，待复核'
            : isMemberRecord
              ? '成员现场记录；待复核'
              : '合成数据',
  };
}

function copyListData(result) {
  const data = result && result.data;
  if (
    !data ||
    !Array.isArray(data.items) ||
    !Number.isInteger(data.page) ||
    !Number.isInteger(data.pageSize) ||
    !Number.isInteger(data.total) ||
    data.page < 1 ||
    data.pageSize < 1 ||
    data.total < 0 ||
    typeof data.hasMore !== 'boolean' ||
    data.items.some((item) => !item || typeof item.placeId !== 'string')
  ) {
    throw new AppError('INVALID_RESPONSE', '地点列表返回格式不兼容。');
  }
  return data;
}

function favoriteIdsFromResult(result) {
  const data = result && result.data;
  if (data && Array.isArray(data.placeIds)) {
    return data.placeIds.filter((placeId) => typeof placeId === 'string');
  }
  if (data && Array.isArray(data.items)) {
    return data.items
      .map((item) => (item && typeof item.placeId === 'string' ? item.placeId : null))
      .filter(Boolean);
  }
  throw new AppError('INVALID_RESPONSE', '收藏列表返回格式不兼容。');
}

function messageFor(error, fallback) {
  return error && typeof error.message === 'string' && error.message ? error.message : fallback;
}

function appendUniquePlaces(existing, incoming) {
  const placeIds = new Set(existing.map((item) => item.placeId));
  const unique = [];
  for (const item of incoming) {
    if (!placeIds.has(item.placeId)) {
      placeIds.add(item.placeId);
      unique.push(item);
    }
  }
  return existing.concat(unique);
}

Page({
  ...createAppShare({ route: 'pages/campus/index' }),
  data: {
    checkinStorageBlocked: false,
    checkinHistoryOpen: false,
    checkinHistory: [],
    checkinHistoryBusy: false,
    checkinHistoryLoaded: false,
    checkinHistoryEmpty: false,
    checkinHistoryMore: false,
    checkinHistoryError: '',
    checkinHistoryRestart: false,
    manualCheckinMode: !isExperience(environment),
    checkinRefreshing: false,
    checkinScrollTarget: '',
    checkinPlaces: PLACES,
    checkinSignedIn: false,
    checkinLoading: false,
    checkinError: '',
    checkinDate: '',
    checkinBusy: false,
    checkinPendingPlace: '',
    isExperience: isExperience(environment),
    isProduction: environment.releaseProfile === 'production',
    preview,
    catalogMode: 'none',
    demoEnabled: false,
    filtersExpanded: false,
    locationExpanded: false,
    weatherPreviewExpanded: false,
    demoDate: DEMO_DATE,
    memberRecordDate: FIELD_NOTE_DATE,
    correctionLimit: LIMITS.correctionTextCodePoints,
    modeLabel: '真实地点接口尚未读取',
    campusOptions: CAMPUS_OPTIONS,
    tagOptions: TAG_OPTIONS,
    campusIndex: 0,
    tagIndex: 0,
    selectedCampus: ALL_CAMPUS,
    selectedTag: ALL_TAG,
    places: [],
    page: 1,
    hasMore: false,
    listMoreError: '',
    listLoadingMore: false,
    total: 0,
    listState: 'unverified',
    selectedPlace: null,
    detailScrollTarget: '',
    detailState: 'idle',
    detailError: '',
    selectedPlaceFavorited: false,
    favorites: [],
    favoriteState: 'idle',
    favoriteError: '',
    favoriteBusy: false,
    favoritePendingOperation: '',
    correctionText: '',
    correctionCount: 0,
    correctionState: 'idle',
    correctionError: '',
    correctionBusy: false,
    locationBusy: false,
    locationState: '未请求定位（首次进入不主动申请）',
    mapState: 'idle',
    supportState: 'pending',
    supportItems: [],
    supportError: '',
    cloudState: 'idle',
    cloudMessage: '',
  },

  onLoad(options = {}) {
    if (
      prepareSharedPage(
        this,
        typeof wx === 'undefined' ? null : wx,
        environment,
        'pages/campus/index',
        options,
      )
    ) {
      return;
    }
    this._disposed = false;
    this._campusVisible = true;
    if (this.data.manualCheckinMode) {
      resetPageNavigation(this);
      this._checkins = createCheckinController({
        service: { createRequest: api.createRequest, submit: api.call },
        session: cloudSessionState,
        pendingStorage: createCheckinOutbox(wx, environment),
        ensureSession: ensureCloudSession,
        publish: (patch) => {
          this.setData({
            ...patch,
            ...(patch.checkinHistoryOpen === false &&
            this.data.checkinScrollTarget === 'checkin-history'
              ? { checkinScrollTarget: '' }
              : {}),
          });
          if (
            this._pullCheckinRefresh &&
            !cloudSessionState.isCurrent(this._pullCheckinRefresh.scope)
          ) {
            this._finishCheckinRefresh();
          }
          if (this._campusVisible) {
            syncLeaveGuard(
              this,
              wx,
              this._checkins?.getWorkStatus().pending
                ? '打卡结果尚未确认，返回后请重试原操作。'
                : '',
            );
          }
        },
        login: (placeId) => this.onCheckinLogin(placeId),
        historyLogin: () => this.onCheckinLogin(undefined, true),
        toast: (title) => wx.showToast({ title, icon: 'success' }),
      });
      return;
    }
    this._unsubscribeCampusSession = cloudSessionState.subscribe(() => {
      const visible = this._campusVisible;
      this.onHide();
      if (visible && !this._disposed && this.data.catalogMode === 'cloud') {
        this._campusVisible = true;
        this._refreshCloudOnShow = false;
        this.loadCloudPlaces(false);
      }
    });
    if (this.data.isExperience) {
      this.onStartFieldNotePreview();
      return;
    }
    this.setData({ listState: 'loading' });
    this.loadCloudPlaces(false);
  },

  onShow() {
    this._campusVisible = true;
    if (this.data.shareSinglePage || this._shareLoginRedirected) {
      return;
    }
    enableAppShare(wx);
    syncTab(this, 1);
    if (this.data.manualCheckinMode) {
      resetPageNavigation(this);
      this._leaveGuardNeedsSync = true;
      this._restoreCheckinPlace();
      const intent = this._checkinLoginIntent;
      this._checkinLoginIntent = null;
      const atShow = cloudSessionState.capture();
      const sequence = (this._historyReturnSequence = (this._historyReturnSequence || 0) + 1);
      return Promise.resolve(this._checkins?.show()).then(() => {
        if (
          !intent ||
          this._disposed ||
          !this._campusVisible ||
          sequence !== this._historyReturnSequence ||
          !cloudSessionState.capture() ||
          (atShow && !cloudSessionState.isCurrent(atShow)) ||
          this._checkins?.getWorkStatus().pending ||
          this.data.checkinHistoryOpen
        ) {
          return false;
        }
        return this.onCheckinHistory();
      });
    }
    if (this._refreshCloudOnShow) {
      this._refreshCloudOnShow = false;
      this.loadCloudPlaces(false);
    }
    if (this.data.catalogMode === 'cloud' && this.data.selectedPlace && !this._favoriteReadBusy) {
      if (!this.data.isProduction) {
        this.loadFavorites();
      }
    }
  },

  onHide() {
    this._campusVisible = false;
    this._historyReturnSequence = (this._historyReturnSequence || 0) + 1;
    if (this.data.manualCheckinMode) {
      this._finishCheckinRefresh();
      this.setData({ checkinScrollTarget: '' });
      pausePageNavigation(this);
      this._checkins?.hide();
      syncLeaveGuard(this, typeof wx === 'undefined' ? {} : wx, '');
      return;
    }
    this._refreshCloudOnShow = this.data.catalogMode === 'cloud';
    this._cloudListGeneration = (this._cloudListGeneration || 0) + 1;
    this._cloudListBusy = false;
    this._locationGeneration = (this._locationGeneration || 0) + 1;
    this._detailGeneration = (this._detailGeneration || 0) + 1;
    this._favoriteReadGeneration = (this._favoriteReadGeneration || 0) + 1;
    this._correctionGeneration = (this._correctionGeneration || 0) + 1;
    this._supportGeneration = (this._supportGeneration || 0) + 1;
    this._pendingFavoriteRequest = null;
    this._favoriteReadRequest = null;
    this._pendingCorrectionRequest = null;
    this._selectedPlaceId = null;
    this._pendingDetailPlaceId = null;
    this._favoriteReadBusy = false;
    this.setData({
      locationBusy: false,
      locationState: '未请求定位（首次进入不主动申请）',
      supportState: 'pending',
      supportItems: [],
      supportError: '',
      listLoadingMore: false,
      favorites: [],
      selectedPlace: null,
      detailScrollTarget: '',
      detailState: 'idle',
      detailError: '',
      selectedPlaceFavorited: false,
      favoriteState: 'idle',
      favoriteError: '',
      favoriteBusy: false,
      favoritePendingOperation: '',
      correctionText: '',
      correctionCount: 0,
      correctionState: 'idle',
      correctionError: '',
      correctionBusy: false,
    });
  },

  onUnload() {
    this._checkinLoginIntent = null;
    if (this._unsubscribeCampusSession) {
      this._unsubscribeCampusSession();
      this._unsubscribeCampusSession = null;
    }
    this.onHide();
    this._checkins?.dispose();
    this._disposed = true;
  },

  getWorkStatus() {
    return this._checkins?.getWorkStatus() || { draft: false, pending: false };
  },
  onCheckinTap(event) {
    this._checkins?.complete(event.currentTarget.dataset.placeId);
  },
  onCheckinRetry() {
    void this._checkins?.retry();
  },
  onCheckinHistory() {
    if (
      this._disposed ||
      !this._campusVisible ||
      this.data.shareSinglePage ||
      this._shareLoginRedirected ||
      !this.data.manualCheckinMode ||
      !this._checkins
    ) {
      return Promise.resolve(false);
    }
    const scope = cloudSessionState.capture();
    const request = this._checkins?.toggleHistory();
    return Promise.resolve(request).then((result) => {
      if (
        !this._disposed &&
        this._campusVisible &&
        !this.data.shareSinglePage &&
        cloudSessionState.isCurrent(scope) &&
        this.data.checkinHistoryOpen
      ) {
        this.setData({ checkinScrollTarget: 'checkin-history' });
      }
      return result;
    });
  },
  onCheckinHistoryMore() {
    return this._checkins?.loadMoreHistory();
  },
  onCheckinHistoryRefresh() {
    return this._checkins?.refreshHistory();
  },
  onCheckinHistoryRetry() {
    return this._checkins?.retryHistory();
  },
  onCheckinRefresh() {
    if (
      this._disposed ||
      !this._campusVisible ||
      this.data.shareSinglePage ||
      this._shareLoginRedirected ||
      !this.data.manualCheckinMode ||
      !this._checkins
    ) {
      return Promise.resolve(false);
    }
    if (this._pullCheckinRefresh) {
      return this._pullCheckinRefresh.promise;
    }
    const operation = { scope: cloudSessionState.capture() };
    this._pullCheckinRefresh = operation;
    this.setData({ checkinRefreshing: true });
    operation.promise = Promise.resolve().then(async () => {
      if (this._pullCheckinRefresh !== operation) {
        return false;
      }
      try {
        if (this._checkins.getWorkStatus().pending) {
          wx.showToast?.({
            title: this.data.checkinBusy ? '正在确认打卡，请稍候' : '请先重试上次打卡',
            icon: 'none',
          });
          return false;
        }
        return await this._checkins.refresh();
      } catch (_error) {
        if (this._pullCheckinRefresh === operation) {
          wx.showToast?.({ title: '暂时无法刷新，请稍后重试', icon: 'none' });
        }
        return false;
      } finally {
        this._finishCheckinRefresh(operation);
      }
    });
    return operation.promise;
  },
  onCheckinRefreshAbort() {
    this._finishCheckinRefresh();
  },
  _finishCheckinRefresh(operation = this._pullCheckinRefresh) {
    if (!operation || this._pullCheckinRefresh !== operation) {
      return;
    }
    this._pullCheckinRefresh = null;
    this.setData({ checkinRefreshing: false });
  },
  _restoreCheckinPlace() {
    let target = this._checkinReturnPlaceId;
    this._checkinReturnPlaceId = null;
    if (!target) {
      try {
        target = wx.getStorageSync?.('moodsky.campus.returnPlace');
      } catch {
        /* Public positioning is optional; no login or record state depends on it. */
      }
    }
    if (target) {
      try {
        wx.removeStorageSync?.('moodsky.campus.returnPlace');
      } catch {
        /* The in-memory target is still consumed for this cached page. */
      }
    }
    this.setData({
      checkinScrollTarget: PLACES.some((p) => p.placeId === target)
        ? 'checkin-place-' + target
        : '',
    });
  },
  onCheckinLogin(placeId, returnHistory = false) {
    if (
      this._disposed ||
      !this._campusVisible ||
      this.data.shareSinglePage ||
      this._shareLoginRedirected ||
      isPageNavigationBlocked(this)
    ) {
      return false;
    }
    if (placeId !== undefined && !PLACES.some((p) => p.placeId === placeId)) {
      return false;
    }
    const intent = returnHistory === true ? {} : null;
    this._checkinLoginIntent = intent;
    if (placeId) {
      this._checkinReturnPlaceId = placeId;
      // Retain PR130's public return-place format; private requests/history are not touched.
      try {
        wx.setStorageSync?.('moodsky.campus.returnPlace', placeId);
      } catch {
        /* Continue login and use the cached-page target if local storage is unavailable. */
      }
    }
    const accepted = navigateOnce(
      this,
      wx,
      '/pages/login/index?returnTo=' + encodeURIComponent('/pages/campus/index'),
      'navigateTo',
      undefined,
      () => {
        if (this._checkinLoginIntent === intent) {
          this._checkinLoginIntent = null;
        }
      },
    );
    if (!accepted && this._checkinLoginIntent === intent) {
      this._checkinLoginIntent = null;
    }
    return accepted;
  },
  onToggleFilters() {
    this.setData({ filtersExpanded: !this.data.filtersExpanded });
  },

  onToggleLocation() {
    this.setData({ locationExpanded: false });
  },

  onToggleWeatherPreview() {
    this.setData({ weatherPreviewExpanded: !this.data.weatherPreviewExpanded });
  },

  useLocalPreview(provider, mode, label) {
    this._cloudListGeneration = (this._cloudListGeneration || 0) + 1;
    this._cloudListBusy = false;
    this._detailGeneration = (this._detailGeneration || 0) + 1;
    this._favoriteReadGeneration = (this._favoriteReadGeneration || 0) + 1;
    this._correctionGeneration = (this._correctionGeneration || 0) + 1;
    this._supportGeneration = (this._supportGeneration || 0) + 1;
    this._catalog = provider;
    this._demo = mode === 'synthetic' ? provider : undefined;
    const fieldNoteMode = mode === 'field-note';
    this.setData({
      catalogMode: mode,
      demoEnabled: true,
      modeLabel: label,
      campusOptions: fieldNoteMode ? CLOUD_CAMPUS_OPTIONS : CAMPUS_OPTIONS,
      campusIndex: fieldNoteMode ? 1 : 0,
      selectedCampus: fieldNoteMode ? '福州大学旗山校区' : ALL_CAMPUS,
      tagOptions: fieldNoteMode ? CLOUD_TAG_OPTIONS : TAG_OPTIONS,
      tagIndex: 0,
      selectedTag: ALL_TAG,
      cloudState: 'idle',
      cloudMessage: '',
      listState: 'loading',
      selectedPlace: null,
      detailScrollTarget: '',
      detailState: 'idle',
      detailError: '',
      favorites: [],
      selectedPlaceFavorited: false,
      favoriteState: 'idle',
      favoriteError: '',
      favoriteBusy: false,
      favoritePendingOperation: '',
      correctionState: 'idle',
      correctionError: '',
      correctionBusy: false,
      supportState: 'pending',
      supportItems: [],
      supportError: '',
    });
    this._pendingFavoriteRequest = null;
    this._favoriteReadRequest = null;
    this._pendingCorrectionRequest = null;
    this._favoriteReadBusy = false;
    this.loadPlaces(false);
  },

  onStartDemo() {
    if (this.data.isProduction) {
      return;
    }
    if (this.data.catalogMode === 'synthetic') {
      return;
    }
    this.useLocalPreview(
      campusService.createPlaceDemo(),
      'synthetic',
      '合成数据演示 · 不可作为真实前往推荐',
    );
  },

  onStartFieldNotePreview() {
    if (this.data.isProduction) {
      return;
    }
    if (this.data.catalogMode === 'field-note') {
      return;
    }
    this.useLocalPreview(
      campusService.createFieldNotePreview(),
      'field-note',
      '成员提交的地点资料 · 本地预览，尚待复核，未写入云端',
    );
  },

  onStopDemo() {
    this._cloudListGeneration = (this._cloudListGeneration || 0) + 1;
    this._detailGeneration = (this._detailGeneration || 0) + 1;
    this._favoriteReadGeneration = (this._favoriteReadGeneration || 0) + 1;
    this._supportGeneration = (this._supportGeneration || 0) + 1;
    this._correctionGeneration = (this._correctionGeneration || 0) + 1;
    this._catalog = null;
    this._demo = null;
    this._pendingFavoriteRequest = null;
    this._favoriteReadRequest = null;
    this._pendingCorrectionRequest = null;
    this.setData({
      catalogMode: 'none',
      demoEnabled: false,
      modeLabel: '真实地点接口尚未读取',
      places: [],
      selectedPlace: null,
      detailScrollTarget: '',
      detailState: 'idle',
      detailError: '',
      favorites: [],
      selectedPlaceFavorited: false,
      favoriteState: 'idle',
      favoriteError: '',
      favoriteBusy: false,
      favoritePendingOperation: '',
      correctionText: '',
      correctionCount: 0,
      correctionState: 'idle',
      correctionError: '',
      correctionBusy: false,
      mapState: 'idle',
      listState: 'unverified',
      listMoreError: '',
      listLoadingMore: false,
      campusIndex: 0,
      campusOptions: CAMPUS_OPTIONS,
      tagOptions: TAG_OPTIONS,
      tagIndex: 0,
      selectedCampus: ALL_CAMPUS,
      selectedTag: ALL_TAG,
      total: 0,
      page: 1,
      hasMore: false,
      cloudState: 'idle',
      cloudMessage: '',
      supportState: 'pending',
      supportItems: [],
      supportError: '',
    });
  },

  applyListResult(result, append) {
    const data = copyListData(result);
    const mapped = data.items.map(viewItem);
    const existing = append ? this.data.places : [];
    this.setData({
      places: appendUniquePlaces(existing, mapped),
      page: data.page,
      hasMore: data.hasMore,
      total: data.total,
      listState: data.total === 0 && !append ? 'empty' : 'ready',
      listMoreError: '',
      listLoadingMore: false,
      selectedPlace: append ? this.data.selectedPlace : null,
      detailState: append ? this.data.detailState : 'idle',
      selectedPlaceFavorited: append ? this.data.selectedPlaceFavorited : false,
      mapState: append ? this.data.mapState : 'idle',
    });
  },

  loadPlaces(append = false) {
    if (!this._catalog || typeof this._catalog.listPlaces !== 'function') {
      return;
    }
    const page = append ? this.data.page + 1 : 1;
    const filters = {
      campus: this.data.selectedCampus,
      tag: this.data.selectedTag,
      page,
      pageSize: PAGE_SIZE,
    };
    try {
      const result = this._catalog.listPlaces(filters, previewDate(this.data.catalogMode));
      this.applyListResult(result, append);
    } catch (error) {
      this.setData({
        listState: append ? this.data.listState : 'error',
        listLoadingMore: false,
        listMoreError: messageFor(error, '本地列表读取失败。'),
      });
    }
  },

  onLoadCloudPlaces() {
    this.loadCloudPlaces(false);
  },

  loadCloudPlaces(append = false) {
    if (append && (!this.data.hasMore || this._cloudListBusy)) {
      return;
    }
    const generation = (this._cloudListGeneration || 0) + 1;
    this._cloudListGeneration = generation;
    const requestedPage = append ? this.data.page + 1 : 1;
    const startingCloud = !append && this.data.catalogMode !== 'cloud';
    if (!append) {
      this._cloudListBusy = false;
      this._catalog = null;
      this._demo = undefined;
      this._detailGeneration = (this._detailGeneration || 0) + 1;
      this._favoriteReadGeneration = (this._favoriteReadGeneration || 0) + 1;
      this._correctionGeneration = (this._correctionGeneration || 0) + 1;
      this._supportGeneration = (this._supportGeneration || 0) + 1;
      this._favoriteReadBusy = false;
      this._pendingFavoriteRequest = null;
      this._favoriteReadRequest = null;
      this._pendingCorrectionRequest = null;
    }
    const campus = startingCloud ? ALL_CAMPUS : this.data.selectedCampus;
    const selectedTag = startingCloud ? ALL_TAG : this.data.selectedTag;
    const filters = {
      campus: campus === ALL_CAMPUS ? undefined : campus,
      tags: selectedTag === ALL_TAG ? [] : [selectedTag],
      page: requestedPage,
      pageSize: PAGE_SIZE,
    };
    this._lastCloudListRequest = { append, filters };
    this._cloudListBusy = true;
    this.setData({
      catalogMode: 'cloud',
      demoEnabled: false,
      modeLabel: '云端地点列表 · 以接口返回为准',
      cloudState: 'loading',
      cloudMessage: '',
      listMoreError: '',
      listLoadingMore: append,
      listState: append ? this.data.listState : 'loading',
      places: append ? this.data.places : [],
      selectedPlace: append ? this.data.selectedPlace : null,
      detailState: append ? this.data.detailState : 'idle',
      detailError: append ? this.data.detailError : '',
      campusOptions: CLOUD_CAMPUS_OPTIONS,
      tagOptions: CLOUD_TAG_OPTIONS,
      campusIndex: startingCloud ? 0 : this.data.campusIndex,
      tagIndex: startingCloud ? 0 : this.data.tagIndex,
      selectedCampus: campus,
      selectedTag,
      favorites: append ? this.data.favorites : [],
      selectedPlaceFavorited: append ? this.data.selectedPlaceFavorited : false,
      favoriteState: append ? this.data.favoriteState : 'idle',
      favoriteError: append ? this.data.favoriteError : '',
      favoriteBusy: append ? this.data.favoriteBusy : false,
      favoritePendingOperation: append ? this.data.favoritePendingOperation : '',
      supportState: append ? this.data.supportState : 'pending',
      supportItems: append ? this.data.supportItems : [],
      supportError: append ? this.data.supportError : '',
    });
    Promise.resolve()
      .then(() => campusService.listPlaces(filters))
      .then((result) => {
        if (generation !== this._cloudListGeneration) {
          return;
        }
        const data = copyListData(result);
        if (
          data.page !== requestedPage ||
          data.pageSize !== PAGE_SIZE ||
          data.items.length > PAGE_SIZE ||
          data.total < data.items.length
        ) {
          throw new AppError('INVALID_RESPONSE', '地点列表分页信息不兼容。');
        }
        this._catalog = {
          getPlace: (placeId) => campusService.getPlace(placeId),
        };
        const mapped = data.items.map(viewItem);
        const oldPlaces = append ? this.data.places : [];
        const items = appendUniquePlaces(oldPlaces, mapped);
        this.setData({
          catalogMode: 'cloud',
          demoEnabled: false,
          modeLabel: '云端地点列表 · 以接口返回为准',
          cloudState: 'ready',
          cloudMessage: '',
          listState: data.total === 0 && !append ? 'empty' : 'ready',
          places: items,
          page: data.page,
          hasMore: data.hasMore,
          total: data.total,
          listMoreError: '',
          listLoadingMore: false,
        });
      })
      .catch((error) => {
        if (generation !== this._cloudListGeneration) {
          return;
        }
        const message = messageFor(error, '云端地点接口暂不可用。');
        this.setData({
          cloudState: 'error',
          listState: append ? this.data.listState : 'error',
          cloudMessage: message,
          listMoreError: append ? message : '',
          listLoadingMore: false,
        });
      })
      .finally(() => {
        if (generation === this._cloudListGeneration) {
          this._cloudListBusy = false;
        }
      });
  },

  onRetryMore() {
    const last = this._lastCloudListRequest;
    if (this.data.catalogMode === 'cloud' && last && last.append && this.data.listMoreError) {
      this.loadCloudPlaces(true);
    }
  },

  onCampusChange(event) {
    const campus = this.data.campusOptions[event.detail.value];
    if (!campus) {
      return;
    }
    this.setData({ selectedCampus: campus, campusIndex: Number(event.detail.value) });
    if (this.data.catalogMode === 'cloud') {
      this.loadCloudPlaces(false);
    } else {
      this.loadPlaces(false);
    }
  },

  onTagChange(event) {
    const tag = this.data.tagOptions[event.detail.value];
    if (!tag) {
      return;
    }
    this.setData({ selectedTag: tag, tagIndex: Number(event.detail.value) });
    if (this.data.catalogMode === 'cloud') {
      this.loadCloudPlaces(false);
    } else {
      this.loadPlaces(false);
    }
  },

  onLoadMore() {
    if (this.data.listMoreError && this.data.catalogMode === 'cloud') {
      this.onRetryMore();
      return;
    }
    if (this.data.catalogMode === 'cloud' && this.data.hasMore) {
      this.loadCloudPlaces(true);
    } else if (this.data.catalogMode !== 'cloud' && this.data.hasMore) {
      this.loadPlaces(true);
    }
  },

  applyPlaceDetail(result, placeId, generation) {
    if (generation !== this._detailGeneration || placeId !== this._selectedPlaceId) {
      return;
    }
    if (!result || !result.data || !result.data.place || result.data.place.placeId !== placeId) {
      throw new AppError('INVALID_RESPONSE', '地点详情返回格式不兼容。');
    }
    const detail = result.data.place;
    const place = viewItem(filterAndPagePlaces([detail], {}, businessDate()).items[0] || detail);
    this.setData({
      selectedPlace: place,
      detailScrollTarget: 'campus-place-detail',
      detailState: 'ready',
      detailError: '',
      selectedPlaceFavorited: this.data.favorites.includes(place.placeId),
      mapState: 'idle',
      correctionState: 'idle',
      correctionError: '',
      correctionText: '',
      correctionCount: 0,
      correctionBusy: false,
      favoriteError: '',
      favoritePendingOperation: '',
    });
    if (this.data.catalogMode === 'cloud') {
      if (!this.data.isProduction) {
        this.loadFavorites();
      }
    } else if (this.data.catalogMode === 'field-note' && this._catalog.listFavorites) {
      try {
        const ids = favoriteIdsFromResult(this._catalog.listFavorites());
        this.setData({ favorites: ids, selectedPlaceFavorited: ids.includes(place.placeId) });
      } catch (_error) {
        this.setData({ favorites: [], selectedPlaceFavorited: false });
      }
    }
  },

  requestPlaceDetail(placeId) {
    if (!this._catalog || typeof this._catalog.getPlace !== 'function') {
      return;
    }
    const generation = (this._detailGeneration || 0) + 1;
    this._detailGeneration = generation;
    this._favoriteReadGeneration = (this._favoriteReadGeneration || 0) + 1;
    this._favoriteReadBusy = false;
    this._favoriteReadRequest = null;
    this._selectedPlaceId = placeId;
    this._pendingDetailPlaceId = placeId;
    this._correctionGeneration = (this._correctionGeneration || 0) + 1;
    this._pendingCorrectionRequest = null;
    this.setData({
      selectedPlace: null,
      detailScrollTarget: '',
      detailState: 'loading',
      detailError: '',
      selectedPlaceFavorited: false,
      mapState: 'idle',
      correctionState: 'idle',
      correctionError: '',
      correctionText: '',
      correctionCount: 0,
    });
    let result;
    try {
      result = this._catalog.getPlace(placeId);
    } catch (error) {
      this.setData({ detailState: 'error', detailError: messageFor(error, '地点详情读取失败。') });
      return;
    }
    if (!result || typeof result.then !== 'function') {
      try {
        this.applyPlaceDetail(result, placeId, generation);
      } catch (error) {
        if (generation === this._detailGeneration) {
          this.setData({
            detailState: 'error',
            detailError: messageFor(error, '地点详情读取失败。'),
          });
        }
      }
      return;
    }
    Promise.resolve(result)
      .then((value) => this.applyPlaceDetail(value, placeId, generation))
      .catch((error) => {
        if (generation !== this._detailGeneration || placeId !== this._selectedPlaceId) {
          return;
        }
        this.setData({
          detailState: 'error',
          detailError: messageFor(error, '地点详情读取失败。'),
        });
      });
  },

  onPlaceTap(event) {
    const placeId = event.currentTarget.dataset.id;
    if (!this._catalog || !this.data.places.some((item) => item.placeId === placeId)) {
      return;
    }
    this.requestPlaceDetail(placeId);
  },

  onRetryDetail() {
    if (this._pendingDetailPlaceId) {
      this.requestPlaceDetail(this._pendingDetailPlaceId);
    }
  },

  onCloseDetail() {
    this._detailGeneration = (this._detailGeneration || 0) + 1;
    this._selectedPlaceId = null;
    this._pendingDetailPlaceId = null;
    this._favoriteReadGeneration = (this._favoriteReadGeneration || 0) + 1;
    this._favoriteReadBusy = false;
    this._correctionGeneration = (this._correctionGeneration || 0) + 1;
    this._pendingCorrectionRequest = null;
    this._favoriteReadRequest = null;
    this.setData({
      selectedPlace: null,
      detailScrollTarget: '',
      detailState: 'idle',
      detailError: '',
      selectedPlaceFavorited: false,
      mapState: 'idle',
      correctionState: 'idle',
      correctionError: '',
      correctionText: '',
      correctionCount: 0,
    });
  },

  onNavigate() {
    // Reject events from a stale template too; this page no longer opens maps.
    this.setData({ mapState: 'unavailable' });
    return false;
  },

  onMapBack() {
    this.onCloseDetail();
  },

  onRequestLocation() {
    this.setData({
      locationBusy: false,
      locationState: '本页无需定位，可按文字方位浏览地点',
    });
    return false;
  },

  applyFavoriteResult(result) {
    const placeIds = favoriteIdsFromResult(result);
    const placeId = this.data.selectedPlace && this.data.selectedPlace.placeId;
    this.setData({
      favorites: placeIds,
      selectedPlaceFavorited: placeId ? placeIds.includes(placeId) : false,
      favoriteState: 'ready',
      favoriteError: '',
      favoriteBusy: false,
      favoritePendingOperation: '',
    });
  },

  loadFavorites(retry = false) {
    if (this.data.catalogMode !== 'cloud' || !this.data.selectedPlace) {
      return;
    }
    if (!campusService.privateActionsReady) {
      this.setData({
        favoriteState: 'unavailable',
        favoriteError: '收藏接口与账号隔离尚待联调，当前不读取或修改真实收藏。',
      });
      return;
    }
    if (this._pendingFavoriteRequest) {
      return;
    }
    if (this._favoriteReadBusy && !retry) {
      return;
    }
    const request =
      retry && this._favoriteReadRequest
        ? this._favoriteReadRequest
        : campusService.createFavoriteRequest({ operation: 'list' });
    this._favoriteReadRequest = request;
    const generation = (this._favoriteReadGeneration || 0) + 1;
    this._favoriteReadGeneration = generation;
    this._favoriteReadBusy = true;
    const selectedPlaceId = this.data.selectedPlace.placeId;
    this.setData({ favoriteState: 'loading', favoriteError: '' });
    Promise.resolve()
      .then(() => campusService.submit(request))
      .then((result) => {
        if (
          generation !== this._favoriteReadGeneration ||
          !this.data.selectedPlace ||
          this.data.selectedPlace.placeId !== selectedPlaceId
        ) {
          return;
        }
        this._favoriteReadRequest = null;
        this.applyFavoriteResult(result);
      })
      .catch((error) => {
        if (
          generation !== this._favoriteReadGeneration ||
          !this.data.selectedPlace ||
          this.data.selectedPlace.placeId !== selectedPlaceId
        ) {
          return;
        }
        this.setData({
          favoriteState: 'error',
          favoriteError: messageFor(error, '收藏读取失败。'),
        });
      })
      .finally(() => {
        if (generation === this._favoriteReadGeneration) {
          this._favoriteReadBusy = false;
        }
      });
  },

  onRetryFavorites() {
    this.loadFavorites(true);
  },

  submitFavoriteMutation(pending) {
    if (!campusService.privateActionsReady || !pending || this.data.favoriteBusy) {
      return;
    }
    this._pendingFavoriteRequest = pending;
    this.setData({
      favoriteBusy: true,
      favoriteState: 'loading',
      favoriteError: '',
      favoritePendingOperation: pending.operation,
    });
    Promise.resolve()
      .then(() => campusService.submit(pending.request))
      .then(() => {
        if (this._pendingFavoriteRequest !== pending) {
          return;
        }
        this._pendingFavoriteRequest = null;
        const ids = new Set(this.data.favorites);
        if (pending.operation === 'add') {
          ids.add(pending.placeId);
        } else {
          ids.delete(pending.placeId);
        }
        const selectedId = this.data.selectedPlace && this.data.selectedPlace.placeId;
        this.setData({
          favorites: Array.from(ids),
          selectedPlaceFavorited: selectedId ? ids.has(selectedId) : false,
          favoriteBusy: false,
          favoriteState: 'ready',
          favoriteError: '',
          favoritePendingOperation: '',
        });
        if (this.data.selectedPlace && this.data.catalogMode === 'cloud') {
          if (!this.data.isProduction) {
            this.loadFavorites();
          }
        }
      })
      .catch((error) => {
        if (this._pendingFavoriteRequest !== pending) {
          return;
        }
        this.setData({
          favoriteBusy: false,
          favoriteState: 'error',
          favoriteError: messageFor(error, '收藏保存失败；可重试原操作。'),
          favoritePendingOperation: pending.operation,
        });
      });
  },

  onRetryFavorite() {
    this.submitFavoriteMutation(this._pendingFavoriteRequest);
  },

  onToggleFavorite() {
    if (this.data.isProduction) {
      return;
    }
    const place = this.data.selectedPlace;
    if (
      !place ||
      this.data.favoriteBusy ||
      this.data.favoriteState === 'loading' ||
      (this.data.favoriteState === 'error' && !this._pendingFavoriteRequest) ||
      this._pendingFavoriteRequest
    ) {
      return;
    }
    if (this.data.catalogMode === 'field-note') {
      this.setData({
        favoriteState: 'unavailable',
        favoriteError: '本地核验资料预览不执行账号收藏。',
      });
      return;
    }
    const operation = this.data.selectedPlaceFavorited ? 'remove' : 'add';
    if (this.data.catalogMode === 'cloud') {
      if (!campusService.privateActionsReady) {
        this.setData({
          favoriteState: 'unavailable',
          favoriteError: '收藏接口与账号隔离尚待联调，当前不修改真实收藏。',
        });
        return;
      }
      this.submitFavoriteMutation({
        request: campusService.createFavoriteRequest({ operation, placeId: place.placeId }),
        operation,
        placeId: place.placeId,
      });
      return;
    }
    if (!this._catalog || typeof this._catalog.setFavorite !== 'function') {
      this.setData({ favoriteState: 'error', favoriteError: '当前预览不支持收藏。' });
      return;
    }
    try {
      this.applyFavoriteResult(this._catalog.setFavorite(place.placeId, operation));
    } catch (error) {
      this.setData({
        favoriteState: 'error',
        favoriteError: messageFor(error, '本地收藏演示失败。'),
      });
    }
  },

  onCorrectionInput(event) {
    if (this.data.correctionBusy) {
      return;
    }
    const value = event.detail.value || '';
    if (
      this._pendingCorrectionRequest &&
      value !== this._pendingCorrectionRequest.request.payload.text
    ) {
      this._pendingCorrectionRequest = null;
      this._correctionGeneration = (this._correctionGeneration || 0) + 1;
    }
    this.setData({
      correctionText: value,
      correctionCount: Array.from(value).length,
      correctionState: 'idle',
      correctionError: '',
    });
  },

  onSubmitCorrection() {
    if (this.data.isProduction) {
      return;
    }
    if (
      !this.data.selectedPlace ||
      this.data.correctionBusy ||
      this.data.correctionState === 'submitting'
    ) {
      return;
    }
    if (this.data.catalogMode === 'field-note') {
      this.setData({
        correctionState: 'preview',
        correctionError: '资料预览模式不会提交或上传纠错。',
      });
      return;
    }
    if (this.data.catalogMode === 'cloud' && !campusService.privateActionsReady) {
      this.setData({
        correctionState: 'preview',
        correctionError: '纠错接口的身份与幂等约定尚待联调；输入已保留，没有提交。',
      });
      return;
    }
    const value = this.data.correctionText;
    const length = Array.from(value).length;
    if (length < 1 || value.trim().length === 0 || length > LIMITS.correctionTextCodePoints) {
      this.setData({ correctionState: 'invalid', correctionError: '' });
      return;
    }
    if (this.data.catalogMode === 'cloud') {
      if (!this._pendingCorrectionRequest) {
        this._pendingCorrectionRequest = {
          request: campusService.createCorrectionRequest({
            placeId: this.data.selectedPlace.placeId,
            text: value,
          }),
        };
      }
      this.submitCorrectionRequest(this._pendingCorrectionRequest);
      return;
    }
    this.setData({ correctionState: 'pending' });
  },

  submitCorrectionRequest(pending) {
    if (!campusService.privateActionsReady || !pending || this.data.correctionBusy) {
      return;
    }
    const generation = (this._correctionGeneration || 0) + 1;
    this._correctionGeneration = generation;
    this.setData({ correctionState: 'submitting', correctionBusy: true, correctionError: '' });
    Promise.resolve()
      .then(() => campusService.submit(pending.request))
      .then(() => {
        if (
          this._pendingCorrectionRequest !== pending ||
          generation !== this._correctionGeneration
        ) {
          return;
        }
        this._pendingCorrectionRequest = null;
        this.setData({
          correctionState: 'submitted',
          correctionBusy: false,
          correctionError: '已收到提交响应；这不表示地点资料已经更新。',
        });
      })
      .catch((error) => {
        if (
          this._pendingCorrectionRequest !== pending ||
          generation !== this._correctionGeneration
        ) {
          return;
        }
        this.setData({
          correctionState: 'error',
          correctionBusy: false,
          correctionError: messageFor(error, '纠错提交失败；输入已保留，可重试原请求。'),
        });
      });
  },

  onRetryCorrection() {
    if (this._pendingCorrectionRequest) {
      this.submitCorrectionRequest(this._pendingCorrectionRequest);
    }
  },

  onReviewDemo(event) {
    if (this.data.catalogMode !== 'synthetic' || this.data.correctionState !== 'pending') {
      return;
    }
    const status = event.currentTarget.dataset.status;
    if (['approved', 'rejected'].includes(status)) {
      this.setData({ correctionState: status });
    }
  },

  onSimulateMapFailure() {
    if (this.data.catalogMode === 'synthetic' && this.data.selectedPlace) {
      this.setData({ mapState: 'failed' });
    }
  },

  onSupportResources() {
    if (this.data.supportState === 'loading') {
      return;
    }
    this.setData({ supportState: 'loading', supportError: '', supportItems: [] });
    const generation = (this._supportGeneration || 0) + 1;
    this._supportGeneration = generation;
    if (this.data.catalogMode === 'field-note' && this._catalog && this._catalog.supportResources) {
      try {
        const result = this._catalog.supportResources();
        const items =
          result && result.data && Array.isArray(result.data.items) ? result.data.items : [];
        this.setData({ supportState: items.length ? 'ready' : 'empty', supportItems: items });
      } catch (error) {
        this.setData({
          supportState: 'error',
          supportError: messageFor(error, '支持资源读取失败。'),
        });
      }
      return;
    }
    Promise.resolve()
      .then(() => campusService.supportResources())
      .then((result) => {
        if (generation !== this._supportGeneration) {
          return;
        }
        const data = result && result.data;
        if (!data || !Array.isArray(data.items)) {
          throw new AppError('INVALID_RESPONSE', '支持资源返回格式不兼容。');
        }
        const today = businessDate();
        const items = data.items.filter(
          (item) =>
            item &&
            item.enabled === true &&
            item.verificationStatus === 'verified' &&
            typeof item.name === 'string' &&
            typeof item.source === 'string' &&
            typeof item.description === 'string' &&
            isBusinessDate(item.validUntil) &&
            item.validUntil >= today,
        );
        this.setData({ supportState: items.length ? 'ready' : 'empty', supportItems: items });
      })
      .catch((error) => {
        if (generation !== this._supportGeneration) {
          return;
        }
        this.setData({
          supportState: error.code === 'NOT_IMPLEMENTED' ? 'notImplemented' : 'error',
          supportError: messageFor(error, '支持资源读取失败。'),
          supportItems: [],
        });
      });
  },
});
