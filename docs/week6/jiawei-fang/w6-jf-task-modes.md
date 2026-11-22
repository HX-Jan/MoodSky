# W6-JF 任务模式、模板与状态

本页对应 W6-JF 第 1、2 项。所有数字来自 [task-mode-samples.json](task-mode-samples.json) 与 [mode-template-results.csv](mode-template-results.csv)，由 `tools/week6-jf/collect-samples.cjs` 在本地 `createProductionEntry` 上实际执行；不是目标云或真机结果。

## 1. 两套门禁

| 层次           | 取值                              | 位置                                                              | 作用                                                           |
| -------------- | --------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| 客户端构建范围 | `closed` / `readOnly` / `enabled` | `miniprogram/config/environment`、`scripts/package-production.js` | 决定是否创建任务控制器、是否显示写入口、是否请求历史           |
| 服务端写入门禁 | `tasksWritesEnabled`              | `createProductionEntry` / `createProductionBackend`               | 决定建议响应里的 `readOnly`、是否允许 `tasks.transition`       |
| 部署环境开关   | `MOODSKY_TASK_WRITES_PAUSED`      | `production/index.js` 的 `exports.main`                           | 未设或非 `'true'` 时部署入口仍开启写；设为 `'true'` 才暂停新增 |

客户端 `taskMode` **没有**对应的服务端三枚举接口；服务端只看到布尔能力。因此两者可能不一致，样例必须分别记录。

## 2. 三种模式

| 模式       | 客户端能力 `tasks`                              | 建议请求               | 服务端 `readOnly`                             | 本人状态/历史                        | 写动作                             | 实测                                                   |
| ---------- | ----------------------------------------------- | ---------------------- | --------------------------------------------- | ------------------------------------ | ---------------------------------- | ------------------------------------------------------ |
| `closed`   | `state='unavailable'`、`historyAvailable=false` | 页面不创建控制器       | 不适用                                        | 不请求                               | 无入口                             | 页面级由 QC `W6-QC mode closed` 覆盖；本文件只验能力值 |
| `readOnly` | `state='readOnly'`、`historyAvailable=false`    | 发 `tasks.suggestions` | `true`                                        | 不请求历史；本人状态可按服务意愿读取 | 隐藏；强制调用在存储前 `FORBIDDEN` | 建议 3 条内置、`readOnly=true`；写 0 行                |
| `enabled`  | `state='available'`、`historyAvailable=true`    | 发 `tasks.suggestions` | 服务端 `tasksWritesEnabled=true` 时为 `false` | 可读                                 | 按状态机执行                       | select/complete/replace/skip 见 §4                     |

补充：

- `closed` 的页面路径在 `pages/tasks/index.js` 的 `onLoad` 前半段：`capability.state === 'unavailable'` 时只设 `tasksClosed` 并返回，不创建 `_cloud`；**该页面级行为由 W6-QC 的 closed 用例实测**，本文件只验证能力值（`W6-JF-M01`）。
- `readOnly` 时页面把历史视图强制回建议视图，客户端 `readOnly` 也会阻止 `transition`，即使服务端仍可写。
- `enabled` 但服务端 `tasksWritesEnabled=false` 时，`tasks.suggestions` 返回 `readOnly=true`；客户端以服务端回执为准置灰，不出现假完成态（QC 的 `enabled + 服务 readOnly` 行同样覆盖）。
- **production profile** 下，不可信会话或未配置云时，即使写 `taskMode='enabled'`，能力仍落到 `unavailable`；这是构建范围之外的第二道 fail-closed。非 production 的本地/开发配置 `taskMode` 缺省为 `enabled`，且不要求 `trustedCloudReady`，实测可能显示 `available`（`W6-JF-M02` 特征化用例）；这种配置不能用于发布判定，候选必须带 `releaseProfile='production'`。

## 3. 模板读取规则

实际执行结果（`mode-template-results.csv` 前 8 行）：

