# W2 JF02 任务状态机、建议与历史（正式处理器 + 边界测试）

| 项目       | 内容                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| 任务编号   | W2 JF02                                                                                     |
| 承接 W1    | W1 JF02《任务接口与状态转换契约》（`docs/week1/Jiawei_Fang/w1-jf02-task-contract.md`）      |
| 关联需求   | UW3-F17（任务建议）、UW3-F18（状态转换）、UW3-F19（任务历史）、UW3-F20（轻选择）            |
| 负责人     | Jiawei Fang（832401110）                                                                    |
| 协作人     | Qizhen Chen（F17—F19 前端显示）、Yifan Ji（F20 轻选择）                                     |
| 复核人     | Xiang Hong（待复核）；独立检查待定                                                          |
| 版本       | 0.2.0                                                                                       |
| 环境       | 本地 Node.js v24.15.0；内存 store + 注入 clock 替身；**真实云 / 数据库 / 回执签名均未执行** |
| 成果路径   | 见 §2                                                                                       |
| 验收状态   | **待复核**                                                                                  |
| 实际耗时   | 待本人确认（不代填）                                                                        |
| 真实云验证 | **阻塞**：无测试环境写入授权，全部结果来自本地替身                                          |

## 1. 结论先行

- 四个任务接口 `tasks.suggestions` / `tasks.quickChoice` / `tasks.transition` / `tasks.history` 已在 `domains/tasks.js` 中以 `createTasksDomain({ store, clock })` 工厂实现；`handle` 仍保留 `notImplemented()` 兜底，`index.js` **未接线**（由 Lead 汇总时接入）。
- 数据访问拆到 `stores/tasks-store.js`：内存实现（测试使用）+ 云数据库实现草案（未对真云验证）。
- 新增 3 个测试文件共 **40 项**，全部通过；本任务完成时完整 `npm test` 为 **268 项通过**（基线 230 + 38），并行账号成员随后持续新增用例；按独立复审意见补 T21/T22 后，最终工作区核对为 **306 项通过**。
- 未修改任何 `shared/`、`miniprogram/`、`adapters.js`、`index.js` 或其他域文件；未新增依赖。
- 真实云联调、数据库唯一索引决定、前端字段确认仍未完成，因此本任务**只能标为待复核**，不能标为已验收。

## 2. 成果路径（本任务只改这些文件）

| 文件                                                   | 变更 | 说明                                                |
| ------------------------------------------------------ | ---- | --------------------------------------------------- |
| `cloudfunctions/moodsky/domains/tasks.js`              | 修改 | 四个处理器 + 载荷白名单 + 状态机；`handle` 保留兜底 |
| `cloudfunctions/moodsky/stores/tasks-store.js`         | 新增 | 内存 store（含按 owner 串行锁）与云 DB store 草案   |
| `tests/week2-tasks-suggestions.test.js`                | 新增 | S01—S06，公开建议与轻选择                           |
| `tests/week2-tasks-transition.test.js`                 | 新增 | T01—T20，状态机、幂等、并发、门禁                   |
| `tests/week2-tasks-history.test.js`                    | 新增 | H01—H12，归属、区间、游标分页、字段边界             |
| `docs/week2/Jiawei_Fang/w2-jf02-task-state-machine.md` | 新增 | 本文档                                              |

## 3. 接口与实现口径

### 3.1 `tasks.suggestions`（public，非 mutates）

- payload 只允许 `{}`；出现任何字段（含 `date`、`text`）→ `INVALID_INPUT`；身份字段被 `shared/validation.js` 在路由层拒绝 → `INVALID_REQUEST`。
- 只读 `task_templates` 中 `enabled === true` 且字段合法的模板，按（`createdAt` → `_id`）排序，最多 `LIMITS.taskSuggestions` = 3 条；**不读**任何本人历史、偏好或正文。
- 模板集合为空或全部无效 → `items: []` 空态，不编造任务。
- 返回：`{ items: [...], notice: "完成由你自行确认，不做打卡惩罚。" }`。条目字段：`taskId`（模板 `_id`）、`title`、`steps`、`durationMin`、`tags`、`indoor`、`state`。公开接口不接收 actor，故 `state` 恒为 `null`，不泄漏任何私人状态。

