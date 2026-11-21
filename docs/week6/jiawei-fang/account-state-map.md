# W6-JF 账号状态图、停用与清理边界

对应 W6-JF 第 3 项。机器结果在 [account-boundaries.json](account-boundaries.json)，由 `tools/week6-jf/collect-samples.cjs` 使用本地合成夹具实际执行。**不是目标云、真实账号或真机结果。**

## 1. 本人偏好

| 步骤       | 请求                                      | 实际结果                                                         | 说明                                    |
| ---------- | ----------------------------------------- | ---------------------------------------------------------------- | --------------------------------------- |
| A 首次读取 | `account.preferences {operation:'get'}`   | `cardTextPreview:false, decorationsEnabled:true, updatedAt:null` | 默认值来自共享常量，不读客户端副本      |
| A 只改一项 | `{operation:'set', cardTextPreview:true}` | `cardTextPreview:true, decorationsEnabled:true`                  | 只写提交字段，另一个字段不被读改写覆盖  |
| A 再读     | `get`                                     | 与写入回执一致；`updatedAt` 为字符串                             | 以数据库实际落盘值回显                  |
| B 读取     | `get`                                     | 仍为默认值                                                       | 偏好行按 `ownerId` 隔离；A 的写入不落 B |

实现：`services/account-candidate.js` 的 `handlePreferences`，`production/accounts.js` 的 `updatePreferences`；白名单只允许两项布尔字段。

## 2. 停用后的私人访问

A 执行 `account.close {confirm:'CLOSE'}` 的实际回执：

```json
{
  "accountStatus": "disabled",
  "sessionRevoked": false,
  "sessionRevocation": "not_implemented",
  "privateActionsDenied": true,
  "cleanup": { "jobId": "<jobId>", "state": "pending" },
  "receipt": "<receipt>"
}
```

`sessionRevoked:false` 是如实上报：当前没有 token/session 表，无法撤销一个令牌；能保证的是路由拒绝所有私人动作。停用后逐项实测：

| 动作                                      | 结果                             |
| ----------------------------------------- | -------------------------------- |
| `account.session`                         | `ACCOUNT_DISABLED`               |
| `account.preferences {get}`               | `ACCOUNT_DISABLED`，不回退默认值 |
| `journal.get`                             | `ACCOUNT_DISABLED`               |
| `tasks.mine`                              | `ACCOUNT_DISABLED`               |
| `tasks.history`                           | `ACCOUNT_DISABLED`               |
| `account.requestExport`                   | `ACCOUNT_DISABLED`               |
| `account.exportStatus` / `downloadExport` | `ACCOUNT_DISABLED`               |
| `tasks.transition`                        | `ACCOUNT_DISABLED`               |
| `tasks.suggestions`（公开）               | 仍成功；不包含私人状态           |

路由在 `resolveAccount` 得到 `disabled` 后统一返回 `ACCOUNT_DISABLED`，不会进入各域存储。公开建议不解析账号，因此停用后仍可浏览。

## 3. 注销入队与清理

一次 close 在同一事务内完成：

1. 计算确定性 `cleanupJobId(ownerId)`，不存在则写 `cleanup_jobs`：`ownerId`、`state:'pending'`、`exportAccessRevoked:true`、`progress:{}`。
2. 将 `accounts` 行改为 `disabled`；同时推进账号围栏/导出世代，使停用前准备的导出失效。
3. 任一步失败则整体回滚：账号保持 `active`，不留孤儿任务；可原样重试。

实测：

- 首次 close：1 个 `pending` 任务，`exportAccessRevoked=true`。
- 重复 close：同一 `jobId`、同状态，不建第二个任务；完成后再 close 仍返回同一任务的 `completed` 状态。
- 清理任务数始终 1。

清理按 `production/cleanup.js` 的 `COLLECTIONS` 逐集合、每页最多 10 行推进；`account.cleanupStatus` 的 receipt 路径执行一步并返回：

