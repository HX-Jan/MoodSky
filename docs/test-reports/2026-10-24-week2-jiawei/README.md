# MoodSky 第二周 Jiawei Fang（JF01—JF05）独立复审报告

- 复审角色：w2-audit（独立验证与对抗式复审）。**未参与实现，未读过作者推理过程，只读最终仓库状态**。
- 复审纪律：本报告作者**未修改任何源码、测试或他人文档正文**；仓库内唯一新增文件即本报告。
- 复审对象：`cloudfunctions/moodsky/{identity.js,index.js,router.js,domains/account.js,domains/tasks.js,stores/account-store.js,stores/tasks-store.js}`、`tests/week2-*.test.js`（6 个文件）、`docs/week2/Jiawei_Fang/*.md`（7 个文件）。
- 依据：`MoodSky_第二周详细任务计划_20261017.docx` 的「1 共同要求」与「Jiawei Fang 第二周任务」两节；`docs/week1/Jiawei_Fang/w1-jf02-task-contract.md` §3 状态表。

---

## 1. 环境与提交

| 项目     | 值                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分支     | `week2/jiawei-fang`                                                                                                                                  |
| 基线提交 | `ecf0c2d37e9a5502c57937cf8695e2a8b53b3961`（docs: integrate Jiawei week-one account and task proposals (#16)）                                       |
| 工作区   | **全部改动未提交**（4 个 M + 9 个新文件，另加 docs/week2 下 7 份文档，见下）；`git diff --stat` = 4 files changed, 732 insertions(+), 8 deletions(-) |
| Node     | `v24.15.0`                                                                                                                                           |
| 执行时间 | 2026-10-24T01:07 — 01:17（+08:00）                                                                                                                   |
| 包版本   | `0.2.0`（`package.json` 未改；计划文档中的 0.2.1 为 10-17 口径，非本周成果）                                                                         |

```
 M cloudfunctions/moodsky/domains/account.js
 M cloudfunctions/moodsky/domains/tasks.js
 M cloudfunctions/moodsky/index.js
 M cloudfunctions/moodsky/router.js
?? cloudfunctions/moodsky/identity.js
?? cloudfunctions/moodsky/stores/account-store.js
?? cloudfunctions/moodsky/stores/tasks-store.js
?? docs/week2/            (Jiawei_Fang/*.md)
?? tests/week2-account-close.test.js
?? tests/week2-account-identity.test.js
?? tests/week2-account-preferences.test.js
?? tests/week2-tasks-history.test.js
?? tests/week2-tasks-suggestions.test.js
?? tests/week2-tasks-transition.test.js
```

被审文件的 sha256 前 16 位（复审时点快照，用于确认结论对应哪一版）：

```
2794dfae70ca9473  identity.js
3c49c4f240fa50e1  stores/account-store.js
fbcabce641eb6fc5  stores/tasks-store.js
9817a203e50b7ba8  domains/account.js
18fc2a7a9925c175  domains/tasks.js
27ac213668c895b5  index.js
2e4497a733b5c45d  router.js
```

> 说明：复审开始（01:07）时 `docs/week2/Jiawei_Fang/` 仅有 4 份文档，01:08—01:09 期间 README.md / PR-body.md / w2-jf05-data-capability.md 方才落盘。本报告以 **01:17 的仓库状态**为准，并在该时点重跑全部命令（见 §2 的两次 check 结果一致）。

---

## 2. 命令与真实输出摘要

### 2.1 `npm run check`（01:08 与 01:17 各跑一次，结果一致）

```
$ npm run check; echo "EXIT=$?"
> npm run lint && npm run format:check && npm run structure:check && npm test
> eslint .                                     (无输出 = 0 问题)
> prettier --check .                           All matched files use Prettier code style!
> node scripts/check-structure.js              Structure, 24 requirement IDs, shared contract copy
                                               and client access policy passed.
ℹ tests 298
ℹ suites 0
ℹ pass 298
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 660.6816
EXIT=0
```

**结论：exit code 0，tests 298 / pass 298 / fail 0**，与「基线 230 + 本周新增 68」一致（298−68=230）。

### 2.2 单文件单跑（要求的两组通配）

```
$ node --test tests/week2-account-close.test.js        → tests 15 / pass 15 / fail 0   EXIT=0
$ node --test tests/week2-account-identity.test.js     → tests 8  / pass 8  / fail 0   EXIT=0
$ node --test tests/week2-account-preferences.test.js  → tests 7  / pass 7  / fail 0   EXIT=0
$ node --test tests/week2-tasks-history.test.js        → tests 12 / pass 12 / fail 0   EXIT=0
$ node --test tests/week2-tasks-suggestions.test.js    → tests 6  / pass 6  / fail 0   EXIT=0
$ node --test tests/week2-tasks-transition.test.js     → tests 20 / pass 20 / fail 0   EXIT=0
```

合计 **68** 项（15+8+7+12+6+20），与 README.md:22-23 的「JF01 8 / JF03 7 / JF04 15 / JF02 38（6/20/12）」完全吻合。

### 2.3 复审自建对抗性探针（不改仓库，脚本在 `/tmp/audit/`，只 require 生产模块）

```
P1 唯一键冲突 + 回查仍为空  → {"ok":false,"error":{"code":"UNAUTHENTICATED","message":"账号尚未就绪。"}} reads=2（未建第二行、未抛未捕获异常）
P2 并发两个部分 set（强制交错）→ A 响应 cardTextPreview:true，最终库内 {"cardTextPreview":false,"decorationsEnabled":false}
P3 终态 replaced 后再 replace(目标 c) → {"state":"replaced","replayed":true}（无 replacementTaskId；行仍为 b=selected）
P4 close 回执 claims → {"p":"cleanup_status","j":"cleanup_1","exp":1792808100}（无 accountId、无 iat）
P5 域级 preferences 无 actor → UNAUTHENTICATED
P6 并发部分 set 丢失更新（同 P2，重复复现）
P7 insertCleanupJob 抛错 → {"ok":false,"error":{"code":"INTERNAL_ERROR"}}，账号仍 active，jobs=0
```

---

## 3. 逐项结论表

### A 身份与门禁（JF01）

| 编号 | 检查点                                                           | 结论                   | 证据                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | OPENID 只来自可信上下文，不读 payload                            | 通过                   | index.js:68 只传 `cloud.getWXContext()`；index.js:64-65 删 `userInfo/tcbContext`；identity.js:141 非空字符串才解析                                                         |
| A2   | payload 带 ownerId/owner/openid/OPENID/role/roles/accountId 被拒 | 通过                   | shared/validation.js:6-14 + :44-46 → `INVALID_REQUEST`；tests/week2-account-identity.test.js:212-233（7 字段 + close 载荷）、week2-tasks-transition.test.js:259-266        |
| A3   | 拒绝发生在任何 store 访问之前                                    | 通过                   | W02/W05 断言 `store.calls` 为空（identity.test.js:179、:225）；router.js:35 校验先于 :41 resolveAccount                                                                    |
| A4   | 首次创建并发只产生一个账号（真并发，非串行冒充）                 | 通过                   | identity.test.js:183-198 用 `Promise.all` 3 路；stub 的 `add` 在 tick 后才查重（:100-111），三路都先读到空再争唯一键 → 确为真交错；accounts 断言 =1                        |
| A5   | 唯一键冲突回查逻辑                                               | 通过                   | identity.js:159-166 捕获 `isDuplicateKeyError` → 回读；account-store.js:37-46 只认 DUPLICATE_KEY/E11000，其他错误重抛                                                      |
| A6   | 「回查仍为空」窗口                                               | 通过（有缺口，见 D10） | identity.js:165 返回 null → router.js:42-43 `UNAUTHENTICATED`（fail closed）；复审探针 P1 实测：不建第二行、不抛未捕获异常。**但无测试覆盖该分支**                         |
| A7   | disabled 在域执行前被拒                                          | 通过                   | router.js:45-47 早于 :69 handler；W04（:200-210）断言 insertAccount 调用为 0；P06/T14 断言 `getPreferences`/history 未被调用                                               |
| A8   | 账号行无内部 id 不能成为 actor                                   | 通过                   | identity.js:110-115 `toIdentity` 要求非空 id；W06（:235-255）                                                                                                              |
| A9   | 无密钥 fail closed（拒绝而非放行）                               | 通过                   | identity.js:38-42 空值视为无密钥；:65-66 issue 返回 null；:79-80 verify 返回 null；C05（close.test.js:161-172）实测 `receipt:null` + `FORBIDDEN`；探针 P4 主张无 accountId |
| A10  | 运营角色不被本地授予                                             | 通过                   | identity.js:133-137 转发 adapters.js；W07（:257-263）未注入→NOT_IMPLEMENTED、空角色→FORBIDDEN                                                                              |

### B 回执安全（JF04）

| 编号 | 检查点                               | 结论                  | 证据                                                                                                                       |
| ---- | ------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| B1   | HMAC 用 timingSafeEqual 常量时间比较 | 通过                  | identity.js:48-52（先比长度再 `crypto.timingSafeEqual`）；:86 调用                                                         |
| B2   | 签名覆盖字段                         | 通过（覆盖不足见 D5） | identity.js:68-74 claims=`{p,j,exp}`；签名段为 base64url(claims)；探针 P4 实测 claims 内容                                 |
| B3   | jobId 校验                           | 通过                  | identity.js:98-100（claims.j 非空）+ :98；domain account.js:208-213 要求 `actor.jobId === payload.jobId`                   |
| B4   | permission 校验                      | 通过                  | identity.js:95-97（`p === cleanup_status`）+ router.js:57-59 双保险；C08（:196-219）异权限→FORBIDDEN 且 `store.calls` 为空 |
| B5   | 过期校验                             | 通过                  | identity.js:101-103；C10（:243-254）到 exp 后 FORBIDDEN，未过期仍可用                                                      |
| B6   | 篡改（签名 / claims）有测试          | 通过                  | C09（:221-241）改末位字符 + 改 j 均 FORBIDDEN，原始回执仍可用（对照）                                                      |
| B7   | 跨任务 / 跨账号不回显                | 通过                  | C11（:256-274）A 回执读 B 的 job → FORBIDDEN，且响应不含 `cleanup_[0-9]                                                    | pending | disabled` |
| B8   | 回执不能当登录、不能复活停用账号     | 通过                  | C12（:276-295）4 个私人动作均 `UNAUTHENTICATED`；再 close 仍 `ACCOUNT_DISABLED`；router.js:55-59 receipt 分支不读 OPENID   |
| B9   | 密钥缺失路径不可绕过                 | 通过                  | 生产只经 index.js:36 注入 signer.verify；identity.js:60-61 每次调用重读 env，无缓存可污染                                  |
| B10  | 顺带泄露面（是否返回账号/正文/进度） | 通过                  | account.js:220-225 只返回 4 字段；C06（:174-187）断言 store 调用仅 `getCleanupJob`                                         |

### C 偏好（JF03）

| 编号 | 检查点                                      | 结论     | 证据                                                                                                                              |
| ---- | ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| C1   | 默认值来自 DEFAULT_PREFERENCES              | 通过     | account.js:24 + :85（无记录直接展开共享常量）；:64-67 行内非布尔回退默认                                                          |
| C2   | 只允许两个布尔字段                          | 通过     | account.js:31 字段表；:71-75 白名单；:100-102 严格 `typeof === 'boolean'`；P04 10 组非法载荷（preferences.test.js:85-106）        |
| C3   | 未知字段 / 错类型 / 空 set → INVALID_INPUT  | 通过     | account.js:58-62、:105-107、:123；P04 覆盖 `{}`、`operation:'update'`、空 set、字符串/0/null/数组、theme/motionEnabled            |
| C4   | 写入以 actor.accountId 为键，绝不取 payload | 通过     | account.js:76 `requireAccountId(actor)`、:49-55 无 id 即 UNAUTHENTICATED；:114 只用 accountId；探针 P5 无 actor → UNAUTHENTICATED |
| C5   | 跨账号真隔离（两个 actor 交叉读写）         | 通过     | P05（:108-127）A 写后 B 读为默认值；`preferences.length===1` 且 `ownerId===alphaId`；payload 带 accountId → INVALID_REQUEST       |
| C6   | 并发写（多设备/连点）                       | **失败** | 见 D1：account.js:108-114 整行读改写无锁，探针 P2/P6 复现丢失更新且响应谎报已存值                                                 |
| C7   | updatedAt 跟随注入 clock                    | 通过     | P07（:139-148）；account.js:114                                                                                                   |

### D 账号注销（JF04）

| 编号 | 检查点                                         | 结论                     | 证据                                                                                                                        |
| ---- | ---------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| D1   | 停用与建清理任务的顺序不产生「已停用但无任务」 | 通过                     | account.js:149-169 —— 先建 job（:152-160）后停用（:165）；停用失败把 job 置 failed（:167）且账号保持 active                 |
| D2   | 失败补偿是否真回滚或有记录                     | 通过（有缺口见 D2 缺陷） | C04（:133-159）实测：job→failed、账号 active、无回执行；重试新建 pending（`cleanupJobs.length===2`，失败行保留）            |
| D3   | 重复调用不产生第二个 job                       | 通过                     | C03（:117-131）第二次 `ACCOUNT_DISABLED`，job 仍 1 个且 id 不变；域级同 requestId 回放 C15（:322-347）                      |
| D4   | 状态如实 pending、不伪造 progress              | 通过                     | account.js:177 用 `job.state`；:218-219 明确不返回百分比；C14（:309-320）连续 3 次 `state==='pending'` 且响应不含 completed |
| D5   | 不把完整注销标为已验收/已完成                  | 通过                     | 响应 4 字段无完成态（C02 :95-105）；docs/week2/Jiawei_Fang/w2-jf04-close-cleanup-gate.md:14 标「待复核；完整注销 阻塞」     |
| D6   | 任务创建失败（计划明确要求的用例）             | **未覆盖**               | 见 D2 缺陷：C04 注入的是 `setAccountStatus` 失败，非 `insertCleanupJob` 失败；探针 P7 证明该分支行为正确但无回归保护        |

### E 任务状态机（JF02）

| 编号 | 检查点                                          | 结论                      | 证据                                                                                                                           |
| ---- | ----------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| E1   | 无记录 × select/complete/skip/replace           | 通过                      | tasks.js:313-334；T01/T03/T05；契约 §3 第 45-48 行                                                                             |
| E2   | selected × complete/skip/replace                | 通过                      | tasks.js:310-334；T02/T03/T04                                                                                                  |
| E3   | 终态改投其他目标 = CONFLICT（非静默覆盖）       | 通过                      | tasks.js:310-312；T09（终端→skip/select/replace、skip→complete、replace→complete 全 CONFLICT，行数仍 1）                       |
| E4   | 终态同目标重复 = ok+replayed 且不重复写历史     | 通过（响应形状缺口见 D6） | tasks.js:296-309 `entries: []`；T08（`replayed:true`，`history().length===1`）                                                 |
| E5   | requestId 同 ID 同 payload 返回原结果、不重复写 | 通过                      | tasks.js:281-287；T11（`{...first, replayed:true}`，历史仍 1、回执仍 1）                                                       |
| E6   | 同 ID 异 payload = CONFLICT                     | 通过                      | tasks.js:283-285；T11 第三段（reused → CONFLICT，回执仍 1）                                                                    |
| E7   | 幂等 digest 是否漏字段                          | 通过                      | tasks.js:270-274 —— payload 三个字段全在 digest；日期有意不入摘要（跨零点重试仍返回原 date，tasks.js:268-269 与 jf02:99 明示） |
| E8   | history 只返回本人                              | 通过                      | tasks.js:363-366、384；H02（:77-88，含 `doesNotMatch(ownerId)`）；H12（:230-250）他人游标不能扩权                              |
| E9   | 分页稳定 + 跨页插入不重不漏                     | 通过                      | tasks.js:171-199 复合游标 + stores/tasks-store.js:113-122；H04（25 行 3 页恰好各走一次）、H11（中途插入不产生重复/位移）       |
| E10  | limit 服务端封顶                                | 通过                      | tasks.js:32-33、379-382（缺省 20 / 上限 50）；H05（0、51、1.5、'10'、-1 全 INVALID_INPUT）                                     |
| E11  | 跨业务日重置                                    | 通过                      | tasks.js:275-276 用 `businessDate(readClock())`；T17（次日重新 select，两行分别 completed/selected）；T15（17:30Z→次日）       |
| E12  | 模板空/停用 → INVALID_INPUT                     | 通过                      | tasks.js:84、288-292；T10（不存在/停用模板）、T19（替换目标停用/不存在）、S02（空集合与畸形行 → 空态而非伪造）                 |
| E13  | 不偷读私人正文                                  | 通过                      | S03（:134-148）把 getStatesForDate/listHistory/getReceipt 改成抛错，suggestions 仍成功；quickChoice 与 journal 解耦（S05/S06） |
| E14  | 最多 3 条建议、自愿性口径                       | 通过                      | tasks.js:216 + LIMITS.taskSuggestions；S01（第 4 条不入列）；notice 文案 `完成由你自行确认，不做打卡惩罚。`                    |

### F 测试质量

| 编号 | 检查点                                 | 结论         | 证据                                                                                                                                                                   |
| ---- | -------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | 是否存在「只断言函数被调用」的空洞测试 | 通过         | 断言全部落在数据形状/持久化结果/错误码；最强证据：C06 断言 store 调用序列恰为 `['getCleanupJob']`；W02/W05 断言 `calls` 为空；S03 用「调用即抛错」反向证明不读私人数据 |
| F2   | 是否为通过而放宽断言                   | 通过         | H05 对 5 种非法 limit 逐个断言；H06 对 6 种区间逐个断言；C09 篡改测试保留「原回执仍可用」的对照，非单边放宽                                                            |
| F3   | 是否依赖真实时钟/宿主机时区            | 通过         | 全量 grep `new Date()`/`Date.now()` 于 tests/week2-*.test.js **0 命中**；全部注入固定 clock；`businessDate` 用固定 +8 偏移（shared/date.js:3,11-13），T15 显式验证跨日 |
| F4   | 测试间共享可变状态                     | 通过         | 每个用例新建 store/domain（`createRoute()`/`createWorld()` 默认新建）；内存 store 计数器在工厂内                                                                       |
| F5   | 并发测试是否串行冒充                   | 通过         | W03/A03、T16 均先构造 Promise 数组再 `Promise.all`；T16 还断言 `replayed===false` 恰好 1 个（证明真交错）                                                              |
| F6   | 计划要求的关键负向用例是否齐备         | **部分失败** | 缺「清理任务创建失败」用例（D2）；缺「唯一键冲突但回查为空」（D10）；终态 replaced→select/skip 未单列（逻辑已覆盖，风险低）                                            |

### G 文档与计划符合度

| 编号 | 检查点                                                                                  | 结论         | 证据                                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1   | 5 项任务各有成果文档                                                                    | 通过         | README.md:12-18 + 5 份 w2-jf0*.md 均在 `docs/week2/Jiawei_Fang/`                                                                                 |
| G2   | 十项元数据（任务编号/关联需求/协作人/复核人/版本/环境/成果路径/实际耗时/验收状态/阻塞） | 通过         | jf01:5-16、jf02:5-16、jf03:5-16、jf04:5-16、jf05:5-15 逐行齐备（注：计划把「阻塞」列入；jf02:16 以「真实云验证｜**阻塞**」承载）                 |
| G3   | 「实际耗时」是否编造                                                                    | 通过         | 5 处均为「待本人确认（不代填）」：jf01:15、jf02:15、jf03:15、jf04:15、jf05:13                                                                    |
| G4   | 状态词是否限于 待开始/进行中/待复核/已验收/阻塞                                         | 通过         | README.md:29 明文口径；5 份文档只出现「待复核」「阻塞」；无一处「已验收」（README:14-18）                                                        |
| G5   | 本地替身与真实云是否分列                                                                | 通过         | 每条「环境」行都写「真实云/数据库/密钥 未执行」；jf02:203-208、jf04:153-157、jf05:65 另设阻塞表/未执行列                                         |
| G6   | 是否把未实现写成已完成                                                                  | 通过         | jf04:127-133 明列未实现（执行器/密钥/唯一键/会话表）；jf05:20-22 明确导出与执行器未实现、联合复核未执行                                          |
| G7   | 测试计数是否与实测一致                                                                  | **部分失败** | README:22-23 与 5 份文档的 8/7/15/38 全部与实测吻合；但 jf05:64 写「JF01 30 项」→ 见 D7                                                          |
| G8   | JF05 是否有交付记录                                                                     | 通过         | w2-jf05-data-capability.md §2 能力清单、§3 导出投影、§4 可重复清理约定、§5 联调记录（含「参与人：仅本人」「未执行 X05—X12」）、§7 剩余缺陷 R1—R6 |
| G9   | 文档与代码是否一致                                                                      | **部分失败** | jf01:69 仍称「接线只覆盖 account 域」，与 index.js:44-47 已注入 tasks 域不符 → 见 D8                                                             |

### H 工程约束

| 编号 | 检查点                                             | 结论                  | 证据                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1   | 未改 shared/ 与 miniprogram/                       | 通过                  | `git status --porcelain -uall` 无 `shared/`、`miniprogram/` 条目；`git diff --name-only` 仅 4 个 cloudfunctions 文件                                                                                                  |
| H2   | 未新增依赖                                         | 通过                  | package.json 未在改动列表；dependencies `{}`，devDependencies 仍为 esbuild/eslint/prettier 三项                                                                                                                       |
| H3   | 未改数据库定义                                     | 通过                  | `database/collections.json` 未改；其声明与文档一致：accounts=[openid]、preferences=[ownerId]、request_receipts=[ownerId,action,requestId]、task_history=[]、cleanup_jobs=[]                                           |
| H4   | 是否有测试专用后门进入生产                         | 通过                  | 生产唯一装配点 index.js:29-48 只传 `cloud`；`{store,clock,receiptSecret,env}` 只能由测试构造（identity.js:124-132），请求路径不可达                                                                                   |
| H5   | index.js 的 try/catch 静默回退是否掩盖真实配置错误 | **失败（判断+建议）** | 见 D3。当前 `catch (_error)`（index.js:50-55）吞掉一切装配异常并**永久**置 `wiringUnavailable=true`，无任何脱敏日志；模块损坏、构造器抛错、SDK 形状变更都会表现为「全部业务 NOT_IMPLEMENTED」，与真正的未实现不可区分 |
| H6   | router 改动是否削弱门禁                            | 通过                  | router.js diff 仅新增 `domainOverrides` 参数与 `handlers` 映射（:23-28、:68），门禁顺序/错误码未动                                                                                                                    |
| H7   | 代码风格/结构检查                                  | 通过                  | prettier + eslint + structure:check 均过（§2.1）                                                                                                                                                                      |

---

## 4. 缺陷清单

| id  | 严重度     | 文件:行                                                                                       | 问题                                                                                                                                                                                                                                                                                                                          | 必修复内容                                                                                                                                                                                                                                           |
| --- | ---------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **medium** | `cloudfunctions/moodsky/domains/account.js:108-114`（配合 `stores/account-store.js:292-313`） | `account.preferences` 的 `set` 是「读整行 → 合并 → 写整行」，无 owner 锁、无 CAS。实测（探针 P2/P6）：并发两个部分 set 时，A 的响应返回 `cardTextPreview:true`，最终库内为 `false`——**回执谎报已保存值，写入被静默覆盖**。tasks 域有 `withOwnerLock`，account 域没有                                                          | ①只写本次 patch 的字段（字段级 update，不要再回写另一字段的默认值）；或 ②复用 `withOwnerLock`/加 CAS；③补 1 条并发用例断言「两个并发部分 set 后两字段都保留」                                                                                        |
| D2  | **medium** | `tests/week2-account-close.test.js:60-73,133-159`；`domains/account.js:152-160`               | 计划 JF04 明列「**任务创建失败**」为必测项，现有 C04 注入的是 `setAccountStatus` 失败（停用失败），`insertCleanupJob` 抛错分支**零覆盖**。复审探针 P7 证明该分支行为正确（INTERNAL_ERROR、账号仍 active、jobs=0）但无回归保护；且该失败本可重试，却与「停用失败」的 `CONFLICT` 语义不一致                                     | ①新增用例：store 的 `insertCleanupJob` 抛错 → 断言 `INTERNAL_ERROR`、账号 active、`cleanupJobs.length===0`、无回执行；②建议把该分支收敛为可重试的 `CONFLICT`（与 :168 一致），并在 jf04 §3.1 补一句                                                  |
| D3  | **medium** | `cloudfunctions/moodsky/index.js:50-55`                                                       | 装配失败一律静默降级且**进程内永久生效**：`wiringUnavailable=true` 后即使后续依赖恢复也再不重试；无任何日志，真实配置错误（模块路径写错、SDK 形状变更、store 构造抛错）与「功能未实现」在客户端完全同形（都是 NOT_IMPLEMENTED），线上排障会误判为「未开发」                                                                   | ①区分 `MODULE_NOT_FOUND` / `cloud.database` 不可用 与 其他异常；②其他异常至少记录 `error.name`+`error.code`（禁止记 payload/OPENID）后**重抛**或降级为 INTERNAL_ERROR，不要伪装成 NOT_IMPLEMENTED；③不要永久缓存失败（或只在明确「模块缺失」时缓存） |
| D4  | low        | `cloudfunctions/moodsky/domains/account.js:176`                                               | 响应硬编码 `sessionRevoked: true`，但系统无会话/令牌表，实际只是停用后 router 拒绝私人动作。字段名对客户端是「令牌已吊销」的强断言，前端可能据此显示「已退出登录」。jf04 §3.3/§8-3 已自披露，属**已披露的契约谎报**                                                                                                           | 改名为 `privateActionsDenied`（或保留但由契约明确「非令牌吊销」），并在 fake 前端联调前定案；不得以该字段作为会话失效证据                                                                                                                            |
| D5  | low        | `cloudfunctions/moodsky/identity.js:68-72`；`domains/account.js:220-225`                      | 回执 claims 只有 `{p,j,exp}`（探针 P4 实测）：无 accountId、无签发时间、无一次性使用标记。900 秒内同一回执可反复读取；出现回执泄露时无法审计归属。jf04 §8-6 已列为待确认，非当前阻塞                                                                                                                                          | 与 Xiang Yu/Xiang Hong 定案：至少加 `iat`，并明确是否一次性；若要审计归属再加 `a`（accountId）或在 job 侧记录                                                                                                                                        |
| D6  | low        | `cloudfunctions/moodsky/domains/tasks.js:296-309`                                             | 终态「同目标状态」回放返回 `{taskId,date,state,replayed:true}`，**丢掉 `replacementTaskId`/`replacementState`**。实测 P3：已 replaced 的任务再用不同 `replacementTaskId` 调 replace，返回 ok/replayed:true 却不含任何替换目标，客户端既不知道实际替换到哪个模板，也拿不到原结果形状（与 T11 的 `{...first.data}` 语义不一致） | 回放分支应返回**首次存储的 result 主体**（含 replacementTaskId/replacementState），或统一规定 replace 回放必须带这两个字段；同时补 1 条「replace 回放含 replacementTaskId」的断言                                                                    |
| D7  | low        | `docs/week2/Jiawei_Fang/w2-jf05-data-capability.md:64`                                        | 「JF01 **30 项**、JF02 38 项新增测试」与实测不符：week2 JF01 单跑 = 8 项（README:23 与 jf01:25 也都写 8）。属数字口径错误，影响复核人对覆盖面的判断                                                                                                                                                                           | 改为「JF01 8 项（另含 W1 account-identity 12 项沿用）」或删去 30 并注明来源                                                                                                                                                                          |
| D8  | low        | `docs/week2/Jiawei_Fang/w2-jf01-account-identity.md:69`                                       | 「接线目前只覆盖 account 域；tasks 域…需在汇总时另行注入」与现状不符：`index.js:44-47` 已注入 `createCloudTasksStore`+`createTasksDomain`。复核人会按错误认知验收接线完整性                                                                                                                                                   | 更新为「account 与 tasks 两域均已接线；journal/review/campus/admin 仍未接线」                                                                                                                                                                        |
| D9  | low        | `stores/tasks-store.js:201-203`、`stores/account-store.js:314-322`                            | 云实现 `withOwnerLock` 为空实现（无分布式锁）、`getStatesForDate` 有 200 行扫描上限、`listHistory` 的 `command.or` 复合游标未对真云验证；`task_history`/`cleanup_jobs` 无唯一键 → 并发可产生同日两行 / 两个 open job。jf02 §5.2、jf04 §7-5 均已如实披露，属**已知未关闭风险**而非隐瞒                                         | 真云联调前必须完成：`task_history` uniqueKeys=[ownerId,taskId,date] 或事务；`cleanup_jobs` owner 级唯一约束；`command.or` 游标用真云验证                                                                                                             |
| D10 | low        | `cloudfunctions/moodsky/identity.js:159-166`；`tests/week2-account-identity.test.js`          | 「唯一键冲突但回查仍为空」的窗口只有 fail-closed 实现（探针 P1：UNAUTHENTICATED、0 行、不崩），但**无任何测试**覆盖该分支，后续改动易把它变成 500 或双行                                                                                                                                                                      | 补 1 条用例：`insertAccount` 抛 DUPLICATE_KEY、`findAccountByOpenid` 恒返 null → 断言 `UNAUTHENTICATED` 且 accounts 仍 0 行                                                                                                                          |

计数：**blocker 0 / high 0 / medium 3（D1 D2 D3）/ low 7（D4—D10）**。

---

## 5. 无法验证项与所需输入

| 项目                                                     | 为何无法验证                                                                         | 需要的输入/授权                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 真实云 `accounts.uniq_openid` 并发首建                   | 无测试环境写入授权；W1 探针只在探针集合验证过。本地只证明「云形状 stub」下的回读逻辑 | 一个隔离测试集合 + `accounts.uniqueKeys=[["openid"]]` 已生效的确认（Xiang Yu）+ 允许写入的最小账号 |
| 云数据库重复键错误真实形状（errCode/errMsg）             | 未对真云触发过；`isDuplicateKeyError` 依赖 `/duplicate key                           | E11000/i`与`errCode`                                                                               | 一次受控的重复插入实验，回填真实错误 JSON |
| `CLOUD_RECEIPT_SECRET` 生产签发                          | 环境变量未配置，全部回执来自测试密钥                                                 | 密钥配置责任人 + 轮换方案（Xiang Hong）；配置后可补「真密钥签发 + 跨实例校验」                     |
| 清理执行器与真实 `state` 流转（pending→processing→done） | 执行器属 Xiang Yu 范围，未实现                                                       | 执行器模块或其接口定义；当前 `state` 恒为 pending 是如实的                                         |
| 双账号真机隔离                                           | 只有本地两个 synthetic openid                                                        | 两台真机/两个微信账号 + 测试环境                                                                   |
| `task_history`/`cleanup_jobs` 并发唯一性                 | 唯一键未定、无事务、云 store 无分布式锁                                              | 数据库变更（Xiang Yu）或事务方案评审                                                               |
| 联合复核 X05—X12（Yuen Lin / Qizhen Cai）                | 复核人未参与；jf05 §5 已如实登记                                                     | 复核人排期与签字                                                                                   |
| 实际工时 / 完整项目估点                                  | 属本人填写范围                                                                       | Jiawei Fang 本人                                                                                   |

---

## 6. 复审结论

**有条件通过（conditional pass）**。

- 门禁与回执这两处安全关键路径，代码、测试与文档三方一致，且有可执行证据（常量时间比较、claims 校验、fail-closed、跨任务/跨账号拒绝、回执不得当登录），**无 blocker、无 high**。
- 任务状态机与契约 §3 的 9 行状态表逐行可对（T01—T09、T17—T19），幂等 digest 覆盖了 payload 全部三个字段，终态改投其他目标确为 CONFLICT 而非静默覆盖。
- 命令层面：`npm run check` exit 0、298/298/0，两次独立复跑结果一致；68 项新增测试无空洞断言、无真实时钟依赖、并发用例是真交错。
- 但仍有 3 项 medium 必须在合入/验收前关闭，且都不是「文档措辞」问题，而是可复现的行为/可维护性缺陷。

**合入前必修（top 5）**

1. **D1** 修 `account.preferences` 部分 set 的丢失更新（且不得再返回未落库的值）——唯一一条「响应说谎」的缺陷。
2. **D2** 补「`insertCleanupJob` 失败」用例（计划明确要求），并把该可重试失败从 `INTERNAL_ERROR` 收敛为 `CONFLICT`。
3. **D3** 收窄 `index.js` 的 `catch (_error)`：区分模块缺失与其他异常、加脱敏诊断、不永久缓存失败。
4. **D7** 修正 jf05:64 的「JF01 30 项」为 8 项（文档数字必须可回指命令输出）。
5. **D8** 修正 jf01:69「接线只覆盖 account 域」为 account+tasks 均已接线。

**建议同批处理（不阻塞合入）**：D6（replace 回放返回形状）、D10（补唯一键冲突回查为空的用例）、D4/D5（`sessionRevoked` 语义与回执 claims 定案）。

**明确不改判的部分（要求写清）**：本报告不以「看起来合理」为依据——D1 由探针 P2/P6 复现，D2/D10 由 grep 全量 tests 证明无覆盖、并由探针 P7/P1 证明现行行为，D3/D7/D8 由 file:line 与命令输出直接对应。未验证项一律列在 §5，不因本地替身结果推断真云通过。
