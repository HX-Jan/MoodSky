# W3 Jiawei Fang 独立对抗式复审报告

- 复审人：w3-audit（独立复审，未参与实现、未修改任何源码/测试/他人文档）
- 被审对象：分支 `week3/jiawei-fang`，基线 `a2a671980a392df1db0e2ec63bd4ec7af4f6b86e`
- 复审时间：2026-10-30 02:20—02:35（Asia/Shanghai）
- 交付物：仅本文件（`docs/test-reports/2026-10-30-week3-jiawei/README.md`）

## 0 结论摘要

| 项                                  | 结果                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                     | exit **0**；lint/format/structure/docs/typecheck 全过；**tests 991 / pass 991 / fail 0**                                 |
| `node --test tests/week3-*.test.js` | **81 / 81 通过**                                                                                                         |
| 被审五个测试文件                    | 12 + 10 + 20 + 17 + 8 = **67 项全过**（逐文件见 §3）                                                                     |
| 缺陷                                | **9 项：高 1 / 中 3 / 低 5**                                                                                             |
| 结论                                | **有条件通过**（JF01/JF02/JF05 主体成立；JF04 事务路径存在平台级不可执行缺陷 D1，未修复前不能按"可执行 close 链路"验收） |

## 1 范围与仓库状态

复审开始时实测（原样）：

```text
 M cloudfunctions/moodsky/services/account-candidate.js
?? cloudfunctions/moodsky/services/account-adapters.js
?? cloudfunctions/moodsky/services/account-data.js
?? cloudfunctions/moodsky/services/tasks-adapters.js
?? docs/week3/Jiawei_Fang/
?? tests/week3-account-adapters.test.js
?? tests/week3-account-close-chain.test.js
?? tests/week3-account-data.test.js
?? tests/week3-preference-contract.test.js
?? tests/week3-tasks-adapters.test.js
```

- `git diff --stat`：仅 `services/account-candidate.js` 一个已跟踪文件，+184/−25。
- 未改动 `shared/`、`miniprogram/`、`index.js`、`candidate-router.js`、`domains/*.js` stub、`database/`、`package.json`（无新增依赖）。
- 新增的 3 个 service 未被 `index.js`/`router.js`/`candidate-router.js`/`wiring.js` 引用（grep 无命中），仍为本地 opt-in 装配。
- 本次复审只新建本报告；未改动上述任何被审文件。

## 2 环境快照

| 项              | 值                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------ |
| OS / 架构       | win32 x64                                                                                        |
| Node            | v24.15.0                                                                                         |
| npm             | 11.12.1                                                                                          |
| Git 分支 / HEAD | `week3/jiawei-fang` / `a2a6719`                                                                  |
| 工作区          | 脏（5 个新测试 + 3 个新 service + 1 个修改 + 新文档目录），未清理、未 stash                      |
| 云环境          | **无授权**：未调用真实云函数/数据库，无 `CLOUD_RECEIPT_SECRET`，无清理执行器；全部结论为本地合成 |
| 数据库替身      | `tests/helpers/w2-database.js`（copy-on-write 事务、串行队列）                                   |

## 3 命令实测

### 3.1 全量检查

```text
$ npm run check
> eslint .                                    （无输出）
> prettier --check .                          All matched files use Prettier code style!
> node scripts/check-structure.js             Structure, 24 requirement IDs, shared contract copy and client access policy passed.
> node scripts/check-docs.js                  16 maintained documents / 293 local links passed.
> tsc --noEmit ...                            （无输出）
> node --test tests/*.test.js
ℹ tests 991
ℹ suites 0
ℹ pass 991
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
exit=0
```

### 3.2 W3 用例与逐文件单跑

```text
$ node --test tests/week3-*.test.js
ℹ tests 81 / pass 81 / fail 0        （exit 0）
```

