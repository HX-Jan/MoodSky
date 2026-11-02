# W3 Jiawei Fang 复审缺陷修复复核报告

- 复核人：w3-recheck（独立复核；未参与实现，未修改任何源码/测试/他人文档）
- 被复核对象：分支 `week3/jiawei-fang`，HEAD `a2a671980a392df1db0e2ec63bd4ec7af4f6b86e`
- 复核时间：2026-10-30 02:40—03:05（Asia/Shanghai）
- 对照基线：独立复审报告 `docs/test-reports/2026-10-30-week3-jiawei/README.md`（判定“有条件通过”，缺陷 D1—D9）
- 交付物：仅本文件 `docs/test-reports/2026-10-30-week3-jiawei/fix-verification.md`
- 方法：只读代码 + 实跑命令 + 自写探针（`/tmp` 下，不入库）；不采信修复者说法，不复用其测试内的守卫辅助函数

## 0 结论摘要

| 项                                  | 结果                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run check`                     | exit **0**；lint / format / structure / docs / typecheck 全过；**tests 995 / pass 995 / fail 0** |
| 逐文件                              | JF01 12、JF02 17、JF03 8、JF04 **14**、JF05 20 → 合计 **71**；基线 995 − 71 = **924**            |
| `node --test tests/week3-*.test.js` | **85 / 85**（含非本任务的 review-integration 2 + validation 12）                                 |
| 缺陷修复                            | **已修复 6 项（D1/D2/D3/D5/D7/D8）**；**部分修复 2 项（D4、D6）**；**未修复 1 项（D9）**         |
| 结论                                | **有条件通过**（D1 阻断级缺陷已在代码与探针层面证实修复；剩余均为文档口径，不需改业务代码）      |

## 1 快照与范围

复核开始时实测（原样）：

```text
$ git branch --show-current   → week3/jiawei-fang
$ git rev-parse HEAD          → a2a671980a392df1db0e2ec63bd4ec7af4f6b86e

$ git status --porcelain
 M cloudfunctions/moodsky/services/account-candidate.js
 M miniprogram/modules/account/service.js
?? cloudfunctions/moodsky/services/account-adapters.js
?? cloudfunctions/moodsky/services/account-data.js
?? cloudfunctions/moodsky/services/tasks-adapters.js
?? docs/test-reports/2026-10-30-week3-jiawei/
?? docs/week3/Jiawei_Fang/
?? tests/week3-account-adapters.test.js
?? tests/week3-account-close-chain.test.js
?? tests/week3-account-data.test.js
?? tests/week3-preference-contract.test.js
?? tests/week3-tasks-adapters.test.js

$ git diff --stat
 .../moodsky/services/account-candidate.js | 239 ++++++++++++++++---
 miniprogram/modules/account/service.js    |   8 +-
 2 files changed, 220 insertions(+), 27 deletions(-)