| 场景                         | 启用行种子           | 结果                                                                  | 说明                                                     |
| ---------------------------- | -------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| 空集合                       | 0                    | 内置 3 条：`moodsky_01_walk`、`moodsky_02_read`、`moodsky_03_journal` | 读取成功且为空，才回退                                   |
| 正式 1 条                    | 1                    | 仅 `synthetic_one`                                                    | 正式模板优先，不补内置                                   |
| 正式 2 条                    | 2                    | `synthetic_one`、`synthetic_two`                                      | 有几条给几条，不补齐                                     |
| 正式 5 条                    | 5                    | `synthetic_a`、`synthetic_b`、`synthetic_c`                           | 按 `_id` 升序，公共建议上限 3                            |
| 全部停用                     | 1（`enabled:false`） | 内置 3 条                                                             | `where({enabled:true})` 成功返回空，等价于空集合         |
| 正式行不合法（超长标题 >60） | 1 合法 + 1 非法      | `INTERNAL_ERROR`，无 items，两行原样保留                              | 整次失败，不拼接内置、不返回半份                         |
| 读取失败（注入 query 失败）  | 1 合法               | `INTERNAL_ERROR`，原行保留；恢复后返回该正式行                        | 失败不回退；客户端显示“任务读取失败，请重试”，不是空成功 |
| 空集合 + enabled 写入        | 0                    | 内置任务可被 select，写入 1 行 `task_history`                         | **“停用全部模板”= 回退内置且内置可写**（见下方风险）     |

实现位置：

- 公共建议：`production/backend.js` 的 `repository.listEnabled`，`data.length === 0` 时返回 `DEFAULT_TASKS.slice(0, limit)`。
- 私人建议/状态：`stores/transactional-tasks.js` 的 `listTemplates`，`rows.length === 0` 时返回 `defaultTemplates`。
- 写路径的模板校验使用同一个回退后的列表（`tasks-candidate.js` 的 `normalizeTemplates(await store.listTemplates())`），所以空 catalogue 下内置任务不仅能看，也能写。
- 两条读路径都不会在异常时回退；异常由入口转为 `INTERNAL_ERROR`。
- **本轮修复：** 公共建议原先使用更宽的边界（标题 120、步骤 500、时长 1440、标签 8），私人校验用标题 60、步骤 120、时长 600、标签 10；会出现公共可见但 `tasks.transition` 报“模板不存在”。现已统一为私人边界（id 64、标题 60、步骤 1—10 且每步 120、时长 1—600、标签最多 10 且每个 20），并用 `T06` 的超长标题用例锁定。

**运营语义风险：** 如果运营把“停用全部模板”理解为“任务下线”，当前实现不满足：用户仍可选择内置三条并写入历史；日后补上正式模板后，这些内置 id 不在 `tasks.mine` 的模板映射中，历史会从页面消失。本轮按现有语义记录，不擅自改动；是否把“空启用集合”改成“任务关闭”需要产品与接口评审。

## 4. 状态机与写入次数

业务日为北京时间；样例时钟 `2026-11-18T04:00:00Z`（11-18 12:00）与 `2026-11-19T04:00:00Z`（11-19 12:00）。

合法迁移：

| 当前       | select                      | complete | skip | replace                  |
| ---------- | --------------------------- | -------- | ---- | ------------------------ |
| 无记录     | 允许                        | 允许     | 允许 | 允许（可自动挑未用模板） |
| `selected` | 重放                        | 允许     | 允许 | 允许                     |
| 终态       | 同目标重放，其它 `CONFLICT` | 同左     | 同左 | 同左                     |

实际执行（`task-mode-samples.json` → `transitions.steps`）：

