// Keep the original assets; visible choices now follow the shared API catalogue.
const { WEATHER_TYPES } = require('../../shared/constants');
const WEATHER = Object.fromEntries(WEATHER_TYPES.map(({ code, label }) => [code, label]));

function weatherChoices(choices) {
  const result = choices.map((choice) => ({
    ...choice,
    label: WEATHER[choice.code] || choice.label,
    image: '/assets/jiaqi/' + choice.code + '.png',
  }));
  return result;
}

function syncTab(page, selected) {
  if (typeof page.getTabBar !== 'function') {
    return;
  }
  const tab = page.getTabBar();
  if (tab) {
    tab.setData({ selected });
  }
}

module.exports = { weatherChoices, syncTab, WEATHER };
