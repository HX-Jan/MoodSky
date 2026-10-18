const { WEATHER_TYPES } = require('../../shared/constants');
const ICONS = Object.freeze({
  SUNNY: '☀',
  PARTLY_CLOUDY: '⛅',
  CLOUDY: '☁',
  RAINY: '☂',
  STORMY: '⛈',
});
function weatherLabel(code) {
  const found = WEATHER_TYPES.find((item) => item.code === code);
  return found ? found.label : '';
}
const weatherView = (code) => ({ icon: ICONS[code] || '', label: weatherLabel(code) });
module.exports = { ICONS, weatherLabel, weatherView };
