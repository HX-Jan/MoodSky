# W4 JF05 任务偏好导出与停用

| 项目      | 内容                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务编号  | W4 JF05                                                                                                                                                                                                                                                                                                                                              |
| 承接      | W3 JF05                                                                                                                                                                                                                                                                                                                                              |
| 负责人    | Jiawei Fang（832401110）                                                                                                                                                                                                                                                                                                                             |
| 协作/复核 | Xiang Yu（任务历史/导出/清理执行器）、Linghan Chen（页面）、Qizhen Cai（复核）                                                                                                                                                                                                                                                                       |
| 环境      | 本地 Node.js v24 + 合成数据库替身；**真实云、真实清理执行器、真实对象存储均未执行**；`task_checkin_links` **未部署**（`database/collections.json` 标 SOURCE PLAN ONLY / Not deployed）                                                                                                                                                               |
| 结论      | 导出 `SOURCES` 只含 7 个已部署集合，`task_checkin_links` 隔离为 opt-in 候选通道（`CANDIDATE_SOURCES` + `includeCandidateSources: true`，默认关闭）；候选清理仍含该集合（服务未接线），正式清理（固定 11 项）与生产数据库白名单均已隔离、不含；重复申请、部分失败、停用后拒绝仍在合成测试中通过，另有 9 项未部署集合的隔离回归（W4-10—13、ISO-01—05） |

## 1 结论先行

- 导出 `SOURCES` 只含已部署集合：日记、收藏、地点打卡、任务历史、偏好、装饰，以及兼容用的旧版 `campus_checkin_states`（`domains/export.js`）。未部署的 `task_checkin_links` 不在其中，因此正式导出默认不查询它。
- `task_checkin_links` 走单独的候选通道 `CANDIDATE_SOURCES`：只有显式 `createExportService({ includeCandidateSources: true })` 才并入遍历，默认 `false`；非 boolean 抛 `TypeError`（`JF05-W4-ISO-05`）。正式入口 `production/exports.js` 与候选快照入口 `tools/export-candidate/preparation.js` 均未传该选项，两者默认都不读该集合。
- 候选通道开启后，`taskCheckins` 仍是条件键：仅当本人文档里存在 `committed` 关联时出现；每条只投影 `ownerId`、`taskId`、`placeId`、`linkedDate`、`linkedAt`，不带出 `requests`（pending 意图/回执）、`digest`、`layout`、`revision` 等内部字段；只有 pending 的文档不产生该键（`JF05-W4-08`、`JF05-W4-ISO-03`）。
- 候选通道开启且集合在环境中不存在（wx-server-sdk `-502005`）时，导出明确 `CONFLICT`，不会被当成「该 owner 没有关联」的空集合（`JF05-W4-ISO-04`）。
- 清理侧：候选 `domains/cleanup.js` 的 `COLLECTIONS` 仍含 `task_checkin_links`（该服务未接线）；正式 `production/cleanup.js` 的 `COLLECTIONS` **不含**它，固定为 11 项已部署集合；`production/database.js` 的生产集合白名单也**不含**它，生产适配器访问时直接报 `Unknown production collection`（`JF05-W4-13`）。这样做的目的是消除「目标环境没有该集合 → 正式注销清理卡在待处理 / 正式导出失败」的回归（`JF05-W4-10`）。
- `task_checkin_links` 仍保留在 `database/collections.json`：`notes` 标明 SOURCE PLAN ONLY、本人任务与自报到访的关联（非公共数据）、Not deployed，`uniqueKeys` 为 `[["ownerId"]]`。这是给将来部署用的声明，不是已部署事实。
- 重复申请：生产关闭使用确定性 jobId，第二次 close 复用同一 job（生产入口 `production/index.js:76-104`；候选域 `account-candidate.js:177-238`）。合成测试见 `JF05-W4-06`。
- 部分失败：单个集合删除失败不会把 job 标成 completed；已提交的计数保留，重试只继续未完成部分（`JF05-W4-03`）。
- 停用后拒绝：`account.close` 之后所有 private 动作返回 `ACCOUNT_DISABLED`（`router.js:72-74`），`JF05-W4-06` 用 `account.preferences` 验证。
- **关联导出**：任务与地点打卡之间不靠 `task_history`/`place_checkins` 互相加字段，而是从独立集合 `task_checkin_links` 输出条件键 `taskCheckins`；当前只在候选通道（opt-in）可达，正式导出默认不含；见 §2/§5。