| 文件                                                     | tests | pass | fail | exit |
| -------------------------------------------------------- | ----- | ---- | ---- | ---- |
| tests/week3-account-adapters.test.js                     | 12    | 12   | 0    | 0    |
| tests/week3-account-close-chain.test.js                  | 10    | 10   | 0    | 0    |
| tests/week3-account-data.test.js                         | 20    | 20   | 0    | 0    |
| tests/week3-tasks-adapters.test.js                       | 17    | 17   | 0    | 0    |
| tests/week3-preference-contract.test.js                  | 8     | 8    | 0    | 0    |
| tests/week3-review-integration.test.js（非本任务，对照） | 2     | 2    | 0    | 0    |
| tests/week3-validation.test.js（非本任务，对照）         | 12    | 12   | 0    | 0    |

### 3.3 打包门禁与基线复算

```text
$ node --test tests/cloud-bundle-defaults.test.js
ℹ tests 1 / pass 1 / fail 0          （exit 0）
```

- 基线复算：当前 991，被审 5 个新文件合计 67 项且**无子测试**（`t.test(` 计数为 0），已跟踪测试文件零改动 → 基线 = 991 − 67 = **924**，与文档口径一致。
- 顶层 `test(` 声明数：当前 913，被审新增 67 → 基线 846，同样自洽。
- 未新增依赖：`package.json`/`package-lock.json` 均不在 `git status` 中。

### 3.4 额外对抗式探针（不写文件，`node -e` 现场执行）

1. **并发首建是否真并发**：用 `databaseFixture` + 5 次 `Promise.all(resolveAccount)` 统计调用：`add=5, query=9, rows=1, distinctIds=1` → 确有多条插入竞争并走唯一冲突回读，不是串行假并发。
2. **cleanupStatus 进度是否被编造**：预置 `cleanup_jobs{state:'processing', progress:{task_history:7, preferences:2}}`，经 `createAccountDomain` 查询，实际返回 `progress:{}`（见 D2）。
3. **事务内 where 的平台可行性**：静态核对 + 官方文档（见 D1），本地替身无法暴露。

## 4 逐项结论表

### A JF01 可信账号解析器

| 检查点                                                                 | 结论 | 证据                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 只吃可信 OPENID；空值不触库                                            | 通过 | `services/account-adapters.js:94-97` 先挡空/非字符串；`router.js:64-75` 仅传 `trustedContext.OPENID`；A07（`week3-account-adapters.test.js:145-151`）断言 `f.calls` 为空 |
| 首建唯一委托 `repository.getOrCreateAccount`，模块内无 add/update 迁移 | 通过 | `account-adapters.js:98`；grep 该文件无 `.add(/.update(/.set(`；`domains/repository.js:49-97` 是唯一写方；A01/A03/A05                                                    |
| 索引未就绪 fail closed                                                 | 通过 | `repository.js:64-66` 返回 `NOT_IMPLEMENTED`；A06（test:138-143）rejects 且账号行数为 0                                                                                  |
| disabled 原样透出、不复活                                              | 通过 | `repository.js:38-48,63`；A04（test:101-119）断言 `{id,status:'disabled'}`、`accountWrites()===[]`                                                                       |
| journalReady 不可伪造；缺 readAccount 安全 false                       | 通过 | `account-adapters.js:110-126`：须 active + layout 常量 + 非负安全整数；readAccount 缺失时 row=null → 三项全 null/false（A09:165-171）                                    |
| 并发首建测试是真 `Promise.all`                                         | 通过 | A02（test:72-85）；本次探针 `adds=5/queries=9/rows=1` 证明冲突回读分支真实执行                                                                                           |
| 与 H02 的契约写清失败码                                                | 通过 | `docs/week3/Jiawei_Fang/w3-jf01-account-layout.md:41-65`：字段表 + NOT_IMPLEMENTED/CONFLICT/UNAUTHENTICATED/ACCOUNT_DISABLED 分工                                        |

