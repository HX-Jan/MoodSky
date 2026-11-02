const { WEATHER_TYPES, LIMITS } = require('./constants');
const { AppError } = require('./result');

// Optional custom names remain private weather metadata, never journal body text.
function weatherFields(value) {
  return {
    weather: value.weather,
    ...(value.weatherName === undefined ? {} : { weatherName: value.weatherName }),
  };
}
function validateWeather(value) {
  if (!value || !WEATHER_TYPES.some(({ code }) => code === value.weather)) {
    throw new AppError('INVALID_INPUT', '请选择已支持的天气。');
  }
  if (value.weather !== 'CUSTOM') {
    if (value.weatherName !== undefined) {
      throw new AppError('INVALID_INPUT', '只有自定义天气可以填写天气名称。');
    }
    return { weather: value.weather };
  }
  if (
    typeof value.weatherName !== 'string' ||
    !value.weatherName.trim() ||
    Array.from(value.weatherName.trim()).length > LIMITS.weatherNameCodePoints ||
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(value.weatherName)
  ) {
    throw new AppError('INVALID_INPUT', '请填写1—20个字的单行天气名称。');
  }
  return { weather: 'CUSTOM', weatherName: value.weatherName.trim() };
}
function weatherLabel(code, name) {
  const type = WEATHER_TYPES.find((item) => item.code === code);
  return code === 'CUSTOM' && typeof name === 'string' && name.trim()
    ? name.trim()
    : type
      ? type.label
      : '';
}
module.exports = { weatherFields, validateWeather, weatherLabel };
