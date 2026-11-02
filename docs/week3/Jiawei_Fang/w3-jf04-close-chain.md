# W3 JF04 停用与受限进度可执行链路（Jiawei Fang / w3-account）

- 任务编号：W3 JF04，承接 W2 JF04（`account.close` 与回执门禁的 `account.cleanupStatus`）
- 关联需求：UW3-F23（停用与清理进度）、UW3-F21（停用后偏好等私人写入被拒）
- 协作人：Xiang Yu（清理执行器、导出清理、job 字段交接）、Linghan Chen（Me 页注销/进度状态映射）
- 复核人：Xiang Hong（契约复核）、Qizhen Cai（独立复核）
- 版本：0.2.3；分支 `week3/jiawei-fang`；基线 `a2a671980a392df1db0e2ec63bd4ec7af4f6b86e`
- 环境：本地 Node v24.15.0 + 合成库；**真云、签名密钥、清理执行器均未执行**，未删除任何真实数据
- 成果路径：[account-candidate.js](../../../cloudfunctions/moodsky/services/account-candidate.js)（close / cleanupStatus 部分）、[week3-account-close-chain.test.js](../../../tests/week3-account-close-chain.test.js)
- 实际耗时：待本人确认
- 验收状态：待复核

## 1 close 链路（事务内建 job + 停用）

注入 `stores/account-transaction.createAccountTransactions` 时，`account.close` 走事务路径（`withOwner`），顺序与保证如下：

1. `withOwner` 先校验账号行：存在、`status==='active'`、`journalLayout==='deterministic-days-v1'`、`operationFence/exportEpoch` 为非负安全整数。任一不满足直接以 `ACCOUNT_DISABLED`/`NOT_IMPLEMENTED`/`CONFLICT` 拒绝，未写任何文档。
2. 在事务内查询该 owner 是否已有 `pending`/`processing` job（中断恢复）：有则复用，不新建。
3. 无未关闭 job 时写 job 文档，`_id` 为 `sha256(['cleanup-job', accountId])` 前 32 位（确定性，一个账号只有一个 job 槽位），字段：
   `ownerId`、`state:'pending'`、`exportAccessRevoked:true`、`progress:{}`、`createdAt`、`updatedAt`。
4. 同一事务内把 `accounts.status` 置为 `disabled`、写 `updatedAt`；`stats.updated !== 1` 时抛错，整个事务回滚。
5. 调用 `transactions.changed(ownerId)`，`withOwner` 在同一提交里把 `operationFence` 与 `exportEpoch` 各 +1。
6. 提交后返回 W2 相同形状的响应（`accountStatus/sessionRevoked/sessionRevocation/privateActionsDenied/cleanup/receipt`）；回执由注入的 HMAC 签名器按 `jobId` 签发，无密钥时为 `null`。

不变式：**不存在"已停用但没有 job"的账号**。任一步失败都由事务整体回滚，不需要补偿写；接口返回 `CONFLICT` + "注销暂未完成，请重试。"，账号保持 `active`、围栏不变，可直接重试。

重复申请：router 对停用账号的私人动作先行返回 `ACCOUNT_DISABLED`（`router.js` 的 `account.status !== 'active'` 门禁），事务前置的 `status==='active'` 再挡一次，job `_id` 又是确定性的，因此三条路径都不会出现第二个 job。

未注入 `transactions` 时保留 W2 的 store 路径：先写 job 再停用；停用失败把 job 标记 `failed`（补偿标记而非回滚），账号保持 `active`，可重试。该 job 由 `stores/account-store.js` 映射写入，只有 `ownerId/state/时间戳`，**缺 `exportAccessRevoked` 与 `progress`，不能直接喂给清理 guard**；映射文件属 Xiang Yu 的 W2 XY01 范围，本任务不改，W3 装配一律注入 transactions。

## 2 cleanupStatus（受限回执）