### B JF04 close / cleanupStatus

| 检查点                                                   | 结论             | 证据                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| job+停用是否真同事务、失败整体回滚                       | **有条件通过**   | `account-candidate.js:177-228` 在 `transactions.withOwner`（`stores/account-transaction.js:20-65` → `db.runTransaction`）内写 job 与停用；C05/C06（test:175-234）证明本地替身回滚；但见 D1：真实平台该事务内 `where` 不可用，原子性无法在云端成立  |
| job 字段符合 `domains/cleanup.js` guard                  | 通过             | 写入 `ownerId/state:'pending'/exportAccessRevoked:true/progress:{}`（`account-candidate.js:190-202`）；guard 要求见 `domains/cleanup.js:43-63`；C03（test:137-156）用真实 `createCleanupService` 跑 `cleanupByOwnerId('preferences')` 通过并返回 0 |
| exportEpoch 递增使导出栅栏失效                           | 通过             | `account-candidate.js:211-214` → `account-transaction.js:51-58` 提交时 `exportEpoch+1`；`domains/export.js:142-152` 按 `accountEpoch` 判旧 job 冲突；C01 断言 `operationFence=1/exportEpoch=1`                                                     |
| 重复 close 幂等、不建第二个 job                          | 通过             | 确定性 job id（`account-candidate.js:159-167`）+ `withOwner` 的 active 前置（`account-transaction.js:34-36`）+ 路由 `ACCOUNT_DISABLED`（`router.js:72-74`）；C04 实测第二个 close 被拒、job 仍为 1                                                 |
| cleanupStatus 只读回执 claim 的 job                      | 通过             | `account-candidate.js:321-340`：payload.jobId 必须等于 claim、读到后再核对 `_id` 与 ownerId；C08 交叉回执均 FORBIDDEN 且不回显对方 jobId                                                                                                           |
| completed 返回 CONFLICT 的判断                           | **不通过（D5）** | `account-candidate.js:41-45,341-346`；而执行器 `domains/cleanup.js:231-239` 会写 `completed` → 接线后唯一合法完成态被永久挡死                                                                                                                      |
| 回执能否当登录                                           | 通过（不能）     | `router.js:82-87` 只有 receipt 门禁动作使用回执；C09（test:320-346）证明带回执访问 `account.preferences` 仍 UNAUTHENTICATED                                                                                                                        |
| progress 是否可能被编造                                  | **不通过（D2）** | `account-candidate.js:353-357` 硬编码 `{}`；本次探针：存储 `{task_history:7,preferences:2}` → 输出 `{}`                                                                                                                                            |
| 无 transactions 的 store 路径缺 guard 字段，文档是否如实 | 通过（如实）     | `account-candidate.js:16-21,247-309`；`w3-jf04-close-chain.md:29`、`README.md:30` 均明确"W3 装配必须注入 transactions"；C07 覆盖补偿路径                                                                                                           |

### C JF02 状态表 / 公开私人隔离