## 2 导出覆盖矩阵

| 数据域                             | 来源与投影                                                                                                                                                                                                                                                                     | 输出位置                               | 结论                                 | 证据                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| 日记 `journals`                    | `journals` 全字段投影（`date/weather/weatherName/tags/text/version/state/createdAt/updatedAt`），`deleted` 跳过、非法状态 `CONFLICT`                                                                                                                                           | `result.journals`                      | 已覆盖                               | `domains/export.js` 的 `SOURCES` 与返回块                          |
| 地点打卡 `place_checkins`          | `ownerId/placeId/date/completedAt`                                                                                                                                                                                                                                             | `result.checkins`（仅非空）            | 已覆盖                               | `domains/export.js`；`JF05-W4-05`                                  |
| 旧版打卡 `campus_checkin_states`   | `ownerId/owner/visits/requests/revision`，校验 `owner` 后展开 `visits`                                                                                                                                                                                                         | `result.campusCheckins`（仅非空）      | 已覆盖                               | `domains/export.js`；`JF05-W4-05`                                  |
| 任务历史 `task_history`            | `ownerId/taskId/taskTitle/date/state/createdAt`                                                                                                                                                                                                                                | `result.taskHistory`                   | 已覆盖                               | `domains/export.js`；`JF05-W4-05`                                  |
| 任务↔打卡关联 `task_checkin_links` | **不在 `SOURCES`**；在 `CANDIDATE_SOURCES`，只有 `includeCandidateSources: true` 时才读取；映射前校验每条 `links[]` 必须 `status='committed'` 且必需字段齐备，否则整体 `CONFLICT`；只投影 `ownerId/taskId/placeId/linkedDate/linkedAt`，不导出 `requests`、`digest` 等内部字段 | `result.taskCheckins`（opt-in 且非空） | 候选通道（opt-in）；正式导出默认不含 | `domains/export.js`；`JF05-W4-08`、`JF05-W4-09`、`ISO-01`—`ISO-05` |
| 偏好 `preferences`                 | `ownerId/cardTextPreview/decorationsEnabled/profile/updatedAt`；无行返回 `null`，不合成默认值                                                                                                                                                                                  | `result.preferences`                   | 已覆盖                               | `domains/export.js`；`services/account-data.js`（读取口径）        |
| 收藏 `favorites`                   | `ownerId/placeId/placeName/createdAt`                                                                                                                                                                                                                                          | `result.favorites`                     | 已覆盖                               | `domains/export.js`；`JF05-W4-05`                                  |
| 纠错 `place_corrections`           | **不在 `SOURCES`**；`production/cleanup.js` 已把它纳入清理，但导出没有对应投影                                                                                                                                                                                                 | 无                                     | 未覆盖                               | `domains/export.js` 的 `SOURCES` 无此键；`production/cleanup.js`   |
| 装饰 `month_decorations`           | `ownerId/month/version/stickers/backgroundId`                                                                                                                                                                                                                                  | `result.monthDecorations`              | 已覆盖                               | `domains/export.js`；`JF05-W4-05`                                  |

说明：

- 矩阵共 9 行：7 个已部署数据域在 `SOURCES`，构成默认导出的全部来源；`task_checkin_links` 是未部署候选，只有 opt-in 才参与，默认导出不读、结果里也没有该键；`place_corrections` 在导出侧仍未覆盖（见下条）。
- `result.checkins` 与 `result.campusCheckins` 是导出响应里的两个独立来源，最终由 `tools/export-candidate/formatter` 合并去重；本项未改 formatter。新增的 `result.taskCheckins` 只属于 opt-in 候选通道，且候选 formatter 目前不渲染它——这是展示侧的残余缺口（见 §5/§8 E6）。
- 投影里保留 `ownerId`（HMAC 账号 id），不包含 raw `OPENID`；这是既有导出契约，不在本项改动。
- 纠错未覆盖属**残余缺口**：它是本人提交的私有记录，清理侧已覆盖，导出侧尚未定义字段。建议由 Xiang Yu 在导出契约评审中处理，本项不擅自扩字段。