### 3.2 `tasks.quickChoice`（public，非 mutates）

- payload 只允许 `{}`；不读取日记、不要求先保存日记（领域模块只依赖任务 store）。
- 返回 `{ entries, suggestions, notice }`：`entries` 固定为 `places` / `tasks` 两个入口；`suggestions` 与 §3.1 共用同一装配函数，但语义独立（F20 轻选择）。`notice = "不读取你的日记正文。"`
- `suggestions` 是否应并入 `quickChoice` 属前端显示口径，见 §9 待确认 2。

### 3.3 `tasks.transition`（private，mutates）

- payload 白名单：`taskId`、`transition`、`replacementTaskId`；其他键（照片、定位、证据、`date` 等）→ `INVALID_INPUT`。身份字段在路由层 → `INVALID_REQUEST`。
- `transition ∈ select | complete | skip | replace`。
- `replacementTaskId`：W1 契约未定死字段名，本实现**选定该名**（见 §9 待确认 3）。可省略：省略时服务端按模板顺序选第一个“今日无记录”的其他启用模板；显式给出时必须是启用模板、不能等于当前任务、且当日无记录。
- `date` 由服务端按 `shared/date.js` 的 `businessDate(clock())`（Asia/Shanghai）计算；payload 传 `date` 直接 `INVALID_INPUT`。
- 返回：`{ taskId, date, state, replayed }`；replace 额外返回 `replacementTaskId`、`replacementState: "selected"`（当前任务自身 `state = "replaced"`）。**终态回放也保持同一形状**：replayed 的 replace 同样带 `replacementTaskId`/`replacementState`，取值来自当日已存行（见 §4 补充规则）。
- 错误码只用既有枚举：`INVALID_INPUT`、`CONFLICT`、`UNAUTHENTICATED`、`ACCOUNT_DISABLED`（路由层）。

### 3.4 `tasks.history`（private，非 mutates）

- payload 白名单：`from`、`to`、`cursor`、`limit`。
- `from`/`to` 必填且为真实日期；闭区间；`from > to` 或区间超过 **90 天** → `INVALID_INPUT`（90 天为本周取值，见 §9 待确认 6）。
- `limit` 缺省 **20**，最大 **50**，必须为 1—50 的整数；否则 `INVALID_INPUT`。
- 只返回 `actor.accountId` 本人的行；条目只含 `taskId / date / state / createdAt`，不含 `ownerId`。
- 返回 `{ entries, nextCursor }`；`nextCursor` 为不透明 Base64URL 字符串（内部为 `createdAt + _id` 复合游标），按 `createdAt` 降序、`_id` 降序稳定分页。

## 4. 状态机（实现口径，按上海业务日）

状态来自 `task_history` 中 `ownerId + taskId + date(今日)` 的快照；无记录即“无状态”。

| 当前状态 | transition | 结果                                    | 写 `task_history`      |
| -------- | ---------- | --------------------------------------- | ---------------------- |
| 无记录   | select     | `selected`，`replayed:false`            | 新增 1 行              |
| 无记录   | complete   | `completed`                             | 新增 1 行              |
| 无记录   | skip       | `skipped`                               | 新增 1 行              |
| 无记录   | replace    | 本模板 `replaced` + 替换模板 `selected` | 新增 2 行              |
| selected | select     | `selected`，`replayed:true`             | 不写                   |
| selected | complete   | `completed`                             | 更新本行为 `completed` |
| selected | skip       | `skipped`                               | 更新本行为 `skipped`   |
| selected | replace    | 本模板 `replaced` + 新模板 `selected`   | 更新本行 + 新增 1 行   |
| 终态     | 同目标状态 | `ok:true`，`replayed:true`              | 不写                   |
| 终态     | 其他目标   | `CONFLICT`                              | 不写                   |

补充规则：

