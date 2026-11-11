# W5 JF 普通任务契约与验证（Jiawei Fang）

第五周任务卡 W5-JF，对应 `W5-R03、R05、R13`。**本文件只描述合成证据**：目标云、真实微信账号与真机均未执行，见 §5。

## 1. 模板与状态表

模板来源是 `task_templates` 集合，只读取 `enabled: true` 的行，按 `_id` 升序，单次最多 50 条（超过即 `CONFLICT`，不截断）。模板字段：`_id`、`title`、`steps`、`durationMin`、`tags`、`enabled`、`createdAt`。

可用状态（`shared/constants.js` 的 `TASK_STATUS`）：

| 状态        | 含义   | 来源动作              |
| ----------- | ------ | --------------------- |
| `selected`  | 已选择 | `select`              |
| `completed` | 已完成 | `complete`            |
| `skipped`   | 已跳过 | `skip`                |
| `replaced`  | 已替换 | `replace`（被替换方） |

合法迁移（按服务端业务日，北京时间）：

| 当前记录                                 | `select` | `complete`               | `skip` | `replace`                    |
| ---------------------------------------- | -------- | ------------------------ | ------ | ---------------------------- |
| 无记录                                   | 允许     | 允许                     | 允许   | 允许（可自动挑一个未用模板） |
| `selected`                               | 重放     | 允许                     | 允许   | 允许                         |
| 终态（`completed`/`skipped`/`replaced`） | 拒绝     | 同目标重放，其它目标拒绝 | 同左   | 同左                         |

- 同日同任务只有一行 `task_history`；"同目标终态 + 新 `requestId`"是安全重放，不再写第二行。
- `replacementTaskId` 只能出现在 `replace`，不能等于原任务；未指定时按当日未使用模板自动挑，挑不到即 `CONFLICT`。

## 2. 请求与回执

`tasks.transition` 的 payload 允许键**恰好**是 `taskId`、`transition`、`replacementTaskId`、`expectedDate`；其它键在路由层即以 `INVALID_REQUEST`/`INVALID_INPUT` 拒绝。

回执以 `(ownerId, action='tasks.transition', requestId)` 为键，摘要绑定 `taskId / transition / replacementTaskId / expectedDate`：

- 同一 `requestId` + 同一摘要 → 回放首次结果并带 `replayed: true`；
- 同一 `requestId` + 不同摘要 → `CONFLICT`，不写任何行；
- 回执跨午夜仍然有效，回放返回首次的业务日 `date`。

## 3. `expectedDate` 规则

- 格式必须是真实业务日 `YYYY-MM-DD`，否则 `INVALID_INPUT`。
- 首次送达时，`expectedDate` 必须等于服务端当日业务日；不等即 `CONFLICT`，**不写历史、不写回执**，并提示重新读取当日状态。
- 已提交的回执不受跨日影响：次日重放同一 `requestId` 仍成功，且返回首次日期。
- 未带 `expectedDate` 的请求按服务端当日执行，用于旧客户端兼容。

## 4. 重开与切号

- 重开：新进程用同一持久层重建服务后，`tasks.mine`/`tasks.history` 能读到已提交状态，原 `requestId` 仍可回放。
- 切号：回执键含 `ownerId`，A 的 `requestId` 在 B 下不命中，B 按自己的新操作执行；A 的历史对 B 不可见。

## 5. 验证矩阵（合成）

新增 `tests/week5-jf-task-contract.test.js`（离线原生 SDK 替身，无云无网络）：

| 要求                               | 用例           | 结果                                                      |
| ---------------------------------- | -------------- | --------------------------------------------------------- |
| 原请求已完成但丢响应，按原回执恢复 | `W5-JF-R13-01` | 通过：`replayed: true`，历史 1 行、回执 1 条              |
| 重开后仍可读且可回放               | `W5-JF-R13-02` | 通过：重建后读到 `completed`，重放不新增行                |
| 跨日首次送达的旧请求被拒绝         | `W5-JF-R13-03` | 通过：`CONFLICT`，历史 0 行、回执 0 条，随后可读当日状态  |
| 已提交的带日期回执跨午夜重放       | `W5-JF-R13-04` | 通过：返回首次日期；同 id 换日期 `CONFLICT`               |
| 切号后不重放                       | `W5-JF-R13-05` | 通过：B 用 A 的 `requestId` 是新操作，双方各 1 行互不可见 |

复用既有证据（不重复造）：

| 范围                             | 现有用例                                                            |
| -------------------------------- | ------------------------------------------------------------------- |
| 状态机与非法迁移                 | `tests/week2-tasks-transition.test.js` T01—T10                      |
| 回执回放与终止态重放             | 同上 T08、T11                                                       |
| 带日期请求的非法/过去/未来拒绝   | 同上 `dated transition ...`                                         |
| 偏好写入白名单与回执核对         | `tests/week4-jf04-preferences-me.test.js` JF04-W4-01、02、06        |
| 偏好失败保留选择、不谎报云端成功 | 同上 JF04-W4-03、07                                                 |
| 账号停用边界                     | `tests/week4-jf01-production-account-boundaries.test.js` JF01-W4-04 |

**变异验证**：临时移除 `tasks-candidate.js` 的 `expectedDate` 跨日拒绝后，`W5-JF-R13-03` 立即失败；还原后通过。说明该断言不是空转。

## 6. 未测与收敛方案

未执行：目标云真实 `tasks.transition` 调用与权限、真实微信登录、真机、正式模板数据、真实服务器时钟跨时区。

按计划「无法形成正式规则或目标云证据时交只读/关闭方案」，**已落地为默认收敛**：

- 生产装配 `createProductionEntry` / `createProductionBackend` 新增 `tasksWritesEnabled`，**默认 `false`**；未显式开启时 `tasks.transition` 在进入任何存储前即返回 `FORBIDDEN`「任务操作暂未开放，请先浏览建议。」，不写历史、不写回执。
- 读能力保持：`tasks.suggestions`、`tasks.mine`、`tasks.history` 正常；客户端 `modules/tasks/cloud.js` 已按服务端 `readOnly` 置灰写入口并提示，不会出现假完成态。
- 开放写入的唯一方式：装配处显式传 `tasksWritesEnabled: true`（一行为改动，便于评审与回退）。取得目标云与真实账号证据前不得开启。
- 回归：`tests/week5-jf-tasks-readonly.test.js` 的 `W5-JF-RO-01`—`RO-04`（默认只读、读写共存、显式开启后可写、域层默认不变）。
- 只读态下写请求在认证与键校验之前即统一返回 `FORBIDDEN`，属 fail-closed：不区分未登录、参数错误与能力关闭，避免通过错误差异探测入口状态。
