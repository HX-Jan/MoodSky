# W4 JF01 账号与停用接入差异

| 项目     | 内容                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 任务编号 | W4 JF01                                                                                                                    |
| 承接     | W3 JF01/JF04                                                                                                               |
| 负责人   | Jiawei Fang（832401110）                                                                                                   |
| 复核人   | Xiang Hong、Qizhen Cai                                                                                                     |
| 环境     | 本地 Node.js v24 + 合成数据库替身（`tests/helpers/w2-database`）；**真实微信登录、真实云函数与真实数据库均未执行**         |
| 基线     | `week4/jiawei-fang`，`origin/main` = `66be660`                                                                             |
| 结论     | 本项未发现账号解析或停用判定缺陷；生产入口在合成数据库上通过首次进入、重复登录、错号与 disabled 四类边界，真实身份链路未测 |

## 1 结论先行

- 生产解析路径只信任服务端从本次调用读取的 `OPENID`：先经 HMAC 派生 `acct_*` 文档 id，再在事务内按 `_id` 读取 `accounts`；原始 `OPENID` 不落库（`production/accounts.js:31-71`，落库字段把 `openid` 写成确定性账号 id，见 `:56`）。
- `session()` 在一个只读事务内要求 `_id === ownerId`、`status === 'active'`、`journalLayout === 'deterministic-days-v1'`、`taskLayout === 'deterministic-tasks-v1'`，否则 `ACCOUNT_DISABLED` 或 `CONFLICT`（`production/accounts.js:108-128`）。
- 路由在角色查询之前拦截非 active 身份：无账号 `UNAUTHENTICATED`，非 active `ACCOUNT_DISABLED`（`router.js:64-80`）。候选适配器只透传状态，不复活 disabled 行（`services/account-adapters.js:94-104`）。
- 新增 4 项生产入口边界测试（`tests/week4-jf01-production-account-boundaries.test.js`），全部通过；未新增或改动任何身份映射、`IDENTITY_KIND`、账号状态或部署入口。
- **真实微信登录 / 真实云 / 真机未测**：本文所有“已验证”均指合成数据库替身下的自动化测试，不是云端结论。

## 2 接入矩阵

### 2.1 生产路径（`production/` 候选发布入口）

