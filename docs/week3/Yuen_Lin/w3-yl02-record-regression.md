# W3 YL02 记录与回顾关键回归

- 执行日期：2026-10-29（Asia/Shanghai）
- 源码基线：`a2a671980a392df1db0e2ec63bd4ec7af4f6b86e`
- 承接：W2 YL02
- 范围：按 H02/H04 覆盖七天气、CUSTOM 名称、日期窗口、版本冲突、未知结果、删除重建和跨页刷新
- 环境：本地合成数据 + 锁定 SDK 离线替身；**未执行真实微信模拟器、手机或真实云端**

## 结果总览

| 项目              | 实际结果                                                       |
| ----------------- | -------------------------------------------------------------- |
| 定向回归          | **176 项通过 / 0 失败 / 0 跳过**，覆盖 17 个测试文件           |
| 完整检查          | 924 项通过 / 0 失败 / 0 跳过（定向回归是其中子集，不重复相加） |
| 真实云/隔离云端   | 未执行；H02 真实账号、唯一索引和正式装配仍阻塞                 |
| 双账号 A/B 与切号 | 未执行；缺真实账号和独立复核条件                               |
| 手机/模拟器       | 未执行；开发者工具与新版体验包均不可用                         |

原始 TAP：[targeted.tap](artifacts/yl02/targeted.tap)、[targeted-pages.tap](artifacts/yl02/targeted-pages.tap)；逐文件结果见 [per-file-summary.csv](artifacts/yl02/per-file-summary.csv) 与 [per-file/](artifacts/yl02/per-file/)。

## 用例与证据

| 用例     | 覆盖要求                  | 测试文件                                                                       | 代表用例                                                                      | 结果 |
| -------- | ------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---- |
| YL02-C01 | 七天气契约与公共投影      | `weather-options`、`week3-validation`、`review-week3`                          | 七类标准天气；分布七个分箱；风暴天气只归并一次                                | 通过 |
| YL02-C02 | CUSTOM 名称 1—20 码点     | `weather-options`、`week3-validation`、`native-journal-integration`            | CUSTOM 接受 1—20 码点、拒绝空值和超长；非 CUSTOM 不携带 `weatherName`         | 通过 |
| YL02-C03 | 日期窗口与边界            | `validation`、`week3-validation`、`review-reader`                              | 新建包含前 29 天和今天；7/30/90 天含精确边界和闰年二月                        | 通过 |
| YL02-C04 | 版本冲突保留草稿          | `journal-pages`、`native-journal-integration`                                  | 冲突保留草稿并要求显式确认重读；CUSTOM 响应不匹配保留原请求                   | 通过 |
| YL02-C05 | 未知结果与原请求重试      | `journal-pages`、`native-journal-integration`                                  | 未知保存保留原 `requestId/payload`；`SYS_ERR`、未映射码、`-501001` 不误判成功 | 通过 |
| YL02-C06 | 删除重建与旧 ID 失效      | `native-journal-integration`、`week3-review-integration`、`review-cloud-pages` | 删除后重建使用新 ID；旧卡片和旧详情不复活；停用账号不能重放                   | 通过 |
| YL02-C07 | 跨页刷新与迟到响应        | `review-cloud-pages`、`review-pages`、`journal-pages`                          | 删除/修改后月历、档案、详情、统计同步；迟到响应不回填；隐藏后不重绘           | 通过 |
| YL02-C08 | 回顾一致性与 7/30/90 快照 | `week3-review-integration`、`review-reader`                                    | 同一有界快照下月历与 7/30/90 边界一致；正文不进入公共投影                     | 通过 |
| YL02-C09 | 账号停用、会话切换与隔离  | `native-journal-integration`、`review-cloud-pages`、`review-session`           | 停用后读写和四种回顾均拒绝；清空/切号/切回丢弃旧私人数据                      | 通过 |
| YL02-C10 | 有界读取与并发快照        | `journal-snapshot-concurrency`、`review-revision`                              | 并行读取保持完整旧快照；新事务提交后不拼接不一致统计                          | 通过 |

## 失败与复测

本轮本地定向回归没有失败项，因此没有修复后复测记录。失败注入用例（未知结果、响应丢失、迟到响应、停用）均按预期被测试捕获并通过，保留在 TAP 原始输出中。

## 未执行范围与边界

| 未执行项                     | 原因                                    | 解锁条件                                 |
| ---------------------------- | --------------------------------------- | ---------------------------------------- |
| 真实账号创建、唯一索引与布局 | H02/JF01/XY02 未完成正式装配            | 可信账号解析、唯一索引和布局依据         |
| 隔离云端固定批次             | H02 新范围未获准；10 月 27 日批次已消费 | 明确批准的新范围、备份和回滚材料         |
| 双账号 A/B、切号、乱序回填   | 缺真实 A/B 账号                         | Qizhen Cai 与 Linghan 可用的真实账号条件 |
| 手机端记录闭环               | 新版体验包未上传，设备不可用            | 新版体验包 + Android/iOS 设备            |

本地通过不等于真实云端通过；本地 SDK 离线、隔离云端和手机结果继续分开记录。
