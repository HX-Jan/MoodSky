const preview = require('../../modules/campus/simulated-weather');
const campusService = require('../../modules/campus/service');
const { openVerifiedPlace, requestCurrentLocation } = require('../../modules/campus/interactions');
const { filterAndPagePlaces } = require('../../modules/campus/presentation');
const { LIMITS } = require('../../shared/constants');
const { syncTab } = require('../../modules/presentation/jiaqi-design');

const DEMO_DATE = '2026-10-16';
const PAGE_SIZE = 2;
const ALL_CAMPUS = '全部校区';
const ALL_TAG = '全部标签';
const CAMPUS_OPTIONS = [ALL_CAMPUS, '云汀校区（合成）', '星河校区（合成）', '松风校区（合成）'];
const { DEMO_PLACES } = require('../../modules/campus/demo-places');
const TAG_OPTIONS = [ALL_TAG, ...new Set(DEMO_PLACES.flatMap((place) => place.environmentTags))];
const STATUS_LABELS = {
  open: '开放（合成状态）',
  expired: '资料已过期，不推荐前往',
  closed: '已关闭，不推荐前往',
  unknown: '开放状态待核实',
};

function viewItem(item) {
  return {
    ...item,
    statusLabel: STATUS_LABELS[item.status] || STATUS_LABELS.unknown,
    tagText: item.environmentTags.join(' · '),
    accessibleText: item.accessibility.details,
  };
}

