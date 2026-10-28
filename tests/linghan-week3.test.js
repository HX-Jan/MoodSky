const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('W3 L01 keeps the current seven-weather contract', () => {
  const constants = require('../miniprogram/shared/constants');
  assert.deepEqual(
    constants.WEATHER_TYPES.map((item) => item.code),
    ['SUNNY', 'PARTLY_CLOUDY', 'CLOUDY', 'RAINY', 'STORMY', 'TYPHOON', 'CUSTOM'],
  );
  assert.equal(constants.LIMITS.weatherNameCodePoints, 20);
});

test('W3 L05 labels both Me preference switches for assistive technology', () => {
  const source = read('miniprogram/pages/me/index.wxml');
  assert.match(source, /<switch[^>]+aria-label="卡片正文预览"/);
  assert.match(source, /<switch[^>]+aria-label="天气装饰"/);
});

test('W3 L05 labels expandable data actions as buttons', () => {
  const source = read('miniprogram/pages/me/index.wxml');
  assert.match(source, /role="button" aria-label="查看记录导出流程"/);
  assert.match(source, /role="button" aria-label="查看账号停用流程"/);
});

test('W3 L05 preserves practical touch target heights on Me and Today', () => {
  const meStyle = read('miniprogram/pages/me/index.wxss');
  const todayStyle = read('miniprogram/pages/today/index.wxss');
  assert.match(meStyle, /min-height:\s*154rpx/);
  assert.match(todayStyle, /min-height:\s*92rpx/);
  assert.match(todayStyle, /min-height:\s*85rpx/);
});

test('W3 L05 keeps long user and error text wrappable on record and review pages', () => {
  const styles = [
    'miniprogram/pages/today/index.wxss',
    'miniprogram/pages/review/month/index.wxss',
    'miniprogram/pages/review/detail/index.wxss',
    'miniprogram/pages/review/insights/index.wxss',
  ].map(read);
  for (const style of styles) {
    assert.match(style, /word-break:\s*break-(?:all|word)/);
  }
});