| 动作                                                        | 身份来源                                                            | 查询字段                                                                                                                      | 停用判定                                                                                                   | 错误码                                                 | 是否接线                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `account.session`                                           | `readInvocationIdentity` 的 `OPENID`（`production/index.js:55-75`） | `accounts` 文档 id=`acct_`+HMAC；`_id/identityKind/status/journalLayout/taskLayout`（`production/accounts.js:36-48,112-121`） | 行缺失或 `status !== 'active'` → 停用；布局不符 → 冲突                                                     | `ACCOUNT_DISABLED`、`CONFLICT`                         | 已接入候选发布入口（`production/index.js:106-111`，仅 `account.session` 允许首次创建）；**未接入**部署入口 `cloudfunctions/moodsky/index.js` |
| `account.preferences`                                       | `OPENID` + `sessionScope`（`production/index.js:66-75`）            | 先解析 `accounts`，再读 `preferences/pref_<ownerId>`（`production/accounts.js:75-107`）                                       | 路由统一拦截非 active（`router.js:72-74`）；事务内再次要求 active（`stores/account-transaction.js:31-36`） | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`INVALID_INPUT` | 已接入候选发布入口（`production/backend.js:76-103`）                                                                                         |
| `account.profile`                                           | 同上                                                                | `preferences/pref_<ownerId>` 的 `profile` 字段（`production/profile.js:53-81`）                                               | 同上                                                                                                       | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`CONFLICT`      | 已接入候选发布入口（`production/backend.js:76-79`）                                                                                          |
| `account.requestExport` / `exportStatus` / `downloadExport` | 同上                                                                | `accounts` 的 `operationFence/exportEpoch/sourceRevisions` 与 `export_jobs`（`domains/export.js:43-55,150-199`）              | 路由统一拦截；导出栅栏再校验 active/epoch                                                                  | `UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`CONFLICT`      | 已接入候选发布入口（`production/backend.js:86-92`）                                                                                          |
| `account.close`                                             | 同上                                                                | `cleanup_jobs` 确定性 jobId + `accounts.status`（`services/account-candidate.js:177-238`）                                    | 路由先拦 disabled；`production/index.js:76-104` 对“已停用后的重试”只返回既有 job，不复活账号               | `ACCOUNT_DISABLED`、`CONFLICT`、`FORBIDDEN`            | 已接入候选发布入口                                                                                                                           |
| `account.cleanupStatus`                                     | 回执 token，无 `OPENID`（`router.js:82-87`）                        | HMAC 回执 `permission === 'cleanup_status'`、jobs 行 `ownerId/state/progress`（`services/account-candidate.js:341-388`）      | 不依赖身份；只按回执绑定的 jobId 读取                                                                      | `FORBIDDEN`、`CONFLICT`                                | 已接入候选发布入口（`production/backend.js:93-101`）                                                                                         |

### 2.2 候选实现（`services/account-adapters.js` 等本地装配）

| 动作/装配                                  | 身份来源                                                   | 查询字段                                                                                   | 停用判定                                                       | 错误码                                               | 是否接线                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `resolveAccount`                           | 调用方传入的 trusted `openid`                              | 委托 `repository.getOrCreateAccount`，只返回 `{id,status}`（`account-adapters.js:94-104`） | status 原样透传，disabled 不复活；不做布局检查                 | 无账号返回 `null`；默认 receipt 为 `NOT_IMPLEMENTED` | 未接入部署入口；由候选路由/测试注入                                                           |
| `resolveAccountForJournal`                 | 同上                                                       | `readAccount` 只读行 `_id/status/journalLayout/journalRevision`（`:110-135`）              | 任一侧 disabled 即 disabled；旧行 `journalReady:false`，不迁移 | 行不一致 `CONFLICT`                                  | 未接入部署入口                                                                                |
| `account.preferences`（候选域）            | `actor.accountId`（只来自路由）                            | `preferences` 行；`operation` + 两个布尔字段（`account-candidate.js:92-145`）              | 路由先拦；store 再校验 owner                                   | `INVALID_INPUT`、`ACCOUNT_DISABLED`                  | 未接入部署入口                                                                                |
| `account.close`（候选域）                  | 同上                                                       | `cleanup_jobs/<sha256(ownerId)>`；同事务写停用（`account-candidate.js:177-238`）           | 只停止用事务；不重建账号                                       | `CONFLICT`、`FORBIDDEN`                              | 未接入部署入口；事务路径由装配选择                                                            |
| 部署入口 `cloudfunctions/moodsky/index.js` | `cloud.getWXContext()`，但默认适配器全部 `NOT_IMPLEMENTED` | 不查询业务集合（`router.js:18-28`）                                                        | 不提供账号判定                                                 | `NOT_IMPLEMENTED`                                    | **故意未接线**（`tests/cloud-bundle-defaults.test.js`、`tests/foundation-transport.test.js`） |

## 3 边界证据表

“已验证”只指下列**合成自动化测试**通过；括号内为测试名。真实微信登录与真实云一律未测。

| 边界                       | 生产路径证据                                                                                                                                                                                                                         | 候选路径证据                                                                                                                                                             | 结论                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| 首次进入（无账号）         | 已验证：`JF01-W4-01 first entry before session is UNAUTHENTICATED and provisions nothing`；先 `account.preferences` 返回 `UNAUTHENTICATED`，`account.session` 后只建 1 行并返回 6 项 capabilities                                    | 已验证：`JF01-A01 first trusted entry provisions one account and a repeat entry reuses it`、`JF01-A05 without first-login provisioning the gate answers UNAUTHENTICATED` | 通过（合成）         |
| 重复登录（同号多实例）     | 已验证：`JF01-W4-02 repeated and concurrent logins reuse one active row and one scope`（`Promise.all` 两次登录仍 1 行、同 scope、raw OPENID 不落库）                                                                                 | 已验证：`JF01-A02 concurrent first entries leave exactly one account behind`、`JF01-A03 the adapters plug straight into the router as its three seams`                   | 通过（合成）         |
| 错号（A 的 OPENID 读 B？） | 已验证：`JF01-W4-03 one OPENID cannot read another account's preferences`；A 拿 B 的 scope → `UNAUTHENTICATED`，A 拿自己的 scope 只读到默认值；payload 带 `accountId` → `INVALID_REQUEST`                                            | 已验证：`P06 two trusted accounts never see each other preferences`、`JF01-A06 payload identity fields are rejected before any account read`                             | 通过（合成，读隔离） |
| `disabled` 身份            | 已验证：`JF01-W4-04 a disabled identity is refused before any action and is never re-provisioned`；`account.session`/`account.preferences` 均 `ACCOUNT_DISABLED`，行保持 disabled 且 `createdAt` 不变，`resolve(..., true)` 不再重建 | 已验证：`JF01-A04 a disabled legacy identity is passed through and never revived`、`JF03-B04 a receipt never acts as a login and never revives a disabled account`       | 通过（合成）         |
| 真实微信登录               | 未验证：本机无真实调用凭据，未执行 `wx.cloud.callFunction`                                                                                                                                                                           | 未验证：同左                                                                                                                                                             | 未测                 |
| 真实云数据库               | 未验证：只用 `databaseFixture`；未对 CloudBase 执行事务                                                                                                                                                                              | 未验证：同左                                                                                                                                                             | 未测                 |