| 检查点                                  | 结论                | 证据                                                                                                                                                                                                                                  |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公开路径零私人读取                      | 通过                | `tasks-adapters.js:112-125` 不触碰 tasksDomain；P01/P07（test:135-150,239-256）用"一调用即抛错"的 store，零调用                                                                                                                       |
| 公开路径不接收/不转发 actor             | 通过                | `tasks-adapters.js:121-124` 只转发 `{action,payload}`；P04（test:173-202）断言收到的请求无 actor                                                                                                                                      |
| 空目录是空态                            | 通过                | `task-suggestions.js:65-77`；P03（test:166-171）`items:[]`                                                                                                                                                                            |
| private 需 active 账号                  | 通过                | `router.js:72-74` + `tasks-candidate.js:264-267` 双重校验；P08（test:258-271）匿名 UNAUTHENTICATED、停用 ACCOUNT_DISABLED，且无历史行写入                                                                                             |
| history 映射以服务端 entries 为唯一来源 | 通过                | `tasks-adapters.js:42-66` 只重命名/搬字段，不重排不重算；P13/P14/P16（test:352-440）覆盖隔离、游标、畸形结果                                                                                                                          |
| 状态矩阵与 tasks-candidate 逐行一致     | 通过                | 逐格核对 `tasks-candidate.js:321-373` 与 `tasks-store.js:143-159`：无记录 1 行、replace 2 行、selected→complete/skip 更新本行、selected→replace 更新 1+新增 1、终态同目标回放/异目标 CONFLICT；与 `w3-jf02-state-table.md:54-58` 一致 |
| F1—F9 未被写成已定稿                    | 通过                | `w3-jf02-state-table.md:94-106` 九项全部"未确认"                                                                                                                                                                                      |
| 是否重复实现 `task-suggestions`         | 通过（复用）        | `tasks-adapters.js:68-76` 只接受注入的公开服务；P02 直接用真实 `createTaskSuggestionsService`                                                                                                                                         |
| 公开字段过滤的证据归属                  | **观察（并入 D6）** | P04 的"拒绝私人筛选"由测试自造的注入实现抛出（test:176-183），adapter 本身不校验 payload；接真实 `task-suggestions.js:49-56` 才成立                                                                                                   |

### D JF05 数据能力

| 检查点                                                                      | 结论 | 证据                                                                                                                                                        |
| --------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| readSourceState 形状符合 `storage-support.sourceState`（五域/epoch/status） | 通过 | `account-data.js:88-133` 返回 `{ownerId,status:'active',epoch,revisions(五域)}`；`storage-support.js:57-81`；D01（test:62-73）直接调用 `sourceState()` 复核 |
| 缺字段失败码诚实、不伪造 0                                                  | 通过 | 缺 layout/围栏 → `NOT_IMPLEMENTED`（`account-data.js:98-111`）；缺 `sourceRevisions` → `NOT_IMPLEMENTED`（:115-118）；D04/D07 实跑                          |
| 非法/耗尽计数器 CONFLICT                                                    | 通过 | :112-131；D06（test:113-130）10 组用例全 CONFLICT                                                                                                           |
| cleanupOwnerBatch 幂等                                                      | 通过 | :238-263 只按 ownerId 查询、逐行复核、`removed=0` 计 0；D17/D18（test:305-338）                                                                             |
| 不会删公共 task_templates                                                   | 通过 | :43,241-244 白名单只有 `task_history/preferences`；D19（test:340-366）INVALID_INPUT 且模板保留                                                              |
| listPreferences 不泄露 ownerId/openid                                       | 通过 | :194-228 显式字段投影；D13（test:228-249）`doesNotMatch(/ownerId                                                                                            | openid/)` |
| 导出接缝与 `domains/export.js` 写法一致                                     | 通过 | `export.js:41-53` 在事务内 `readSourceState(ownerId,tx)` → `sourceState()`，与 `w3-jf05-data-capability.md:94` 描述一致                                     |

### E JF03 合同测试

| 检查点                           | 结论             | 证据                                                                                                                                                                                           |
| -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真调用客户端 service 构造请求    | 通过             | `week3-preference-contract.test.js:9,38-39` 直接 require 并调用 `miniprogram/modules/account/service.createPreferencesRequest`                                                                 |
| 真经过 router + account 候选链   | 通过             | test:27-32 装配 `createRouter({domainHandlers:{account:domain.handle}})`，domain 来自 `createAccountDomain`                                                                                    |
| 停用/A-B 走真实门禁              | 通过             | 停用用 `identity.resolveAccount`（P05:90-98）；A/B 两个 OPENID 各自解析（P06:100-108）                                                                                                         |
| 是否把本地成功写成云端成功       | 通过（未）       | 文件头 test:1-2、`w3-jf03-preference-contract.md:44-57` 均明确本地/云端分列                                                                                                                    |
| close/cleanupStatus 的客户端合同 | **不通过（D3）** | 客户端 `service.js:7` 无 `confirm`、`:8` 只发 `receipt`；服务端 `account-candidate.js:233-235` 要求 `confirm:'CLOSE'`、`:314-316` 要求 `jobId`；P08（test:122-127）把 INVALID_INPUT 记为"通过" |

