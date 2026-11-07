# W4 JF03 私人任务 + 地点打卡复合服务（候选）

| 项目     | 内容                                                                  |
| -------- | --------------------------------------------------------------------- |
| 任务编号 | W4 JF03（承接 W4 JF02、W3 JF02/JF03）                                 |
| 负责人   | Jiawei Fang                                                           |
| 联调方   | Qizhen Chen（QC01 任务页面）、Qinghan Zhang（QH03 打卡页面）          |
| 协调     | Junhan Huang（地点可用性与校园服务）                                  |
| 复测     | Yuen Lin（功能复测）                                                  |
| 权限复核 | Qizhen Cai（QT02）                                                    |
| 状态     | 候选服务已实现；**未接任何部署入口，未注册正式 action**               |
| 环境     | 本地 Node.js + 合成数据库替身；真实云、真实设备、真实第二位用户未执行 |

## 1. 实现了什么

新增两个文件，均为 additive，不修改既有服务、存储、路由与注册表：

| 文件                                                  | 行数 | 职责                                                             |
| ----------------------------------------------------- | ---: | ---------------------------------------------------------------- |
| `cloudfunctions/moodsky/services/task-checkins.js`    |  385 | 复合动作编排、写前地点预校验、载荷校验、旧动作转发、返回结构校验 |
| `cloudfunctions/moodsky/stores/task-checkin-links.js` |  496 | 关联记录持久化：每账号一个确定文档、请求映射、容量与停用清理     |
| `tests/week4-task-checkins.test.js`                   |  995 | T01—T25 合成用例                                                 |

服务复用了两条既有能力，没有复制它们的业务逻辑：

- 任务半程：`services/tasks-candidate.js` 的 `createTasksDomain`（状态机、回执、同日回放、跨日重置）。
- 打卡半程：`services/checkins.js` 的 `createPersistentService`（地点有效性、同日去重、回执、历史）。
- 任务持久化：调用方注入 `stores/transactional-tasks.js` 的 `createTransactionalTasksStore`；T17 用该真实存储验证。

### 1.1 关联方式（与 JF02 一致）

新增复合动作 `tasks.checkin`，载荷恰好 `{ taskId, placeId }`；把**同一个 `requestId`** 转发给任务域与打卡服务：

1. 复合层在**请求映射事务**里按以下顺序处理：已有 `committed` 回执（或同日同 task+place 的等价关联）直接回放，不重读地点；否则**先在事务内读取地点并按打卡服务完全相同的规则预校验**（`classification(place, now)` 属于 `verified|expiring`，且 `place.openState` 属于 `OPEN|LIMITED`）。预校验不通过返回 `NOT_FOUND`（文案「地点不可打卡。」），事务不写任何行——包括不写 `pending` 意图。预校验通过后才写 `pending` 意图。
2. 调 `tasksDomain.handle({ action: 'tasks.transition', payload: { taskId, transition: 'complete' } })`。
3. 调 `checkins.complete({ requestId, payload: { placeId } }, binding)`。打卡服务会在自己的事务里重新读取地点；两次读取之间的窗口按 §1.2 的「中途失败」语义处理。
4. 两半都成功后提交关联记录（`committed`）；若提交时发现同日同一 task+place 已有 `committed` 关联（并发另一请求先提交），本次请求记为 `committed` 回执并回放已有结果，不写第二条关联行。

`tasks.transition` 与 `campus.checkin` 的载荷、返回结构完全未改；新事实只落在 `task_checkin_links`。

### 1.2 幂等与失败边界

