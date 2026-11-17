# W6XY 导出、到期维护与注销清理：本地验收报告

| 项目     | 内容                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 任务     | W6-XY 第 1—3 项（导出内容与格式、领取生命周期、停用与分批清理）                                                            |
| 本人     | Xiang Yu（Phoenix-Yx）                                                                                                     |
| 构建     | `987b19d675bfe7a8f4b14c0cb1b25d508483d329`（分支 `feature/week6-xy-export-cleanup`，基线即计划登记的主干提交）             |
| 环境     | Windows 24H2，Node v24.21.0，仓库内合成夹具（WX 形态内存库），无 SDK、无网络、无真实账号；未连接真实云、未部署、未写真实库 |
| 结论状态 | **待复核**（本地通过；真实触发器、设备文件送达与云端清理仍需后续补验，见[维护与补验单](W6XY-维护与补验单.md)）             |
| 复核人   | 蔡奇真（隐私与生命周期依据）、Yuen Lin（复现）                                                                             |

计划登记的主干是 `987b19d`。收件时主干已到 `13afb20`（PR #183），其与基线的差异只有 `docs/week5` 与 `tools/week5-jh` 的文档措辞，不含导出或清理代码，因此本次结论对 `13afb20` 同样成立；是否改按 `13afb20` 出包由洪翔决定。

## 1. 结论摘要

1. **导出内容与格式正确**：A、B 各申请 JSON 与 Markdown，每个文件只含本账号的记录、任务、偏好、打卡、月份装饰，正文、`weatherName`、Unicode 与换行原样保留；`ownerId`、内部 `_id`、`accountEpoch`、`sourceRevisions`、`fileId`、`contentSha256` 均未出现在文件里；已删除记录整行排除，悬空贴纸目标被过滤为日期缺失而不是留下内部 ID。
2. **领取生命周期按设计失效**：24 小时整点即过期、跨账号领取和状态查询返回 `FORBIDDEN`、记录被编辑后旧文件转 `expired` 并拒绝领取、库内正文被改动后哈希不符拒绝领取。
3. **停用与清理可复现**：停用后所有私人动作返回 `ACCOUNT_DISABLED`，正文在库内成为待清理残留；清理按集合分 11 批推进，进度总和 30 与实际删除数一致，B 的 8 行业务数据与公共地点、任务模板逐行未变，B 的导出内容逐字节不变；唯一残留是账号墓碑与 `cleanup_jobs` 台账。
4. **凭回执查询清理进度可用**：用注销返回的回执读 `account.cleanupStatus` 得到 `completed` 与完整进度。
5. **未覆盖项**：真实云定时触发器、真实 24 小时自然流逝、设备文件实际送达、云端多实例并发与外部文件删除协议。这些不改变本地结论，但决定能否进入外部联调。

## 2. 方法与工具

- 工具：`tools/week6-xy/verify-export-cleanup.cjs`（入口）+ `tools/week6-xy/memory-database.js`（WX 形态内存库，串行化写时复制事务，支持 `gt/lte/in` 查询）。
- 走真实生产入口 `cloudfunctions/moodsky/production/index.js` 的 `createProductionEntry`，动作、回执、会话范围、来源版本围栏、清理 worker（`production/cleanup.js`）与维护任务（`production/maintenance.js`）都是被测代码本身，没有替身改写。
- 记录与偏好通过真实 API 写入（`journal.upsert`、`account.preferences`）。任务历史、收藏、打卡、月份装饰在写入入口仍处于关闭或暂停状态（新增打卡默认暂停、任务写入 fail-closed），因此按 `domains/export.js` 的 `SOURCES` 字段表和仓库写入形状以合成行播种；导出格式化器对这些行做了完整校验并全部通过，可作为形状正确的旁证。
- 时钟注入：起点 `2026-11-17T02:00:00Z`，按需推进到 `+24h`、`+49h`，不依赖真实等待。
- 复现：`node tools/week6-xy/verify-export-cleanup.cjs`（详见 [tools/week6-xy/README.md](../../../tools/week6-xy/README.md)）。

## 3. 数据覆盖与格式

A、B 为可辨识的合成账号（`acct_f9b43a81…`、`acct_9adb4f1c…`）。A：4 条记录行（3 有效 + 1 删除）、11 个收藏、2 条任务历史、1 份偏好、1 个月份装饰（3 个贴纸，其中 1 个目标已失效）、2 条地点打卡 + 1 条旧 `campus_checkin_states` 访问。B：2 条记录、1 个收藏、1 条任务历史、1 条打卡、1 份偏好。

