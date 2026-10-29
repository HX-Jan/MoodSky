# Junhan Huang 第三周交付（W3 JH01—JH05）

2026-10-29，按《MoodSky 第三周详细任务计划 20261025》第 4 节执行 W3 JH01—JH05，承接 W2 JH01—JH05（[PR #72](https://github.com/HX-Jan/MoodSky/pull/72)，已由 #72 整合为 `ca37471`）。本文是本地交审材料：源码、路由响应和测试均可复现，但**没有真实云部署、真实数据库写入、真实运营账号或真实 Web 身份**，也没有取得指定同学的独立验收。个人工时、难度点和签字不代填。

|          |                                                                   |
| -------- | ----------------------------------------------------------------- |
| 分支     | `Junhan_Huang-W3-campus-admin`                                    |
| 基线     | `origin/main` `78de000`（含 #72/#73/#74/#76）                     |
| 环境     | Windows / Node.js 24 / 本地 `createRouter` + 内存仓储             |
| 全量检查 | `npm run cloud:prepare && npm run check` → **909 项通过，0 失败** |

## 五项交付与复核

| 任务 / 承接          | 本次可核对成果                                                                                                                                                                                                           | 预期与实际                                                                                                                                                                                              | 状态 / 指定协作与待验                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| JH01 / W2 JH01       | [契约矩阵](w3-jh01-contract-matrix.json)、[`docs/api.md`](../../api.md)、[15 个 action 的实际实现状态](w3-jh01-contract-matrix.json)                                                                                     | 15 个 campus/admin action 的 payload、访问级别、实现/未实现逐项列出；公开摘要与后台字段分开；未新增注册表 action                                                                                        | 待 Qinghan、Qizhen Chen 确认字段；Xiang Hong 复核矩阵。矩阵为本地状态，不代表生产入口已接 |
| JH02 / W2 JH01       | [`campus.js`](../../../cloudfunctions/moodsky/domains/campus.js)、[`campus-rules.js`](../../../cloudfunctions/moodsky/domains/campus-rules.js)、[11 组查询记录](w3-jh02-public-query-records.json)                       | 校区、标签、分页、空态、过期降级、合成/未核验 `NOT_FOUND`、支持资源空态全部按规则返回；字段白名单由实际响应读出                                                                                         | 待 Qinghan 页面验证；真实已核验资料接入（XY02）未执行                                     |
| JH03 / W2 JH02、JH03 | [`admin.js`](../../../cloudfunctions/moodsky/domains/admin.js)、[`router.js`](../../../cloudfunctions/moodsky/router.js)、[12 组角色与维护记录](w3-jh03-role-and-maintenance-records.json)                               | 无身份/无账号 `UNAUTHENTICATED`、普通账号 `FORBIDDEN`、停用运营 `ACCOUNT_DISABLED`、伪造角色 `INVALID_REQUEST`；读取→改→验证→重读→公开可读链路通过；陈旧版本 `CONFLICT`，客户端盖核验章 `INVALID_INPUT` | 待 Qizhen Cai 独立复核；真实 `operator_roles` 与 Web 身份阻塞                             |
| JH04 / W2 JH04       | [`admin.reviewCorrection`](../../../cloudfunctions/moodsky/domains/admin.js)、[`repositories.js`](../../../cloudfunctions/moodsky/repositories.js)、[12 组收藏/纠错/审核记录](w3-jh04-favorites-correction-records.json) | 收藏去重与幂等取消；跨账号隔离；纠错 200 码点通过、201 拒绝；审核 approved/rejected 终态、同结论幂等、改判 `CONFLICT`；**审核不改地点**（`placeUpdated:false`，前后地点记录逐字相同）                   | 待 Qinghan 联调、Qizhen Cai 核对本人可见范围；真实双账号与后台页面未联调                  |
| JH05 / W2 JH05       | [`campus-personal.js`](../../../cloudfunctions/moodsky/domains/campus-personal.js)、[导出与两次清理记录](w3-jh05-export-cleanup-records.json)、[资料核验表](w3-jh05-data-review.csv)                                     | 本人查询按服务端账号；导出只含约定字段；首次清理 2 收藏 + 1 纠错，第二次 0/0 不报错；地点/资源/模板数量前后一致                                                                                         | 阻塞：QH01 未交可核验资料，核验表保持表头；导出清理模块待 Xiang Yu 复核接入完整流程       |

## 本周源码改动

| 文件                                                | 改动                                                                                                    | 复核人                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| `cloudfunctions/moodsky/domains/admin.js`           | 实现 `admin.reviewCorrection`：读取、终态校验、事务写入、重新读取；响应固定 `placeUpdated:false`        | Xiang Hong、Qizhen Cai |
| `cloudfunctions/moodsky/domains/admin-rules.js`     | 新增审核请求校验、终态计划与审核视图；列表视图补 `reviewedAt`/`reviewedBy`/`reviewNote`，仍不回传提交人 | Xiang Hong             |
| `cloudfunctions/moodsky/repositories.js`            | 纠错按 id 读取与事务审核、按 owner 扫描；收藏/纠错按 owner 有界幂等删除                                 | Xiang Yu               |
| `cloudfunctions/moodsky/domains/campus-personal.js` | 新增：本人校园数据导出投影与幂等清理，供账号导出/清理执行器接入                                         | Xiang Yu、Jiawei       |
| `tests/admin-campus.test.js`                        | 新增 3 项审核测试；原“审核未实现”用例缩为模板/资源两项                                                  | Yuen Lin               |
| `tests/campus-personal.test.js`                     | 新增 5 项：导出归属、跨账号隔离、幂等清理、停用账号清理、缺失账号拒绝                                   | Yuen Lin               |
| `docs/api.md`                                       | 同步 `admin.reviewCorrection` 与校园私人导出/清理约定                                                   | Xiang Hong             |
| `tools/week3-jh/run-evidence.cjs`                   | 证据生成器：真实路由 + 内存仓储 + 固定时钟，输出本次 5 份 JSON                                          | —                      |

共享注册表**没有新增 action**：`admin.reviewCorrection` 在第二周已注册为 operator/mutates，本次只是把 `NOT_IMPLEMENTED` 变成实现。因此不需要新的注册表评审项，但仍需 Xiang Hong 确认行为与文档。

## W3 JH01：契约与实现矩阵

[`w3-jh01-contract-matrix.json`](w3-jh01-contract-matrix.json) 从 `shared/contracts.js` 的 `ACTIONS` 生成 15 个 campus/admin action，记录 domain、access、mutates、需求编号、payload 字段、实现状态与说明。要点：

- `campus` 域 6 个：4 个公开（`listPlaces`、`getPlace`、`supportResources`、`weatherPreview`）+ 2 个私人（`favorites`、`correctPlace`）。
- `admin` 域 9 个：5 个只读 + `updatePlace` + `reviewCorrection` 已实现；`updateTaskTemplate`、`updateSupportResource` 仍为 `NOT_IMPLEMENTED`。
- `wiring.js` 的 `createCampusBackend(cloud)` 仍是显式接线；`index.js` 未引用，未接线环境返回 `NOT_IMPLEMENTED`。
- 公开摘要 9 个字段、后台地点 19 个字段分别列出；矩阵里的“已实现”只指处理器与测试存在，不指已部署或页面已接。

矩阵是**当前实现状态**，不是对页面表单的推断：后台页面是否接、Web 身份是否可用，分别由 QC03/QC04 记录。

## W3 JH02：公开查询接通

[`w3-jh02-public-query-records.json`](w3-jh02-public-query-records.json) 用真实路由跑 11 组请求，固定时钟 `2026-10-23T00:00:00Z`：

| 场景                       | 实际结果                                                         |
| -------------------------- | ---------------------------------------------------------------- |
| 默认列表                   | 3 条（仅已启用、非合成、有来源、已核验、未过期）                 |
| 东校区筛选                 | 1 条                                                             |
| `tags:['STUDY']`           | 1 条（任一命中）                                                 |
| 第 2 页、每页 2            | 稳定排序，`total:3`                                              |
| 西校区                     | `items:[]`、`total:0`，不是错误                                  |
| 已核验详情                 | 含 `contact`/`location`/`source`/`validUntil`                    |
| 过期详情                   | `stale:true`，无 `contact`/`location`                            |
| 合成地点                   | `NOT_FOUND`                                                      |
| 支持资源                   | 仅已核验 1 条；无资源时 `emptyState.code = NO_VERIFIED_RESOURCE` |
| `pageSize:21` / 未约定字段 | `INVALID_INPUT`                                                  |

字段白名单不是抄规则文件，而是从上述实际响应读取：公开摘要 9 字段、过期详情不含联系与坐标、支持资源 8 字段。真实已核验资料由 XY02 接入前，本记录只证明处理器行为，不证明云端数据可用。

## W3 JH03：运营授权与首条维护链路

[`w3-jh03-role-and-maintenance-records.json`](w3-jh03-role-and-maintenance-records.json) 覆盖 12 组：

| 身份/场景                   | 实际结果                                         |
| --------------------------- | ------------------------------------------------ |
| 无可信 `OPENID`             | `UNAUTHENTICATED`                                |
| `OPENID` 无内部账号         | `UNAUTHENTICATED`                                |
| 普通 active 账号            | `FORBIDDEN`                                      |
| 停用运营（仍有角色）        | `ACCOUNT_DISABLED`（先于角色判定）               |
| 客户端携带 `role`           | `INVALID_REQUEST`                                |
| 运营读取未核验地点          | `verificationState: unverified`                  |
| 公开读取同一地点（核验前）  | `NOT_FOUND`                                      |
| 运营改来源并 `markVerified` | `saved:true, verified:true`，服务端写核验人/时间 |
| 运营重新读取                | `verified`，新来源                               |
| 公开读取（核验后）          | 成功，返回新来源                                 |
| 陈旧 `expectedUpdatedAt`    | `CONFLICT`，不写入                               |
| 客户端传 `verifiedAt`       | `INVALID_INPUT`                                  |

真实 `operator_roles` 集合、内部账号映射和 Web 身份仍未打通，因此只验收到**本地授权能力**，不宣称后台已可真实运营。

## W3 JH04：收藏、纠错与审核边界

### 收藏与纠错（承接 W2）

[`w3-jh04-favorites-correction-records.json`](w3-jh04-favorites-correction-records.json) 记录：添加、重复添加 `duplicated:true`、本人列表、他人列表为空、伪造 `ownerId` 被拒、取消、重复取消 `removed:false`、200 码点通过、201 码点 `INVALID_INPUT`。

### 新增：`admin.reviewCorrection`

第三周补上第二周明确留白的审核入口：

- payload 只接受 `correctionId`、`decision`（`approved`/`rejected`）、可选 `note`（1—200 码点）。
- `reviewedBy`、`reviewedAt`、`updatedAt` 由服务端盖章；客户端带身份字段在路由层即 `INVALID_REQUEST`。
- 同结论重复提交幂等：`reviewed:false, alreadyReviewed:true`，不产生第二次写。
- 已终态后改判 `CONFLICT`，原状态保留。
- **审核只记录纠错结论，不更新地点**：响应固定 `placeUpdated:false`；本次记录中审核前后地点对象逐字相同。要改地点必须另走 `admin.updatePlace`，走它自己的白名单、版本冲突和重读。
- 审核视图不含提交人账号，仍保持“纠错私人”的边界。

这对应计划里的“提交成功不能表示地点资料已经更新”：提交、审核、地点更新是三件事，分别留证。

## W3 JH05：校园导出与幂等清理

[`campus-personal.js`](../../../cloudfunctions/moodsky/domains/campus-personal.js) 向 Xiang Yu 的导出/清理执行器提供两个函数，不新增公开 action：

| 函数                                                   | 输出                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `collectPersonalCampusData({repositories, accountId})` | `version:1`、`favorites[{placeId,createdAt}]`、`corrections[{correctionId,placeId,text,status,createdAt,reviewedAt}]`、`counts`、`truncated` |
| `clearPersonalCampusData({repositories, accountId})`   | `favoritesRemoved`、`correctionsRemoved`、`sharedRetained:true`                                                                              |

实际执行记录见 [`w3-jh05-export-cleanup-records.json`](w3-jh05-export-cleanup-records.json)：

- 清理前导出：2 收藏、1 纠错，全部只含本人字段，序列化结果不含账号 id。
- 第一次清理：删除 2 + 1。
- 第二次清理：删除 0 + 0，不报错。
- 地点、支持资源、任务模板数量前后一致；`sharedRetained:true`。
- 另一个学生的收藏与纠错未被删除（由测试覆盖）。
- 停用账号 `acc_off` 由账号流程解析出的可信 `accountId` 直接清理，删除其 1 条收藏后返回；本模块不自行判断账号状态，也不生成导出文件、凭证或恢复标记。

### 资料核验表仍阻塞

[`w3-jh05-data-review.csv`](w3-jh05-data-review.csv) 保留 15 列表头，**没有数据行**。Qinghan 的 W3 QH01 截至 2026-10-29 尚未交付可核验的来源、日期和有效期；把测试合成地点写进核验表会被当成真实资料，这正是第一周定下的红线。待 QH01 到位后由本人逐条复核，再决定启用与复审日期。

## 验证与复现

```powershell
npm ci
npm run setup
npm run cloud:prepare
npm run check          # ESLint + Prettier + structure + typecheck + 909 tests
node tools/week3-jh/run-evidence.cjs
npx prettier --write "docs/week3/Junhan_Huang/*.json"   # 生成器写 2 空格 JSON，统一格式
```

本次结果：**909 项测试通过，0 失败**（2026-10-29，Windows，Node 24）。新增专项：

```powershell
node --test tests/admin-campus.test.js tests/campus-personal.test.js tests/campus.test.js
```

新增 8 项（审核 3、个人数据 5），原有收藏/纠错/公开查询/维护链用例全部保留。证据生成器只监听本地内存仓储，不发起网络或云调用；它复用 `tests/support` 的固定数据，输出到本目录，可重复运行。

## 未执行与边界

- 未执行真实云部署、真实数据库读写、真实账号/角色建号、真实 Web OAuth 或双账号联调。
- 未接生产入口：`index.js` 仍不 `require('./wiring')`；未接线环境 campus/admin 返回 `NOT_IMPLEMENTED`。
- 未做后台页面联调；QC03/QC04 的页面证据不代替本人处理器证据，反之亦然。
- 未生成导出文件、临时凭证、清理执行器、删除标记或恢复流程；这些属于 Xiang Yu。
- 未填资料核验表、未把合成地点当真实资料。
- 未取得 Qinghan、Qizhen Chen、Xiang Hong、Qizhen Cai、Xiang Yu 的独立复核。

## 复核清单

| 复核人      | 需要确认                                                                    |
| ----------- | --------------------------------------------------------------------------- |
| Qinghan     | 公开字段够不够画卡片、校区枚举、`supportResources` 是否按校区筛选、页面可接 |
| Qizhen Chen | 后台读取字段与 `reviewCorrection` 返回是否够用；页面失败保留输入            |
| Xiang Hong  | 审核语义、`placeUpdated:false`、无新注册表项；`router` 接缝未变             |
| Qizhen Cai  | 停用运营 `ACCOUNT_DISABLED`、伪造角色、跨账号收藏、审核越权                 |
| Xiang Yu    | `campus-personal` 的查询/导出/清理口径与集合假设；幂等删除上限              |
| Yuen Lin    | 新增 8 项测试归属与回归范围；证据生成器是否纳入日常检查                     |

## 记录字段（计划 §16）

| 字段     | JH01                 | JH02              | JH03                         | JH04                | JH05             |
| -------- | -------------------- | ----------------- | ---------------------------- | ------------------- | ---------------- |
| 任务编号 | W3 JH01              | W3 JH02           | W3 JH03                      | W3 JH04             | W3 JH05          |
| 承接 W2  | W2 JH01              | W2 JH01           | W2 JH02/JH03                 | W2 JH04             | W2 JH05          |
| 协作人   | Qinghan、Qizhen Chen | Qinghan、Xiang Yu | Qizhen Chen、Qinghan         | Qinghan             | Xiang Yu、Jiawei |
| 复核人   | Qinghan、Xiang Hong  | Qinghan           | Qizhen Cai                   | Qinghan、Qizhen Cai | Xiang Yu         |
| 前置输入 | W2 契约与欠项        | XY02 已核验资料   | 真实 operator_roles/Web 身份 | 前端联调            | QH01 核验资料    |
| 实际耗时 | 待本人填写           | 待本人填写        | 待本人填写                   | 待本人填写          | 待本人填写       |
| 难度点   | 待本人估             | 待本人估          | 待本人估                     | 待本人估            | 待本人估         |
| 验收状态 | 待复核               | 待复核            | 待复核                       | 待复核              | 阻塞（核验表）   |
| 阻塞     | 字段确认             | 真实资料接入      | 真实身份与独立复核           | 双账号与页面        | QH01 资料        |

## 关键交接（计划 §15）

| 方向                          | 内容                                                                 | 状态                            |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| Junhan → Qinghan、Qizhen Chen | 公开字段、后台读取字段、审核返回                                     | 本目录 JH01/JH04、`docs/api.md` |
| Junhan → Qizhen Cai           | 角色/停用/伪造/跨账号审核结果                                        | 待真实环境复测                  |
| Junhan → Xiang Yu             | `collectPersonalCampusData`/`clearPersonalCampusData` 与幂等清理口径 | 本目录 JH05，待接入复核         |
| Junhan → Yuen Lin             | 新增测试与证据生成器                                                 | 本目录，待纳入回归              |
| Qinghan → Junhan              | 首批地点/资源核验结果                                                | **等待，JH05 核验表阻塞**       |
| Xiang Yu → Junhan             | `places`/`favorites`/`place_corrections` 最终字段与索引              | 等待                            |

> 难度点取 1、2、3、5、8；实际工时与难度由本人填写，不由工具代估。