## 3 清理范围与幂等

### 3.1 候选 `domains/cleanup.js` 与实际 `production/cleanup.js` 的差异

| 集合                    | 候选 `domains/cleanup.js`（当前） | 实际 `production/cleanup.js` | 说明                                                                                    |
| ----------------------- | --------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `journals`              | 有                                | 有                           | 候选对 `deterministic-days-v1` 的日记返回 `NOT_IMPLEMENTED`（`:46-48`），不静默跳过     |
| `favorites`             | 有                                | 有                           | —                                                                                       |
| `place_checkins`        | **有（本次新增）**                | 有                           | 本人打卡行；`JF05-W4-01`                                                                |
| `campus_checkin_states` | **有（本次新增）**                | 有                           | 旧版 visits 行；`JF05-W4-01`                                                            |
| `task_checkin_links`    | **有（保留；服务未接线）**        | **无（本轮隔离）**           | 集合未部署：正式清单不登记候选，缺集合回归见 §6；候选清理仍由 `JF05-W4-07`/`W4-12` 覆盖 |
| `task_history`          | 有                                | 有                           | —                                                                                       |
| `preferences`           | 有                                | 有                           | —                                                                                       |
| `month_decorations`     | 有                                | 有                           | —                                                                                       |
| `request_receipts`      | 有                                | 有                           | —                                                                                       |
| `export_jobs`           | 有                                | 有                           | 候选在删除前先持久化文件意图（`:157-183`）                                              |
| `deletion_markers`      | 无（有意保留账本）                | 有                           | 候选在 `:222` 明确保留删除账本，不把它当业务数据清掉                                    |
| `place_corrections`     | 无（**残余差异，未修**）          | 有                           | 属本人纠错；建议 Xiang Yu/Junhan Huang 确认后单独补，本项不扩范围                       |

正式 `production/cleanup.js` 当前为 11 项：`journals`、`favorites`、`place_checkins`、`campus_checkin_states`、`task_history`、`preferences`、`month_decorations`、`request_receipts`、`export_jobs`、`deletion_markers`、`place_corrections`，与 §6 `JF05-W4-13` 的逐项断言一致。

候选的 `services/account-data.js:44` 另有一个只允许 `task_history`/`preferences` 的 `CLEANUP_COLLECTIONS`，那是 W3 的两集合删除原语，不是注销执行器清单，本次未改，也不应据此判断注销范围。

### 3.2 本轮改动：隔离未部署集合

上一轮把 `task_checkin_links` 无条件接进正式路径，离线目标环境没有该集合时，正式注销清理卡在待处理、正式导出失败。本轮按「正式路径只含已部署集合、候选能力显式开启」收回：

- `database/collections.json`：**保留** `task_checkin_links` 条目，`owner` 为 Jiawei Fang / Xiang Yu，`uniqueKeys` 为 `[["ownerId"]]`，`notes` 标明 **SOURCE PLAN ONLY**、本人任务与自报到访的关联（非公共数据）以及 **Not deployed**；未改 `client-access-policy.json` 的 `defaultClientRule`。
- `domains/export.js`：`SOURCES` **不含**该集合；新增 `CANDIDATE_SOURCES`，只有 `includeCandidateSources: true` 才并入遍历，默认 `false`；非 boolean 抛 `TypeError`；opt-in 时集合缺失返回 `CONFLICT`。返回结果按既有条件键风格加入 `taskCheckins`，逐条只投影五个最小字段；既有键（`checkins`、`campusCheckins`、`taskHistory` 等）不变。
- `domains/cleanup.js`：`COLLECTIONS` **仍含** `task_checkin_links`（候选通道，该服务未接线），未改其它集合语义。
- `production/cleanup.js`：`COLLECTIONS` **不含** `task_checkin_links`，固定为 11 项已部署集合。
- `production/database.js`：生产集合白名单**不含** `task_checkin_links`；生产适配器访问时直接报 `Unknown production collection`，不会把未部署集合当空集合。
- `tests/helpers/offline-wx-database.js`：撤销 `task_checkin_links` 的 owner 查询允许项，恢复主干形状；离线替身也不再静默回答该集合的查询（`W4-13` 断言其 reject）。
- 新增测试：`tests/week4-jf05-cleanup-isolation.test.js`（W4-10—13）与 `tests/week4-jf05-export-isolation.test.js`（ISO-01—05）；原 `tests/week4-jf05-export-cleanup.test.js` 的 W4-08/09 改为显式传入 `includeCandidateSources: true`。
- 未改 `shared/contracts.js`、路由、`index.js` 或部署入口；未重新执行 2026-10-30 已通过的 QA 清理。