| 集合                                          | 导出字段                                                              | 排除字段                                                                     | A   | B   |
| --------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --- | --- |
| journals                                      | date, weather, weatherName, tags, text, version, createdAt, updatedAt | ownerId, _id, entryId, state, layout；`state=deleted` 整行                   | 3   | 2   |
| favorites                                     | placeId, placeName, createdAt                                         | ownerId, _id                                                                 | 11  | 1   |
| task_history                                  | taskId, taskTitle, date, state, createdAt                             | ownerId, _id                                                                 | 2   | 1   |
| preferences                                   | cardTextPreview, decorationsEnabled, updatedAt, profile               | ownerId, _id, openid                                                         | 1   | 1   |
| month_decorations                             | month, version, stickers(stickerId, targetDate), backgroundId         | ownerId, _id, targetEntryId；丢失/跨月目标过滤                               | 1   | 0   |
| place_checkins + campus_checkin_states.visits | placeId, date, completedAt(, placeName, selfReported)                 | ownerId, _id, owner, requests, revision                                      | 3   | 1   |
| 顶层                                          | exportVersion, exportedAt, data                                       | ownerId, accountStatus, accountEpoch, sourceRevisions, fileId, contentSha256 | 1   | 1   |

机器可读版本见 [evidence/coverage.csv](evidence/coverage.csv)；样例见 [evidence/samples/A-export.json](evidence/samples/A-export.json)、[A-export.md](evidence/samples/A-export.md)、[B-export.json](evidence/samples/B-export.json)、[B-export.md](evidence/samples/B-export.md)。JSON 为 4331 字节、Markdown 为 2665 字节，均含中文与换行，Markdown 正文用长于正文反引号序列的 `text` 围栏包裹。

边界事实（`production/exports.js`）：单文件上限 512 KiB、每个集合最多 2000 行；超限直接失败而不是截断。`exportVersion` 仍是 `1.0-candidate`，不是正式 1.0 协议。

## 4. 领取生命周期实测

| 用例                 | 预期                                           | 实测                                                                                                                                                                                                                       | 证据   |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 正常领取             | 返回正文、格式、字节数                         | `ok=true`，`extension=json/md`                                                                                                                                                                                             | S2、S3 |
| 跨账号领取           | 拒绝，不泄露存在性以外信息                     | B 领 A、A 领 B 均 `FORBIDDEN`；B 查 A 状态同样 `FORBIDDEN`                                                                                                                                                                 | S5     |
| 到期前 1 秒          | 仍可领取                                       | `ready`，领取成功                                                                                                                                                                                                          | S6     |
| 到达 24 小时         | 立刻 `expired`，领取被拒                       | `expired`；领取 `CONFLICT`「导出尚未完成或已失效」                                                                                                                                                                         | S6     |
| 记录改动使旧文件失效 | 状态转 `expired`，旧文件不可领                 | 编辑记录（version 1→2）后 `expired`，领取 `CONFLICT`；重新申请得到含新正文的文件，旧正文不再出现                                                                                                                           | S7     |
| 库内正文被篡改       | 哈希/字节不符时拒领                            | `CONFLICT`；恢复原文后可领                                                                                                                                                                                                 | S7b    |
| 到期维护             | 移除正文与文件元数据，保留任务元数据，重跑幂等 | 6 个 ready 全部转 `expired`，`content/contentSha256/byteLength/mimeType/extension` 移除、`fileId=null`；保留 `_id/ownerId/format/createdAt/readyAt/expiresAt/accountEpoch/sourceRevisions/state/updatedAt`；二次运行返回 0 | S8     |
| 停用后领取           | 拒绝，且不可再申请                             | `exportStatus`／`downloadExport`／`requestExport`／`journal.get` 全部 `ACCOUNT_DISABLED`；库里正文仍在（残留）                                                                                                             | S9     |

到期判定只看 `LIMITS.exportFileHours = 24`，到期时刻本身即拒绝、不额外宽限。领取凭证函数（`planClaim`/`authorizeRead`，300 秒、可撤销）仍是纯函数候选，未接入生产动作；本轮生产路径的领取鉴权来自会话范围与库内哈希校验，汇报时不要把 300 秒凭证当成已生效能力。

## 5. 停用与分批清理

A 执行 `account.close`（`confirm=CLOSE`）后：账号 `status=disabled`，生成 `cleanup_jobs` 台账（`state=pending`、`exportAccessRevoked=true`、`progress={}`），返回 151 字符回执；同事务推进 `exportEpoch`，因此停用前生成的导出立即失效。

清理 worker 每步只处理一个集合的一页（≤10 行），逐批结果见 [evidence/cleanup-progress.csv](evidence/cleanup-progress.csv)：

| 批  | 状态       | 说明                                                                                         |
| --- | ---------- | -------------------------------------------------------------------------------------------- |
| 1—2 | processing | journals 4 行、favorites 前 10 行                                                            |
| 3   | processing | favorites 余下 1 行（证明分页无偏移丢失）                                                    |
| 4—9 | processing | place_checkins 2、campus_checkin_states 1、task_history 2、preferences 1、request_receipts 3 |
| 10  | processing | export_jobs 5（正文随文档删除）                                                              |
| 11  | completed  | 进度固定、`totalDeleted` 由进度求和                                                          |