| 字段       | 实测                                                       |
| ---------- | ---------------------------------------------------------- |
| `state`    | `pending → processing → completed`                         |
| `progress` | 每集合删除计数，单调递增                                   |
| 完成条件   | 所有集合无本账号行后写 `completed`，保留账号墓碑与任务台账 |

本次合成种子每集合 1 行 A、1 行 B；加上真实偏好、任务选择和注销回执后，完成计数为 `journals:1, favorites:1, place_checkins:1, campus_checkin_states:1, task_history:2, preferences:2, month_decorations:1, request_receipts:2, export_jobs:1, deletion_markers:1, place_corrections:1`。完成后 A 在 11 个集合的残留均为 0；B 每集合仍 1 行；公共 `task_templates` 保留；A 账号行 `disabled`、B 账号行 `active`。

## 4. 进度回执边界

| 用法                           | 结果                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| 正确 `jobId` + 本任务 receipt  | `ok=true`，只返回该任务的 `state/progress/createdAt/updatedAt` |
| 换一个 `jobId` + 原 receipt    | `FORBIDDEN`；receipt 只读它绑定的任务                          |
| 伪造/篡改 receipt              | `FORBIDDEN`                                                    |
| B 不持 receipt 查询 A 的 jobId | `FORBIDDEN`                                                    |

注意：receipt 是 **bearer 能力**，签名绑定 `jobId` 和有效期，不按账号二次绑定；这是为了让已停用、无法登录的账号仍能查自己的清理进度。它只返回计数与状态，不含正文、身份或导出内容。不要把它写进日志、截图或工单。

## 5. 与 Xiang Yu 的边界对齐

| 边界     | 本实现                                                 | 与 W6-XY 的关系                                    |
| -------- | ------------------------------------------------------ | -------------------------------------------------- |
| 入队     | close 事务内写 `cleanup_jobs`，字段满足清理 guard      | XY 的清理执行器只消费该行；不另建队列              |
| 导出撤销 | close 同时置 `exportAccessRevoked` 并推进导出世代      | 停用后旧导出不可领；XY 的到期/领取拒绝沿用同一围栏 |
| 执行     | worker `tick` 或 receipt `cleanupStatus` 调同一 `step` | 两条入口共用 guard、分页和计数                     |
| 残留     | 账号墓碑 + 清理台账；业务行清零                        | 与 XY「清理前后对照」一致；不代表云端备份/日志已清 |
| 未验     | 真实触发器、自然到期、多实例并发                       | 保留在 XY 的 M1—M9 补验单，不由本页替代            |

## 6. 与 Linghan 的客户端状态对齐

服务端返回 `ACCOUNT_DISABLED` 后，现有客户端按以下路径收敛：

- `services/api.js`：对私人动作命中 `UNAUTHENTICATED/ACCOUNT_DISABLED/FORBIDDEN` 时清本地会话，页面下一次请求需重新登录。
- `modules/journal/controller.js`：显示「账号已停用，已清空本页内容。」并清私人内容。
- `modules/tasks/cloud.js`：`privateUnavailable(true)` 清建议/历史/待处理，提示登录状态已变化。
- `modules/review/reader.js` 与 `pages/me`、`pages/login`：显示账号已停用，不展示私人记录。
- 导出预览与迟到响应：由 Linghan 的 `W6-L` 会话/退出回归覆盖（本轮复跑 28 项客户端相关用例通过）。

未对齐/未测：

- `sessionRevoked:false` 意味着服务端没有主动作废客户端缓存；客户端要等下一次私人请求被拒才知道停用。真实微信账号停用后的首屏行为需真机补验。
- 真实 A/B 切号、真实停用后的登录页和导出预览需在目标环境复测，本轮只证明源码路径。

## 7. 结论

本地合成层：偏好按账号隔离；停用后私人读写全部拒绝；close 的停用、入队、导出撤销同事务；清理只删本账号、B 与公共数据完整；进度回执可查且只绑定自己的任务。未测项保持未测。