- 同一 `requestId` + 同一载荷：返回首次结果，`replayed=true`、`created=false`，零写入。
- 同一 `requestId` + 不同 `taskId`/`placeId`：`CONFLICT`，零写入。
- 不同 `requestId` 命中同日同 task+place 的等价去重：返回已有结果（`replayed=true`、`created=false`），并为该 `requestId` 写一条 `committed` 回执；之后同一 `requestId` 重放或 `tasks.checkinStatus` 查询都得到 `committed`，同一 `requestId` 换载荷仍 `CONFLICT`，且不新增关联行。
- 并发同 `requestId`：数据层只写 1 条关联；先提交者的响应 `created=true`，后到者由关联行已存在判定为 `created=false`、`replayed=true`，不重复写任务行、到访或关联。
- 写前地点预校验失败（地点不存在、关闭、过期、未核验等）：`NOT_FOUND`，**零写入**——无任务行、无到访、无 `task_checkin_links` 行，连 `pending` 意图也不写，`tasks.checkinStatus` 返回 `absent`。这是本轮修复的用户复现用例（T21）。
- 任务半程被拒绝（`CONFLICT`/`INVALID_INPUT`）：复合失败，**不执行打卡**，不写关联；此前已写的 `pending` 意图保留，`linkStatus` 为 `pending`（T08）。
- 打卡半程失败（预校验后地点失效、事务错误等）：复合**必须返回失败** `CONFLICT`，文案「任务已完成，打卡尚未确认，请用原请求标识重试。」；任务可能已完成，到访未写，关联保持 `pending`（T22）。复合**绝不**把这种状态返回成成功。
- 用原 `requestId` 重试：任务半程按既有回执回放、不重复完成；打卡补写（或回放已有的打卡回执）；关联从 `pending` 转 `committed`。重复点击同一 ID 不产生第二条到访或第二条关联（T22）。
- 关联提交本身失败（存储错误）：复合返回该失败，不伪装成功；`pending` 意图保留，`linkStatus` 为 `pending`。同 `requestId` 重试时任务与打卡按各自回执回放、关联补提交，仍不重复到访/关联（T25）。
- 两半返回结构不完整：`INVALID_RESPONSE`，不提交关联。

### 1.3 持久化与重开

关联记录按 `sha256(ownerId)` 存为单文档，字段为 `{ layout, owner, ownerId, links[], requests[], revision }`；`links` 只存 `committed` 关联（计入容量，进入历史），`requests` 是请求映射（`pending` 意图 + 等价去重的 `committed` 回执）。`ownerId` 与文档 `_id` 一起用于注销清理的按 owner 分页（`domains/cleanup.js`）。服务对象本身不保存任何业务状态，重新构造服务、重新进入页面后仍从同一数据库读取。

容量与回收口径：

- `links` 上限为 `capacity`（候选默认 500，且被 `Math.min(capacity, MAX_LINKS)` 钳制，避免写出 `normalizeState` 会判无效的超限文档）。
- `pending` 意图**不计入** 500 容量，单独有 50 条配额；配额满时拒绝新请求（`CONFLICT`，消息与“关联已满”不同），不静默截断。
- 超过 `PENDING_TTL_MS`（24 小时）的 `pending` 行在之后的下一次写入时回收，回收后不再计入配额；同一 `requestId` 的自身重试不会被当作过期行清掉。
- `committed` 关联与等价回执无 TTL，与任务/打卡既有回执同口径；它们随请求累计，是已知的文档增长点，接线评审需确认是否需要单独保留期。

### 1.4 账号停用

停用校验的准确位置：

- 关联文档的读写（`prepare` / `commit` / `find` / `history`）在**同一个事务**内先要求 `resolveActive(tx, owner)`，停用账号返回 `ACCOUNT_DISABLED`，不写任何数据；打卡服务 `checkins.complete` 也是同一事务内校验。
- 转发给任务域的入口（`transition` / `taskHistory`）在 write path 前有一次独立的 `assertActive` 校验（单独事务），真正写入在随后的任务域事务里；`services/tasks-candidate.js` 全文没有自己的 active 门（生产装配的 `stores/transactional-tasks.js` 会在其事务内再校验 active）。
- `router.js:72-74` 在动作分发前另有一道账号状态门，把上面的窗口压小。它和上述校验**不是同一事务**；接线评审需确认是否需要更强门（例如把 active 校验并入任务写入事务或引入跨集合事务）。

`UNAUTHENTICATED` 同理。复合写路径在**写 pending 意图之前**就经过关联存储的同一事务 `resolveActive` 校验，因此停用账号的 `tasks.checkin` 在任务转换与打卡之前即返回 `ACCOUNT_DISABLED`，零写入（T23）。

