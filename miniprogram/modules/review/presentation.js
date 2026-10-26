const { WEATHER_TYPES, CUSTOM_WEATHER } = require('../../shared/constants');
const ICONS = Object.freeze({
  SUNNY: '☀',
  PARTLY_CLOUDY: '⛅',
  CLOUDY: '☁',
  RAINY: '☂',
  STORMY: '⛈',
  HEAVY_RAIN: '🌧',
  TYPHOON: '🌀',
  CUSTOM: '🌈',
});
function weatherLabel(code, customName) {
  if (code === CUSTOM_WEATHER.code) {
    return customName || CUSTOM_WEATHER.label;
  }
  const found = WEATHER_TYPES.find((item) => item.code === code);
  return found ? found.label : '';
}
const weatherView = (code, customName) => ({
  icon: ICONS[code] || '',
  label: weatherLabel(code, customName),
});
module.exports = { ICONS, weatherLabel, weatherView };
