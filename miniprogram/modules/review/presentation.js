const { weatherLabel } = require('../../shared/weather');
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
const weatherView = (code, name) => ({ icon: ICONS[code] || '', label: weatherLabel(code, name) });
module.exports = { ICONS, weatherLabel, weatherView };
