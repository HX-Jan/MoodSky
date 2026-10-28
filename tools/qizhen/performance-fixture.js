// Current synthetic D30 variant. Historical reports retain their original inputs.
const { WEATHER_TYPES } = require('../../miniprogram/shared/constants');
const businessInstant = '2026-10-17T04:00:00.000Z';
const datasetVersion = 'D30-seven-weather-v2';
function createPerformanceDataset() {
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.parse('2026-09-18T00:00:00Z') + i * 86400000)
      .toISOString()
      .slice(0, 10);
    const weather = WEATHER_TYPES[i % WEATHER_TYPES.length].code;
    return {
      id: `synthetic_perf_${i + 1}`,
      date,
      weather,
      ...(weather === 'CUSTOM' ? { weatherName: '合成天气😀' } : {}),
      tags: ['REST'],
      text: (`TEST_PERF_D30_${String(i + 1).padStart(2, '0')}_` + 'x'.repeat(200)).slice(0, 200),
      version: 1,
      createdAt: `${date}T04:00:00.000Z`,
      updatedAt: `${date}T04:00:00.000Z`,
    };
  });
}
module.exports = { createPerformanceDataset, businessInstant, datasetVersion };
