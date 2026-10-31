# PR: 第三周 Jiawei Fang —— 账号解析器、任务分流、偏好合同、停用链路与数据能力

## 摘要

- JF01：新增 `services/account-adapters.js`，把可信账号解析整理成可装配解析器（首建唯一委托 repository、索引未就绪 fail closed、旧账号不迁移、disabled 不复活、H02 journalReady 契约）
- JF02：新增 `services/tasks-adapters.js`，公开只读与私人写入分流，`entries→items` 映射，状态表差异显式保留待前端确认
- JF03：新增偏好"客户端真实请求 → 服务端候选"合同测试（8 项）
- JF04：`services/account-candidate.js` 的 close 走事务内建 job + 停用，job 满足清理服务 guard，递增 exportEpoch；cleanupStatus 按回执只读本人 job
- JF05：新增 `services/account-data.js`（readSourceState / 本人 history+preferences 投影 / 幂等批量清理原语）

## 改动

- 新增：`services/account-adapters.js`、`services/account-data.js`、`services/tasks-adapters.js`
- 修改：`services/account-candidate.js`（仅 close/cleanupStatus/工厂）
- 测试：`tests/week3-account-adapters.test.js`(12)、`week3-account-close-chain.test.js`(14)、`week3-account-data.test.js`(20)、`week3-source-revisions.test.js`(8)、`week3-tasks-adapters.test.js`(17)、`week3-preference-contract.test.js`(8)
- 文档：三份协调文件（QC02 状态确认、sourceRevisions 提案、旧账号注销方案）
- 文档：`docs/week3/Jiawei_Fang/` 五份任务记录 + 索引 + 三份协调文件（QC02 状态确认、sourceRevisions 提案、旧账号注销提案）
- 未改：`shared/`、`index.js`、`candidate-router`、`domains/*.js` stub、`database/`、依赖；`miniprogram/` 仅按复审 D3 修正 `modules/account/service.js` 的 close/cleanupStatus 载荷（需 Linghan 复核）

## 验证

```
npm run check   # 1003/1003，lint + format + structure + docs + typecheck 全过
```

## 设计决定与偏差

- 账号首建仍不在生产 `index.js` 装配（`tests/cloud-bundle-defaults.test.js` 打包门禁）；本 PR 只提供可调用的解析器与合同测试。
- 无事务的 store 路径生成的 job 不满足 `domains/cleanup.js` guard；W3 装配必须注入 `stores/account-transaction`，已在 JF04 文档写明。
- `cleanupStatus` 按行内真实状态上报（含执行器写入的 `completed`），未知状态 fail closed；本地环境不会产生完成态。
- 事务路径已移除 `where()`（云事务不支持），改用确定性 `doc()` 读取；旧账号无 `journalLayout` 仍无法注销，见 JF04 阻塞。
- 客户端 `createClosureRequest`/`cleanupStatus` 已补齐 `confirm`/`jobId`，跨范围修改需 Linghan 复核。
- `readSourceState` 在缺失 `sourceRevisions` 时返回 `NOT_IMPLEMENTED`，不使用 `exportEpoch/operationFence` 顶替（会放过过期快照）。

## 阻塞与复核请求

- Xiang Hong：`resolveAccountForJournal` 的 H02 契约、`sourceRevisions` 口径
- Xiang Yu：cleanup job 字段与 `exportAccessRevoked/progress`、清理原语接缝
- Qizhen Chen：状态表 F1—F9 定稿
- Qizhen Cai：禁用后写入、跨 job 回执、A/B 隔离独立复测
- 真实云/密钥/执行器/真机未执行