补充说明：

- “错号”在架构上不可由 payload 指定：`shared/validation.js:7-14` 把 `ownerId/owner/openid/OPENID/role/roles/accountId` 列为保留身份字段，命中即 `INVALID_REQUEST`；账号 id 只由 trusted `OPENID` 派生（`production/config.js:62-63`）。
- 停用判定发生在角色查询之前（`router.js:72-80`），因此 disabled 身份不会先进入 `resolveOperatorRoles`。
- 回执路径没有任何登录态，`cleanupStatus` 只读回执绑定的单个 job（`router.js:82-87`）。

## 4 实际缺陷与修复结论

**本项（JF01）未发现缺陷。依据：**

1. 生产解析与 `session()` 的四项条件（`_id`、`status`、两个 layout）在合成测试中分别被首次进入、重复登录、错号和 disabled 覆盖；无失败断言。
2. 候选适配器对 disabled 状态只透传不重建（`account-adapters.js:100-104`），既有 `JF01-A04` 仍通过；本次未改该文件。
3. 身份字段注入在进入业务域之前被 `validateRequest` 拒绝；本次未改共享校验。

**边界核对中邻近发现的两处真实缺口（已分别在 JF04/JF05 修复，不属本项账号解析缺陷）：**

| 缺陷                                                                      | 位置                                            | 修复                                                                         | 测试                                                                             |
| ------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 生产偏好写入在 store 层没有字段白名单，任意键会被展开写入                 | `production/accounts.js:90-106`（修复前 `:78`） | `checkedPreferencePatch` 只允许两个布尔字段，非法键 `INVALID_INPUT` 且不写行 | `JF04-W4-02 the trusted preference writer rejects unknown keys before writing`   |
| 候选清理集合遗漏本人地点打卡（`place_checkins`、`campus_checkin_states`） | `domains/cleanup.js:14-24`                      | 把两个集合纳入同一 owner 清理；公共 `places/task_templates` 不在清单         | `JF05-W4-01 close cleanup removes the owner check-ins and keeps public material` |

## 5 合成验证与真实验证分列

| 类别             | 已执行                                                                                                 | 未执行                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 合成验证         | `node --test tests/week4-jf01-production-account-boundaries.test.js`（4/4）；既有 W3/W2 身份与回执测试 | —                                                          |
| 真实微信登录     | —                                                                                                      | `wx.login`/`wx.cloud.callFunction` 真机调用、真实 `OPENID` |
| 真实云函数       | —                                                                                                      | `production/index.js` 部署、`wx-server-sdk` 初始化         |
| 真实数据库事务   | —                                                                                                      | CloudBase 事务并发、唯一索引 `uniq_openid` 冲突路径        |
| 停用后的真实审计 | —                                                                                                      | 真实 disabled 账号的人工会话复核（需运维执行）             |

## 6 未决项与阻塞

| 编号 | 事项                                              | 所需输入/提供人         | 恢复条件                                         |
| ---- | ------------------------------------------------- | ----------------------- | ------------------------------------------------ |
| J1   | 真实微信登录与真实云验证                          | 云环境授权 / Xiang Hong | 取得测试环境凭据并完成一次真机登录               |
| J2   | 生产入口接线决定                                  | Xiang Hong / Lead       | 单独评审把 `production/index.js` 接入 `index.js` |
| J3   | 既有 W3 清理任务 `completed` 状态的回执兼容（D5） | Xiang Yu（清理执行器）  | 接线前重新定案，不在本项扩范围                   |

## 7 本次改动文件

| 文件                                                     | 变更                                         |
| -------------------------------------------------------- | -------------------------------------------- |
| `tests/week4-jf01-production-account-boundaries.test.js` | 新增 4 项生产入口边界测试                    |
| `cloudfunctions/moodsky/production/accounts.js`          | 偏好写入白名单（与 JF04 共用，见 JF04 文档） |
| `cloudfunctions/moodsky/domains/cleanup.js`              | 补地点打卡清理集合（见 JF05 文档）           |

未改：`IDENTITY_KIND`、`account-adapters.js`、`router.js`、`shared/validation.js`、`shared/contracts.js`、`cloudfunctions/moodsky/index.js`、`production/cleanup.js`。
