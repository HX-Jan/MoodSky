# W4 JF05 任务偏好导出与停用

| 项目      | 内容                                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务编号  | W4 JF05                                                                                                                                                                                                                                  |
| 承接      | W3 JF05                                                                                                                                                                                                                                  |
| 负责人    | Jiawei Fang（832401110）                                                                                                                                                                                                                 |
| 协作/复核 | Xiang Yu（任务历史/导出/清理执行器）、Linghan Chen（页面）、Qizhen Cai（复核）                                                                                                                                                           |
| 环境      | 本地 Node.js v24 + 合成数据库替身；**真实云、真实清理执行器、真实对象存储均未执行**                                                                                                                                                      |
| 结论      | 导出覆盖 8 个本人数据域（新增关联快照键 `taskCheckins`）；候选与正式清理均补齐地点打卡与任务↔打卡关联文档；`task_checkin_links` 已同时进集合声明、导出、两套清理清单与生产数据库白名单；重复申请、部分失败、停用后拒绝均在合成测试中通过 |

## 1 结论先行

- 导出 `SOURCES` 覆盖：日记、收藏、地点打卡、任务历史、偏好、装饰、兼容用的旧版 `campus_checkin_states`，以及 JF03 的 `task_checkin_links`（`domains/export.js`）；输出的键名与投影见同文件返回块。
- `task_checkin_links` 导出为条件键 `taskCheckins`：仅当本人文档里存在 `committed` 关联时出现；每条只投影 `ownerId`、`taskId`、`placeId`、`linkedDate`、`linkedAt`，不带出 `requests`（pending 意图/回执）、`digest`、`layout`、`revision` 等内部字段。只有 pending 的文档不产生该键（`JF05-W4-08`）。
- 清理候选 `domains/cleanup.js` 与正式 `production/cleanup.js` 的 `COLLECTIONS` 均已含 `place_checkins`、`campus_checkin_states`、`task_checkin_links`，`task_checkin_links` 位置与候选清单一致；本人打卡行与任务↔打卡关联文档随注销清理，公共 `places`、`task_templates` 与他人数据不在删除范围。关联文档由 JF03 store 写入，文档携带 `ownerId` 才能被按 owner 分页的清理器命中。
- `task_checkin_links` 同时登记进 `database/collections.json` 与 `production/database.js` 的生产集合白名单；后者是导出与清理在真实入口查询该集合的前置条件（`JF05-W4-08` 与生产生命周期测试覆盖）。
- 重复申请：生产关闭使用确定性 jobId，第二次 close 复用同一 job（生产入口 `production/index.js:76-104`；候选域 `account-candidate.js:177-238`）。合成测试见 `JF05-W4-06`。
- 部分失败：单个集合删除失败不会把 job 标成 completed；已提交的计数保留，重试只继续未完成部分（`JF05-W4-03`）。
- 停用后拒绝：`account.close` 之后所有 private 动作返回 `ACCOUNT_DISABLED`（`router.js:72-74`），`JF05-W4-06` 用 `account.preferences` 验证。
- **关联导出**：任务与地点打卡之间不靠 `task_history`/`place_checkins` 互相加字段，而是从独立集合 `task_checkin_links` 输出条件键 `taskCheckins`；见 §2/§5。

## 2 导出覆盖矩阵

