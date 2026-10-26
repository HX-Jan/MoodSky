// 七类天气：晴天、晴间多云、阴天、雨天、暴风雨、暴雨、台风。
// CUSTOM 为独立的自定义天气选项，不计入七天气；其名称需满足 1—20 码点边界。
const WEATHER_TYPES = Object.freeze([
  Object.freeze({ code: 'SUNNY', label: '晴天', labelEn: 'Sunny' }),
  Object.freeze({ code: 'PARTLY_CLOUDY', label: '晴间多云', labelEn: 'Partly Cloudy' }),
  Object.freeze({ code: 'CLOUDY', label: '阴天', labelEn: 'Cloudy' }),
  Object.freeze({ code: 'RAINY', label: '雨天', labelEn: 'Rainy' }),
  Object.freeze({ code: 'STORMY', label: '暴风雨', labelEn: 'Stormy' }),
  Object.freeze({ code: 'HEAVY_RAIN', label: '暴雨', labelEn: 'Heavy Rain' }),
  Object.freeze({ code: 'TYPHOON', label: '台风', labelEn: 'Typhoon' }),
]);
const CUSTOM_WEATHER = Object.freeze({ code: 'CUSTOM', label: '自定义', labelEn: 'Custom' });
const CUSTOM_NAME_MIN = 1;
const CUSTOM_NAME_MAX = 20;
const JOURNAL_TAGS = Object.freeze([
  Object.freeze({ id: 'STUDY', label: '课业' }),
  Object.freeze({ id: 'REST', label: '休息' }),
  Object.freeze({ id: 'EXERCISE', label: '运动' }),
  Object.freeze({ id: 'SOCIAL', label: '社交' }),
  Object.freeze({ id: 'ALONE_TIME', label: '独处' }),
  Object.freeze({ id: 'ANTICIPATION', label: '期待' }),
  Object.freeze({ id: 'TIREDNESS', label: '疲惫' }),
  Object.freeze({ id: 'CALM', label: '平静' }),
]);
const LIMITS = Object.freeze({
  journalTextCodePoints: 1000,
  journalTags: 5,
  newEntryWindowDays: 30,
  correctionTextCodePoints: 200,
  taskSuggestions: 3,
  staticStickers: 6,
  staticBackgrounds: 2,
  minimumTrendEntries: 3,
  exportCredentialSeconds: 300,
  exportFileHours: 24,
});
const DEFAULT_PREFERENCES = Object.freeze({ cardTextPreview: false, decorationsEnabled: true });
module.exports = {
  APP_NAME: 'MoodSky',
  APP_VERSION: '0.2.2',
  API_VERSION: '1',
  CLOUD_FUNCTION_NAME: 'moodsky',
  BUSINESS_TIMEZONE: 'Asia/Shanghai',
  WEATHER_TYPES,
  CUSTOM_WEATHER,
  CUSTOM_NAME_MIN,
  CUSTOM_NAME_MAX,
  JOURNAL_TAGS,
  LIMITS,
  DEFAULT_PREFERENCES,
  REVIEW_WINDOWS: Object.freeze([7, 30, 90]),
  ACCOUNT_STATUS: Object.freeze({ ACTIVE: 'active', DISABLED: 'disabled' }),
  TASK_STATUS: Object.freeze({
    SELECTED: 'selected',
    COMPLETED: 'completed',
    SKIPPED: 'skipped',
    REPLACED: 'replaced',
  }),
};
