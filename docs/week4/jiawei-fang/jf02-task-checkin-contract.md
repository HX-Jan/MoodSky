# W4 JF02 任务与地点手动打卡共同规则（提案）

| 项目     | 内容                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------- |
| 任务编号 | W4 JF02（承接 W3 JF02 与议题 #38）                                                                   |
| 负责人   | Jiawei Fang                                                                                          |
| 共同确认 | Qizhen Chen（任务页面，QC01）、Junhan Huang（地点与校园服务，JH02）、Qinghan Zhang（打卡页面，QH03） |
| 复核     | Xiang Hong                                                                                           |
| 用例     | Yuen Lin（据此形成功能用例）                                                                         |
| 权限复核 | Qizhen Cai（QT02）                                                                                   |
| 环境     | 本地 Node.js 与合成测试替身；真实云、真实设备、真实第二位用户均未执行                                |
| 相关代码 | `services/task-checkins.js`、`stores/task-checkin-links.js`（候选，未接线）                          |

状态：提案，待 Qizhen Chen / Junhan Huang / Qinghan Zhang 共同确认，未定稿。

本文件是**共同规则提案**，不是单方定稿，也不替代前端、地点服务与权限复核。未取得共同确认前，不向 `tasks.transition` 或 `campus.checkin` 的既有载荷增加地点字段，也不把本文当作已确认的接口契约。

## 1. 结论先行

1. 任务与地点打卡通过**新增的复合动作** `tasks.checkin` 关联，载荷恰好两个顶层键 `taskId`、`placeId`；`tasks.transition` 与 `campus.checkin` 的载荷和返回结构一律不变。
2. 同一次复合请求把**同一个 `requestId`** 转发给任务半程与打卡半程，复用两边已有的回执去重；复合层只新增一条"关联记录"（`task_checkin_links`）。
3. 写路径顺序固定为：**地点预校验 → 任务转换 → 地点打卡 → 关联提交**。地点预校验在请求映射事务内、写 `pending` 意图之前完成，规则与打卡服务完全一致；**首次请求**不通过则 `NOT_FOUND` 且零写入。若同一 `requestId` 已存在 `pending` 意图（恢复路径）而地点仍不可用，则返回恢复 `CONFLICT`（见 §3.2 与 §6.2），不退回首次 `NOT_FOUND`。任务被拒绝（`CONFLICT` / `INVALID_INPUT`）时不写任何打卡或关联记录。
4. 复合请求不是跨集合的单一事务：一条首次成功的复合请求实际是**四条独立事务**（请求映射含地点预校验 / 任务半程 / 打卡半程 / 关联提交），每条各自幂等，但没有跨集合原子性。中途失败时复合请求明确返回失败（`CONFLICT`，文案「任务已完成，打卡尚未确认，请用原请求标识重试。」），任务可能已完成、关联保持 `pending`；客户端用**原 `requestId` + 原载荷**重试即可补全，绝不换新 ID 重发。
5. 同一任务、同一地点、同一业务日只保留一条关联记录；同日重复请求返回回放结果，不新增任务行、到访或关联行。
6. 未定稿事项集中在 §7，逐项写明由谁确认什么。

## 2. 为什么新增动作，而不是给旧协议加字段

| 方案                                     | 结论   | 原因                                                                                                    |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 在 `tasks.transition` 载荷增加 `placeId` | 不采用 | 任务域 `hasOnlyKeys(payload, ['taskId','transition','replacementTaskId'])` 会拒绝；改它等于改已冻结协议 |
| 在 `campus.checkin` 载荷增加 `taskId`    | 不采用 | 打卡服务要求 `payload` 恰好一个 `placeId`；改它影响已交付的 QH03 页面与既有打卡回执                     |
| 新增 `tasks.checkin` 复合动作            | 采用   | 旧动作零改动；两半仍由原服务处理；关联事实单独持久化；可独立评审后再决定是否注册                        |

复合动作的载荷是 `{ taskId, placeId }`，拒绝任何额外字段（包括 `transition`、`date`、坐标、照片、`ownerId`、`actor`）。业务日只由服务端时钟决定。

## 3. 状态表

### 3.1 合法状态与迁移

"任务当日状态"来自 `task_history` 中本人在该业务日该任务的快照；"打卡记录"指本人当日该 `placeId` 是否已有到访记录。复合动作固定为"完成"。