### F 文档与纪律

| 检查点                             | 结论                | 证据                                                                                                                                       |
| ---------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 五份文档含要求字段                 | 通过（版式不统一）  | 逐文件 grep：JF01—JF05 均含任务编号/承接/关联需求/协作人/复核人/版本/环境/成果路径/实际耗时/验收状态/阻塞；JF01、JF04 的"阻塞"仅为 §5 标题 |
| 实际耗时是否编造                   | 通过（未编造）      | 五份均"待本人确认/不由代理代填"，未填具体小时                                                                                              |
| 状态词表                           | 通过                | 仅 待复核/阻塞；未出现 已验收/已完成                                                                                                       |
| 本地与真实云分列                   | 通过                | 各文档"环境"字段与 §阻塞 明确未执行真实云                                                                                                  |
| 是否声称已完成清理/导出/真云       | 通过（未声称）      | JF04:8,104-107；JF05:12,128；README:24                                                                                                     |
| 测试数字与实测一致                 | 通过                | 22/17/8/20/81/991 全部与 §3 实测一致                                                                                                       |
| 未改共享/客户端/入口/stub/database | 通过                | §1 git status；`git diff --stat` 仅 account-candidate.js                                                                                   |
| 打包门禁                           | 通过                | §3.3；`PR_BODY.md:27` 亦声明                                                                                                               |
| 无新增依赖                         | 通过                | package.json 未变；新代码仅 `node:crypto` 内置模块                                                                                         |
| 文档引用与计数口径                 | **不通过（D6/D7）** | 见缺陷清单                                                                                                                                 |

## 5 缺陷清单