若停用发生在任务半程已提交之后（两次读取之间的窗口），打卡服务在自己的事务里返回 `ACCOUNT_DISABLED`；复合按该码失败，任务可能已完成、关联保持 `pending`，且不做自动恢复写入。只有人工恢复身份后，才能按 §1.2 用原 `requestId` 重试补全。

停用后的恢复边界：停用账号不做自动复活，也不做恢复写入。`cleanupDisabled(owner)`（要求 `resolveDisabled`）只回收本人关联并保留修订墓碑；正式清理执行器（`domains/cleanup.js` / `production/cleanup.js`）按 `ownerId` 删除关联文档。账号恢复只能人工处理，服务不会因为重试、重新登录或清理而自动恢复已停用的身份，也不会把已回收的关联写回。

## 2. 对外接口面（QC01 / QH03）

`createTaskCheckinService(options)` 接收 `database`、`tasksDomain`、`checkins`、`findPlace`、`resolveIdentity`、`resolveActive`、`resolveDisabled`、可选 `publicSuggestions`、`now`、`capacity`。其中 **`findPlace(tx, placeId)` 是 `tasks.checkin` 写路径的必注入依赖**（与 `services/checkins.js` 同形）：未注入时该动作在读写任何数据前以 `NOT_IMPLEMENTED` 失败关闭（fail-closed），其余转发/查询动作仍可装配（T24）。构造函数其余参数不变。

返回：

| 方法                                    | 参数                                                                 | 返回                                        | 用途                                            |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| `handle(request, binding)`              | `{ action, requestId?, payload? }`、可信 binding                     | 随 `action` 而定（见下）                    | 按 `request.action` 分派，推荐页面/路由统一调用 |
| `completeWithCheckin(request, binding)` | `{ requestId, payload: { taskId, placeId } }`                        | 复合结果                                    | 直接调用复合完成                                |
| `transition(request, binding)`          | `{ requestId, payload: { taskId, transition, replacementTaskId? } }` | `{ taskId, date, state, replayed }`         | 转发 `tasks.transition`（旧协议不变）           |
| `taskHistory(request, binding)`         | `{ payload: { from, to, cursor?, limit? } }`                         | `{ entries, nextCursor }`                   | 转发 `tasks.history`（旧协议不变）              |
| `checkin(request, binding)`             | `{ requestId, payload: { placeId } }`                                | `{ visit, duplicated }`                     | 转发 `campus.checkin`（旧协议不变）             |
| `checkinHistory(request, binding)`      | `{ payload: { page?, pageSize? } }`                                  | `{ items, page, pageSize, total, hasMore }` | 转发 `campus.checkinHistory`                    |
| `linkHistory(request, binding)`         | `{ payload: { page?, pageSize? } }`                                  | `{ items, page, pageSize, total, hasMore }` | 关联历史分页                                    |
| `linkStatus(request, binding)`          | `{ payload: { requestId } }`                                         | `{ requestId, status, result? }`            | 按 `requestId` 查关联状态（未知结果恢复）       |
| `cleanupDisabled(owner)`                | `ownerId: string`                                                    | `{ removed, sharedRetained: true }`         | 服务端停用清理接缝，禁止暴露给页面              |

`handle` 支持的动作：

- 复合（候选，未注册）：`tasks.checkin`、`tasks.checkinHistory`、`tasks.checkinStatus`
- 转发（已注册）：`tasks.transition`、`tasks.history`、`campus.checkin`、`campus.checkinHistory`
- 可选公开（需注入 `publicSuggestions`）：`tasks.suggestions`、`tasks.quickChoice`；未注入返回 `NOT_IMPLEMENTED`
- 其它动作：`NOT_IMPLEMENTED`

`binding` 是**服务端可信凭据**（会话/身份绑定），不是客户端载荷；`handle` 不使用客户端自带 `actor`。

### 2.1 候选装配示例（不在 `index.js` 中）