| 任务当日状态 | 当日该地点打卡                       | 复合结果                                                                 | 写入                                                     |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| 未记录       | 不存在                               | 成功：`task.state=completed`，`checkin.duplicated=false`，`created=true` | 任务行 1 条、到访 1 条、关联 1 条                        |
| 未记录       | 已存在                               | 成功：任务 completed，`checkin.duplicated=true`，`created=true`          | 任务行 1 条、关联 1 条；不新增到访                       |
| selected     | 不存在                               | 成功：同上                                                               | 任务行更新为 completed、到访 1 条、关联 1 条             |
| selected     | 已存在                               | 成功：任务 completed，`duplicated=true`                                  | 任务行更新、关联 1 条；不新增到访                        |
| completed    | 不存在                               | 成功：`task.replayed=true`，到访新增，`created=true`                     | 任务回放不写行、到访 1 条、关联 1 条                     |
| completed    | 已存在                               | 成功：`task.replayed=true`，`duplicated=true`，`created=true`            | 任务回放不写行、关联 1 条                                |
| completed    | 已存在且同一 task+place 已有当日关联 | 回放：`replayed=true`、`created=false`                                   | 写 1 条 `committed` 请求回执；不新增任务行、到访或关联行 |
| skipped      | 任意                                 | 失败 `CONFLICT`（任务已结束）                                            | 零写入；已有打卡不被删除                                 |
| replaced     | 任意                                 | 失败 `CONFLICT`（任务已结束）                                            | 零写入；已有打卡不被删除                                 |

补充说明：

- `task.replayed` / `checkin.duplicated` 记录的是**首次执行**时两半的真实返回值；顶层 `replayed` / `created` 描述**本次响应**。回放时前两者保持首次值。
- 同一任务同一天可以关联**不同地点**（每个地点一条关联记录，产生各自的到访）；是否允许"一任务一天只关联一个地点"见 §7 C2，未确认前按"允许多地点"实现。
- 关联记录只保存"任务已完成 + 地点已打卡 + 同一业务日"的关联事实，不复制任务行或到访行。

### 3.2 失败与例外

| 情形                                                                   | 返回                                                                                       | 已发生的副作用                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 未登录 / 身份不可信                                                    | `UNAUTHENTICATED`                                                                          | 无                                                                                                                     |
| 账号停用                                                               | `ACCOUNT_DISABLED`                                                                         | **写前**拒绝，零部分写入；窗口内停用则任务可能已完成、关联 `pending`，同样不自动恢复；身份恢复只能人工（见 JF03 §1.4） |
| 载荷多字段、缺字段、`requestId` 不合法                                 | `INVALID_INPUT`                                                                            | 无                                                                                                                     |
| 任务模板不存在/停用                                                    | `INVALID_INPUT`                                                                            | 无，打卡半程不执行                                                                                                     |
| 任务当日已是 skipped / replaced                                        | `CONFLICT`                                                                                 | 无，打卡半程不执行                                                                                                     |
| **地点预校验失败（首次请求）**（不存在、关闭、过期、未核验）           | `NOT_FOUND`（「地点不可打卡。」）                                                          | **零写入**：无任务行、无到访、无关联，也不写 `pending` 意图；`checkinStatus=absent`                                    |
| **恢复路径地点仍不可用**（同 `requestId` 已有 `pending` 意图）         | `CONFLICT`（「任务已完成，打卡尚未确认，地点当前不可用；地点恢复后请用原请求标识补全。」） | **零写入**；任务可能已完成、关联保持 `pending`；地点恢复后同 `requestId` 补全（T26）                                   |
| **中途失败**（预校验通过后打卡半程失败：地点在窗口内失效、事务错误等） | `CONFLICT`（「任务已完成，打卡尚未确认，请用原请求标识重试。」）                           | 任务可能已完成；到访未写；关联 `pending`；同 `requestId` 重试补全，任务只完成一次、不重复到访/关联                     |
| **关联提交失败**（存储错误）                                           | `CONFLICT`（同一恢复文案；原始存储错误不透出）                                             | 任务与到访可能都已写，关联 `pending`；同 `requestId` 重试只补关联，不重复到访/关联（T25）                              |
| 任务半程返回结构不完整                                                 | `INVALID_RESPONSE`                                                                         | 不提交关联；客户端按未知结果处理                                                                                       |
| 打卡半程返回结构不完整（到访可能已写）                                 | `CONFLICT`（同一恢复文案）                                                                 | 不提交关联，关联 `pending`；同 `requestId` 重试补全（T28）                                                             |
| 同一 `requestId` 换了 `taskId` 或 `placeId`                            | `CONFLICT`                                                                                 | 零写入                                                                                                                 |
| 关联记录容量超过候选上限（500）                                        | `CONFLICT`                                                                                 | 零写入，不静默截断；只统计 `committed` 关联                                                                            |
| pending 意图超过单独配额（50）                                         | `CONFLICT`（消息与“关联已满”区分）                                                         | 零写入，不静默截断；pending 不计入 500 容量                                                                            |
| pending 意图超过 24 小时                                               | 不报错                                                                                     | 在之后的下一次写入时回收，不再计入配额                                                                                 |
| 复合动作未装配（含未注入 `findPlace`）                                 | `NOT_IMPLEMENTED`                                                                          | 无；写路径失败关闭，不先写任务再碰运气                                                                                 |