| id  | 严重度               | 文件:行                                                                                                                                 | 问题                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 必修复                                                                                                                                                                                               |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **高（平台级阻断）** | `cloudfunctions/moodsky/services/account-candidate.js:169-173,183`；调用方 `stores/account-transaction.js:28`                           | 事务回调内用 `tx.collection('cleanup_jobs').where({ownerId})` 查询。微信云数据库官方明确"**事务中不支持批量操作（where 语句），只支持单记录操作（collection.doc, collection.add）**"（https://developers.weixin.qq.com/minigame/dev/wxcloud/guide/database/transaction.html ）。真实云上该调用在 `runTransaction` 回调里不可用，会被 `closeInTransaction` 的 catch 转成 CONFLICT，**所有真实 close 都会失败**。本地替身 `tests/helpers/w2-database.js:17` 支持事务内 where，因此 10 项 close 测试全绿也发现不了；项目自己的排障文档也只声明事务回调提供 `tx.collection(name).doc(id)`（`docs/troubleshooting/storage-tests.md:12`，AGENTS.md:16 同义）。 | 是：改为 `tx.collection('cleanup_jobs').doc(cleanupJobId(accountId)).get()`（job id 本就确定性，无需 where）；补一个"事务替身禁止 where"的回归用例，把平台约束固化；文档不得再宣称事务路径可直接上云 |
| D2  | 中                   | `cloudfunctions/moodsky/services/account-candidate.js:353-357`                                                                          | `cleanupStatus` 对 guard-ready job 无条件返回 `progress:{}`，实测存储 `{task_history:7,preferences:2}` 时仍报空。执行器一旦把 job 推进到 processing 并累加计数，回执会少报已删除行数，与"只读该 job、不编造"的声明（JF04:36）冲突。                                                                                                                                                                                                                                                                                                                                                                                                                      | 是：如实返回经校验的 `job.progress`（或省略该字段并说明"执行器未接"），补"processing+非空 progress"用例                                                                                              |
| D3  | 中                   | `miniprogram/modules/account/service.js:7-8`；`account-candidate.js:233-235,314-316`；`tests/week3-preference-contract.test.js:122-127` | 已发布客户端构造器与 W3 服务端合同不兼容：`createClosureRequest()` 不带 `confirm:'CLOSE'` → 必 INVALID_INPUT；`cleanupStatus(receipt)` 不带 `jobId` → 必 INVALID_INPUT。JF03 P08 把该拒绝写成"识别…通过"，JF04 文档只写服务端白名单、未把客户端/Me 页联调列为阻塞，容易被读成"入口已接通"。                                                                                                                                                                                                                                                                                                                                                              | 是：或更新客户端构造器（属 L04 范围）并加客户端合同测试，或在 JF04/JF03 明确列为阻塞并下调"接通"表述                                                                                                 |
| D4  | 中                   | `stores/account-transaction.js:37-39`                                                                                                   | `withOwner` 要求 `journalLayout==='deterministic-days-v1'`，无布局的 W1/W2 旧账号调用 close 会直接 NOT_IMPLEMENTED（"功能开发中"），**旧账号无法注销**。JF04 只在 §1.1 技术前置提到，未列入阻塞/影响，属用户权利缺口。                                                                                                                                                                                                                                                                                                                                                                                                                                   | 是：在 JF04 §5 明确"旧账号不能注销"的影响与替代路径（先回填布局或单独的低敏注销事务），或放宽 close 的布局前置                                                                                       |
| D5  | 低                   | `account-candidate.js:41-45,341-346`；`domains/cleanup.js:231-239`                                                                      | 执行器会写 `completed`，而 `cleanupStatus` 对 `completed` 永久 CONFLICT。当前不谎报是安全的，但接线后唯一合法完成态被挡死；仅 `PR_BODY.md:29` 提到"接线后重新定案"，JF04 正文 §5 未列。                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 是（文档+预留分支）：JF04 §5 列为阻塞；接线时对 `completed` 返回执行器写入的 progress/totalDeleted（来源仍是 job 行，不由本端推断）                                                                  |
| D6  | 低                   | `w3-jf02-state-table.md:174`；`w3-jf05-data-capability.md:175`；`w3-jf01-account-layout.md:88`；`week3-tasks-adapters.test.js:178-183`  | 计数/证据归属错误：把 67 项中的 30 项（实为本分支 JF01 12+JF03 8+JF04 10）写成"同工作区并行成员用例"；JF02 的"本任务 37 项"含 JF05 的 D01—D20，JF05 的 37 项又含 JF02 的 P01—P17；JF01 的"22 项"含 JF04 的 10 项。P04 的"拒绝私人筛选"由测试自造实现抛出，非 adapter 行为。总数 991=924+67 本身正确。                                                                                                                                                                                                                                                                                                                                                    | 是（仅文字更正）：按 12/17/8/10/20 重新归属，并把 P04 证据改述为"下游公开服务拒绝"                                                                                                                   |
| D7  | 低                   | `docs/week3/Jiawei_Fang/README.md:23`                                                                                                   | 链接指向 `docs/test-reports/2026-10-30-week3-jiawei/README.md`，复审开始时该文件不存在（悬空链接）。`docs:check` 只覆盖 16 份 maintained 文档，未校验本目录。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 是：本报告生成后链接可达；建议合入前再跑一次链接核对，或延后填写报告路径                                                                                                                             |
| D8  | 低                   | `account-candidate.js:186-202`                                                                                                          | 若同一账号的 `completed` job 已存在（执行器完成后账号被人工恢复为 active），再次 close 因 `OPEN_JOB_STATES` 不含 completed，会用 `doc(jobId).set()` 整体覆写该 job（progress/totalDeleted 丢失）。当前流程下不可达，属防御性缺口。                                                                                                                                                                                                                                                                                                                                                                                                                       | 建议：`get()` 到既有 job 时若状态非可复用则 CONFLICT，不 `set` 覆写                                                                                                                                  |
| D9  | 低                   | `w3-jf01-account-layout.md:17-23`；`account-adapters.js:94-98`                                                                          | 失败码表只列空/非字符串返回 null；非空但格式非法的 openid 会被 `repository.identity` 抛 `INVALID_INPUT`（不是 null），文档未记录该分支。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 建议：补一行失败码说明（INVALID_INPUT）                                                                                                                                                              |

