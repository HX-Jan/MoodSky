# W6-Z｜Zhifeng Dai · 月历、档案与回顾一致性

- 任务编号：W6-Z
- 负责人：Zhifeng Dai
- 分支：`week6/review-zhifeng-dai`（基于 `MoodSky-main` 快照开发）
- 验证环境：禁用云服务的本地小程序路径（`journalDemo = true`、`cloudEnabled = false`）+ 合成种子记录
- 运行日：2026-11-17（业务日 `Asia/Shanghai`）

## 1. 本周结论

| 项目                       | 结果                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| 合成记录日期清单与四页预期 | 已固定为可执行断言（3 个月份 / 7 条记录）                                                    |
| 修改、删除后的三页同步     | 月历、档案、详情、回顾取自同一快照，无残留、无错位                                           |
| 非当前月份下拉刷新         | 保留所选月份与记录行，空月份同样保留                                                         |
| 失败自动恢复               | 返回页面自动重读 + 显式重试 + 下拉刷新三条路径均可恢复                                       |
| 装饰素材失败               | 降级为文本与默认背景，月历、档案、详情入口全部可用                                           |
| 迟到旧请求                 | 切月、离页返回、切到其他模块后均不会回填旧视图                                               |
| 多账号隔离                 | 请求进行中切换账号，迟到响应被拒绝，无串数据                                                 |
| 发现的缺陷                 | 1 处：演示模式离开页面时未释放进行中的读取，导致返回后 `calendarBusy` 卡住、不重读（已修复） |
| 自动化用例                 | `tests/week6-review-zhifeng.test.js` 7/7 通过                                                |

## 2. 交付物索引

| 交付物                                     | 文件                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| 跨页面预期 vs 实测对照表                   | [w6-z01-expected-actual.md](w6-z01-expected-actual.md)                      |
| 完整异常测试用例集合                       | [w6-z02-anomaly-cases.md](w6-z02-anomaly-cases.md)                          |
| 验证证据与截图清单                         | [w6-z03-verification-evidence.md](w6-z03-verification-evidence.md)          |
| 复核交接（Yifan 一致性 / Yuen 全流程复现） | [w6-z04-review-handoff.md](w6-z04-review-handoff.md)                        |
| Pull Request 说明                          | [w6-z05-pr-body.md](w6-z05-pr-body.md)                                      |
| 自动化用例                                 | [week6-review-zhifeng.test.js](../../../tests/week6-review-zhifeng.test.js) |

## 3. 范围

| 层         | 文件                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| 月历页     | [pages/universe/index.js](../../../miniprogram/pages/universe/index.js)                       |
| 月份档案页 | [pages/review/month/index.js](../../../miniprogram/pages/review/month/index.js)               |
| 档案索引页 | [pages/review/archive/index.js](../../../miniprogram/pages/review/archive/index.js)           |
| 详情页     | [pages/review/detail/index.js](../../../miniprogram/pages/review/detail/index.js)             |
| 回顾页     | [pages/review/insights/index.js](../../../miniprogram/pages/review/insights/index.js)         |
| 合成数据   | [modules/review/demo-data.js](../../../miniprogram/modules/review/demo-data.js)               |
| 会话边界   | [modules/review/session-boundary.js](../../../miniprogram/modules/review/session-boundary.js) |

## 4. 运行方式

```bash
npm run cloud:prepare          # 生成 cloudfunctions 共享契约（缺少时 W3/W4/WIRING 用例会失败）
node --test tests/week6-review-zhifeng.test.js
npm run check
```

## 5. 本周代码改动

1. `tests/week6-review-zhifeng.test.js`：新增 7 个跨页面一致性 / 异常 / 并发用例。
2. `miniprogram/pages/universe/index.js`：演示模式 `onHide` 现在会作废进行中的读取并释放
   `calendarBusy` / `decorationLoading`。修复前，若在读取未完成时离开页面，返回后 `onShow`
   因 `calendarBusy` 仍为真而跳过重读，旧响应会把空快照写回当前月份。

## 6. 已知阻塞

本机没有微信开发者工具（已检查标准安装路径与 CLI），因此无法产出模拟器截图；
真机 / 开发者工具截图清单与取证步骤见 [w6-z03-verification-evidence.md](w6-z03-verification-evidence.md)，
本轮以页面状态断言日志作为可复核证据，未伪造截图。
