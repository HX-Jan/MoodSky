# W2 JF04 注销停用、清理任务门禁与受限回执

| 项目     | 内容                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 任务编号 | W2 JF04                                                                                                                                   |
| 承接 W1  | W1 JF03《偏好、停用与受限进度回执》的 close/回执部分 + W1 JF04《任务与偏好数据能力清单》                                                  |
| 关联需求 | UW3-F23 账号停用、注销清理与受限进度回执                                                                                                  |
| 负责人   | Jiawei Fang（832401110），本周身份 w2-account                                                                                             |
| 协作人   | Xiang Yu（`cleanup_jobs` 与清理执行器）、Xiang Hong（回执字段与注册表）、Linghan Chen（处理中页显示依据）、Qizhen Cai（完整流程独立验收） |
| 复核人   | Xiang Hong（待复核）；独立检查：Qizhen Cai                                                                                                |
| 版本     | 0.2.3（rebase 后；交付过程起始于 0.2.0）                                                                                                  |
| 环境     | 本地 Node.js v24.15.0；内存 store + 注入 clock + 本地测试密钥；**真实云 / 真实签名密钥 / 清理执行器未执行**                               |
| 成果路径 | 见 §2                                                                                                                                     |
| 验收状态 | **待复核**；完整注销（清理完成）**阻塞**：清理执行器未接通                                                                                |
| 实际耗时 | 待本人确认（不代填）                                                                                                                      |
| 阻塞     | 清理执行器（Xiang Yu）；回执签名密钥未配置；真实云写入未授权                                                                              |

## 1. 结论先行

- `account.close` 已实现：校验 `confirm = "CLOSE"` → 先按 `ownerId` 幂等创建 `cleanup_jobs(pending)` → 再置 `accounts.status = disabled`。停用失败时把任务标记 `failed` 并返回可重试错误（`CONFLICT`），账号保持 active，**不会出现“已停用但没有可恢复任务”**。
- 返回 `{ accountStatus, sessionRevoked, sessionRevocation, privateActionsDenied, cleanup: { jobId, state }, receipt }`；`state` 保持 `pending`，清理执行器未接通，**不把完整注销标为已完成**。
- `account.cleanupStatus` 走 router 的 `receipt` 分支：回执由服务端 HMAC 签发，只绑定本 `jobId` + `permission = cleanup_status` + 过期时间；无回执、权限不符、篡改、过期、jobId 不匹配一律 `FORBIDDEN`，且不查账号、不泄露其他任务。
- 密钥缺失时 `close` 返回 `receipt: null`，`cleanupStatus` 一律 `FORBIDDEN`（fail closed）。
- 新增 16 项测试，本地全过（`node --test tests/week2-account-close.test.js` → 16 pass）。真实云、真实密钥、清理执行均**未执行**，本条标**待复核**，完整注销标**阻塞**。

## 2. 成果路径（本条改动的文件）

| 文件                                                   | 变更 | 说明                                                     |
| ------------------------------------------------------ | ---- | -------------------------------------------------------- |
| `cloudfunctions/moodsky/domains/account.js`            | 修改 | close / cleanupStatus 处理器、载荷校验、可重试失败语义   |
| `cloudfunctions/moodsky/identity.js`                   | 新增 | HMAC 回执签发与校验（`createCleanupReceiptSigner`）      |
| `cloudfunctions/moodsky/stores/account-store.js`       | 新增 | `cleanup_jobs` / `request_receipts` 内存与云 DB 两套实现 |
| `cloudfunctions/moodsky/index.js`                      | 修改 | 注入 `resolveCleanupReceipt` 与 `issueCleanupReceipt`    |
| `tests/week2-account-close.test.js`                    | 新增 | C01—C15                                                  |
| `docs/week2/Jiawei_Fang/w2-jf04-close-cleanup-gate.md` | 新增 | 本文档                                                   |

## 3. `account.close`

### 3.1 载荷与顺序

- payload 只允许 `confirm`，值必须严格等于 `CLOSE`；缺失、大小写不符、带其他字段 → `INVALID_INPUT`。
- 顺序固定为：**先清理任务，后停用账号**；任务 `ownerId` 来自 `actor.accountId`，不取 payload。
- 幂等创建：先查该 owner 的 open job（`pending` / `processing`），存在即复用；不存在才插入 `pending`。
- 重试：新建一个 `pending` job（失败行保留为证据），停用成功后账号 disabled 且恰好有 1 个 open job。**不变量**：不存在 disabled 账号而没有 recoverable job 的状态。

失败矩阵（两条写入失败分支都是**可直接重试**的 `CONFLICT`，文案同为「注销暂未完成，请重试。」，且都不留下"已停用但没有任务"的状态）：

