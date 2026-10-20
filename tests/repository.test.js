const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('W2XY03 导出模块骨架存在', () => {
  const exportPath = path.join(__dirname, '../cloudfunctions/moodsky/domains/export.js');
  assert.ok(fs.existsSync(exportPath), 'export.js 文件未创建');

  const code = fs.readFileSync(exportPath, 'utf8');
  assert.ok(code.includes('gatherExportData'), '缺失数据组织逻辑');
  assert.ok(code.includes('createExportJob'), '缺失任务创建逻辑');
});