```js
const { createPersistentService } = require('../services/checkins');
const { createTasksDomain } = require('../services/tasks-candidate');
const { createTransactionalTasksStore } = require('../stores/transactional-tasks');
const { createTaskCheckinService } = require('../services/task-checkins');

const service = createTaskCheckinService({
  database, // CloudBase 事务数据库
  tasksDomain: createTasksDomain({
    store: createTransactionalTasksStore({ db: database, sourceRevisionsEnabled: true }),
    clock: () => new Date(),
  }),
  checkins: createPersistentService({
    database,
    resolveIdentity,
    resolveActive,
    resolveDisabled,
    findPlace,
    now: Date.now,
  }),
  findPlace,
  resolveIdentity,
  resolveActive,
  resolveDisabled,
});
```

以上装配仅说明依赖形状；本仓库的 `index.js`、`production/backend.js` 与 `ACTIONS` 注册表均未改动。

### 2.2 QC01（任务页面）调用

```js
// 建议、选择、完成、跳过、替换仍走既有 action，服务原样转发
await service.handle(
  {
    action: 'tasks.transition',
    requestId: 'req_task_checkin_0001',
    payload: { taskId: 'tpl_walk_10min', transition: 'complete' },
  },
  binding,
);

// 任务与地点手动打卡一起完成（候选动作）
const linked = await service.handle(
  {
    action: 'tasks.checkin',
    requestId: 'req_task_checkin_0002',
    payload: { taskId: 'tpl_walk_10min', placeId: 'fzu_library_quiet' },
  },
  binding,
);

// 未知结果恢复：原 requestId + 原载荷重试，或先查状态
const status = await service.handle(
  { action: 'tasks.checkinStatus', payload: { requestId: 'req_task_checkin_0002' } },
  binding,
);

// 任务历史与关联历史
await service.handle(
  { action: 'tasks.history', payload: { from: '2026-11-01', to: '2026-11-07', limit: 20 } },
  binding,
);
await service.handle(
  { action: 'tasks.checkinHistory', payload: { page: 1, pageSize: 10 } },
  binding,
);
```

`tasks.history` 保持服务端形状 `{ entries, nextCursor }`；页面若需要 `items` 映射，沿用现有 `tasks-adapters.js` 的客户端映射，不在本服务内改写。

### 2.3 QH03（打卡页面）调用

```js
// 直接地点打卡沿用既有协议：载荷只有 placeId，返回 { visit, duplicated }
const visit = await service.handle(
  {
    action: 'campus.checkin',
    requestId: 'req_campus_0001',
    payload: { placeId: 'fzu_library_quiet' },
  },
  binding,
);

// 本人打卡历史：{ items, page, pageSize, total, hasMore }
const history = await service.handle(
  { action: 'campus.checkinHistory', payload: { page: 1, pageSize: 10 } },
  binding,
);
```

## 3. 返回结构

复合完成（`tasks.checkin`）：

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

状态查询（`tasks.checkinStatus`）：

```json
{
  "requestId": "req_task_checkin_0002",
  "status": "committed",
  "result": { "...": "同上，replayed=true、created=false" }
}
```

`status` 取 `absent` / `pending` / `committed`；`pending` 不等于成功。

关联历史条目：

```json
{
  "requestId": "req_task_checkin_0002",
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

## 4. 错误码

| 错误码             | 触发条件                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`  | 无可信身份                                                                                                                              |
| `ACCOUNT_DISABLED` | 账号停用（写前拒绝，零部分写入）                                                                                                        |
| `INVALID_INPUT`    | 载荷多键/缺键、`requestId` 不合法、分页越界、任务模板不可用                                                                             |
| `CONFLICT`         | 同 `requestId` 换载荷、任务终态冲突、关联容量已满、pending 配额已满、存储不一致，以及**预校验后打卡半程失败**（任务已完成、打卡未确认） |
| `NOT_FOUND`        | **写前地点预校验失败**：地点不存在或当日不可打卡；此时零写入、无 pending 意图                                                           |
| `INVALID_RESPONSE` | 任务域/打卡服务返回结构不完整                                                                                                           |
| `FORBIDDEN`        | `cleanupDisabled` 时账号未停用，或关联归属不匹配                                                                                        |
| `NOT_IMPLEMENTED`  | 动作未装配（含未注入的公开建议），或 `tasks.checkin` 未注入 `findPlace`                                                                 |

## 5. 合成验证证据

命令与结果（本地、合成替身）：

