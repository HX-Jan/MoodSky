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

| 模式       | 客户端能力 `tasks`                              | 建议请求                     | 服务端 `readOnly`                             | 本人状态/历史                        | 写动作                             | 实测                                                   |
| ---------- | ----------------------------------------------- | ---------------------------- | --------------------------------------------- | ------------------------------------ | ---------------------------------- | ------------------------------------------------------ |
| `closed`   | `state='unavailable'`、`historyAvailable=false` | 不发；页面在创建控制器前返回 | 不适用                                        | 不请求                               | 无入口                             | 页面级由 QC `W6-QC mode closed` 覆盖；本样例记录能力值 |
| `readOnly` | `state='readOnly'`、`historyAvailable=false`    | 发 `tasks.suggestions`       | `true`                                        | 不请求历史；本人状态可按服务意愿读取 | 隐藏；强制调用在存储前 `FORBIDDEN` | 建议 3 条内置、`readOnly=true`；写 0 行                |
| `enabled`  | `state='available'`、`historyAvailable=true`    | 发 `tasks.suggestions`       | 服务端 `tasksWritesEnabled=true` 时为 `false` | 可读                                 | 按状态机执行                       | select/complete/replace/skip 见 §4                     |

补充：

- `closed` 的判定在 `pages/tasks/index.js` 的 `onLoad` 前半段：`capability.state === 'unavailable'` 时只设 `tasksClosed` 并返回，不创建 `_cloud`，所以不会出现“先请求再隐藏”。
- `readOnly` 时页面把历史视图强制回建议视图，客户端 `readOnly` 也会阻止 `transition`，即使服务端仍可写。
- `enabled` 但服务端 `tasksWritesEnabled=false` 时，`tasks.suggestions` 返回 `readOnly=true`；客户端以服务端回执为准置灰，不出现假完成态（QC 的 `enabled + 服务 readOnly` 行同样覆盖）。
- 不可信会话或未配置云时，即使写 `taskMode='enabled'`，能力仍落到 `unavailable`；这是构建范围之外的第二道 fail-closed。

## 3. 模板读取规则

实际执行结果（`mode-template-results.csv` 前 8 行）：

| 场景                        | 启用行种子           | 结果                                                                  | 说明                                                     |
| --------------------------- | -------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| 空集合                      | 0                    | 内置 3 条：`moodsky_01_walk`、`moodsky_02_read`、`moodsky_03_journal` | 读取成功且为空，才回退                                   |
| 正式 1 条                   | 1                    | 仅 `synthetic_one`                                                    | 正式模板优先，不补内置                                   |
| 正式 2 条                   | 2                    | `synthetic_one`、`synthetic_two`                                      | 有几条给几条，不补齐                                     |
| 正式 5 条                   | 5                    | `synthetic_a`、`synthetic_b`、`synthetic_c`                           | 按 `_id` 升序，公共建议上限 3                            |
| 全部停用                    | 1（`enabled:false`） | 内置 3 条                                                             | `where({enabled:true})` 成功返回空，等价于空集合         |
| 正式行不合法（空标题）      | 1                    | `INTERNAL_ERROR`，无 items                                            | 整次失败，不拼接内置、不返回半份                         |
| 读取失败（注入 query 失败） | 0                    | `INTERNAL_ERROR`，存储 0 行                                           | 失败不回退；客户端显示“任务读取失败，请重试”，不是空成功 |

实现位置：

- 公共建议：`production/backend.js` 的 `repository.listEnabled`，`data.length === 0` 时返回 `DEFAULT_TASKS.slice(0, limit)`。
- 私人建议/状态：`stores/transactional-tasks.js` 的 `listTemplates`，`rows.length === 0` 时返回 `defaultTemplates`。
- 两条路径都不会在异常时回退；异常由入口转为 `INTERNAL_ERROR`。

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
| 同 `requestId` 再 complete                  | 11-18  | `completed`，`replayed:true`              | 1                     | 2                       |
| 已完成后再 skip                             | 11-18  | `CONFLICT`                                | 1                     | 2                       |
| 11-19 重放 11-18 的 select 回执             | 11-19  | `selected`、`date=11-18`、`replayed:true` | 1                     | 2                       |
| 11-19 select `synthetic_two`                | 11-19  | `selected`                                | 2                     | 3                       |
| replace `synthetic_two` → `synthetic_three` | 11-19  | 原 `replaced`、新 `selected`              | 3                     | 4                       |
| skip `synthetic_one`                        | 11-19  | `skipped`                                 | 4                     | 5                       |
| 11-19 首次送达 `expectedDate=11-18`         | 11-19  | `CONFLICT`，零写入                        | 4                     | 5                       |

最终 4 行历史 = 11-18 一条（completed）+ 11-19 三条（replaced/selected/skipped）；6 条回执对应 6 个成功请求（3 个 11-18、3 个 11-19）。失败请求不写回执。

## 5. 重试、跨日与隔离

- **丢响应重试：** 同 `requestId` + 同摘要返回首次结果并带 `replayed:true`；不新增历史，不新增回执。同 `requestId` + 不同摘要 `CONFLICT`。
- **提交失败：** 本地合成注入提交失败时返回 `INTERNAL_ERROR`，历史与回执均 0 行；恢复后同 `requestId` 重试成功，各 1 行（见 `tests/week6-jf-task-modes.test.js` `W6-JF-R02`）。
- **跨日：** 未提交的旧 `expectedDate` 首次送达新业务日 → `CONFLICT`，不补写昨天；已提交回执跨午夜仍按首次业务日回放。
- **切号：** 回执键含 `ownerId`；A 的 `requestId` 在 B 下是新操作，不命中 A 的回执。A/B 各 1 行历史、互不可见（`W6-JF-A01`）。

## 6. 与 W6-QC 的对照

QC 的 [三模式矩阵](../qizhen-chen/README.md) 从页面与真实控制器验证：closed 不发请求、readOnly 不显示写按钮、enabled 在回执后才跳转。本页从生产入口验证服务响应与写入次数。两边共同结论：

- `tasks.suggestions` 的 `readOnly` 必须以服务端布尔为准，不能只看客户端 `taskMode`。
- 同一 `requestId` 的重试是“恢复原结果”，不是“再写一次”；页面不得在未确认时跳转或显示完成。
- 模板空、少、多时，公共建议都以正式行优先；只有成功空读才出现内置三条。

## 7. 未测

目标云真实 `task_templates` 与权限、真实 `expectedDate` 跨时区、真实服务器时钟午夜、真实微信账号 A/B、真机。目标云的写入范围由部署环境 `MOODSKY_TASK_WRITES_PAUSED` 决定，必须与候选 `taskMode` 一起核对。