```

文件 mtime 佐证“本轮只改了 4 个文件”（其余未动）：

| 文件                                                                     | mtime       | 归属                                |
| ------------------------------------------------------------------------ | ----------- | ----------------------------------- |
| `services/account-candidate.js`                                          | 02:36       | 本轮修复                            |
| `miniprogram/modules/account/service.js`                                 | 02:37       | 本轮修复（**跨范围**）              |
| `tests/week3-account-close-chain.test.js`                                | 02:36       | 本轮补测（+4 项）                   |
| `tests/week3-preference-contract.test.js`                                | 02:37       | 本轮改写 P08                        |
| `services/account-adapters.js` / `account-data.js` / `tasks-adapters.js` | 02:10       | 原提交，未动                        |
| `tests/week3-account-adapters/account-data/tasks-adapters.test.js`       | 02:10—02:13 | 原提交，未动                        |
| `tests/helpers/w2-database.js`                                           | 02:02       | 未动（**通用替身未被加固**，见 §6） |

纪律核对（实测命令见 §2.4）：

- `git diff --name-only` 仅 2 个已跟踪文件；`git diff --name-only -- miniprogram/` 仅 `service.js` → 客户端改动确实只落该文件。
- `git status --porcelain -- shared/ index.js domains/ database/ package.json package-lock.json` **无输出** → 未改共享源码/入口/域 stub/数据库，无新增依赖。
- 改动只涉及清单内文件；`miniprogram/modules/account/service.js` 属复审 D3 要求的跨范围修正（**需 Linghan 复核**），本报告单独点明。

## 2 命令实测

### 2.1 全量门禁

```text
$ npm run check
> moodsky@0.2.3 check
> moodsky@0.2.3 lint
> eslint .
> moodsky@0.2.3 format:check
> prettier --check .
All matched files use Prettier code style!
> moodsky@0.2.3 structure:check
> node scripts/check-structure.js
Structure, 24 requirement IDs, shared contract copy and client access policy passed.
> moodsky@0.2.3 docs:check
> node scripts/check-docs.js
16 maintained documents / 293 local links passed.
> moodsky@0.2.3 typecheck
> tsc --noEmit --strict --skipLibCheck false --lib es2020 --module commonjs tools/week1-contracts/type-assertions.ts
> moodsky@0.2.3 test
> node --test tests/*.test.js
ℹ tests 995
ℹ pass 995
ℹ fail 0
EXIT=0
```

### 2.2 逐文件（独立单跑，非引用文档）

```text
$ node --test tests/week3-account-adapters.test.js     ℹ tests 12 / pass 12 / fail 0
$ node --test tests/week3-tasks-adapters.test.js       ℹ tests 17 / pass 17 / fail 0
$ node --test tests/week3-preference-contract.test.js  ℹ tests  8 / pass  8 / fail 0
$ node --test tests/week3-account-close-chain.test.js  ℹ tests 14 / pass 14 / fail 0
$ node --test tests/week3-account-data.test.js         ℹ tests 20 / pass 20 / fail 0
$ node --test tests/week3-*.test.js                    ℹ tests 85 / pass 85 / fail 0
```

12 + 17 + 8 + 14 + 20 = **71**；995 − 71 = **924**，与 README/JF02/JF05/JF04 §6 的“995 = 924 + 71”口径一致。相比复审时（67 项、991），增量恰为 JF04 +4（C11/C12/C13/C14）。

### 2.3 定点用例与打包门禁

```text
$ node --test --test-name-pattern='C10|C12|C13|C14' tests/week3-account-close-chain.test.js
✔ JF04-C10 a stored completed row is reported as stored, an unknown state fails closed
✔ JF04-C12 close never queries with where() inside the cloud transaction
✔ JF04-C13 a legacy account without a journal layout cannot be closed yet
✔ JF04-C14 a retried close never overwrites a job the executor already advanced
ℹ tests 4 / pass 4 / fail 0

$ node --test tests/cloud-bundle-defaults.test.js
ℹ tests 1 / pass 1 / fail 0
```

### 2.4 范围与依赖

```text
$ git diff --name-only
cloudfunctions/moodsky/services/account-candidate.js
miniprogram/modules/account/service.js

$ git diff --name-only -- miniprogram/
miniprogram/modules/account/service.js

$ git status --porcelain -- shared/ cloudfunctions/moodsky/index.js cloudfunctions/moodsky/domains/ database/ package.json package-lock.json
（无输出）
```

## 3 独立探针（自写，`/tmp`，不复用被审测试内的守卫）

探针一：`/tmp/w3-recheck-probe.js`；探针二（负向对照）：`/tmp/w3-recheck-negctl.js`。二者自建 Proxy 守卫——**任何** `tx.collection(...).where` 访问立刻抛错。

### 3.1 D1 事务内无 where，close 仍成功

```text
$ node /tmp/w3-recheck-probe.js
D1 close.ok: true
D1 close.error: null
D1 jobId: "12de9b80858b671c8419e192b267c0be"
D1 jobCount: 1
D1 account.status: "disabled"
D1 tx.where_hits: []
D1 job.state: "pending"
D1b root where lookup (preferences get): {"ok":true,"data":{"cardTextPreview":false,"decorationsEnabled":true,"updatedAt":null}}
D1b root query calls: 1
```

负向对照（证明守卫真的会响，不是空守卫）：

```text
$ node /tmp/w3-recheck-negctl.js
NEGATIVE-CONTROL: guard fired -> PROBE-GUARD: where() inside transaction
ROOT-WHERE: repository.getOrCreateAccount -> {"id":"account_alpha","status":"active"} queryCalls= 1
```

结论：在被禁 `where` 的事务上 close 成功、账号 `disabled`、恰好 1 个 job、`state:'pending'`；根级 `where`（`repository.getOrCreateAccount` 的 lookup，以及 router 前置解析）不受影响。

### 3.2 D2 行内 progress 如实回显 / 非法即 CONFLICT

```text
D2 stored progress echoed: {"ok":true,"progress":{"task_history":7,"preferences":2},"state":"processing"}
D2 invalid progress string:   {"ok":false,"code":"CONFLICT","message":"清理进度尚不可确认。"}
D2 invalid progress negative: {"ok":false,"code":"CONFLICT","message":"清理进度尚不可确认。"}
D2 invalid progress array:    {"ok":false,"code":"CONFLICT","message":"清理进度尚不可确认。"}
D2 invalid progress fraction: {"ok":false,"code":"CONFLICT","message":"清理进度尚不可确认。"}
D2 invalid progress nested:   {"ok":false,"code":"CONFLICT","message":"清理进度尚不可确认。"}
```

### 3.3 D3 真实客户端构造器 → router 全链路（不触网）

```text
D3 close request payload: {"confirm":"CLOSE"}
D3 close via client: {"ok":true,"status":"disabled","jobState":"pending"}
D3 cleanupStatus via client+router: {"ok":true,"jobId":"12de9b80858b671c8419e192b267c0be","state":"pending","progress":{}}
D3 api.call replaced (netCalls): 1
```

`api.call` 被本地替身替换后直接喂给 router（netCalls=1 即一次本地路由，无网络）；`api.createRequest` 只构造并 `validateRequest` 信封，不发请求（`miniprogram/services/api.js:21-43`）。

### 3.4 D8 completed / failed 不被覆写，pending 复用

```text
D8 completed: {"outcome":{"ok":false,"code":"CONFLICT"},"storedState":"completed","storedProgress":{"task_history":3},"storedTotalDeleted":3,"account":"active","jobCount":1}
D8 failed:    {"outcome":{"ok":false,"code":"CONFLICT"},"storedState":"failed","storedProgress":{"task_history":3},"storedTotalDeleted":3,"account":"active","jobCount":1}
D8 pending reuse: {"ok":true,"sameJob":true,"jobCount":1,"state":"pending"}
```

## 4 逐条结论

| id                                             | 结论         | 证据（file:line / 命令 / 探针）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** 事务内 `where()`（高）                  | **已修复**   | close 事务改用确定性文档读取：`account-candidate.js:168-173`（jobId=sha256 前 32 位）、`:186-188`（`tx.collection('cleanup_jobs').doc(jobId).get()`）、`:200-212`（set）、`:214-224`（update + `changed`）；全文件 `grep -n 'where('` 仅命中注释 `:183`。C12（`tests/week3-account-close-chain.test.js:442-450`）把“事务替身禁止 where”固化。**本次自写守卫探针**：关闭成功、账号 disabled、1 job、`where_hits=[]`；负向对照证明守卫可抛错；根级 where 仍可用。                                                                                                                                                                                                                       |
| **D2** 进度恒空（中）                          | **已修复**   | `readProgress`（`account-candidate.js:323-339`）校验“非空键名 + 非负安全整数”，`:383-387` 仅在 guard 就绪（`exportAccessRevoked===true`）时回显。探针：`{task_history:7,preferences:2}` → 原样回显；字符串/负数/数组/小数/字符串计数 → **CONFLICT**（非空 map）。C11（`:421-440`）覆盖。                                                                                                                                                                                                                                                                                                                                                                                              |
| **D3** 客户端 close/cleanupStatus 缺字段（中） | **已修复**   | `miniprogram/modules/account/service.js:9`（`confirm='CLOSE'`）、`:11-12`（`{jobId, receipt}`）；探针用**真实客户端构造器**跑 router：close ok / disabled / pending，cleanupStatus ok 且 jobId 一致。P08 的 `api.call` 确为替身（`week3-preference-contract.test.js:134-145` 保存并替换 `api.call`，`:137-140` 返回内存值）；即便漏替换，真实 `api.call` 在 `cloudEnabled!==true` 时直接抛错（`miniprogram/services/api.js:74-79`），不会触网。改动范围：`git diff --name-only -- miniprogram/` 仅 `service.js`。                                                                                                                                                                     |
| **D4** 旧账号无布局无法注销（中）              | **部分修复** | 行为未改（设计如此）：`stores/account-transaction.js:37-39` 无 `journalLayout` → `NOT_IMPLEMENTED`；C13（`tests/week3-account-close-chain.test.js:452-461`）真实断言 `NOT_IMPLEMENTED` + 账号仍 `active` + **0 job**（实跑通过）。文档：JF04 §6 修订表已列为阻塞（`w3-jf04-close-chain.md:118`）、`docs/week3/Jiawei_Fang/README.md:38` 列入阻塞。**但**仍未写进 JF04 §5 阻塞清单本体，也未给“影响范围 + 替代路径（回填布局 / 布局无关的注销事务）”，只写“待定案”。                                                                                                                                                                                                                   |
| **D5** completed 永久 CONFLICT（低）           | **已修复**   | `REPORTABLE_JOB_STATES`（`account-candidate.js:47-52`）含 `completed/failed`，`:371-376` 仅对未知状态 fail closed；C10（`:378-419`）断言 completed 如实上报、未知 `expired` → CONFLICT；修订表 `w3-jf04-close-chain.md:119` 记录。残余：未上报 `totalDeleted`（当前执行器未接线，未违反“不编造”）。                                                                                                                                                                                                                                                                                                                                                                                   |
| **D8** 可能覆写 completed job（低）            | **已修复**   | `account-candidate.js:192-196`：行状态不在 `OPEN_JOB_STATES(['pending','processing'])` 即 CONFLICT，且该判定在 `set()`/`update()` 之前。探针：completed/failed 行 → CONFLICT，行内 `state / progress{task_history:3} / totalDeleted:3` 原样保留、账号仍 active、jobCount 仍 1；pending 行 → 复用且不新增。C14（`:463-496`）断言一致。                                                                                                                                                                                                                                                                                                                                                 |
| **D9** JF01 失败码漏 INVALID_INPUT（低）       | **未修复**   | 实测：`resolveAccount('bad openid!')` → `THROWN INVALID_INPUT`（经 `repository.js:50` → `storage-support.identity`）。但 `w3-jf01-account-layout.md:17-23` 失败码表、`:65` 失败码约定均**无 INVALID_INPUT**；`grep -n INVALID_INPUT docs/week3/Jiawei_Fang/w3-jf01-account-layout.md` 零命中。                                                                                                                                                                                                                                                                                                                                                                                        |
| **D6** 文档计数/证据归属（低）                 | **部分修复** | 主体正确：`README.md:22`、`w3-jf02-state-table.md:174`、`w3-jf05-data-capability.md:175` 均为 995 = 924 + 71（12/17/8/14/20），与 §2 实测一致；“37 项”已改为“JF02 17 + JF05 20 合计 37，不互相计入”，不再混算。**余项**：`w3-jf01-account-layout.md:88` 仍写“含本任务的 **22 项**”（JF01 实为 12，且所引 JF04 §4 显示 991）；`w3-jf04-close-chain.md:71-76,94-96` 仍保留 81 / 22（“JF04 10”）/ 991 的旧运行，与同文件 `:80-85` 的 995、“JF04 14”自相矛盾；P04 证据归属未按建议改述（`w3-jf02-state-table.md:85` 仍把“拒绝私人筛选字段”记在 P04 名下，而实际抛错来自测试注入替身 `tests/week3-tasks-adapters.test.js:176-183`，真实下行拒绝在 `services/task-suggestions.js:49-56`）。 |
| **D7** 链接悬空（低）                          | **已修复**   | `docs/week3/Jiawei_Fang/README.md:23` 指向 `docs/test-reports/2026-10-30-week3-jiawei/README.md`，目标现存在（38729 B）。注意：该引用是行内代码而非 Markdown 链接，且 `docs/week3/Jiawei_Fang/*` **不在** `scripts/check-docs.js` 的 16 份 maintained 清单内（`check-docs.js:5-22`），`docs:check` 不覆盖它——可达性依赖人工核对。                                                                                                                                                                                                                                                                                                                                                     |

## 5 关键代码与断言核对（非“看起来对”）

- **原子性**：job 写入、账号 `disabled`、围栏推进都在 `transactions.withOwner`（`account-candidate.js:181-229`）的回调内；任一步抛错整体回滚，catch 只把**非 AppError**转成 CONFLICT（`:230-237`），不会把 `ACCOUNT_DISABLED / NOT_IMPLEMENTED` 吞掉。C05/C06 实测“失败后无 job、账号 active、可重试”。
- **一个账号一个 job 槽位**：`cleanupJobId`（`:168-173`）与路由 `ACCOUNT_DISABLED` 门禁 + `withOwner` 的 `status==='active'` 前置（`account-transaction.js:34-36`）三重保证；C04 实测第二次 close 被拒且 job 仍 1。
- **cleanupStatus 只读回执绑定的那一行**：payload.jobId 必须等于 claim（`account-candidate.js:351-356`），读回后再核对 `_id` 与 `ownerId`（`:367-370`）；`readCleanupJob` 用 `doc().get()` 而非 `where`（`account-adapters.js:58-69`）。C08 交叉回执均 FORBIDDEN。
- **回执不是登录**：router 只对 `access==='receipt'` 的动作走回执（`router.js:82-87`）；C09 实测带合法回执访问 `account.preferences` 仍 `UNAUTHENTICATED`。
- **测试未被削弱**：本轮只改 2 个测试文件，且都是**加强**——close-chain 由 10 → 14 项（新增 C11—C14，C12 为平台约束守卫）；P08 由“把 INVALID_INPUT 记为通过”改为断言真实 `ok / disabled / pending` 并核对 `{jobId, receipt}` 信封。其余 3 个测试文件 mtime 02:10—02:13，未动。

## 6 残余风险与阻塞

1. **真云事务语义仍未验证（不可本地消除）**：`doc(jobId).get()` 在**文档不存在**时的返回形状是本次修复的新依赖。本地替身返回 `{data:null}`；仓库内已有同构先例（`stores/transactional-tasks.js:154,175` 在事务内读可能不存在的 `request_receipts / task_history`），但**首次 close 必然走“job 不存在”分支**，需在具备云授权时**第一优先**复验；若平台抛“文档不存在”，则 close 全部转 CONFLICT。
2. **`stats.updated !== 1` 的云端形状未验证**：`account-candidate.js:218` 依赖事务内 `update` 返回 `{stats:{updated:1}}`；本地替身满足，真实 SDK 未复验（同属 §6.1 的云端复验项）。
3. **where 守卫只固化了本用例**：C12 的守卫写在测试文件内，`tests/helpers/w2-database.js`（02:02，未改）仍允许事务内 `where`；其他模块若再引入同类调用不会被通用替身拦住。建议后续把“事务内禁 where”下沉到共享替身。
4. **D9 未修复**：JF01 失败码表缺 `INVALID_INPUT`（非空非法 openid 的真实行为）。
5. **D6 余项**：JF01:88 的“22 项”、JF04 §4 的 81/22/991、“JF04 10”与 995/14 自相矛盾；P04 证据归属未改述。
6. **D4 表述不足**：旧账号“不能注销”的影响范围与替代路径仍未写，也未进 JF04 §5 阻塞清单。
7. **PR_BODY 与事实冲突**：`PR_BODY.md:17` 写“未改：… `miniprogram/` …”，而 `miniprogram/modules/account/service.js` 已被修改（同一文件 `:31` 又承认该跨范围修改）。属**披露不一致**，应改。
8. **JF04 §2 表述过期**：`w3-jf04-close-chain.md:36` 仍写“progress … 值恒为 `{}`”，与 C11 及新代码矛盾（现为“回显行内已存储计数”）。
9. **仍未覆盖**：真实云/签名密钥/清理执行器/Me 页面真机；`totalDeleted` 未上报；“回执归属账号”仍依赖派发绑定（JF04 §5.4 已自述）。

## 7 复核结论

**有条件通过。**

- **代码层面通过**：D1、D2、D8 三项由**独立探针 + 负向对照 + 真实用例**共同证实（不是只看代码），D3 由真实客户端构造器经 router 全链路证实（不触网），D5 的永久 CONFLICT 已解除。995/995、门禁全绿、打包门禁 1/1、无新增依赖、diff 仅 2 个已跟踪文件。
- **放行前须完成（均为文档，不改业务代码）**：
  1. 补 D9：JF01 §1 失败码表 / §3 失败码约定加 `INVALID_INPUT`（非空但格式非法的 openid）；
  2. 清 D6 余项：JF01:88 的“22 项”，JF04 §4 的 81 / 22（JF04 10）/ 991 → 85 / 26 / 995 / 14，P04 证据改述为“下游公开服务拒绝”（或补一条用真实 `task-suggestions` 的断言）；
  3. 修 `PR_BODY.md:17`：把 `miniprogram/modules/account/service.js` 计入“修改”并标注 Linghan 复核；
  4. 改 `w3-jf04-close-chain.md:36`：progress 不再“恒为 `{}`”，而是回显行内已存储的非负整数映射，损坏即 CONFLICT；
  5. 补 D4：在 JF04 §5 写清“旧账号不能注销”的影响与替代路径（或明确排期）。
- **不具备放行条件但也不阻断本次的**：真实云事务语义（§6.1/6.2）需云授权单独复验；本报告任何“通过”仅指本地合成环境可复现，不代替云端、真机或独立验收人结论。

## 8 复现命令

```bash
cd C:/Users/lenovo/DSH/Karl/kar/MoodSky-repo
git status --porcelain=v1 && git diff --stat && git diff --name-only
npm run check
node --test tests/week3-*.test.js
node --test tests/week3-account-adapters.test.js
node --test tests/week3-tasks-adapters.test.js
node --test tests/week3-preference-contract.test.js
node --test tests/week3-account-close-chain.test.js
node --test tests/week3-account-data.test.js
node --test --test-name-pattern='C10|C12|C13|C14' tests/week3-account-close-chain.test.js
node --test tests/cloud-bundle-defaults.test.js
node /tmp/w3-recheck-probe.js      # 自写探针（D1/D2/D3/D8）
node /tmp/w3-recheck-negctl.js     # 负向对照：事务内 where 必抛
```