| 数据域                             | 来源与投影                                                                                                                           | 输出位置                                | 结论   | 证据                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------ | ---------------------------------------------------------------- |
| 日记 `journals`                    | `journals` 全字段投影（`date/weather/weatherName/tags/text/version/state/createdAt/updatedAt`），`deleted` 跳过、非法状态 `CONFLICT` | `result.journals`                       | 已覆盖 | `domains/export.js` 的 `SOURCES` 与返回块                        |
| 地点打卡 `place_checkins`          | `ownerId/placeId/date/completedAt`                                                                                                   | `result.checkins`（仅非空）             | 已覆盖 | `domains/export.js`；`JF05-W4-05`                                |
| 旧版打卡 `campus_checkin_states`   | `ownerId/owner/visits/requests/revision`，校验 `owner` 后展开 `visits`                                                               | `result.campusCheckins`（仅非空）       | 已覆盖 | `domains/export.js`；`JF05-W4-05`                                |
| 任务历史 `task_history`            | `ownerId/taskId/taskTitle/date/state/createdAt`                                                                                      | `result.taskHistory`                    | 已覆盖 | `domains/export.js`；`JF05-W4-05`                                |
| 任务↔打卡关联 `task_checkin_links` | JF03 store 的每账号单文档；只投影 `links[]` 的 `ownerId/taskId/placeId/linkedDate/linkedAt`，不导出 `requests`、`digest` 等内部字段  | `result.taskCheckins`（仅非空，条件键） | 已覆盖 | `domains/export.js`；`JF05-W4-08`；清理见 `JF05-W4-07`           |
| 偏好 `preferences`                 | `ownerId/cardTextPreview/decorationsEnabled/profile/updatedAt`；无行返回 `null`，不合成默认值                                        | `result.preferences`                    | 已覆盖 | `domains/export.js`；`services/account-data.js`（读取口径）      |
| 收藏 `favorites`                   | `ownerId/placeId/placeName/createdAt`                                                                                                | `result.favorites`                      | 已覆盖 | `domains/export.js`；`JF05-W4-05`                                |
| 纠错 `place_corrections`           | **不在 `SOURCES`**；`production/cleanup.js` 已把它纳入清理，但导出没有对应投影                                                       | 无                                      | 未覆盖 | `domains/export.js` 的 `SOURCES` 无此键；`production/cleanup.js` |
| 装饰 `month_decorations`           | `ownerId/month/version/stickers/backgroundId`                                                                                        | `result.monthDecorations`               | 已覆盖 | `domains/export.js`；`JF05-W4-05`                                |

说明：

- `result.checkins` 与 `result.campusCheckins` 是导出响应里的两个独立来源，最终由 `tools/export-candidate/formatter` 合并去重；本项未改 formatter。新增的 `result.taskCheckins` 只是快照字段，候选 formatter 目前不渲染它——这是展示侧的残余缺口（见 §5/§7）。
- 投影里保留 `ownerId`（HMAC 账号 id），不包含 raw `OPENID`；这是既有导出契约，不在本项改动。
- 纠错未覆盖属**残余缺口**：它是本人提交的私有记录，清理侧已覆盖，导出侧尚未定义字段。建议由 Xiang Yu 在导出契约评审中处理，本项不擅自扩字段。

## 3 清理范围与幂等

### 3.1 候选 `domains/cleanup.js` 与实际 `production/cleanup.js` 的差异

| 集合                    | 候选 `domains/cleanup.js`（修复后） | 实际 `production/cleanup.js` | 说明                                                                                                            |
| ----------------------- | ----------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `journals`              | 有                                  | 有                           | 候选对 `deterministic-days-v1` 的日记返回 `NOT_IMPLEMENTED`（`:40-42`），不静默跳过                             |
| `favorites`             | 有                                  | 有                           | —                                                                                                               |
| `place_checkins`        | **有（本次新增）**                  | 有                           | 本人打卡行；`JF05-W4-01`                                                                                        |
| `campus_checkin_states` | **有（本次新增）**                  | 有                           | 旧版 visits 行；`JF05-W4-01`                                                                                    |
| `task_checkin_links`    | **有（本次对齐）**                  | **有（本次新增）**           | JF03 关联文档，位置与候选一致；`JF05-W4-07` 验证候选清理，生产清单由 `production/cleanup.js` 与生命周期测试覆盖 |
| `task_history`          | 有                                  | 有                           | —                                                                                                               |
| `preferences`           | 有                                  | 有                           | —                                                                                                               |
| `month_decorations`     | 有                                  | 有                           | —                                                                                                               |
| `request_receipts`      | 有                                  | 有                           | —                                                                                                               |
| `export_jobs`           | 有                                  | 有                           | 候选在删除前先持久化文件意图（`:145-181`）                                                                      |
| `deletion_markers`      | 无（有意保留账本）                  | 有                           | 候选在 `:217` 明确保留删除账本，不把它当业务数据清掉                                                            |
| `place_corrections`     | 无（**残余差异，未修**）            | 有                           | 属本人纠错；建议 Xiang Yu/Junhan Huang 确认后单独补，本项不扩范围                                               |

