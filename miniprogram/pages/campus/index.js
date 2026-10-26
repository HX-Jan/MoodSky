const environment = require('../../config/environment.local');
const { isExperience } = require('../../config/experience');
const preview = require('../../modules/campus/simulated-weather');
const campusService = require('../../modules/campus/service');
const { openVerifiedPlace, requestCurrentLocation } = require('../../modules/campus/interactions');
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
    navigationLabel: derived.navigationAvailable
      ? '可主动打开地图'
      : item.isSynthetic
        ? '合成资料不启用导航'
        : '坐标来源或坐标系未确认，暂不导航',
    verificationLabel:
      item.verificationStatus === 'verified' && derived.recommendable
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
  data: {
    isExperience: isExperience(environment),
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

  onLoad() {
    this._disposed = false;
    if (this.data.isExperience) {
      this.onStartFieldNotePreview();
      return;
    }
    this.setData({ listState: 'loading' });
    this.loadCloudPlaces(false);
  },

  onShow() {
    syncTab(this, 1);
    if (this._refreshCloudOnShow) {
      this._refreshCloudOnShow = false;
      this.loadCloudPlaces(false);
    }
    if (this.data.catalogMode === 'cloud' && this.data.selectedPlace && !this._favoriteReadBusy) {
      this.loadFavorites();
    }
  },

  onHide() {
    this._refreshCloudOnShow = this.data.catalogMode === 'cloud' && this._cloudListBusy;
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
    this.onHide();
    this._disposed = true;
  },

  onToggleFilters() {
    this.setData({ filtersExpanded: !this.data.filtersExpanded });
  },

  onToggleLocation() {
    this.setData({ locationExpanded: !this.data.locationExpanded });
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
      this.loadFavorites();
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
    const place = this.data.selectedPlace;
    if (!place || place.recommendable !== true || place.navigationAvailable !== true) {
      this.setData({ mapState: 'unavailable' });
      return;
    }
    const generation = this._detailGeneration;
    const update = (mapState) => {
      if (
        !this._disposed &&
        generation === this._detailGeneration &&
        this.data.selectedPlace === place
      ) {
        this.setData({ mapState });
      }
    };
    openVerifiedPlace(wx, place, {
      onSuccess: () => update('opened'),
      onFailure: () => update('failed'),
    });
  },

  onMapBack() {
    this.onCloseDetail();
  },

  onRequestLocation() {
    if (this.data.locationBusy) {
      return;
    }
    const generation = (this._locationGeneration || 0) + 1;
    this._locationGeneration = generation;
    const update = (patch) => {
      if (!this._disposed && generation === this._locationGeneration) {
        this.setData(patch);
      }
    };
    requestCurrentLocation(wx, {
      onRequest: () => this.setData({ locationBusy: true, locationState: '正在请求定位权限…' }),
      onSuccess: () =>
        update({
          locationBusy: false,
          locationState: '已获本次定位结果；未保存或上传坐标',
        }),
      onFailure: () =>
        update({
          locationBusy: false,
          locationState: '定位未授权或不可用，仍可继续浏览列表',
        }),
    });
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
          this.loadFavorites();
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
      value !== this._pendingCorrectionRequest.request.payload.content
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
            content: value,
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