Page({
  data: {
    preview,
    demoEnabled: false,
    filtersExpanded: false,
    locationExpanded: false,
    weatherPreviewExpanded: false,
    demoDate: DEMO_DATE,
    correctionLimit: LIMITS.correctionTextCodePoints,
    modeLabel: '合成数据演示 · 不可作为真实前往推荐',
    campusOptions: CAMPUS_OPTIONS,
    tagOptions: TAG_OPTIONS,
    campusIndex: 0,
    tagIndex: 0,
    selectedCampus: ALL_CAMPUS,
    selectedTag: ALL_TAG,
    places: [],
    page: 1,
    hasMore: false,
    total: 0,
    listState: 'loading',
    selectedPlace: null,
    selectedPlaceFavorited: false,
    favorites: [],
    correctionText: '',
    correctionCount: 0,
    correctionState: 'idle',
    locationBusy: false,
    locationState: '未请求定位（首次进入不主动申请）',
    mapState: 'idle',
    supportState: 'pending',
  },

  onLoad() {
    this.setData({ listState: 'unverified' });
  },
  onShow() {
    syncTab(this, 1);
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

  onStartDemo() {
    if (this.data.demoEnabled) {
      return;
    }
    this._demo = campusService.createPlaceDemo();
    this.setData({ demoEnabled: true });
    this.loadPlaces();
  },

  onStopDemo() {
    this._demo = null;
    this.setData({
      demoEnabled: false,
      places: [],
      selectedPlace: null,
      favorites: [],
      selectedPlaceFavorited: false,
      correctionText: '',
      correctionCount: 0,
      correctionState: 'idle',
      mapState: 'idle',
      listState: 'unverified',
      campusIndex: 0,
      tagIndex: 0,
      selectedCampus: ALL_CAMPUS,
      selectedTag: ALL_TAG,
      total: 0,
      page: 1,
      hasMore: false,
    });
  },

  loadPlaces(append = false) {
    if (!this._demo) {
      return;
    }
    const page = append ? this.data.page + 1 : 1;
    const result = this._demo.listPlaces(
      {
        campus: this.data.selectedCampus,
        tag: this.data.selectedTag,
        page,
        pageSize: PAGE_SIZE,
      },
      DEMO_DATE,
    ).data;
    const items = result.items.map(viewItem);
    this.setData({
      places: append ? this.data.places.concat(items) : items,
      page: result.page,
      hasMore: result.hasMore,
      total: result.total,
      listState: result.total === 0 ? 'empty' : 'ready',
      selectedPlace: null,
      selectedPlaceFavorited: false,
      mapState: 'idle',
    });
  },

  onCampusChange(event) {
    const campus = this.data.campusOptions[event.detail.value];
    if (!campus) {
      return;
    }
    this.setData({ selectedCampus: campus, campusIndex: Number(event.detail.value) });
    this.loadPlaces();
  },

  onTagChange(event) {
    const tag = this.data.tagOptions[event.detail.value];
    if (!tag) {
      return;
    }
    this.setData({ selectedTag: tag, tagIndex: Number(event.detail.value) });
    this.loadPlaces();
  },

  onLoadMore() {
    if (this.data.hasMore) {
      this.loadPlaces(true);
    }
  },

  onPlaceTap(event) {
    const placeId = event.currentTarget.dataset.id;
    if (!this._demo || !this.data.places.some((item) => item.placeId === placeId)) {
      return;
    }
    const detail = this._demo.getPlace(placeId).data.place;
    const place = viewItem(filterAndPagePlaces([detail], {}, DEMO_DATE).items[0]);
    this.setData({
      selectedPlace: place,
      selectedPlaceFavorited: this._demo.listFavorites().data.placeIds.includes(place.placeId),
      mapState: 'idle',
      correctionState: 'idle',
      correctionText: '',
      correctionCount: 0,
    });
  },

  onCloseDetail() {
    this.setData({
      selectedPlace: null,
      selectedPlaceFavorited: false,
      mapState: 'idle',
      correctionState: 'idle',
    });
  },

  onNavigate() {
    const place = this.data.selectedPlace;
    if (!place || place.recommendable !== true || place.navigationAvailable !== true) {
      this.setData({ mapState: 'unavailable' });
      return;
    }
    openVerifiedPlace(wx, place, {
      onSuccess: () => this.setData({ mapState: 'opened' }),
      onFailure: () => this.setData({ mapState: 'failed' }),
    });
  },

  onMapBack() {
    this.setData({ selectedPlace: null, mapState: 'idle' });
  },

  onRequestLocation() {
    if (this.data.locationBusy) {
      return;
    }
    requestCurrentLocation(wx, {
      onRequest: () => this.setData({ locationBusy: true, locationState: '正在请求定位权限…' }),
      onSuccess: () =>
        this.setData({
          locationBusy: false,
          locationState: '已获本次定位结果；本次小验证未保存或上传坐标',
        }),
      onFailure: () =>
        this.setData({
          locationBusy: false,
          locationState: '定位未授权或不可用，仍可继续浏览列表',
        }),
    });
  },

  onToggleFavorite() {
    const place = this.data.selectedPlace;
    if (!place) {
      return;
    }
    if (!this.data.demoEnabled || !this._demo) {
      return;
    }
    const placeId = place.placeId;
    const operation = this.data.selectedPlaceFavorited ? 'remove' : 'add';
    const result = this._demo.setFavorite(placeId, operation).data;
    this.setData({
      favorites: result.placeIds,
      selectedPlaceFavorited: result.placeIds.includes(placeId),
    });
  },

  onCorrectionInput(event) {
    const value = event.detail.value || '';
    this.setData({
      correctionText: value,
      correctionCount: Array.from(value).length,
      correctionState: 'idle',
    });
  },

  onSubmitCorrection() {
    if (!this.data.demoEnabled || !this.data.selectedPlace) {
      return;
    }
    const text = this.data.correctionText.trim();
    const length = Array.from(text).length;
    if (
      length < 1 ||
      Array.from(this.data.correctionText).length > LIMITS.correctionTextCodePoints
    ) {
      this.setData({ correctionState: 'invalid' });
      return;
    }
    // The cloud action is still NOT_IMPLEMENTED. Keep the input local and explicit.
    this.setData({ correctionState: 'pending' });
  },

  onReviewDemo(event) {
    if (this.data.correctionState !== 'pending' || !this.data.demoEnabled) {
      return;
    }
    const status = event.currentTarget.dataset.status;
    if (['approved', 'rejected'].includes(status)) {
      this.setData({ correctionState: status });
    }
  },

  onSimulateMapFailure() {
    if (this.data.demoEnabled) {
      this.setData({ mapState: 'failed' });
    }
  },

  onSupportResources() {
    // The cloud action is not implemented; keep the unverified-resource empty state visible.
    this.setData({ supportState: 'notImplemented' });
  },
});