- 终态 = `completed / skipped / replaced`；同一终态重复提交（不同 `requestId`）返回 `replayed:true`，**不会**再触发一次替换选新模板。
- 终态“改投其他终态”包括 `select`：W1 契约表把终态视为不可逆（与 W1 #14 本地演示允许重新选择不同，见 §8）。
- 任务状态只在当日有效：跨日后同一 `taskId` 视为无记录，可重新 `select`（见 §9 待确认 5）。
- replace 无可用替换模板 → `CONFLICT`；模板不存在或停用 → `INVALID_INPUT`；显式替换目标当日已有记录 → `CONFLICT`。
- **replace 的回放不是重新执行**：新的 `requestId` 重复同一 replace 时走回放分支，不写任何行、不再选新模板；`replacementTaskId` 从当日行反推（当日唯一的 `selected` 行），**payload 里的 `replacementTaskId` 不会被当作已生效的目标回显**。
- 回放的已知限制：若当日存在**多个** `selected` 行（例如之后又 select 了别的任务），或该替换目标当日已被改成其他状态，则无法唯一确定首次的替换目标，响应返回 `replacementTaskId: null` 且 `replacementState: null`，**不编造**（T22）。
- 模板有效性：`enabled === true` 且 `_id`（或 `taskId`）/ `title` / `steps` 合法；非法行被跳过而不是修补。

## 5. 幂等、并发与原子性

### 5.1 幂等

- 键：`request_receipts` 的唯一键 `ownerId + action + requestId`（`database/collections.json` 已声明）。
- 摘要：`digest = JSON.stringify([taskId, transition, replacementTaskId])`，只覆盖客户端 payload；服务端日期**不**进入摘要，因此跨零点用同一 `requestId` 重试仍返回原结果与原 `date`。
- 同 `requestId` + 同 payload → 返回首次结果并把 `replayed` 置为 `true`，不再写 `task_history`。
- 同 `requestId` + 不同 payload → `CONFLICT`，按新 payload 执行被明确拒绝。
- 失败（`INVALID_INPUT` / `CONFLICT`）不写入回执：重试会重新计算，不会缓存失败结果。

### 5.2 原子性：选择契约方案 C，并说明剩余风险

W1 JF02 §2.1 给出 A/B/C 三种处理；本周选择 **C：回执先占位，再写历史**，同时：

- **内存实现**：`withOwnerLock(ownerId, …)` 按 owner 串行化转换；锁内读状态、写回执、写历史在同一次同步提交里完成，**无部分写入窗口**（T16 用 5 个并发请求验证最终只有 1 行）。
- **云 DB 草案**（未对真云验证）：先 `request_receipts.add`，再逐模板 upsert `task_history`；无事务、无分布式锁。

| 风险                                                | 现状                                            | 需要什么                                                                          |
| --------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| 回执已写、历史未写（进程在两步之间退出）            | 重试命中回执返回成功，但历史行缺失              | 事务，或回执保存“待完成”状态后补偿                                                |
| 两个不同 `requestId` 并发写同一 (owner, task, date) | 均可能判定“无记录”并各插一行 → **同一日期两行** | 方案 A：`task_history.uniqueKeys` 增加 `[ownerId, taskId, date]`（Xiang Yu 决定） |
| 替换涉及两行（replaced + selected）                 | 两行 non-atomic 写入                            | 同上唯一键 + 事务                                                                 |

未选方案 B（先查后写）：它只能缩小竞态窗口，不能消除，而且会掩盖“同一日期两行”的业务违规。方案 A 才是正解，但 `database/collections.json` 目前 `task_history.uniqueKeys = []`，本周无权也不应改动数据库设计。

### 5.3 `task_history` 的行语义

按 `ownerId + taskId + date` **一行/天** upsert：同日后续转换只更新 `state`，保留首次写入的 `createdAt`。这样 `tasks.history` 分页游标稳定（历史行的 `createdAt` 不会因更新而移动）。代价是**不保留同日中间转换的审计轨迹**；若后续需要审计，应另设事件集合或在 `task_history` 增加 `updatedAt` 版本字段（待确认 7）。