### 3.3 幂等与部分失败的验证方式

| 场景         | 验证方式                                                                                                                                                        | 测试                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 重复执行     | 第一次完成后再次 `executeAccountCleanup`，返回同一 `{state,progress,totalDeleted}`，不再计数、不再删行                                                          | `JF05-W4-02`             |
| 部分失败     | 在删除 `campus_checkin_states` 时注入一次存储失败；失败后 job 仍非 completed，`progress.place_checkins=2` 已提交，`totalDeleted` 未写；重试后完成且总数只算一次 | `JF05-W4-03`             |
| 重复申请关闭 | 连续两次 `account.close` 返回同一 jobId，`cleanup_jobs` 只有 1 行；之后 private 动作 `ACCOUNT_DISABLED`                                                         | `JF05-W4-06`；`JF04-C04` |
| 非停用账号   | active 账号执行清理 → `FORBIDDEN`，一行不删                                                                                                                     | `JF05-W4-04`             |
| 他人 job     | `cleanup_jobs.ownerId` 与请求 owner 不一致 → `FORBIDDEN`，一行不删                                                                                              | `JF05-W4-04`             |

## 4 明确保留（不得删除）

| 数据                          | 归属       | 证据                                                                                                                                                           |
| ----------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公共地点资料 `places`         | 公共/运营  | `JF05-W4-01` 断言 `places:place_public` 仍在；候选清单不含 `places`                                                                                            |
| 共享任务模板 `task_templates` | 公共/运营  | `JF05-W4-01` 断言 `task_templates:tpl_public` 仍在；`production/cleanup.js` 也不含它                                                                           |
| 其他账号数据                  | 其他 owner | `JF05-W4-01` 断言 `place_checkins:checkin_other`、`campus_checkin_states:legacy_other` 仍在；`JF05-W4-07`、`JF05-W4-12` 断言他人 `task_checkin_links` 文档保留 |
| 删除账本 `deletion_markers`   | 恢复/审计  | 候选有意保留（`domains/cleanup.js:222`）；只写元数据，不写地点正文                                                                                             |

## 5 隔离与登记

JF03 的关联事实现在有独立集合承载，因此不需要往 `place_checkins` 或 `task_history` 里猜字段：`JF05-W4-05` 继续断言 `checkins` 无 `taskId`、`taskHistory` 无 `placeId`，关联只从 `task_checkin_links` 的 `taskCheckins` 输出——而该输出当前只在 opt-in 候选通道可达。

| 登记面     | 当前状态                                                                                                                                                                                                                                  | 证据                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 集合声明   | `database/collections.json` 保留条目；`notes` 写明 SOURCE PLAN ONLY、隐私范围与 Not deployed；未部署                                                                                                                                      | 文件条目；结构检查                            |
| 导出       | `SOURCES` 不含；`CANDIDATE_SOURCES` + `includeCandidateSources: true`（默认 `false`，非 boolean `TypeError`）；映射前要求 `links[]` 每行 `status='committed'` 且字段齐备，非法行整体 `CONFLICT`；仅五个最小字段；opt-in 缺集合 `CONFLICT` | `JF05-W4-08`、`JF05-W4-09`、`ISO-01`—`ISO-05` |
| 候选清理   | `domains/cleanup.js` 的 `COLLECTIONS` 含；按 `ownerId` 命中并删除本人文档，保留他人与公共数据；该服务未接线                                                                                                                               | `JF05-W4-07`、`JF05-W4-12`                    |
| 正式清理   | `production/cleanup.js` 的 `COLLECTIONS` 不含（固定 11 项已部署集合）；目标环境缺该集合时仍能走完清理                                                                                                                                     | `JF05-W4-10`、`JF05-W4-13`                    |
| 生产白名单 | `production/database.js` 不含；生产适配器报 `Unknown production collection`                                                                                                                                                               | `JF05-W4-13`                                  |

