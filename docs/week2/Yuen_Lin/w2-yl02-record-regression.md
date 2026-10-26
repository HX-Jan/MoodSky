# W2 YL02 记录核心功能回归

- 负责人：Yuen Lin（[学号已隐去]）
- 执行日期：2026-10-24，Asia/Shanghai
- 基线提交：`ed1d76fd97312dd2a4bee0db87aed4e49a14f7eb`（0.2.3）
- 状态：本地/离线替身回归完成，待复核；真实云端私有记录回归**阻塞**

## 1. 范围与方法

按第二周计划覆盖：正常保存、空正文、标签与码点、日期窗口、旧记录编辑、版本冲突、删除、重复提交、网络结果未知。执行分三层：

1. **完整套件**：`npm run check` 内 593 项通过，用于确认本次记录相关用例没有破坏其他模块。
2. **定向记录/回顾子集**：12 个测试文件共 **144 项通过 / 0 失败**，是完整套件的子集，**不与 593 相加**。原始 TAP 见 [record-core-targeted.tap](artifacts/yl02/record-core-targeted.tap)。
3. **模拟器**：在显式 `journalDemo:true`、`cloudEnabled:false` 下完成保存、重新进入、编辑和回顾刷新，见 [YL04](w2-yl04-integration-device.md)。

定向命令：

```powershell
node --test --test-reporter=tap `
  tests/journal-backend.test.js `
  tests/journal-backend-client.test.js `
  tests/journal-pages.test.js `
  tests/today-controller.test.js `
  tests/validation.test.js `
  tests/native-journal-integration.test.js `
  tests/loopback-journal-integration.test.js `
  tests/week2-integration.test.js `
  tests/review-backend.test.js `
  tests/review-week2.test.js `
  tests/review-store-invalidation.test.js `
  tests/journal-demo.test.js
```

## 2. 逐项结果

完整字段、步骤、预期、实际和证据见 [w2-yl02-cases.csv](w2-yl02-cases.csv)。摘要如下：

| 用例     | 行为                                   | 结果                                                 | 关键证据（完整 TAP）            |
| -------- | -------------------------------------- | ---------------------------------------------------- | ------------------------------- |
| YL02-C01 | 天气必选、标签正文可空、保存后重进读取 | 本地 + 模拟器通过                                    | ok 523、527；模拟器 3 项        |
| YL02-C02 | 5 个固定标签、第 6 个与重复标签拒绝    | 本地通过                                             | ok 525                          |
| YL02-C03 | 1000/1001 码点、中文与 emoji           | 本地通过                                             | ok 526                          |
| YL02-C04 | 29/30 天窗口、未来日期、北京时间       | 本地通过                                             | ok 528、242、549                |
| YL02-C05 | 旧记录编辑保持 ID/创建时间、版本递增   | 本地 + 模拟器通过                                    | ok 529、538；模拟器 version 1→2 |
| YL02-C06 | 同日唯一、并发创建/编辑只有一个赢家    | 本地通过                                             | ok 237、588                     |
| YL02-C07 | 旧版本冲突保留草稿、确认后重读         | 本地通过                                             | ok 534、281、231                |
| YL02-C08 | 删除确认/取消/幂等/跨账号拒绝          | 本地通过                                             | ok 535、239、241                |
| YL02-C09 | 删除后回顾同步、重建新 ID              | 本地 + 模拟器通过                                    | ok 399、453；universe 检查      |
| YL02-C10 | 保存中重复点击只写一次                 | 本地通过                                             | ok 533                          |
| YL02-C11 | 未知结果复用原 requestId/payload       | 本地 + 真实 HTTP loopback 通过                       | ok 530、537、336、77            |
| YL02-C12 | 生产未接线返回 `NOT_IMPLEMENTED`       | 本地通过（不虚假成功）                               | ok 539                          |
| YL02-C13 | 账号→记录→回顾组装后端本地联调         | 本地通过                                             | ok 588、335                     |
| YL02-C14 | 真实云端 CRUD                          | **阻塞**：生产 journal/review 仍为 `NOT_IMPLEMENTED` | 只读核对域名源码                |

## 3. 模拟器补充证据

- Today 初次加载：7 类天气、8 个标签、`canSave:false`，业务日 `2026-10-24`。
- 选择 SUNNY 保存：`entryWeather:SUNNY`、`entryVersion:1`。
- 重新进入 Today：仍读取 SUNNY / version 1。
- 记录页编辑为 RAINY：版本从 1 变为 2，ID 保持不变。
- Universe：2026-10 月记录数 6，当天单元格为 `RAINY` / `雨天` / `recorded:true`，证明编辑已进入回顾视图。

证据：[simulator-validation.json](artifacts/yl04/simulator-validation.json)、[universe-today-check.json](artifacts/yl04/universe-today-check.json)。

## 4. 缺陷与缺口

本次没有发现新增的本地记录缺陷。以下缺口均为已登记的依赖，不由测试侧代填通过：

| 编号    | 缺口                                               | 影响                           | 接收负责人              | 下一步                                                |
| ------- | -------------------------------------------------- | ------------------------------ | ----------------------- | ----------------------------------------------------- |
| YL02-B1 | 生产 `journal`/`review` 域仍返回 `NOT_IMPLEMENTED` | 真实云端保存/读取/删除无法验收 | Xiang Hong              | 正式处理器接入可信账号与数据库后，按本表 C01—C14 复测 |
| YL02-B2 | 默认账户适配器未接线，唯一索引/布局/迁移未验证     | 无法证明真实账号与同日唯一     | Jiawei Fang / Xiang Yu  | 提供真实测试账号、索引与布局证据                      |
| YL02-B3 | 真实云并发冲突与超时未执行                         | C06/C07/C11 只有本地和离线结论 | Xiang Hong / Qizhen Cai | 获批后在隔离测试环境固定批次执行                      |
| YL02-B4 | 真实云端 1000 码点与标签上限未执行                 | 仅客户端与本地服务端替身通过   | Xiang Hong / Yifan Ji   | 服务端校验接入后复测同一 payload                      |

## 5. 环境分列与结论

| 环境                 | 记录回归结果                                                                          |
| -------------------- | ------------------------------------------------------------------------------------- |
| 本地单元/内存替身    | 144 项定向通过；完整套件 593 项通过                                                   |
| 锁定 SDK 离线替身    | 事务、回执、并发与回滚路径通过；未发网络请求                                          |
| 微信开发者工具模拟器 | 保存、重进、编辑、回顾刷新 8 项执行完成；7 项断言通过；Campus 定位仅发起请求，见 YL04 |
| 真实云端测试环境     | **未执行/阻塞**；私有业务仍关闭                                                       |
| Android/iOS 真机     | **未测/阻塞**，见 YL04                                                                |

结论：记录核心语义在本地和离线替身范围内通过，可以作为第三周真实云接入后的回归基线；不能写成真实云端已通过或已验收。