## 6. 数据字段口径

- `task_templates`：按 `docs/week1/XiangYu/data-dictionary.md` §9（`_id / title / steps / durationMin / tags / enabled / createdAt`）。本实现把 `_id` 作为业务 `taskId`；`indoor` 由 `tags` 派生，`tags` 缺失时为 `null` 而不是猜一个值。
- `task_history`：`ownerId / taskId / date / state / createdAt`，`state` 只用 `shared/constants.js` 的 `TASK_STATUS`。
- `request_receipts`：`ownerId / action / requestId / digest / result`（`result` 只含安全摘要，不含正文或身份）。
- **未改 `shared/`**：payload 白名单写在本模块内（`hasOnlyKeys`）。若要把任务校验统一到共享层，应补到 `shared/validation.js` 并同步两份拷贝；该文件本周冻结，列为待确认 1。

## 7. 测试命令与真实计数

```sh
node --test tests/week2-tasks-suggestions.test.js tests/week2-tasks-transition.test.js tests/week2-tasks-history.test.js
# tests 40 / suites 0 / pass 40 / fail 0
```

| 文件                              | 用例数 | 覆盖重点                                                                                                                                         |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `week2-tasks-suggestions.test.js` | 6      | 未登录可用、上限 3、空态、不读私人数据、payload 白名单、quickChoice 与日记解耦                                                                   |
| `week2-tasks-transition.test.js`  | 22     | 状态机全表、终态幂等/冲突、replace 显式与自动、replace 回放形状（T21）与无法确定目标时为 null（T22）、幂等回执、并发、跨日、停用账号、服务端日期 |
| `week2-tasks-history.test.js`     | 12     | 本人隔离、闭区间、游标分页不重不漏、limit/区间/游标校验、字段形状、跨页插入稳定性                                                                |

提交前检查（真实输出）：

```sh
npx prettier --check cloudfunctions/moodsky/domains/tasks.js cloudfunctions/moodsky/stores/tasks-store.js \
  tests/week2-tasks-suggestions.test.js tests/week2-tasks-transition.test.js tests/week2-tasks-history.test.js
# All matched files use Prettier code style!

npx eslint <同上 5 个文件>
# 无输出（0 问题）

npm run structure:check
# Structure, 24 requirement IDs, shared contract copy and client access policy passed.

npm test
# JF02 单跑：tests 40 / pass 40 / fail 0
# 完整套件：tests 306 / pass 306 / fail 0
```

完整检查：

```sh
npm run check
# lint 通过；format:check 通过；structure:check 通过；npm test 306/306 通过
```

说明：本任务完成时，完整 `npm run check` 曾以 **268/268 全绿**（lint + format + structure + test），随后账号成员的在途测试文件一度挡住 `format:check`。按独立复审意见修复缺陷后，本轮已对这些文件统一 `prettier --write`，`npm run check` 恢复全绿：**306 tests / pass 306 / fail 0**，lint、format、structure 均通过。

## 8. 与 W1 契约 / #14 演示的显式偏差

| #   | 偏差                                                                    | 依据 / 处理                                                   |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `tasks.history` 返回 `entries`，W1 样例用 `items`                       | 按本周 Lead 约定；前端确认后统一（待确认 5）                  |
| 2   | replace 的替换目标字段名定为 `replacementTaskId`                        | W1 未定死；已写入测试与本文                                   |
| 3   | replace 在未指定目标时**自动**选择下一个启用且今日无记录的模板          | 保证“无可用替换 → CONFLICT”可实现；显式指定仍受支持           |
| 4   | 终态当日不可再 `select`（返回 `CONFLICT`）                              | 按 W1 §3 契约表；与 W1 #14 本地演示“可重新选择”不同，需要定案 |
| 5   | 任务状态跨日重置                                                        | W1 §5 标注“仅当日有效、待评审确认”；本实现按日读取状态        |
| 6   | `task_history` 一行/天 upsert，不保留同日中间状态                       | 与“一个日期一个模板只有一行”的业务要求一致；审计需求另议      |
| 7   | 建议条目不含 `alternatives`，改出 `steps/tags/durationMin/indoor`       | `alternatives` 在数据字典中没有来源，编造会违反空态原则       |
| 8   | 未知/停用的替换目标 → `INVALID_INPUT`；已有记录的替换目标 → `CONFLICT`  | 区分“输入不合法”和“状态冲突”，不新增错误码                    |
| 9   | 终态 replace 回放若当日无法唯一确定替换目标 → `replacementTaskId: null` | 回放不重新执行、不编造；限制见 §4，需 Xiang Hong 确认该口径   |

