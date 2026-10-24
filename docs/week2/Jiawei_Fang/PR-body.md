# PR: 第二周 Jiawei Fang —— 任务 / 偏好 / 账号入口后端

## 摘要

- 正式内部账号解析与首次创建（可信 `OPENID` → `accounts`，唯一键冲突回查，停用门禁）
- 任务四接口与状态机（`suggestions` / `quickChoice` / `transition` / `history`），含 `requestId` 幂等与终态冲突
- 账号偏好读写（`operation=get|set`，默认值、白名单、跨账号隔离）
- `account.close` 幂等停用 + 清理任务入口；`account.cleanupStatus` 受限回执读取（无密钥 fail closed）
- 数据能力交付与导出字段投影（JF05），清理执行器不在本 PR 范围

## 改动

- 新增：`cloudfunctions/moodsky/identity.js`、`stores/account-store.js`、`stores/tasks-store.js`
- 修改：`domains/account.js`、`domains/tasks.js`、`index.js`、`router.js`（新增可选 `domainOverrides` 参数，未改默认行为）
- 测试：`tests/week2-account-*.test.js`（33 = close 16 + identity 9 + preferences 8）、`tests/week2-tasks-*.test.js`（40 = 6 + 22 + 12）、`tests/week2-entry-wiring.test.js`（3）
- 文档：`docs/week2/Jiawei_Fang/`（5 份任务记录 + 索引 + 本 PR 说明）、复审报告
- 未改：`shared/*`、`miniprogram/*`、`adapters.js`、其他域、依赖

## 验证

```
npm run check   # lint + format + structure + typecheck + 669 tests，全绿（rebase 到 de4ed97）
```

## 复审修复（D1—D4 / D6 / D7 / D8 / D10）

- D1 偏好部分 set 改为字段级写入（只写本次 patch 字段，内存按 owner 串行锁），响应回显实际落库值；并发用例 P08。
- D2 补「清理任务创建失败」用例 C16，并把该可重试失败从 `INTERNAL_ERROR` 收敛为 `CONFLICT`。
- D3 装配失败只对 `MODULE_NOT_FOUND` 回退且不缓存；其他异常记录 `error.name`/`error.code`（不含身份值）后重抛；用例 WIRING-01—03。
- D4 close 会话语义改为 `sessionRevoked:false` / `sessionRevocation:"not_implemented"` / `privateActionsDenied:true`。
- D6 replace 终态回放补齐 `replacementTaskId`/`replacementState`（无法唯一确定时为 null）；用例 T21/T22。
- D7/D8 文档数字与接线口径改正；D10 补唯一键冲突回查为空用例 W09。
- 仍**未解决**（已在文档列为待确认/阻塞）：D5 回执 claims 无 `iat`/accountId/一次性标记；D9 真云唯一键与分布式锁。

## 已知偏差与阻塞

- 重复 `account.close` 被 router 以 `ACCOUNT_DISABLED` 拒绝（数据层已幂等，行为与 W1 提案 §3 不同）
- `cleanupStatus` 不返回 `progress`，`state` 恒 `pending`：清理执行器未接通
- payload 白名单暂在域模块（`shared/validation.js` 本周冻结），待接口 PR 统一
- 真实云、`uniq_openid` 并发、`CLOUD_RECEIPT_SECRET`、双账号真机隔离均**未执行**

## 复核请求

- Xiang Hong：`router.js` 可选参数与重复 close 行为
- Xiang Yu：`cleanup_jobs` 唯一键、回执 TTL、导出字段
- Qizhen Cai：越权、回执、跨账号隔离的独立复测
- Yuen Lin：账号到记录调用的联合复核

## 上游对齐与合入前置

- `router.js` 已与远端 `main`（de4ed97）逐字节一致，采用其 `services.domainHandlers` 注入缝；本 PR 不再修改 router。
- 已 rebase 到 `de4ed97`，全量 669 项通过；合入仍需按下方建议收敛账号首建实现。
- 与上游重叠：`domains/repository.js` 的 `getOrCreateAccount`（账号首建，含 `journalLayout/journalRevision/operationFence/exportEpoch`）与 `services/task-suggestions.js`（公开建议）。建议合入时账号首建改用 repository（需 `accountUniqueIndexReady` 与 `newAccountJournalLayout`），本分支保留清理进度回执（上游 `services/receipt-policy.js` 是 journal 幂等回执，语义不同）、任务状态机、偏好、停用/清理入口与对应测试。