```text
node --test tests/week4-task-checkins.test.js
ℹ tests 25
ℹ pass 25
ℹ fail 0
```

| 用例 | 覆盖点                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01  | 正向关联完成；任务行、到访、关联各 1 条；本人隔离                                                                                                                            |
| T02  | 同日同 task+place 去重：返回回放，零新增；等价请求记为 committed 回执                                                                                                        |
| T03  | 跨日新增任务行、到访与关联；历史按时间倒序                                                                                                                                   |
| T04  | 同 `requestId` 回放同一结果，无新写入                                                                                                                                        |
| T05  | 同 `requestId` 换 task/place → `CONFLICT`，原结果不变                                                                                                                        |
| T06  | 停用账号：复合、状态、关联历史、任务历史、转换、打卡、打卡历史全拒绝；被拒转换不写任务行                                                                                     |
| T07  | 地点不可打卡 → **写前预校验**失败，无任务行/到访/关联，`linkStatus=absent`；修复后原 `requestId` 首次执行成功                                                                |
| T08  | 任务终态冲突 → 不写打卡、不写关联，`pending` 意图保留                                                                                                                        |
| T09  | 关联历史分页：3 条、每页 2、`hasMore` 正确                                                                                                                                   |
| T10  | 重新构造服务后仍可读取已提交关联与打卡历史                                                                                                                                   |
| T11  | 载荷白名单、分页边界、未登录、未装配动作的错误码                                                                                                                             |
| T12  | 旧动作载荷与返回形状不变；`tasks.transition` 拒绝 `placeId`；公开建议可选                                                                                                    |
| T13  | 停用清理：`removed` 1→0，墓碑保留，未停用 `FORBIDDEN`                                                                                                                        |
| T14  | 容量上限拒绝新关联，不静默截断                                                                                                                                               |
| T15  | 中途失败后跨零点补全：任务 1 行、到访 1 条（次日）、关联 1 条且 `linkedDate=null`                                                                                            |
| T16  | 同日时钟推进后同 `requestId` 仍回放原结果                                                                                                                                    |
| T17  | 正常成功路径三对齐：`task_history` 1 行 completed、`campus_checkin_states` 1 条到访、`task_checkin_links` 1 条 committed + 回执                                              |
| T18  | 预校验失败不产生 pending、不占 committed 容量；等价回执也不占容量                                                                                                            |
| T19  | 中途失败产生 pending；配额满时以不同消息失败；超过 24 小时在下次写入时回收                                                                                                   |
| T20  | 并发同 `requestId` 只建 1 条关联，后到响应为 `created=false`/`replayed=true`                                                                                                 |
| T21  | **用户复现用例**：有效任务 + 不存在地点 → `NOT_FOUND`，任务行/到访/关联/`request_receipts` 均为 0 写入，`linkStatus=absent`                                                  |
| T22  | 预校验后地点失效 → `CONFLICT`「任务已完成，打卡尚未确认…」、任务 1 行 completed、到访 0、关联 pending；同 id 重试补全后任务仍 1 行、到访 1、关联 committed；重复点击不再新增 |
| T23  | 停用账号 → `ACCOUNT_DISABLED`，无任务行/到访/关联；重新启用后无自动恢复写入                                                                                                  |
| T24  | 未注入 `findPlace` 时 `tasks.checkin` → `NOT_IMPLEMENTED`，零写入                                                                                                            |
| T25  | 关联提交失败：两半已写、关联 pending；同 id 重试只补关联，任务/到访不重复                                                                                                    |

完整测试：`npm test` 共 **1459** 项，**1459** 通过，**0 fail**（含本文件 25 项；运行快照，同工作树另有其他成员并行改动）。

测试替身说明：`tests/week4-task-checkins.test.js` 用一个串行化、写时复制的文档数据库替身承载打卡服务与关联记录；任务半程默认用仓库既有内存任务存储，T17 另用 `tests/helpers/w2-database.js` 启动真实事务任务存储。两者都是合成环境，不代表 CloudBase 行为。

## 6. 未测项与限制