将来接入时需要做的三件事：

1. **部署集合与索引**：按 `database/collections.json` 创建 `task_checkin_links` 集合与 `uniqueKeys [["ownerId"]]` 索引，沿用 `defaultClientRule` 的客户端禁读禁写。
2. **登记回正式路径**：把集合加回 `production/cleanup.js` 的 `COLLECTIONS` 与 `production/database.js` 白名单，再跑一次缺集合回归的反向验证（集合存在时正式清理与导出都能命中），然后用真实停用账号做正式环境验收。
3. **补展示侧**：让 `tools/export-candidate/formatter` 渲染 `taskCheckins`（以及页面展示），再核对正式环境 JSON/Markdown 产物确实含本人记录。

仍缺（未执行，不写成已通过）：

- `task_checkin_links` 尚未部署，任何环境都还没有该集合。
- 候选 `tools/export-candidate/formatter` 尚未渲染 `taskCheckins`；即使 opt-in 快照带该键，JSON/Markdown 产物里也看不到关联行，需展示侧接线。
- 「只清理本人关联、保留他人数据」与「JSON/Markdown 含本人记录」的**正式环境**验证要等集合与功能正式接入后再做；目前只有候选层合成测试（`JF05-W4-12`、`ISO-03`）。
- `taskCheckins` 的保留期、单文档 500 条上限与拆表方案未定；等价去重回执仍无 TTL。
- 真实云导出、真实清理执行器（定时器触发）与真实对象存储仍未执行，见 §8。
- 关联的导出字段命名（`linkedDate`/`linkedAt`）仍需接口评审确认后再定稿；当前实现按 JF03 store 的实际字段。

## 候选导出产物（JSON / Markdown）

- `tools/export-candidate/preparation.js` 增加 `includeCandidateSources`（默认 `false`，非 boolean 抛 `TypeError`），显式开启后才并入候选集合读取；`production/exports.js` 不传该选项，正式导出不查询。
- 开启后 `tools/export-candidate/formatter.js` 输出条件键 `taskCheckins`：仅本人 `committed` 关联，字段为 `taskId`、`placeId`、`linkedDate`、`linkedAt`（不输出内部账号 id、回执、digest、状态）；`linkedDate` 为 `null` 表示跨日。Markdown 新增 `## 任务打卡关联（N 条）` 一节，位于「地点打卡」之后、「偏好设置」之前，按 `linkedAt` 倒序。
- 集合不存在时（CloudBase `DATABASE_COLLECTION_NOT_EXIST` / `-502005`）开启即明确失败（`CONFLICT`），不静默当空；已部署集合的权限（`-502003`）、网络错误继续抛出。
- 回归：`JF05-W4-ART-01`—`ART-05`（默认不查询/开启后两格式含本人/缺集合明确失败/权限网络不吞/非法选项与坏行报错）。

- **版本一致性**：opt-in 时把关联文档的 `revision` 作为 `candidateRevision` 贯穿快照读取、`export_jobs`、`prepare` 与 `publish`；快照前后读不一致、生成期变化、发布前变化均返回 `CONFLICT`，不生成或发布缺条目的文件。`ART-06`（快照后新增关联）与 `ART-07`（生成后发布前新增关联）覆盖两个窗口；`ART-08` 断言默认导出在两个窗口都不读该集合并成功。残余窗口：发布事务内「读版本 → 写 ready」之间仍无跨文档锁，彻底关闭需让关联写入 bump 账号 `operationFence`，属接线期决定。

## 6 未部署集合的隔离回归