| 请求                                        | 业务日 | 结果                                      | 之后 `task_history`   | 之后 `request_receipts` |
| ------------------------------------------- | ------ | ----------------------------------------- | --------------------- | ----------------------- |
| select `synthetic_one`                      | 11-18  | `selected`，`replayed:false`              | 1                     | 1                       |
| complete 同任务                             | 11-18  | `completed`                               | 1（同日同任务只一行） | 2                       |
| **同 `requestId`** 再 complete              | 11-18  | `completed`，`replayed:true`              | 1                     | 2                       |
| 已完成后再 skip                             | 11-18  | `CONFLICT`                                | 1                     | 2                       |
| 11-19 重放 11-18 的 select 回执             | 11-19  | `selected`、`date=11-18`、`replayed:true` | 1                     | 2                       |
| 11-19 select `synthetic_two`                | 11-19  | `selected`                                | 2                     | 3                       |
| replace `synthetic_two` → `synthetic_three` | 11-19  | 原 `replaced`、新 `selected`              | 3                     | 4                       |
| skip `synthetic_one`                        | 11-19  | `skipped`                                 | 4                     | 5                       |
| 11-19 首次送达 `expectedDate=11-18`         | 11-19  | `CONFLICT`，零写入                        | 4                     | 5                       |

最终 4 行历史 = 11-18 一条（completed）+ 11-19 三条（replaced/selected/skipped）；5 条回执对应 5 个成功请求（3 个 11-18、2 个 11-19 新增；11-19 的旧回执重放不新增）。失败请求不写回执。

## 5. 重试、跨日与隔离

- **同 `requestId` 丢响应重试：** 同摘要返回首次结果并带 `replayed:true`；不新增历史，不新增回执；同 `requestId` 不同摘要 `CONFLICT`（`W6-JF-R01`）。
- **新 `requestId` 同终态重放：** 例如多端重复点“完成”，会走 `current === target` 分支：历史不新增，但会为新请求写一条 `request_receipts` 并返回 `replayed:true`。实测 `task_history` 1→1、`request_receipts` 2→3（`terminalReplay`、`W6-JF-R05`）。这与“同 requestId 零写”是两条不同路径，不能混用。
- **提交失败：** 本地合成注入提交失败时返回 `INTERNAL_ERROR`，历史与回执均 0 行；恢复后同 `requestId` 重试成功，各 1 行（见 `tests/week6-jf-task-modes.test.js` `W6-JF-R02`）。
- **跨日：** 未提交的旧 `expectedDate` 首次送达新业务日 → `CONFLICT`，不补写昨天；已提交回执跨午夜仍按首次业务日回放。
- **切号：** 回执键含 `ownerId`；A 的 `requestId` 在 B 下是新操作，不命中 A 的回执。A/B 各 1 行历史、互不可见（`W6-JF-A01`）。

## 6. 与 W6-QC 的对照

QC 的 [三模式矩阵](../qizhen-chen/README.md) 从页面与真实控制器验证：closed 不发请求、readOnly 不显示写按钮、enabled 在回执后才跳转。本页从生产入口验证服务响应与写入次数。两边共同结论：

- `tasks.suggestions` 的 `readOnly` 必须以服务端布尔为准，不能只看客户端 `taskMode`。
- 同一 `requestId` 的重试是“恢复原结果”，不是“再写一次”；页面不得在未确认时跳转或显示完成。
- 模板空、少、多时，公共建议都以正式行优先；只有成功空读才出现内置三条。

## 7. `tasks.quickChoice` 已知差异

| 来源                         | 实际形状                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生产入口（public candidate） | `entries:[{kind:'tasks',label:'浏览小任务'}]`；无 `places`、无 `suggestions`；notice 按 `readOnly` 显示“任务操作仍待接入”或“无需保存日记即可浏览任务” |
| W2 域处理器测试 S05          | `entries:[places,tasks]` + `suggestions`；notice “不读取你的日记正文”                                                                                 |
| W1 契约示例                  | 两条入口，无 `suggestions`                                                                                                                            |

客户端 `loadChoices` 只消费 `entries`，本轮未观察到功能中断；本轮修正了生产入口在 enabled 下仍说“任务操作仍待接入”的假文案（`W6-JF-Q01`）。入口数量、`places` 是否保留、是否返回 `suggestions` 仍需接口负责人统一，未在本周改。

## 8. 未测

目标云真实 `task_templates` 与权限、真实 `expectedDate` 跨时区、真实服务器时钟午夜、真实微信账号 A/B、真机。目标云的写入范围由部署环境 `MOODSKY_TASK_WRITES_PAUSED` 决定，必须与候选 `taskMode` 一起核对。