候选的 `services/account-data.js:44` 另有一个只允许 `task_history`/`preferences` 的 `CLEANUP_COLLECTIONS`，那是 W3 的两集合删除原语，不是注销执行器清单，本次未改，也不应据此判断注销范围。

### 3.2 本次修复

- `database/collections.json`：新增 `task_checkin_links` 条目，`owner` 为 Jiawei Fang / Xiang Yu，`uniqueKeys` 为 `[["ownerId"]]`，`notes` 标明 **SOURCE PLAN ONLY**、本人任务与自报到访的关联（非公共数据）以及 **Not deployed**；未改 `client-access-policy.json` 的 `defaultClientRule`。
- `domains/export.js`：`SOURCES` 增加 `task_checkin_links: ['ownerId', 'links']`；返回结果按既有条件键风格加入 `taskCheckins`，逐条只投影五个最小字段；既有键（`checkins`、`campusCheckins`、`taskHistory` 等）不变。
- `domains/cleanup.js` 与 `production/cleanup.js`：两套 `COLLECTIONS` 都含 `task_checkin_links`，位置一致（`campus_checkin_states` 之后、`task_history` 之前）；未改其它集合语义。
- `production/database.js`：生产集合白名单补入 `task_checkin_links`；否则真实导出/清理查询会在白名单处报 `Unknown production collection`（离线生命周期测试已复现并要求此登记）。
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

| 数据                          | 归属       | 证据                                                                                                                                             |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 公共地点资料 `places`         | 公共/运营  | `JF05-W4-01` 断言 `places:place_public` 仍在；候选清单不含 `places`                                                                              |
| 共享任务模板 `task_templates` | 公共/运营  | `JF05-W4-01` 断言 `task_templates:tpl_public` 仍在；`production/cleanup.js` 也不含它                                                             |
| 其他账号数据                  | 其他 owner | `JF05-W4-01` 断言 `place_checkins:checkin_other`、`campus_checkin_states:legacy_other` 仍在；`JF05-W4-07` 断言他人 `task_checkin_links` 文档保留 |
| 删除账本 `deletion_markers`   | 恢复/审计  | 候选有意保留（`domains/cleanup.js:217`）；只写元数据，不写地点正文                                                                               |

## 5 `task_checkin_links` 三处对齐与仍缺什么

JF03 的关联事实现在有独立集合承载，因此不需要往 `place_checkins` 或 `task_history` 里猜字段：`JF05-W4-05` 继续断言 `checkins` 无 `taskId`、`taskHistory` 无 `placeId`，关联只从 `task_checkin_links` 的 `taskCheckins` 输出。

| 登记面   | 现状                                                                                               | 证据               |
| -------- | -------------------------------------------------------------------------------------------------- | ------------------ |
| 集合声明 | `database/collections.json` 已新增；`notes` 写明 SOURCE PLAN ONLY、隐私范围与 Not deployed         | 文件条目；结构检查 |
| 导出     | `domains/export.js` 的 `SOURCES` 与条件键 `taskCheckins`；仅五个最小字段，pending 意图与回执不外泄 | `JF05-W4-08`       |
| 候选清理 | `domains/cleanup.js` 的 `COLLECTIONS` 已含，按 `ownerId` 命中并删除本人文档，保留他人与公共数据    | `JF05-W4-07`       |
| 正式清理 | `production/cleanup.js` 的 `COLLECTIONS` 已含且位置一致；生产数据库白名单同步登记                  | 生产生命周期测试   |

仍缺（未执行，不写成已通过）：

