# PR：W5-R02 月历/档案/详情/回顾同步验证与专项测试

## Summary

- 为 W5-R02 补充 5 个云路径专项用例，覆盖月历、月份档案、详情、7/30/90 天回顾在新增/编辑/删除/删除重建后的一致性。
- 补充跨月边界、无记录空态、A/B 同日渐号场景，并在用例层排除 demo store/demo service 的旧数据回填。
- 修复详情页 stale 空态在“档案 → 详情”链路下的错误返回指引。
- 交付跨页面对照结果、异常复现报告、真机回填表与 Yuen/Yifan 复核结论。

任务编号：W5-R02

## Changes

- `tests/week5-review-zhifeng.test.js`（新增）
  - Z01：同一记录在四类视图的新增/编辑/删除/重建一致性；旧 ID stale；卡片不含正文。
  - Z02：2026-09-30 与 2026-10-01 的月份隔离，7/30/90 天窗口边界。
  - Z03：无记录月份、缺失详情、云端档案落地页不生成 demo 空月。
  - Z04：A/B 同日记录切号，四页面清空、旧链接 stale、切回恢复。
  - Z05：calendar/monthArchive/timeline/journal.get 的 ID、日期、天气、revision 一致。
- `miniprogram/pages/review/detail/index.wxml`
  - stale 文案由“请返回月历，打开最新记录。”改为“请返回上一页，重新打开最新记录。”
- `docs/week5/zhifeng-dai/**`（新增）
  - 交付说明、同步对照矩阵、异常复现报告、真机回填表、Yuen/Yifan 复核、PR 说明与原始证据。

## Test Plan

```powershell
npm install
npm install --prefix cloudfunctions/moodsky
npm run cloud:prepare
node --test tests/week5-review-zhifeng.test.js
npm run check
```

结果：

- `node --test tests/week5-review-zhifeng.test.js`：5/5 通过。
- `npm run check`：1489/1489 通过；lint、format、结构、文档、类型检查均通过。
- 真机：本机无 adb 设备、无微信开发者工具 CLI，未执行；回填表已列明阻塞原因与执行步骤，不伪造结果。

## Risks / Follow-ups

- 真实云+真机验收仍未完成，W5-R02 不能据此标记为上线通过。
- 云端档案落地页缺月份目录/计数列表（w1-h04 §3.4 已知缺口），不属于本次同步修复范围。
- 普通卡片正文可见范围保持不变；正文仍只在本人详情页展示。
