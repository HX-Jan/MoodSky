// F24 is intentionally fictional and fixed. No private records or campus contributions are read.
const preview = Object.freeze({
  simulated: true,
  label: '模拟天气',
  description: '固定模拟数据，不读取私人天气记录，也不采集真实贡献。',
  skies: Object.freeze([
    Object.freeze({ name: '晴天', symbol: '☀', shade: 'sun', caption: '暖暖的光' }),
    Object.freeze({ name: '晴间多云', symbol: '⛅', shade: 'soft', caption: '云在散步' }),
    Object.freeze({ name: '阴天', symbol: '☁', shade: 'cloud', caption: '慢一点也好' }),
    Object.freeze({ name: '雨天', symbol: '☂', shade: 'rain', caption: '听雨落下' }),
    Object.freeze({ name: '暴风雨', symbol: '⚡', shade: 'storm', caption: '记得照顾自己' }),
  ]),
});
module.exports = preview;