## 4. 输入输出

### 4.1 旧动作（本次不改，仅列出确认口径）

| action                  | 载荷键（恰好）                                   | 成功返回                                                | 常见错误                                                                        |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `tasks.transition`      | `taskId`、`transition`、可选 `replacementTaskId` | `{ taskId, date, state, replayed }`（replace 另含目标） | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`INVALID_INPUT`、`CONFLICT`              |
| `tasks.history`         | `from`、`to`、可选 `cursor`、可选 `limit`        | `{ entries, nextCursor }`（页面层再映射为 items）       | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`INVALID_INPUT`                          |
| `campus.checkin`        | `placeId`                                        | `{ visit, duplicated }`                                 | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`INVALID_INPUT`、`CONFLICT`、`NOT_FOUND` |
| `campus.checkinHistory` | 可选 `page`、可选 `pageSize`                     | `{ items, page, pageSize, total, hasMore }`             | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`INVALID_INPUT`                          |

### 4.2 新增候选动作

以下动作名是**候选**，未写入 `shared/contracts.js` 的 `ACTIONS` 注册表，也未接部署入口。

| action                 | 载荷键（恰好）          | 成功返回                                                               | 常见错误                                                                                                                                     |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks.checkin`        | `taskId`、`placeId`     | 复合结果（见 4.3）                                                     | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`INVALID_INPUT`、`CONFLICT`、`NOT_FOUND`、`INVALID_RESPONSE`、`NOT_IMPLEMENTED`（未注入 `findPlace`） |
| `tasks.checkinHistory` | 可选 `page`、`pageSize` | `{ items, page, pageSize, total, hasMore }`                            | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`INVALID_INPUT`                                                                                       |
| `tasks.checkinStatus`  | `requestId`             | `{ requestId, status: 'absent' \| 'pending' \| 'committed', result? }` | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`INVALID_INPUT`                                                                                       |

`requestId` 需同时满足两个既有规则的交集：`^req_[A-Za-z0-9_-]{4,76}$`（总长 8—80），以便原样转发给任务域与打卡服务。复合请求把同一个 ID 用于两个域，因此客户端**不得**把复合 `requestId` 再用于直接 `tasks.transition` 或 `campus.checkin` 调用。

### 4.3 复合成功返回

```json
{
  "taskId": "tpl_walk_10min",
  "placeId": "fzu_library_quiet",
  "linkedDate": "2026-11-06",
  "task": {
    "taskId": "tpl_walk_10min",
    "date": "2026-11-06",
    "state": "completed",
    "replayed": false
  },
  "checkin": {
    "placeId": "fzu_library_quiet",
    "date": "2026-11-06",
    "completedAt": "2026-11-06T04:00:00.000Z",
    "placeName": "图书馆安静区",
    "duplicated": false
  },
  "linkedAt": "2026-11-06T04:00:00.000Z",
  "created": true,
  "replayed": false
}
```

- `linkedDate`：两半业务日相同时为该日期；跨零点补全导致两半不同日时为 `null`（见 §6.3）。
- `created`：本次是否新建了关联记录；回放或同日去重为 `false`。
- `replayed`：本次是否回放了此前已提交的结果。
- `checkin.placeName`：地点名为空时返回 `null`，不猜、不补。

### 4.4 关联历史条目

```json
{
  "requestId": "req_task_checkin_001",
  "taskId": "tpl_walk_10min",
  "placeId": "fzu_library_quiet",
  "linkedDate": "2026-11-06",
  "taskDate": "2026-11-06",
  "checkinDate": "2026-11-06",
  "checkinAt": "2026-11-06T04:00:00.000Z",
  "placeName": "图书馆安静区",
  "duplicated": false,
  "linkedAt": "2026-11-06T04:00:00.000Z"
}
```

只列出 `committed` 记录；`pending` 表示结果未知，不作为历史展示，客户端应重试原请求。

## 5. 同日重复规则

| 重复方式                                           | 结果                                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 同一 `requestId` + 同一载荷（复合）                | 返回首次结果，`replayed=true`、`created=false`，零写入                                                                        |
| 不同 `requestId` + 同一 task+place+业务日（复合）  | 返回该关联的首次结果，`replayed=true`、`created=false`，零新增关联行；该 `requestId` 记为 `committed` 回执，之后可重放/可查询 |
| 同一 `requestId` + 不同 task 或 place              | `CONFLICT`，零写入                                                                                                            |
| 同一 task 当日再次直接 `tasks.transition complete` | 任务域回放，`replayed=true`，不写第二行                                                                                       |
| 同一 place 当日再次直接 `campus.checkin`           | 打卡服务返回 `duplicated=true`，不新增到访                                                                                    |
| 同一 task 当日关联另一个 place（新 requestId）     | 任务回放、该地点新增到访、新增一条关联记录                                                                                    |
| 同一 place 当日关联另一个 task（新 requestId）     | 打卡 `duplicated=true`（不新增到访）、任务 completed、新增关联记录                                                            |

同日关联记录按 `linkedAt` 降序、`requestId` 升序稳定排序；分页每页 1—50，默认 10。

## 6. 跨日与未知结果恢复

### 6.1 跨日

- 任务状态按业务日隔离。跨日后同一 `taskId` 视为"未记录"，可重新完成，前一日任务行保留在历史中。
- 地点打卡按"地点 + 业务日"唯一。跨日后同一地点可再次打卡，前一日到访保留。
- 新业务日的复合请求创建新的任务行、到访和关联记录；不覆盖旧记录。

### 6.2 未知结果恢复

1. 客户端在发请求前持久化 `requestId` 与完整载荷；超时、断网、服务端未知时，用**同一个** `requestId` 和**同样的** `taskId`、`placeId` 重试。
2. 服务端三种状态：`absent` 重新执行（先做地点预校验，再写 `pending`）；`pending` 重跑两个幂等半程后提交；`committed` 直接返回已存结果（`replayed=true`）。同日等价去重命中的请求在第一次返回前就写成 `committed` 回执，因此不会以 `absent` 状态被误当作新操作。
3. **同 id 重试补全**：`pending` 状态下用原 `requestId` 重试时，任务半程按既有回执回放、不重复完成；打卡半程补写（若首次实际已写则回放其回执）；关联从 `pending` 转 `committed`。重复点击同一 ID 不会产生第二条到访或第二条关联。若重试时地点仍不可用，返回恢复 `CONFLICT`「任务已完成，打卡尚未确认，地点当前不可用；地点恢复后请用原请求标识补全。」，意图保持 `pending`，地点恢复后继续用同一 ID 补全（T26）。若状态为 `absent` 且预校验失败（`NOT_FOUND`），说明从未写入，修正地点后可用同一 ID 首次执行。
4. 也可用 `tasks.checkinStatus` 先查状态，再决定是否重试；`pending` 不等于成功，不得据此展示"已完成"。
5. 明确失败（`INVALID_INPUT`、`CONFLICT`、`NOT_FOUND`、`FORBIDDEN`、`UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`NOT_IMPLEMENTED`）不要原样自动重试；应先修正请求或状态，或改用新的 `requestId` 发起新的逻辑操作。其中中途失败的 `CONFLICT` 例外：按第 3 条用原 ID 重试是唯一补全路径。
6. 换新 `requestId` 重发未知结果是**新操作**，可能产生第二条关联记录，因此不能替代"原请求重试"。