两个新文件都用合成替身，不含真实云：一个模拟「目标环境从未创建 `task_checkin_links`」，一个验证「默认路径不碰候选、opt-in 失败要响」。

| 用例         | 断言要点                                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JF05-W4-10` | 目标环境没有 `task_checkin_links` 仍能走完正式清理：清理器全程未查询该集合，已部署集合逐个被查询；已完成的 job 重复 `step` 返回同一终态且不再查询；生产适配器与离线替身两条路径都通过。                                      |
| `JF05-W4-11` | 已部署集合上的失败必须让清理失败、不能当空集合：`PERMISSION_DENIED` 时 job 仍 `pending`、无 progress、数据未删，`tick` 记 `retry: 1`；`NETWORK_ERROR` 时 job 停在 `processing`、已提交 progress 保留、后续集合未推进。       |
| `JF05-W4-12` | 候选清理仍只删本人关联：`progress.task_checkin_links=1`、`totalDeleted=1`；本人 link 文档消失、他人 link 文档保留；`places`/`task_templates` 保留；`deletion_markers` 只含 `ownerId/collection/docId` 元数据，不含地点正文。 |
| `JF05-W4-13` | 正式清理的 `COLLECTIONS` 逐项等于 11 项且不含 `task_checkin_links`；生产适配器对该集合抛 `Unknown production collection`；离线替身对该集合的查询 reject（不静默返回空）。                                                    |
| `ISO-01`     | 默认导出从不在该集合上查询：合成库里即使存在本人的 link 文档，结果也没有 `taskCheckins`，查询记录里也没有 `task_checkin_links`（对照组 `journals` 被查询）。                                                                 |
| `ISO-02`     | 已部署集合上的权限错误（`-502003`）与网络错误（`-1`）必须让导出失败，不会被当成空数据。                                                                                                                                      |
| `ISO-03`     | opt-in 时才读该集合：只返回本人 `committed` 关联的 5 个最小字段；pending 意图、`digest`、`layout`、`requests` 与另一 owner 的关联都不出现；内部键 `task_checkin_links` 不出现在结果里。                                      |
| `ISO-04`     | opt-in 且集合缺失（`-502005`）时明确 `CONFLICT`；同一缺失环境里默认导出仍成功。                                                                                                                                              |
| `ISO-05`     | `includeCandidateSources` 传 `'true'`/`1`/`null`/`{}` 均抛 `TypeError`，不回落到默认值。                                                                                                                                     |

## 7 测试与命令

```sh
node --test tests/week4-jf05-export-cleanup.test.js tests/week4-jf05-cleanup-isolation.test.js tests/week4-jf05-export-isolation.test.js
```

```text
✔ JF05-W4-10 a target environment without task_checkin_links still completes production cleanup
▶ JF05-W4-11 permission and network failures on an existing collection abort cleanup
  ✔ PERMISSION_DENIED
  ✔ network failure
