# MoodSky 第二周 Jiawei Fang 复审缺陷修复 —— 独立复核（w2-recheck）

- 复核角色：w2-recheck。**未参与修复**，只依据最终仓库状态与实跑命令判断，不采信任何“已修复”声明。
- 复核纪律：未修改任何源码、测试或他人文档正文；仓库内唯一新增文件即本文件。D1 探针位于系统临时目录（`%TEMP%\w2recheck-probe-d1*.js`），不进入仓库。
- 复核对象：`cloudfunctions/moodsky/{index.js,domains/account.js,domains/tasks.js,stores/account-store.js,identity.js}`、`tests/week2-*.test.js`、`tests/foundation-transport.test.js`、`docs/week2/Jiawei_Fang/*.md`。
- 对照基准：`docs/test-reports/2026-10-24-week2-jiawei/README.md`（原复审报告，3 medium + 7 low）。

---

## 1. 快照

| 项目     | 值                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分支     | `week2/jiawei-fang`                                                                                                                                  |
| HEAD     | `ecf0c2d`（docs: integrate Jiawei week-one account and task proposals (#16)）                                                                        |
| 工作区   | 快照时全部改动未提交：**5 个已跟踪修改 + 18 个未跟踪路径**（`git status --porcelain -uall` 共 23 行）；Lead 随后提交为 `c5480fc`（本地分支，未推送） |
| diff     | `git diff --stat` = 5 files changed, 778 insertions(+), 9 deletions(-)                                                                               |
| Node     | `v24.15.0`                                                                                                                                           |
| 包版本   | 0.2.0（`package.json` 未改，dependencies 为空，devDependencies 仍 esbuild/eslint/prettier 三项）                                                     |
| 执行时间 | 2026-10-24T10:17 — 10:26（+08:00）                                                                                                                   |

被复核文件 sha256 前 16 位（钉住本次结论对应的版本；与 01:17 复审时点相比 account/tasks/index/account-store 已变，identity/router 未变）：

```
aed562a1041b27d3  cloudfunctions/moodsky/domains/account.js
1d204b9866ac49b5  cloudfunctions/moodsky/domains/tasks.js
f354371dc1c38f37  cloudfunctions/moodsky/index.js
c465526abab86243  cloudfunctions/moodsky/stores/account-store.js
2794dfae70ca9473  cloudfunctions/moodsky/identity.js
2e4497a733b5c45d  cloudfunctions/moodsky/router.js
```

`git status --porcelain -uall` 摘要：

```
 M cloudfunctions/moodsky/domains/account.js
 M cloudfunctions/moodsky/domains/tasks.js
 M cloudfunctions/moodsky/index.js
 M cloudfunctions/moodsky/router.js
 M tests/foundation-transport.test.js
?? cloudfunctions/moodsky/identity.js
?? cloudfunctions/moodsky/stores/account-store.js
?? cloudfunctions/moodsky/stores/tasks-store.js
?? docs/test-reports/2026-10-24-week2-jiawei/README.md
?? docs/week2/Jiawei_Fang/{PR-body,README,w2-jf01..w2-jf05}.md
?? tests/week2-account-close.test.js          ?? tests/week2-account-identity.test.js
?? tests/week2-account-preferences.test.js    ?? tests/week2-entry-wiring.test.js
?? tests/week2-tasks-history.test.js          ?? tests/week2-tasks-suggestions.test.js
?? tests/week2-tasks-transition.test.js
```

## 2. 命令实测

### 2.1 全量检查（`npm run check`，退出码未经管道修饰）

```
$ node -v
v24.15.0
$ npm run check > /tmp/w2recheck-check.log 2>&1; echo "EXIT=$?"
EXIT=0
All matched files use Prettier code style!
Structure, 24 requirement IDs, shared contract copy and client access policy passed.
ℹ tests 306
ℹ suites 0
ℹ pass 306
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 725.2207
```

**exit 0 / tests 306 / pass 306 / fail 0**，与任务书给出的基线一致。

### 2.2 逐文件单跑（`node --test <file>` 的 `tests` 行）

| 文件                                    | tests | pass | fail | 对应文档口径                     |
| --------------------------------------- | ----- | ---- | ---- | -------------------------------- |
| tests/week2-account-identity.test.js    | 9     | 9    | 0    | JF01 9                           |
| tests/week2-account-preferences.test.js | 8     | 8    | 0    | JF03 8                           |
| tests/week2-account-close.test.js       | 16    | 16   | 0    | JF04 16                          |
| tests/week2-tasks-transition.test.js    | 22    | 22   | 0    | JF02 转换 22（含 T21/T22）       |
| tests/week2-tasks-history.test.js       | 12    | 12   | 0    | JF02 历史 12                     |
| tests/week2-tasks-suggestions.test.js   | 6     | 6    | 0    | JF02 建议 6                      |
| tests/week2-entry-wiring.test.js        | 3     | 3    | 0    | 入口装配 3                       |
| tests/foundation-transport.test.js      | 11    | 11   | 0    | 入口改动后的既有基础测试仍 11 项 |

全仓 31 个测试文件逐文件求和 = **306**；非 week2 文件合计 = **230**；week2 新增 = 9+8+16+22+12+6+3 = **76**，与 README.md:22「基线 230 + 新增 76」自洽。

### 2.3 D1 独立探针（`%TEMP%\w2recheck-probe-d1b.js`，只 require 生产模块）

```
$ node w2recheck-probe-d1b.js
defaults: { cardTextPreview: false, decorationsEnabled: true }
realStore:  a={card:true,dec:true}  b={card:true,dec:false}
            stored={card:true,dec:false}  get={card:true,dec:false}  prefRows=1
            patchCalls=[["cardTextPreview"],["decorationsEnabled"]]
prefixShape（反证用旧“整行读改写”替身）:
            a={card:true,dec:true}  b={card:false,dec:false}
            stored={card:false,dec:false}
probeCatchesLostUpdate=true
rounds20:  rounds=20 lost=0  finalRow={card:false,dec:true}
EXIT=0
```

要点：探针先在**旧形状**（读整行→内存合并→回写整行，故意加 tick 交错）上复现了丢失更新（card 从 true 被覆盖回 false，且 b 的响应报出 `card:false`），证明探针具备区分能力；同一探针对真实 store 判 0 丢失。云实现探针（`w2recheck-probe-d1-cloud.js`，wx-server-sdk 形状替身）另测得：

```
E1 已有行：update 载荷 keys=["decorationsEnabled","updatedAt"]，另一字段 cardTextPreview 保持 true
E2 并发首写（唯一键冲突路径）：最终 {card:true,dec:true}，preferences 仅 1 行；后手 update 只含自己字段
E3 冲突 + 回查仍为空：抛 DUPLICATE_KEY，preferences 0 行（不臆造行）
EXIT=0
```

## 3. 逐条验证

### D1 偏好并发丢失（medium）— **已修复**

代码证据：

- `domains/account.js:95-119`：`set` 只把本次出现的字段汇成 `patch`（:96-105），不再先读整行；直接 `store.updatePreferences(accountId, patch, clock)`（:112），响应由 `saved`（落库后的行）构造（:115-119）。
- `stores/account-store.js:183-196`：内存实现 `Object.assign(row, patch, {updatedAt})`，只写 patch 字段；首写 `{ownerId, ...DEFAULT_PREFERENCES, ...patch}` 只补默认（:192）。整段包在 `withPreferenceLock`（:185）内。
- `stores/account-store.js:91-113`：owner 级串行闸（`tails` Map + gate），按 ownerId 排序，完成后清理表项。
- `stores/account-store.js:337-361`：云实现已有行时 `update({...patch, updatedAt})`（:340）；首写 DEFAULT 合并（:344）；唯一键竞争失败后回查再只写本字段（:354-359），回查为空则重抛（:355-357）。

测试与探针：

- `tests/week2-account-preferences.test.js:150-186`（P08）：`Promise.all` 两个部分 set（`cardTextPreview:true` / `decorationsEnabled:false`，正好与默认值相反，具区分度），断言两字段都保留、仅 1 行、各响应“本次写入字段”=库内值、get 回读一致 —— 非空断言。
- 2.3 探针：真实 store 20 轮并发交替 set，`lost=0`；旧形状同探针可检出丢失，说明通过不是“看起来对”。

结论：字段级写入 + owner 串行 + 首写 DEFAULT 合并 + 响应取落库值四点成立。**已修复**。

### D2 清理任务创建失败（medium）— **已修复**

代码证据：`domains/account.js:151-166` —— 先 `findOpenCleanupJob`，`insertCleanupJob` 抛错时 `throw new AppError(ERROR_CODES.CONFLICT, RETRY_MESSAGE)`（:165）；`setAccountStatus` 在其后（:170-175），因此账号仍为 active、0 job、无 `setAccountStatus` 调用。

测试证据：`tests/week2-account-close.test.js:370-392`（C16）注入 `insertCleanupJob` 抛错，断言 `ok:false`、`code==='CONFLICT'`、`message==='注销暂未完成，请重试。'`、账号 `ACTIVE`、`cleanupJobs.length===0`、`requestReceipts.length===0`、`setAccountStatus` 调用数 0（:381），并验证重试后成功且只有 1 个 pending job。**非空断言，且覆盖了原报告指出的“零覆盖”分支。**

结论：错误码由 INTERNAL_ERROR 收敛为 CONFLICT，行为与断言一致。**已修复**。

### D3 入口装配异常被永久吞掉（medium）— **已修复**

代码证据：

- `index.js:16-18`：`isMissingModule` 只认 `error.code === 'MODULE_NOT_FOUND'`。
- `index.js:56-67`：模块缺失才回退（:57-62，返回**新建**的未接线路由，不写缓存）；其余异常 `console.error('[moodsky] router wiring failed', error.name, error.code)`（:65，只记类名与错误码，不含 payload/OPENID）后 `throw error`（:66）。
- `index.js:36,55`：`wiredRouter` 仅在装配成功时赋值，失败路径不置任何“永久不可用”标记；`index.js:23-29` 在 `cloud.database` 不可用时每次现建路由，同样不缓存失败。

测试证据：`tests/week2-entry-wiring.test.js:85-114`（WIRING-02）注入构造器抛 `name='SyntheticWiringError'/code='E_WIRING'`，用 `assert.rejects` 断言**异常原样抛出**（:104-107），并断言日志仅 1 条且含类名/错误码、不含 `trusted_openid|OPENID|payload 日期`（:108-113）；`:72-83`（WIRING-01）验证 MODULE_NOT_FOUND 回退且不打日志；`:116-147`（WIRING-03）验证第一次缺失回退、第二次成功（`attempts===2`），证明无进程级失败缓存。**确实覆盖“普通异常必须抛出”，不是只测回退。**

`tests/foundation-transport.test.js` 改动（`git diff` 全文 1 处）：仅把替身对未列依赖抛的 `new Error(...)` 改为带 `code='MODULE_NOT_FOUND'` 的异常（:53-58），**未删任何原断言**；`assert.deepEqual(f.observations.unexpectedRequires, [])` 仍在 `tests/foundation-transport.test.js:183`，该文件仍 11/11 通过。该改动是必需的接口对齐（否则一切 require 失败都会被视为“真实装配错误”而重抛），不是放宽。

结论：**已修复**。

### D4 close 响应字段（low）— **已修复**

代码：`domains/account.js:183-185` → `sessionRevoked:false`、`sessionRevocation:'not_implemented'`、`privateActionsDenied:true`。

测试：`tests/week2-account-close.test.js:110-123` 先断言响应键集合恰含这三个字段（:110-117），再逐字段断言 false / `'not_implemented'` / true；C11 另断言未实现路径不回显 `cleanup_/pending/disabled`。

文档：`docs/week2/Jiawei_Fang/w2-jf04-close-cleanup-gate.md:21,65-67,73,142,157` 全部写 false/not_implemented/true 并说明「无会话表、不得据此显示已退出登录」；`PR-body.md:30` 一致；全仓 grep 无任何文档再写 `sessionRevoked: true`（仅原复审报告在描述旧缺陷，属历史记录，未改）。

结论：代码、测试、文档三方一致。**已修复**（新增 `sessionRevocation` 字段属附加字段，契约需 Xiang Hong 最终确认，见 §4）。

### D6 终态 replace 回放（low）— **已修复**

代码：`domains/tasks.js:296-318` 回放分支在 `name==='replace'` 时补 `replayed.replacementTaskId = todaysReplacement(states, taskId)` 与 `replacementState = TASK_STATUS.SELECTED | null`（:303-307），无法唯一确定时报 null 而非猜测（`todaysReplacement`，:353-358）。

测试：`tests/week2-tasks-transition.test.js:358-388`（T21）断言首次 `replacementTaskId===SECOND`；同目标回放 `replayed:true` 且带 `replacementTaskId===SECOND`、`replacementState==='selected'`；用**另一个**目标回放时仍返回已落库的 SECOND（不回显 payload 的 THIRD）。`:390-406`（T22）构造当日有两个 selected 行，断言回放 `replacementTaskId:null` / `replacementState:null`。

形状一致性：首次响应 `{taskId,date,state,replacementTaskId,replacementState,replayed:false}`，回放 `{...同五键..., replayed:true}`，键集合一致。

结论：**已修复**。

### D10 唯一键冲突但回查为空（low）— **已修复**

代码：`identity.js:154-168` —— 仅 `isDuplicateKeyError` 时回查（:161-163），回查为空返回 null（:165），由路由 fail closed 为 UNAUTHENTICATED；其他错误重抛。

测试：`tests/week2-account-identity.test.js:290-315`（W09）真实注入：`insertAccount` 抛 `code='DUPLICATE_KEY'`、`findAccountByOpenid` 恒返 null；断言 `ok:false`、`code==='UNAUTHENTICATED'`、`message==='账号尚未就绪。'`、插入仅 1 次、读取 2 次、`accounts.length===0`、`store.calls.length===0`。**断言落在数据与错误码上，非空断言。**

结论：**已修复**。

### 文档一致性 — **一致**（2 处措辞保留意见，不阻塞）

数字逐项实测比对：

| 文档声明                 | 文档位置                                | 实测                       | 判定 |
| ------------------------ | --------------------------------------- | -------------------------- | ---- |
| npm run check 306 项全过 | README.md:22、w2-jf05:64、PR-body:22    | 306 / exit 0               | 一致 |
| 基线 230 + 新增 76       | README.md:22                            | 306−76=230，逐文件求和 306 | 一致 |
| JF01 9                   | README.md:23、w2-jf01:25、w2-jf05:64,69 | 9                          | 一致 |
| JF02 40（6/22/12）       | README.md:23、w2-jf02:22、w2-jf05:64,69 | 6+22+12=40                 | 一致 |
| JF03 8                   | README.md:23、w2-jf05:64,69             | 8                          | 一致 |
| JF04 16                  | README.md:23、w2-jf05:64                | 16                         | 一致 |
| 入口装配 3               | README.md:23、w2-jf01:25、w2-jf05:64    | 3                          | 一致 |
| account 三文件合计 33    | w2-jf05:69、PR-body                     | 9+8+16=33                  | 一致 |

（`w2-jf02:22` 另提“提交时 268 项”属历史过程值，已明确标注为“随后/按复审意见修复后 306”，不构成当前口径错误。）

十项元数据：jf01/jf03/jf04/jf05 表头均含 任务编号/关联需求/协作人/复核人/版本/环境/成果路径/实际耗时/验收状态/阻塞；jf02 以「真实云验证 | **阻塞**」承载“阻塞”一项（内容在，标签不同），其余九项齐备。「实际耗时」5 处均为「待本人确认（不代填）」。

未实现是否被写成已完成：无。5 份文档验收状态仍为「待复核」，JF04/JF05 明确清理执行器、真实云、回执密钥、联合复核为阻塞；D7「JF01 30 项」已删除并在 w2-jf05:69 说明来源；D8「接线只覆盖 account 域」已改为 account+tasks 两域（w2-jf01:71,133），grep 无残留。全仓无“已验收”。

保留意见（low，非阻塞）：

1. `w2-jf02:22,170` 用「提交时 / 本任务完成时」表述，但工作区实际未提交（README.md:6 写明「未提交、未推送」），措辞易误读为已有提交。
2. `sessionRevocation` 是本次新增的响应字段，属契约增量，需 Xiang Hong 在接口口径复核时确认，文档已自述语义。

### 范围检查 — **符合**

- `git status --porcelain -uall` / `git diff --name-only`：改动仅 `cloudfunctions/moodsky/{domains/account.js,domains/tasks.js,index.js,router.js}` 与 `tests/foundation-transport.test.js`；新增仅 identity/stores/两个 week2 文档目录/7 个 week2 测试。
- 未改 `shared/`、`miniprogram/`、`adapters.js`、`database/`（针对这些路径的 `git status` 输出为空）。
- 无新增依赖：`package.json` 未在改动列表，`dependencies` 为空，devDependencies 仍三项；无 lock 文件改动。
- 未新增“测试后门”进入生产：生产装配点仍只有 `index.js:30-54`。

## 4. 残余风险与阻塞

| 项                                                  | 现状（证据）                                                                                             | 是否仍为阻塞                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 真实云唯一键并发首建（accounts/preferences）        | `database/collections.json:5,29` 声明 uniqueKeys，但本地只验证“云形状替身”；真云授权未获得（w2-jf05:15） | **是**（延续原报告 §5，非本次缺陷）    |
| `cleanup_jobs` 无唯一键                             | `database/collections.json:71`（uniqueKeys 空）+ `account-store.js:16-18` 自述 read-then-insert 竞态     | **是**（R2，需数据库变更，Xiang Yu）   |
| `task_history` 无唯一键 + 云 `withOwnerLock` 空实现 | `database/collections.json:59`；`stores/tasks-store.js:201`（空实现）                                    | **是**（D9，真云联调前必须关闭）       |
| 回执 claims 无 iat/accountId/一次性标记             | `identity.js:68-71` 仍只有 `{p,j,exp}`；PR-body 明确 D5 未解决                                           | 否（原报告列为“建议同批、不阻塞合入”） |
| `CLOUD_RECEIPT_SECRET` 未配置                       | w2-jf04:15 阻塞；C05 验证无密钥 fail closed                                                              | **是**（生产签发前置）                 |
| 清理执行器未接通                                    | `domains/account.js:227-228` 注释明确不返回 progress；w2-jf05:55                                         | **是**（完整注销不可达）               |
| 联合复核 X05—X12 未执行                             | w2-jf05:22,65 如实登记「未执行」「联合复核人未参与」                                                     | **是**（验收签字前置）                 |

另记观察（low，不影响上述结论）：

- `domains/account.js:151` 的 `findOpenCleanupJob` 在 D2 的 try 之外；该调用自身抛错会以未捕获异常（500）返回，D2 只覆盖 `insertCleanupJob` 失败。计划要求的用例已覆盖，属额外加固点。
- 内存 owner 锁只在单进程有效；云端靠“字段级写入 + 唯一键回查”，跨实例不依赖锁，语义成立但真云未验证（同上表）。

## 5. 复核结论

**通过（就本轮“复审缺陷修复”而言）**。

- 原报告 3 个 medium（D1/D2/D3）与要求同批处理的 D4/D6/D7/D8/D10 全部关闭，每条均有 file:line 证据 + 实跑命令/探针输出，不依赖“代码看起来对”。
- D1 由可区分探针双向验证（旧形状能复现丢失更新，新实现 20 轮 0 丢失，且响应不再谎报）；D2/D10 用例为真实注入且断言数据面；D3 用例实测“普通异常抛出 + 只记类名/码 + 不缓存失败”；D6 回放响应形状与首次一致；D4 代码/测试/文档三方一致。
- 全量 `npm run check` exit 0、306/306/0，逐文件数字与五份文档口径完全吻合；范围未越界（未改 shared/miniprogram/adapters/database、无新增依赖）。

**不作为本次不通过的理由、但必须在验收前关闭的阻塞**：真实云唯一键与错误形状、`cleanup_jobs`/`task_history` 唯一性、`CLOUD_RECEIPT_SECRET`、清理执行器、联合复核 X05—X12（均已在文档中如实登记为阻塞，且不属本轮修复范围）。D5（回执 claims）仍为已披露待确认项。