最终进度：`{journals:4, favorites:11, place_checkins:2, campus_checkin_states:1, task_history:2, preferences:1, month_decorations:1, request_receipts:3, export_jobs:5}`，合计 30，与清理前 A 的业务行数一致；再次 `step` 返回 `completed` 且不再写入。

[evidence/cleanup-before-after.csv](evidence/cleanup-before-after.csv) 给出逐集合前后对照：A 业务集合全部 0；B 的 8 个业务键逐一保持；`places`、`task_templates` 未被触碰（公共集合行数不变，清理也只按 `ownerId` 取页）。

清理后 A 只剩两条非业务文档：账号墓碑（`openid`、`identityKind`、`status=disabled`、`journalLayout`、`closedAt`）与 `cleanup_jobs` 台账；`accounts:acct_f9b43a81…` 与 `cleanup_jobs:2a6fd7ea…`。恢复验证：A 重新 `account.session` 返回 `ACCOUNT_DISABLED`（墓碑阻止复活），B 仍可登录、申请并领取自己的导出。凭回执查询 `account.cleanupStatus` 返回 `state=completed` 与完整进度，未返回正文或文件引用。

## 6. 与计划要求的差异和未覆盖项

| 项目             | 实际情况                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 真实定时触发器   | 只调用 `production/maintenance.js` 与 `production/cleanup.js` 的函数入口；`production/worker.js` 的 `TRIGGER_SRC=timer` 授权、`timer.config.json` 触发频率未在云上验证                                                                                             |
| 真实 24 小时流逝 | 用注入时钟推进，未做自然时间等待；结论依赖 `readyAt`/`expiresAt` 均为服务器时间                                                                                                                                                                                    |
| 设备文件送达     | 导出正文存于 `export_jobs.content`，领取后由客户端写盘；`native-export-file` 的 11 项离线检查通过，但真实手机保存/发送未执行（与 Linghan 的补验单衔接）                                                                                                            |
| 外部文件删除协议 | 生产清理直接删 `export_jobs` 文档；`domains/cleanup.js` 的 `removeExportFile` 外部文件协议本轮未触发（当前 `fileId` 指向库内正文）                                                                                                                                 |
| 云端并发与锁     | 内存库是串行写时复制，不证明真实云事务、多实例 worker 竞争下的行为                                                                                                                                                                                                 |
| 全量检查         | `npm run cloud:prepare` 通过；`lint`、`format:check`、`structure:check`、`docs:check`、`typecheck` 通过；`npm test` 在本机沙箱内被进程隔离限制拦截（子进程 `spawn EPERM`），因此改为逐文件运行 14 个相关测试文件（130 项全部通过），全量套件由 Yuen 在常规环境复核 |

## 7. 交接

- **Linghan Chen**：[evidence/samples/](evidence/samples/) 的 A/B 样例可直接用于导出界面口径核对（字段名、`exportVersion`、排除字段、Markdown 围栏）。注意 `exportVersion` 仍为 `1.0-candidate`，共享接口未改。
- **蔡奇真**：本报告的隐私依据是第 3 节字段表与第 5 节清理前后对照；真实后台声明、UGC 与审核状态不在本轮范围，不作为已生效证据。
- **Yuen Lin**：复核命令与期望输出见 [tools/week6-xy/README.md](../../../tools/week6-xy/README.md)；完整回归请按计划第 2 项在实际源码目录执行。
- **洪翔**：本次结论为「本地通过、待外部补验」，不含真实云、设备与后台项；若以 `13afb20` 出包，导出与清理路径不受影响。

## 8. 证据清单

| 文件                                                                   | 内容                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [evidence/run.json](evidence/run.json)                                 | 14 个场景、137 项检查的机器结果（构建号、环境、逐项 actual/expected）                          |
| [evidence/coverage.csv](evidence/coverage.csv)                         | 集合 × 导出字段 × 排除字段 × A/B 条数                                                          |
| [evidence/cleanup-before-after.csv](evidence/cleanup-before-after.csv) | 逐集合清理前后对照（A/B/公共）                                                                 |
| [evidence/cleanup-progress.csv](evidence/cleanup-progress.csv)         | 11 批清理进度                                                                                  |
| [evidence/targeted-tests.txt](evidence/targeted-tests.txt)             | 14 个测试文件、130 项结果                                                                      |
| [evidence/quality.txt](evidence/quality.txt)                           | lint、ormat:check、structure:check、docs:check、 ypecheck、git diff --check 的构建号与退出结果 |
| [evidence/samples/](evidence/samples/)                                 | 脱敏 A/B 导出样例（JSON、Markdown）                                                            |