| 失败点           | 触发条件                       | 实际写入了什么                | 账号状态 | 返回            | 重试后                                      | 用例 |
| ---------------- | ------------------------------ | ----------------------------- | -------- | --------------- | ------------------------------------------- | ---- |
| 载荷不合法       | `confirm` 缺失/不符/带未知字段 | 无                            | active   | `INVALID_INPUT` | 修正载荷即可                                | C01  |
| 清理任务创建失败 | `insertCleanupJob` 抛错        | 无（无 job、无回执）          | active   | `CONFLICT`      | 新建 1 个 `pending` job                     | C16  |
| 停用失败         | `setAccountStatus` 抛错        | job 置 `failed`（保留为证据） | active   | `CONFLICT`      | 新建 1 个 `pending` job，open job 恰好 1 个 | C04  |

### 3.2 重复调用（真实行为，如实记录）

router 在进入域模块前就会用 `ACCOUNT_DISABLED` 拒绝第二次 `close`，因此客户端看到的是“账号已停用”，而不是 W1 提案里的“重复返回同一 jobId”。测试 C03 断言重复调用**不产生第二个 job**。这是与 W1 提案的**偏差**，列为待 Xiang Hong 复核项（§8 第 1 条）。

域模块仍保留按 `requestId` 回放的实现（`request_receipts`），供“停用成功但响应丢失”的恢复路径使用；该分支只能在域级测试中验证（C15）。

### 3.3 返回形状

```json
{
  "accountStatus": "disabled",
  "sessionRevoked": false,
  "sessionRevocation": "not_implemented",
  "privateActionsDenied": true,
  "cleanup": { "jobId": "cleanup_1", "state": "pending" },
  "receipt": "v1.<base64url-claims>.<base64url-hmac>"
}
```

- 会话语义（三个字段并存，不再声称吊销令牌）：本系统**没有会话/令牌表**，因此 `sessionRevoked` 恒为 `false`、`sessionRevocation` 恒为 `"not_implemented"`，**没有**任何令牌被吊销；真正成立的是 `privateActionsDenied: true`——账号停用后 router 对所有私人动作返回 `ACCOUNT_DISABLED`。即「停用后私人动作被拒，但无令牌表故未吊销会话」。前端不得用该响应显示"已退出登录"；独立会话/令牌吊销表是否要做仍待确认（§8 第 3 条）。
- `receipt` 在无密钥时为 `null`，客户端必须按“无进度查询能力”处理。

## 4. `account.cleanupStatus`（receipt 访问级别）

### 4.1 进入门禁（`router.js`，未改）

`resolveCleanupReceipt(payload.receipt)` 返回的 actor 必须带 `permission === "cleanup_status"`；否则 `FORBIDDEN`。该分支**不读 OPENID**，登录态与回执互不替代。

### 4.2 回执口径

| 约束         | 实现                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| 服务端签发   | HMAC-SHA256，密钥来自 `process.env.CLOUD_RECEIPT_SECRET`（调用时读取）                       |
| 只绑定本任务 | claims 中 `j` 为 jobId；域模块要求 `actor.jobId === payload.jobId` 且只 `getCleanupJob` 该行 |
| 权限         | claims `p = cleanup_status`，不可用于导出、正文或其他动作                                    |
| 过期         | `exp = 签发时刻 + 900 秒`（提案值，见 §9 第 2 条）                                           |
| 篡改         | 签名用 `timingSafeEqual` 常量时间比较；payload 改动即签名不符                                |
| 失败关闭     | 密钥缺失、格式不符、过期、jobId 不符、job 行不存在 → `FORBIDDEN`                             |

回执格式：`v1.<base64url(claims)>.<base64url(hmac)>`，claims 为 `{ p, j, exp }`。

### 4.3 返回与禁止项

- 返回 `{ jobId, state, createdAt, updatedAt }`；**不返回** `progress` 百分比、账号标识、正文、导出或错误细节。
- 清理执行器未接通，`state` 恒为 `pending`；任何“已全部删除”的显示都不成立（F23 显示依据）。
- 回执不能当登录：用回执访问 `account.preferences` / `journal.get` / `account.requestExport` / `account.close` 均为 `UNAUTHENTICATED`（C12）；已停用账号也不能借回执复活。

## 5. 测试清单与真实计数

```
node --test tests/week2-account-close.test.js
# tests 16 / pass 16 / fail 0
```