| 项目                                   | 状态   | 所需输入 / 提供人                                                                                                                                      |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 真实 CloudBase 事务、索引与并发冲突    | 未测   | 云环境与数据库权限；Xiang Hong / Xiang Yu                                                                                                              |
| 真实设备页面（任务页、打卡页）         | 未测   | 候选包与设备；Qizhen Chen / Qinghan Zhang                                                                                                              |
| 真实第二位用户与跨账号隔离             | 未测   | 第二个真实账号；Qizhen Cai                                                                                                                             |
| 正式地点目录、有效期与开放状态         | 未测   | 正式地点清单；Junhan Huang / Qinghan Zhang                                                                                                             |
| 任务模板真实数据                       | 未测   | 正式模板；Xiang Hong                                                                                                                                   |
| 导出、注销清理完整接入                 | 部分   | `task_checkin_links` 已进导出 `taskCheckins`、候选与正式清理清单、`collections.json` 与生产数据库白名单；真实执行器与真实云未跑；Xiang Yu / Xiang Hong |
| `ACTIONS` 注册、路由与部署入口         | 未接线 | 接口评审；Qizhen Chen / Xiang Hong                                                                                                                     |
| 新集合 `task_checkin_links` 的部署声明 | 未执行 | 集合/权限/容量计划；Xiang Hong                                                                                                                         |

补充限制：

- 复合不是跨集合单事务：一条首次成功的复合请求实际是**四条独立事务**（请求映射含地点预校验 / 任务半程 / 打卡半程 / 关联提交），任一半成功、另一半失败时存在部分状态，靠原 `requestId` 重试补全；这是当前设计，不是"已原子化"。
- 写前地点预校验与打卡服务读取地点之间仍有 TOCTOU 窗口：地点在两次读取之间被关闭时，任务半程可能已经完成。此时复合按 §1.2 返回 `CONFLICT`（不是成功），关联保持 `pending`，同 `requestId` 重试补全；若打卡服务仍未通过，重试继续失败，不会退化成"任务完成但接口成功"。
- 关联记录每账号候选上限 500 条（`links`），超限 `CONFLICT` 且不截断；该上限已被钳制在存储格式允许的 `MAX_LINKS` 内。
- `pending` 意图**不计入** 500 容量，单独有 50 条配额；超过 24 小时的 `pending` 在下次写入时回收。配额满时新请求以 `CONFLICT`（消息与“关联已满”区分）失败，因此**极端情况下仍可能因 pending 配额满而失败**；客户端不要用新 `requestId` 反复重试已明确失败的请求。
- 等价去重的 `committed` 回执与既有回执一样无 TTL，随请求累计；这是单文档的增长点，接线前需与存储负责人确认保留期或拆表方案。
- `linkedDate=null` 只会在跨零点补全时出现；当前返回两个日期，不合并。
- 普通任务持久化 ≠ 地点打卡已实现：T17 只证明"任务行 + 回执 + 关联"能在事务存储中一起写入；地点打卡的真实云写入、地点目录与真实设备仍未验证。
- 本文件不写未执行的验收结论；上述项目均未执行。

## 7. 与 JF02 的关系

本文的实现口径对应 [JF02 共同规则提案](jf02-task-checkin-contract.md)：

- 状态表、同日重复、跨日与未知结果恢复以 JF02 §3—§6 为准；
- 动作名、是否注册、同日多地点、跨零点展示等仍列在 JF02 §7 待确认；
- JF02 未定稿前，本服务只作为候选联调面，不代表前端或地点服务已确认该契约。

## 8. 相关文件

- [JF02 共同规则提案](jf02-task-checkin-contract.md)
- 服务：[task-checkins.js](../../../cloudfunctions/moodsky/services/task-checkins.js)
- 存储：[task-checkin-links.js](../../../cloudfunctions/moodsky/stores/task-checkin-links.js)
- 测试：[week4-task-checkins.test.js](../../../tests/week4-task-checkins.test.js)
- 既有任务域：[tasks-candidate.js](../../../cloudfunctions/moodsky/services/tasks-candidate.js)
- 既有事务存储：[transactional-tasks.js](../../../cloudfunctions/moodsky/stores/transactional-tasks.js)
- 既有打卡服务：[checkins.js](../../../cloudfunctions/moodsky/services/checkins.js)