- 入参白名单只有 `jobId` 与 `receipt`；回执由 router 的 `receipt` 门禁验证（HMAC、`permission==='cleanup_status'`、`exp` 未过期），失败即 `FORBIDDEN`。
- 只读回执自身 claim 里的 `jobId`：payload 的 `jobId` 必须与 claim 相同，否则 `FORBIDDEN`；读到文档后再次核对 `_id`，跨 job 一律拒绝且不回显对方 jobId（C08）。
- 状态白名单 `pending`/`processing`/`completed`/`failed`：**按行内真实状态原样上报**，未知状态返回 `CONFLICT`（"清理进度尚不可确认。"）。本地环境不会产生 `completed`（执行器未接通），但若执行器已写入 `completed`，读取端如实报告，不推算百分比、不编造计数（C10/C11）。
- `progress` 只对 guard 就绪（`exportAccessRevoked === true`）的 job 返回：值为**行内计数映射**（本地空 map 即 `{}`，表示尚无执行器写入的计数）；格式非法的映射返回 `CONFLICT`，不伪造 0（C02/C11）。
- 回执不是登录：只认回执的 action 才生效；`account.preferences`/`journal.get`/`tasks.mine` 等私人动作仍需可信 OPENID + active 账号，停用后一律 `ACCOUNT_DISABLED`（C09）。
- **本人性说明**：`identity.js` 的 W2 签发器 claim 只有 `p/j/exp`，不带 `ownerId`；因此"本人"由派发绑定（回执只发给执行 close 的本人）+ jobId 绑定 + 平台身份共同保证，账号级 claim 需改签名器，不在本任务文件范围，列为阻塞项。

## 3 与 `domains/cleanup.js`、`domains/export.js` 的接缝

`domains/cleanup.js` 的 `guard(tx, ownerId, jobId, collection)` 逐条要求与本链路写法对照：

| guard 要求                                                                 | close 写入的值                  | 为什么必须这样                                                                   |
| -------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| 账号行 `_id===ownerId` 且 `status==='disabled'`                            | 同事务置 `disabled`             | guard 只服务停用后清理；先建 job 再停用，失败整体回滚，避免"停用无 job"          |
| `job.ownerId === ownerId`                                                  | 取自 router actor，不取 payload | 防止跨账号清理                                                                   |
| `job.state ∈ {pending, processing}`（`allowCompleted` 时才加 `completed`） | `pending`                       | 只有执行器能把状态推进到 `processing`/`completed`；close 不能预先声称进度        |
| `job.exportAccessRevoked === true`                                         | `true`                          | 缺这个字段 guard 直接 `FORBIDDEN`，清理无法开始，等于停用后永远无法清理          |
| `job.progress` 为对象，键属于 `COLLECTIONS` 且值为非负安全整数             | `{}`                            | 空对象表示"尚未统计"；键集合留白由执行器按 collection 累加，close 不预置伪造计数 |
| `export_jobs` 走 intent-first + `removeExportFile`                         | 不在 close 内删除任何文件       | 文件不在数据库事务内，导出清理仍由执行器（Xiang Yu）负责                         |

`domains/export.js`：`createExportJob` 先按 `sourceState` 要求 `status==='active'`，停用账号直接 `ACCOUNT_DISABLED`；此外它在同一事务里递增 `operationFence` 并把 `accountEpoch` 写进导出任务。close 递增 `exportEpoch` 后，停用前准备的导出任务 `accountEpoch` 与账号不再一致，读取侧不会把旧快照当新导出。两者互为兜底，**导出/下载入口仍由 Xiang Yu 的 F22 实现，本任务不实现**。

接缝验证：C03 用 `createCleanupService({ db })` 直接跑 `cleanupByOwnerId('preferences', ...)`，guard 通过并返回 0（无行可删）；`journals` 在该布局下仍按 cleanup.js 的既有说明返回 `NOT_IMPLEMENTED`。这证明 close 写的字段能过 guard，不代表发生了清理。

## 4 真实命令输出