## 6 无法验证项

1. **真实云事务语义**：无云授权。D1 是基于官方文档与项目既有约定（事务回调只用 `doc`）的静态判定，未在真实环境复现；一旦具备环境，应首先执行 D1 的复验。
2. **`uniq_openid` 索引状态、平台重复键错误形状、真实 openid 首建/并发**：均未执行。
3. **`CLOUD_RECEIPT_SECRET` 签发/验签、回执 TTL 与"回执归属账号"**：本地用 `local_test_secret`，claim 无 ownerId（JF04:38 已自述）。
4. **清理执行器与导出领取**：未实现/未接线；"进度可查询"不等于"清理已运行"，本次无法验证 completed 链路的实际行为。
5. **Me 页面真实接线、真机、体验版**：仓库与本次执行均无证据；JF03 已列为阻塞，JF04 未列（见 D3）。
6. **H02/H03 联合联调与"配合 H03 检验停用竞争"**：docx 计划有此要求，仓库内只有本地停用单测，无联合执行记录；列入未验证。
7. **主计划 docx 的"10/25 593 项"基线**：该日快照不可复现；本报告只对当前 HEAD 的 924 基线负责。
8. **实际耗时、难度点、独立验收人签字**：属本人/复核人填写范围，代理无法核实，也未代填。

## 7 复审结论

**有条件通过。**

- 成立部分：JF01 解析器（唯一写方、fail closed、旧账号只读、H02 失败码）、JF02 公开/私人隔离与状态矩阵（逐行核对一致，F1—F9 未冒充定稿）、JF05 数据能力（形状/失败码/幂等/公共模板保护/导出接缝）证据充分，测试与文档口径基本一致；991/991 与 81/81 均可复现。
- 不成立/需先处理：JF04 的事务 close 在真实平台因 **D1（事务内 where）** 不可执行，且 D2 会少报进度、D3 的客户端合同与页面联调未落地/未记录、D4 旧账号无法注销未列阻塞。因此不能按"可执行 close 链路"判为通过。
- 放行条件（按优先级）：
  1. 修复 D1 并补"事务替身禁止 where"的回归测试（阻断级）；
  2. 修复 D2（如实回传 progress）；
  3. 对 D3 二选一：更新客户端合同并补测，或明确列为阻塞；
  4. 把 D4、D5 写入 JF04 §5 阻塞清单；
  5. 更正 D6/D7/D9 的文档表述（不改业务代码）；
  6. D8 作为防御性建议纳入后续。
- 说明：本报告不代替真实云、真机或独立验收人结论；任何"通过"仅指本地合成环境可复现。

## 8 复现命令

```bash
cd C:/Users/lenovo/DSH/Karl/kar/MoodSky-repo
git status --porcelain=v1 && git diff --stat
npm run check
node --test tests/week3-*.test.js
node --test tests/week3-account-adapters.test.js
node --test tests/week3-account-close-chain.test.js
node --test tests/week3-account-data.test.js
node --test tests/week3-tasks-adapters.test.js
node --test tests/week3-preference-contract.test.js
node --test tests/cloud-bundle-defaults.test.js
```

D1 平台依据（外部）：微信开放文档《事务》——"在事务中不支持批量操作（where 语句），只支持单记录操作（collection.doc, collection.add）"。
