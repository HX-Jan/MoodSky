# W5-Z｜月历、档案和回顾（W5-R02）

- 负责人：Zhifeng Dai
- 任务：W5-R02（本周 W5-Z 全部工作；W5-R16 装饰不在本次请求范围）
- 分支：`week5/review-zhifeng-dai`
- 基线：`origin/main` @ `9f58ed8`（MoodSky-main 快照内容与之一致）
- 日期：2026-11-10

## 1. 结论

| 项目                                                       | 结果                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 新增/编辑/删除后月历、月份档案、详情、7/30/90 天回顾一致性 | 通过（5/5 W5-R02 用例）                                                                        |
| 跨月数据同步（9/30 与 10/1）                               | 通过，月份互不串数据                                                                           |
| 无记录状态（空月份、缺失详情）                             | 通过，空态明确且无演示数据回填                                                                 |
| 删除后重新创建                                             | 通过，新 ID 全面替换，旧详情链接进入 stale 且不展示正文                                        |
| A/B 切号（同日不同账号）                                   | 通过，四类视图均清空，旧账号内容不回填，同日 B 记录不会被 A 的旧链接打开                       |
| 旧数据回填逻辑干扰                                         | 已排除：云路径用例中 demo store / demo service 读取次数为 0                                    |
| 普通卡片正文可见范围                                       | 未调整；月历格、档案卡、回顾条目均不含正文，详情页仍是唯一正文出口                             |
| 全量检查                                                   | `npm run cloud:prepare` 通过；`npm run check` 通过，1489/1489                                  |
| 真机同包回填                                               | 阻塞：本机无 adb 设备、无微信开发者工具 CLI，未伪造结果，回填表见 `w5-z03-device-backfill.csv` |

本轮未复现影响用户阅读或正常操作的功能缺陷。唯一代码修复为详情页 stale 空态文案：原“请返回月历”在从“档案”进入详情时指引错误，改为“请返回上一页，重新打开最新记录。”。

## 2. 变更清单

- 新增 `tests/week5-review-zhifeng.test.js`：W5-R02 Z01–Z05，使用云路径 reader + 固定时钟 2026-10-18（Asia/Shanghai），不读取 demo store/service。
- 修改 `miniprogram/pages/review/detail/index.wxml`：stale 空态返回指引改为“上一页”。

## 3. 交付文件

- `w5-z01-sync-matrix.md`：同一组测试记录在月历、档案、详情、7/30/90 天回顾的逐阶段对照结果，含跨月、空态、删除重建、A/B 切号。
- `w5-z02-anomaly-report.md`：异常复现报告（含未复现结论、测试工具误报、已知缺口、真机阻塞）。
- `w5-z03-device-backfill.csv`：周二前真机回填表（本机可执行的本地列已回填，真机列如实标记未测/阻塞）。
- `w5-z04-review-yuen-yifan.md`：对 Yuen、Yifan 相关内容的复核结论。
- `w5-z05-pr-body.md`：PR 说明，关联 W5-R02。
- `evidence/`：`cloud:prepare`、`check`、W5 专项测试原始输出。

## 4. 复现命令

```powershell
npm install
npm install --prefix cloudfunctions/moodsky
npm run cloud:prepare
node --test tests/week5-review-zhifeng.test.js
npm run check
```

固定时钟：`2026-10-18`（北京时间）；7 天窗口 `2026-10-12..10-18`，30 天窗口 `2026-09-19..10-18`，90 天窗口 `2026-07-21..10-18`。

## 5. 提交与 PR

- 主提交：`f0ea4eb` `test(review): W5-R02 verify calendar, archive, detail and review sync`
- 分支已推送到 `origin/week5/review-zhifeng-dai`（基于 `origin/main` @ `9f58ed8`）。
- PR 标题：`W5-R02 月历/档案/详情/回顾同步验证与专项测试`
- PR 正文：见 `w5-z05-pr-body.md`；目标分支 `main`，来源分支 `week5/review-zhifeng-dai`。
- 创建入口：https://github.com/HX-Jan/MoodSky/pull/new/week5/review-zhifeng-dai
- 说明：本机浏览器未登录 GitHub，自动创建 PR 被登录页阻断；分支与提交已就绪，登录后打开上述入口即可创建，正文可直接粘贴 `w5-z05-pr-body.md`。

## 6. 风险与未决

- 真机同包测试无法在本机完成，需设备与微信开发者工具登录后按回填表执行；在此之前 W5-R02 不能标记为“真实云+真机通过”。
- 云端“档案”落地页目前只有月份选择器，没有月份目录/计数列表（w1-h04 §3.4 已知缺口）；本月档案页本身同步一致，该缺口不属于本次同步修复范围。
