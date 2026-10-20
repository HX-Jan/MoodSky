// UI labels and assets from Jia7Zhu's W1 design; API weather codes are unchanged.
const WEATHER = {
  SUNNY: '晴天',
  PARTLY_CLOUDY: '多云',
  CLOUDY: '阴天',
  RAINY: '小雨',
  STORMY: '风雨',
  HEAVY_RAIN: '暴雨',
  TYPHOON: '台风',
  CUSTOM: '自定义',
};

function weatherChoices(choices, extensions = false) {
  const result = choices.map((choice) => ({
    ...choice,
    label: WEATHER[choice.code] || choice.label,
    image: '/assets/jiaqi/' + choice.code + '.png',
  }));
  if (extensions) {
    for (const code of ['HEAVY_RAIN', 'TYPHOON', 'CUSTOM']) {
      result.push({
        code,
        label: WEATHER[code],
        image: '/assets/jiaqi/' + code + '.png',
        unavailable: true,
      });
    }
  }
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
