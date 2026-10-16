# W1 JF01 可信微信账号解析验证

- 负责人：Jiawei Fang（832401110）｜复核：Xiang Hong｜独立检查：Qizhen Cai
- 协作：Xiang Yu（`accounts` 字段与唯一约束）
- 成果：`tests/account-identity.test.js`、`w1-jf01-local-results.json`
- 运行方式：`node --test tests/account-identity.test.js`
- 状态：**本地替身验证通过（11/11 中 A01—A07 属本条）；真实云验证未执行**

## 1. 门禁事实（读码结论，非推断）

`cloudfunctions/moodsky/router.js` 对 `private` / `operator` 的执行顺序：

1. 无 `trustedContext.OPENID` → `UNAUTHENTICATED`（未发起任何账号查询）；
2. `resolveAccount(OPENID)` 返回空或无 `id` → `UNAUTHENTICATED`「账号尚未就绪。」；
3. `account.status !== 'active'` → `ACCOUNT_DISABLED`；
4. 通过后 `actor = { accountId: account.id, roles: [] }`，业务 handler 只能看到 `actor`。

`cloudfunctions/moodsky/index.js` 用 `cloud.getWXContext()` 取可信上下文，并在路由前删除 `userInfo`、`tcbContext`；注释明确「Never get identity from event/payload」。

`miniprogram/shared/validation.js` 的 `RESERVED_IDENTITY_FIELDS` = `ownerId, owner, openid, OPENID, role, roles, accountId`，出现即 `INVALID_REQUEST`——**是拒绝，不是忽略**。

`database/collections.json` 与数据字典一致：`accounts.uniqueKeys = [["openid"]]`，字段 `_id / openid / status / campusId / createdAt / updatedAt`。

## 2. 首次创建规则（本条要「明确」的内容）

现状：`adapters.js`（Junhan Huang）的候选 `resolveAccount` 是**只读查找**，未命中返回 `null`；若将它接入，缺账号时会得到 `UNAUTHENTICATED`「账号尚未就绪。」。但正式 `index.js` 仍使用无参数 `createRouter()`，默认适配器返回 `NOT_IMPLEMENTED`，尚未接入这个只读候选。**首次创建尚未实现**，A05 只测本地只读规则，不代表正式入口现状；整合新增 A08 固定这个差别。

本次按「本地替身 + 提出规则」的方式验证，规则 R1—R4：

| 规则 | 内容                                                                                |
| ---- | ----------------------------------------------------------------------------------- |
| R1   | 仅当 `trustedContext.OPENID` 为非空字符串时才解析；否则不查库、不建号               |
| R2   | 命中已有账号 → 返回 `{ id, status }`；`status` 原样透传，不修正、不复活             |
| R3   | 未命中 → **尝试创建** `status = active`；写入 `openid` 由服务端从可信上下文显式写入 |
| R4   | 创建遇唯一键冲突 → 回读既有行返回，**不报错、不新增第二行**                         |

R3/R4 是提案：生产实现与接线（`adapters.js` 或 `index.js`）属于共享接口变更，须走接口 PR，由 Xiang Hong、Xiang Yu、Junhan Huang 共同复核。本次**未修改任何生产文件**。

## 3. 本地结果（实际输出）

| 用例 | 场景                                 | 期望                                                    | 实际                                                         | 结果 |
| ---- | ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------ | ---- |
| A01  | 首次进入 + 重复进入                  | 建 1 个 active 账号；两次进入同一 `accountId`；门禁放行 | 1 行账号、两次同一 id、到达 domain stub（`NOT_IMPLEMENTED`） | 通过 |
| A02  | 无可信身份                           | `UNAUTHENTICATED`，且**未发生任何账号读取**             | `UNAUTHENTICATED`，`store.calls` 为空                        | 通过 |
| A03  | 5 次并发首次进入                     | 最终仅 1 行；唯一键冲突被回读兜底                       | 5 次 insert 尝试，4 次冲突回读，**最终 1 行**                | 通过 |
| A04  | 停用账号重新进入                     | `ACCOUNT_DISABLED`；不自动恢复；**不新建 active**       | `ACCOUNT_DISABLED`，行数仍 1，status 仍 disabled             | 通过 |
| A05  | 本地只读规则，不启用首次创建         | `UNAUTHENTICATED`「账号尚未就绪。」                     | 一致；未连接正式入口                                         | 通过 |
| A06  | payload 伪造身份（7 个保留字段逐一） | `INVALID_REQUEST`，且未发起账号查询                     | 7/7 一致，`store.calls` 为空                                 | 通过 |
| A07  | 账号行缺 `id`                        | 不可成为 actor                                          | `UNAUTHENTICATED`                                            | 通过 |

```
tests 11 / pass 11 / fail 0   # 含 JF03 的 B01—B04
```

以上 11 项为成员原始记录。2026-10-17 整合复测加入 A08 后为 **12/12**：默认 `createRouter()` 的可信私人请求仍返回 `NOT_IMPLEMENTED`，没有把候选接入事实写成已完成。

## 4. 未执行项（如实登记）

| 项目                                 | 状态   | 原因 / 所需                                                       |
| ------------------------------------ | ------ | ----------------------------------------------------------------- |
| 真实云 `accounts` 读写验证           | 未执行 | 需测试环境权限与获批的真实云写入；由 Xiang Hong 协调              |
| `uniq_openid` 在真实集合上的冲突行为 | 未执行 | Xiang Yu 的 W1XY02 仅在探针集合验证过重复插入，未覆盖正式集合并发 |
| 首次创建的生产实现与接线             | 未实现 | 属共享接口变更，走接口 PR                                         |

## 5. 交回给复核人的三项

1. 规则 R1—R4 是否采纳为首次创建口径（尤其 R4 的「冲突即回读」）。
2. 生产实现落在 `adapters.js` 还是新建账号解析模块；目录归谁主责。
3. 真实云验证的授权与时间。

## 6. 交接字段（按 handoff 要求）

| 字段         | 内容                                                                 |
| ------------ | -------------------------------------------------------------------- |
| 任务编号     | W1 JF01                                                              |
| 成果路径     | `tests/account-identity.test.js`、`docs/week1/Jiawei_Fang/w1-jf01-*` |
| 提交版本     | 工作分支 `week1/jiawei-fang-account-tasks`（PR 待开）                |
| 环境类型     | 本地 Node.js 24.15.0，本地替身；无云调用                             |
| 预期 / 实际  | 四种结果：见 §3 A01—A04                                              |
| 复核意见     | 待填                                                                 |
| 实际耗时     | 待填                                                                 |
| 后续任务点数 | 5                                                                    |
| 阻塞与下一步 | 见 §4；下一步为接口 PR 与真云授权                                    |