| 用例 | 场景                          | 断言要点                                                                                            |
| ---- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| C01  | 缺失/错误 confirm、未知字段   | `INVALID_INPUT`；无 job；账号仍 active                                                              |
| C02  | 正常 close                    | 返回 4 个字段；账号 disabled；1 个 pending job；job.ownerId = 服务端账号 id                         |
| C03  | 重复 close（router）          | `ACCOUNT_DISABLED`；job 仍 1 个，id 不变                                                            |
| C04  | 停用失败后重试                | 首次 `CONFLICT` + job failed + 账号 active；重试成功且恰好 1 个 open job                            |
| C05  | 无密钥                        | `receipt: null`；进度查询 `FORBIDDEN`（fail closed）                                                |
| C06  | 有效回执                      | 只返回本 job 的 4 个字段；store 调用只有 `getCleanupJob`（不查账号）                                |
| C07  | 无回执                        | `FORBIDDEN`，store 调用为空                                                                         |
| C08  | 权限不符（`export_download`） | `FORBIDDEN`，store 调用为空                                                                         |
| C09  | 篡改签名 / 篡改 claims        | 均 `FORBIDDEN`；原始回执仍可用（对照）                                                              |
| C10  | 过期                          | 未过期可用；到 `exp` 后 `FORBIDDEN`                                                                 |
| C11  | 用 A 的回执读 B 的 job        | `FORBIDDEN`；响应不含 B 的 jobId/state/createdAt                                                    |
| C12  | 回执当登录 / 复活停用账号     | 4 个私人动作均 `UNAUTHENTICATED`；close 仍 `ACCOUNT_DISABLED`                                       |
| C13  | 导出入口                      | `requestExport / exportStatus / downloadExport` 仍 `NOT_IMPLEMENTED`                                |
| C14  | 清理完成态                    | 连续 3 次查询 `state = pending`，响应不含 completed                                                 |
| C15  | 域级 requestId 回放           | 同 requestId 两次 close 返回同一 jobId / 同一回执，仅 1 个 job                                      |
| C16  | 清理任务创建失败              | `CONFLICT`「注销暂未完成，请重试。」；账号 active、job 0、回执 0、未调 `setAccountStatus`；重试成功 |

## 6. 已实现 / 未实现

已实现：

- close 的载荷校验、任务先建、停用后置、失败标记与可重试错误、返回形状、回执签发（有密钥时）。
- 幂等创建 open job；重复 close 不产生第二个 job。
- 回执签发/校验（HMAC、绑定 job、权限、过期、常量时间比较、fail closed）。
- cleanupStatus 的只读返回与 jobId 绑定校验；无回执/权限不符不查账号。
- 导出入口保持 `NOT_IMPLEMENTED`（不越界实现 Xiang Yu 范围）。

未实现 / 未执行：

- 清理执行器与真实 `state` 流转（协作方 Xiang Yu；本条只创建 `pending`）。
- 真实回执密钥配置与真云签发（`CLOUD_RECEIPT_SECRET` 未配置，生产签发未执行）。
- `cleanup_jobs` 的账户级唯一键/事务（当前 read-then-insert 仍有竞态窗口）。
- 会话表与令牌吊销：没有会话/令牌表，close 如实返回 `sessionRevoked: false` / `sessionRevocation: "not_implemented"` / `privateActionsDenied: true`，不声称已吊销会话。
- 前端处理中页的轮询与文案（Linghan Chen 范围）。

## 7. 与 W1 提案的偏差

1. **重复 close**：W1 §3.1 写“重复调用返回同一 jobId”；实际 router 先以 `ACCOUNT_DISABLED` 拒绝。测试按真实行为断言“不产生第二个 job”，并在 §3.2 说明；需 Xiang Hong 复核是否接受该口径。
2. **进度字段**：W1 示例含 `progress: { task_history, preferences }`。本条**不返回** progress，因为执行器未接通，任何计数都是编造；待 Xiang Yu 的清理执行器定义“已处理记录数”后再补。
3. **回执字段名**：采用 router 硬编码的 `payload.receipt`（W1 选项 O1），未使用 `receiptCredential`；该冲突按 router 现状定案，仍待 Xiang Yu + Xiang Hong 书面确认。
4. **重试语义**：停用失败后重试会新建 pending job（失败行保留），而不是把 failed 行改回 pending；W1 未规定，本条选择“保留失败证据”。
5. **cleanup_jobs 并发**：`database/collections.json` 未给 `cleanup_jobs` 定义唯一键，本条用读后写兜幂等，**不能**宣称并发下绝不产生两个 open job。

## 8. 待确认项

1. 重复 close 的口径（`ACCOUNT_DISABLED` vs 返回原 jobId）——Xiang Hong 复核。
2. 回执有效期 900 秒与是否一次性使用——W1 §6.4 未定，需 Xiang Yu + Xiang Hong 定案。
3. 是否需要独立会话/令牌吊销表：当前无表，故 `sessionRevoked` 恒 `false`、`sessionRevocation = "not_implemented"`，只有 `privateActionsDenied` 成立（字段语义已定案，是否补会话表待定）。
4. `CLOUD_RECEIPT_SECRET` 的配置责任人与轮换方式；密钥缺失时的产品文案（当前 fail closed）。
5. `cleanup_jobs` 是否增加 `uniq(ownerId, open)` 或改用事务；`database/` 变更由 Xiang Yu 主责。
6. 回执 claims 是否应包含 `accountId`（当前不含，仅 jobId，减少泄露面）与是否应加入签发时间。
7. 云数据库重复键/权限错误形状（同时影响 accounts 与 preferences 的归一化判定）。

## 9. 阻塞

- 清理执行器未接通：**阻塞**，完整注销不能标为完成（Xiang Yu）。
- 回执签名密钥未配置：**阻塞**，生产回执签发未执行（Xiang Hong 分配）。
- 真实云 `cleanup_jobs` / `accounts` 写入：**阻塞**，缺测试环境授权。