### 6.3 跨零点补全

若首次请求通过地点预校验、任务半程成功，但打卡半程失败（中途失败，关联 `pending`），客户端隔日才用原 `requestId` 重试：

- 任务半程回放首次业务日，打卡半程在重试当日完成，两半日期不同；
- 关联记录仍会提交，`linkedDate=null`，`task.date` 与 `checkin.date` 分别保留；
- 历史与状态查询如实返回两个日期，不伪造同日，也不因此拒绝已完成的打卡。

## 7. 待确认清单

| 编号 | 待确认事项                                          | 当前提案口径                                                                                             | 确认人                     | 状态   |
| ---- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------- | ------ |
| C1   | 复合动作名 `tasks.checkin` 及是否注册进 ACTIONS     | 先用候选名，不注册、不接部署入口                                                                         | Qizhen Chen、Xiang Hong    | 未确认 |
| C2   | 同一 task 同日是否允许关联多个地点                  | 允许，每个地点一条关联                                                                                   | Qizhen Chen                | 未确认 |
| C3   | 失败时"任务已完成、打卡未完成"的部分状态是否可接受  | 接受；写前预校验已把可判定的地点失败压到零写入，剩余窗口按 `CONFLICT` + `pending` 处理，靠原请求重试补全 | Qizhen Chen、Yuen Lin      | 未确认 |
| C4   | 地点可用性口径（verified/expiring 且 OPEN/LIMITED） | 直接沿用打卡服务，不新增宽严规则                                                                         | Junhan Huang               | 未确认 |
| C5   | 跨零点补全的 `linkedDate=null` 记录如何展示         | 如实显示两个日期，不合并成一天                                                                           | Qizhen Chen、Qinghan Zhang | 未确认 |
| C6   | 关联历史分页默认值与页面交互                        | 默认 10、最大 50，与打卡历史一致                                                                         | Qinghan Zhang              | 未确认 |
| C7   | `requestId` 生成与本地持久化时机                    | 发请求前落盘，重试不换 ID                                                                                | Qizhen Chen、Qinghan Zhang | 未确认 |
| C8   | 停用账号的读写拒绝范围与清理接缝                    | 全部拒绝；`cleanupDisabled` 仅服务端，未接清理执行器                                                     | Qizhen Cai、Xiang Hong     | 未确认 |
| C9   | 关联回执保留期与容量上限                            | `committed` 关联每账号 500 条；`pending` 单独 50 条、超 24 小时回收；等价回执随请求保留（无 TTL）        | Xiang Hong                 | 未确认 |
| C10  | 状态表到测试用例的映射                              | 按 §3 逐行出用例，含失败与回放                                                                           | Yuen Lin                   | 未确认 |
| C11  | 是否把 `tasks.checkin*` 纳入正式接口评审            | 先用候选服务联调，评审后另行决定                                                                         | Xiang Hong、Qizhen Chen    | 未确认 |