- 候选 `tools/export-candidate/formatter` 尚未渲染 `taskCheckins`；导出快照已带该键，但 JSON/Markdown 产物里还看不到关联行，需展示侧接线。
- `taskCheckins` 的保留期、单文档 500 条上限与拆表方案未定；等价去重回执仍无 TTL。
- 真实云导出、真实清理执行器（定时器触发）与真实对象存储仍未执行，见 §7。
- 关联的导出字段命名（`linkedDate`/`linkedAt`）仍需接口评审确认后再定稿；当前实现按 JF03 store 的实际字段。

## 6 测试与命令

```sh
node --test tests/week4-jf05-export-cleanup.test.js
```

```text
✔ JF05-W4-01 close cleanup removes the owner check-ins and keeps public material
✔ JF05-W4-02 repeating a completed close returns the same persisted result
✔ JF05-W4-03 a partial failure leaves committed counts and a retry finishes once
✔ JF05-W4-04 an active account or foreign job cannot delete check-ins
✔ JF05-W4-05 export covers check-ins and task history without inventing a link
✔ JF05-W4-06 a repeated close returns the same job and afterwards refuses private actions
✔ JF05-W4-07 close cleanup removes the owner task-checkin link document
✔ JF05-W4-08 export projects only the owner committed task-checkin links
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

## 7 未测项与阻塞

| 编号 | 事项                                             | 所需输入/提供人                      | 恢复条件                                                                  |
| ---- | ------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------- |
| E1   | 真实云导出（文件生成、24 小时过期、下载）        | 云环境授权 / Xiang Yu                | 部署候选入口并执行一次真实申请与下载                                      |
| E2   | 真实清理执行器（`production/cleanup.js` tick）   | Xiang Yu（执行器）                   | 真实停用账号 + 定时器触发，核对文件与行均清理                             |
| E3   | 任务↔打卡关联字段                                | JF03 负责人、Xiang Yu、Xiang Hong    | 见 §5                                                                     |
| E4   | 纠错 `place_corrections` 是否加入导出            | Xiang Yu / Junhan Huang              | 导出契约评审后另立任务；本项不扩范围                                      |
| E5   | 2026-10-30 QA 清理的历史结论                     | Qizhen Cai                           | 只作历史引用；本项不重做、不改写                                          |
| E6   | `taskCheckins` 在候选 formatter/页面展示与保留期 | Xiang Yu / Xiang Hong / Linghan Chen | 导出快照与清理已对齐；formatter 渲染、保留期/拆表评审后补展示与保留期测试 |

## 8 本次改动文件

| 文件                                            | 变更                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `database/collections.json`                     | 新增 `task_checkin_links` 集合条目（SOURCE PLAN ONLY / 隐私范围 / Not deployed）         |
| `cloudfunctions/moodsky/domains/export.js`      | `SOURCES` 增 `task_checkin_links`；条件键 `taskCheckins` 只投影五个最小字段              |
| `cloudfunctions/moodsky/domains/cleanup.js`     | `COLLECTIONS` 补 `place_checkins`、`campus_checkin_states`、`task_checkin_links`         |
| `cloudfunctions/moodsky/production/cleanup.js`  | `COLLECTIONS` 补 `task_checkin_links`，位置与候选一致                                    |
| `cloudfunctions/moodsky/production/database.js` | 生产集合白名单补 `task_checkin_links`（导出/清理查询前置）                               |
| `tests/week4-jf05-export-cleanup.test.js`       | 8 项导出/清理/重复申请/部分失败测试；含关联文档清理与 `taskCheckins` 投影                |
| `tests/helpers/offline-wx-database.js`          | 离线原生数据库替身的 owner 查询允许清单补 `task_checkin_links`（合成夹具，不是生产代码） |

未改：`shared/contracts.js`、`services/account-data.js`、`services/checkins.js`、部署入口。剩余缺口（formatter 展示、保留期、真实云/执行器）见 §5/§7 E1、E2、E6。