✔ JF05-W4-11 permission and network failures on an existing collection abort cleanup
✔ JF05-W4-12 candidate cleanup still deletes only the closing owner links
✔ JF05-W4-13 production cleanup never references the candidate collection
✔ JF05-W4-01 close cleanup removes the owner check-ins and keeps public material
✔ JF05-W4-02 repeating a completed close returns the same persisted result
✔ JF05-W4-03 a partial failure leaves committed counts and a retry finishes once
✔ JF05-W4-04 an active account or foreign job cannot delete check-ins
✔ JF05-W4-05 export covers check-ins and task history without inventing a link
✔ JF05-W4-06 a repeated close returns the same job and afterwards refuses private actions
✔ JF05-W4-07 close cleanup removes the owner task-checkin link document
✔ JF05-W4-08 export projects only the owner committed task-checkin links
✔ JF05-W4-09 export rejects a non-committed row inside links[]
✔ JF05-W4-ISO-01 the default export never queries the undeployed candidate collection
✔ JF05-W4-ISO-02 a permission or network error on a deployed source fails the export
✔ JF05-W4-ISO-03 an opt-in export reads the candidate collection and keeps only the owner rows
✔ JF05-W4-ISO-04 an opt-in export fails explicitly when the candidate collection is missing
✔ JF05-W4-ISO-05 a non-boolean opt-in flag is rejected instead of falling back to the default
ℹ tests 20
ℹ pass 20
ℹ fail 0
```

W4-08/09 现在显式传 `includeCandidateSources: true`，默认路径由 ISO-01 覆盖；W4-11 的两个子用例计入总数，故 18 个顶层用例 + 2 个子用例共 20 项。

## 8 未测项与阻塞

| 编号 | 事项                                             | 所需输入/提供人                       | 恢复条件                                                                                      |
| ---- | ------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| E1   | 真实云导出（文件生成、24 小时过期、下载）        | 云环境授权 / Xiang Yu                 | 部署候选入口并执行一次真实申请与下载                                                          |
| E2   | 真实清理执行器（`production/cleanup.js` tick）   | Xiang Yu（执行器）                    | 真实停用账号 + 定时器触发，核对文件与行均清理                                                 |
| E3   | `task_checkin_links` 部署与正式环境关联验证      | 集合与索引部署；Xiang Yu / Xiang Hong | 集合部署、登记回正式清理与生产白名单后，验证正式环境 JSON/Markdown 含本人记录、只清理本人关联 |
| E4   | 纠错 `place_corrections` 是否加入导出            | Xiang Yu / Junhan Huang               | 导出契约评审后另立任务；本项不扩范围                                                          |
| E5   | 2026-10-30 QA 清理的历史结论                     | Qizhen Cai                            | 只作历史引用；本项不重做、不改写                                                              |
| E6   | `taskCheckins` 在候选 formatter/页面展示与保留期 | Xiang Yu / Xiang Hong / Linghan Chen  | 候选 formatter 渲染（当前不渲染）、保留期/拆表评审后补展示与保留期测试                        |

以上均为未执行项；合成测试通过不等于正式环境验收。

## 9 本次改动文件

| 文件                                            | 变更                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database/collections.json`                     | 保留 `task_checkin_links` 条目（SOURCE PLAN ONLY / 隐私范围 / Not deployed），供将来部署                                                                                                |
| `cloudfunctions/moodsky/domains/export.js`      | `SOURCES` 不含该集合；新增 `CANDIDATE_SOURCES` 与 `includeCandidateSources` opt-in（默认 `false`、非 boolean `TypeError`、opt-in 缺集合 `CONFLICT`）；`taskCheckins` 只投影五个最小字段 |
| `cloudfunctions/moodsky/domains/cleanup.js`     | `COLLECTIONS` 仍含 `place_checkins`、`campus_checkin_states`、`task_checkin_links`（候选通道，未接线）                                                                                  |
| `cloudfunctions/moodsky/production/cleanup.js`  | `COLLECTIONS` 不含 `task_checkin_links`，固定 11 项已部署集合                                                                                                                           |
| `cloudfunctions/moodsky/production/database.js` | 生产集合白名单不含 `task_checkin_links`；生产适配器报 `Unknown production collection`                                                                                                   |
| `tests/helpers/offline-wx-database.js`          | 撤销 `task_checkin_links` 的 owner 查询允许项，恢复主干形状                                                                                                                             |
| `tests/week4-jf05-export-cleanup.test.js`       | 原 9 项导出/清理/重复申请/部分失败测试；W4-08/09 改为显式 opt-in                                                                                                                        |
| `tests/week4-jf05-cleanup-isolation.test.js`    | 新增 W4-10—13：缺集合正式清理、失败必须失败、候选只删本人、正式清单不引用候选                                                                                                           |
| `tests/week4-jf05-export-isolation.test.js`     | 新增 ISO-01—05：默认不查、部署集合错误失败、opt-in 最小投影、缺集合 `CONFLICT`、非 boolean `TypeError`                                                                                  |

未改：`shared/contracts.js`、`services/account-data.js`、`services/checkins.js`、`services/task-checkins.js`、`stores/task-checkin-links.js`、`tools/export-candidate/*`、部署入口。剩余缺口（formatter 展示、保留期、真实云/执行器）见 §5/§8 E1、E2、E6。