## 8. 例外与不做项

- 不接地图、定位、导航、扫码、照片上传；打卡为**用户自报**，不做到场核验。
- 不采集位置轨迹、不保存坐标、不以签到距离作为完成条件。
- 不修改 `tasks.transition`、`campus.checkin` 的载荷与返回结构；未定稿前不向旧协议增加地点字段。
- 不修改 `shared/contracts.js` 的 `ACTIONS` 注册表，不修改 `index.js` 或任何部署入口。
- 不把关联记录当成任务行或到访行；不复制、不改写两边的既有数据。
- 不提供"撤销关联"或"删除打卡"；如需撤销属于新能力，另行评审。
- 不自动复活停用账号，也不因重试、重新登录或清理把关联写回；身份恢复只能人工。
- `task_checkin_links` 的部署声明登记在 `database/collections.json`（SOURCE PLAN ONLY、Not deployed），候选清理 `domains/cleanup.js` 含该集合；**正式清理与生产集合白名单本轮已隔离**，导出改为 `includeCandidateSources` 显式开启的候选通道，正式导出默认不查询。真实云、真实执行器仍未跑，`cleanupDisabled` 只是服务端生命周期接缝。
- 不宣称真实云、真实设备、真实第二位用户已通过；本文件全部结论来自合成替身。

## 9. 相关文件

- 候选服务：[task-checkins.js](../../../cloudfunctions/moodsky/services/task-checkins.js)
- 关联持久化：[task-checkin-links.js](../../../cloudfunctions/moodsky/stores/task-checkin-links.js)
- 既有任务域：[tasks-candidate.js](../../../cloudfunctions/moodsky/services/tasks-candidate.js)
- 既有打卡服务：[checkins.js](../../../cloudfunctions/moodsky/services/checkins.js)
- 服务说明与验证：[jf03-task-checkin-service.md](jf03-task-checkin-service.md)
- 合成测试：[week4-task-checkins.test.js](../../../tests/week4-task-checkins.test.js)