```text
$ node --test tests/week3-account-adapters.test.js tests/week3-account-close-chain.test.js
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

```text
$ node --test tests/week3-*.test.js
ℹ tests 81
ℹ pass 81
ℹ fail 0
```

（85 项含同分支其他任务的 W3 用例；本任务贡献 14 项，JF01 负责其余 12 项，三者合计 26 项同属账号方向。）

```text
$ npm test
ℹ tests 995
ℹ pass 995
ℹ fail 0
```

（995 = 基线 924 + 本分支 71：JF01 12、JF02 17、JF03 8、JF04 14、JF05 20；测试数为当次真实运行结果，不代表云或设备验收。）

```text
$ npm run check
> npm run lint && npm run format:check && npm run structure:check && npm run docs:check && npm run typecheck && npm test
Checking formatting...
All matched files use Prettier code style!
Structure, 24 requirement IDs, shared contract copy and client access policy passed.
16 maintained documents / 293 local links passed.
ℹ tests 991
ℹ pass 991
ℹ fail 0
（exit 0）
```

说明：本任务进行中有并行成员（JF02/JF05）同时新建文件，中途一次 `format:check` 曾因对方两份未格式化文档告警；其作者随后格式化，最终 `npm run check` 全链通过（exit 0），本人文件未代改他人材料。

## 5 偏差与阻塞

1. **旧账号无布局（D4）**：`stores/account-transaction.withOwner` 要求 `journalLayout === 'deterministic-days-v1'`，因此 W1/W2 时期没有该字段的旧账号调用 close 会得到 `NOT_IMPLEMENTED`（C13：账号仍 active、0 job、无文档写入）。影响范围：旧账号当前无法自助注销；替代路径需 Xiang Hong/Xiang Yu 定案——要么允许布局无关的注销事务，要么先完成旧账号布局迁移（本任务不做自动迁移）。
2. **清理执行器未实现**：`state` 恒为 `pending`，没有任何行被删除；`completed` 只由 `executeAccountCleanup` 在全部清空后写入（Xiang Yu / F23）。因此本地"进度可查询"不等于"清理已运行"。
3. **真实云端未验证**：事务回滚语义、`runTransaction` 重试下的回调幂等、真实账号停用与 job 落库均未在云端执行；本地只证明合成库上的原子性。
4. **store 路径的 job 不具备 guard 字段**：`stores/account-store.js` 的 `insertCleanupJob`/`mapJob` 只映射 `ownerId/state/时间戳`，属 W2 XY01 文件范围，本任务未改。W3 装配必须注入 `transactions`，否则清理 guard 会 `FORBIDDEN`。
5. **回执无账号 claim**：跨 job 已拒绝，但"回执是否属于该账号"依赖派发绑定与平台身份；若要账号级断言需扩展 `identity.js` 的 claim（接口变更，待复核）。
6. **request_receipts 差异**：事务路径不再写 `request_receipts`（停用后同一 requestId 的重放会被 router 与事务前置一起以 `ACCOUNT_DISABLED` 拒绝，且 job id 确定性保证幂等）；store 路径保留 W2 的重放记录。
7. **验收与工时**：路由停用门禁、字段形状由 Xiang Hong 复核，Qizhen Cai 独立复核；本人工时"待本人确认"，未代填复核或验收结论。

## 6 复审后修订（2026-10-30）

| 复审项                   | 修订                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 事务内 `where()`（高）   | close 的 job 查询改为确定性 `doc(cleanupJobId(accountId)).get()`；新增 C12：事务替身禁止 `where()`，close 仍成功。真实云事务不支持 `where`，原实现会在线上全部失败。                |
| 进度恒空（中）           | `cleanupStatus` 返回行内 `progress`（非负整数映射），空 map 表示未统计；格式损坏 → `CONFLICT`，不伪造 0（C11）。                                                                    |
| 客户端形状（中）         | `miniprogram/modules/account/service.js` 的 close 现发送 `confirm:'CLOSE'`，cleanupStatus 现发送 `{jobId, receipt}`；属跨范围修改，**需 Linghan 复核**。                            |
| 旧账号布局（中）         | 无 `journalLayout` 的 W1/W2 旧账号仍无法 close（事务前置要求布局）→ 新增 C13 断言 `NOT_IMPLEMENTED` 且不写文档，列为**阻塞**（需 Xiang Hong/Xiang Yu 定案布局无关注销或迁移策略）。 |
| completed 永久拒绝（低） | 改为如实上报已存储状态；未知状态仍 fail closed。                                                                                                                                    |
| 覆盖已完成 job（低）     | 复用前校验行状态：仅 `pending/processing` 可复用；`completed/failed` 一律 `CONFLICT`，不覆盖执行器账本（C14）。                                                                     |