## 9. 待确认项

1. **`shared/validation.js` 应补任务 payload 白名单**：本周写在 `domains/tasks.js` 内，因为 `shared/` 冻结且结构检查比对两份拷贝。统一到共享层需要接口评审（Xiang Hong）。
2. `tasks.quickChoice` 是否应内联 `suggestions`，还是只返回 `entries` 由前端另行调用 `tasks.suggestions`（Qizhen Chen / Yifan Ji）。
3. replace 的替换目标字段名是否采用 `replacementTaskId`，以及是否强制前端必填（Qizhen Chen）。
4. 终态当日是否允许重新 `select`：契约表禁止，W1 #14 演示允许；需 Jiawei / Qizhen Chen / Xiang Hong 定案。
5. `tasks.history` 返回字段用 `entries` 还是 W1 样例的 `items`；以及窗口上限 90 天、分页 20/50 是否合适。
6. `task_history` 是否落地方案 A 的唯一键 `[ownerId, taskId, date]`（Xiang Yu）；这是并发“同一日期两行”的正解。
7. 同日中间转换是否需要审计轨迹；若需要，是加事件集合还是给 `task_history` 增加版本字段（Xiang Yu）。
8. `task_templates` 是否需要显式 `order` 字段；当前排序为 `createdAt` → `_id`。
9. 显式替换目标“当日已有记录”应返回 `CONFLICT` 还是自动改选其他模板。
10. 任务是否允许跨日补记（W1 §5 未决）；当前实现只写当日行。

## 10. 阻塞项

| 项目                         | 状态 | 原因 / 所需                                    |
| ---------------------------- | ---- | ---------------------------------------------- |
| 真实云 `task_templates` 读取 | 阻塞 | 无测试环境写入授权；模板集合实际字段未定稿     |
| 真实云 `task_history` 写入   | 阻塞 | 同上；且唯一键方案未定，无法验证并发语义       |
| `request_receipts` 真云幂等  | 阻塞 | 同上；本地替身不能证明真实唯一键行为           |
| 前端字段确认                 | 阻塞 | 需 Qizhen Chen 确认 §9 的 2/3/4/5 后再冻结接口 |

## 11. 复核要点（给 Xiang Hong）

1. 状态机表（§4）是否与 W1 契约一致，尤其“终态不可再 select”和“跨日重置”。
2. 幂等摘要不含日期、失败不写回执，是否符合 `docs/api.md` 的重试口径。
3. 方案 C 的剩余风险与方案 A 的数据库决定是否应升级为本任务的前置条件。
4. `task_history` 一行/天的 upsert 语义是否可接受（丢失同日中间状态）。
5. `indoor: null`、`state: null` 的空值口径是否满足前端显示。

## 12. 交接字段

| 字段         | 内容                                                   |
| ------------ | ------------------------------------------------------ |
| 任务编号     | W2 JF02                                                |
| 成果路径     | §2 六个文件                                            |
| 环境类型     | 本地 Node.js v24.15.0 + 内存替身；无云调用             |
| 测试计数     | 本任务 40/40；完整套件 306/306（本任务完成时 268/268） |
| 验收状态     | 待复核                                                 |
| 实际耗时     | 待本人确认                                             |
| 阻塞与下一步 | 见 §10；下一步为接口评审、唯一键决定与前端字段确认     |
