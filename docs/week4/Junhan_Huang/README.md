# Junhan Huang 第四周交付（W4 JH01—JH05）

2026-11-07，按《MoodSky 第四周详细任务计划 20261102 修订版》第 5 节整理 W4 JH01—JH05，承接 W3 JH01—JH05 与旧 [Issue #55](https://github.com/HX-Jan/MoodSky/issues/55)。本文是本地交审材料：源码、路由记录与清单复核可复现；没有真实云部署、真实数据库写入、真实 Web 运营身份或独立验收。

|          |                                                                    |
| -------- | ------------------------------------------------------------------ |
| 分支     | `Junhan_Huang-W4-campus-recommend`                                 |
| 基线     | `origin/main` `66be660`（0.4.0，含 #128/#129/#145 等校园实现）     |
| 环境     | Windows / Node.js 24 / 本地 `createRouter` + 内存仓储              |
| 全量检查 | `npm run cloud:prepare && npm run check` → **1414 项通过，0 失败** |

## 任务口径说明（先说明不重复实现的部分）

team 第四周索引 [docs/week4/tasks.csv](../tasks.csv) 把本人 JH02 记为“完善收藏与纠错服务”，而 11/02 修订版计划把“地点手动打卡服务”列在 JH02。实际情况是：**手动打卡已由 Xiang Hong 在 #128/#129 实现并合入 main，Qinghan 完成地点清单、页面与云导入**；[校园推荐说明](../campus-recommendation-checkin.md)也明确基本打卡由 Xiang Hong 推进。

因此本次没有重复实现 `campus.checkIn`/`checkins`，而是补齐仍未覆盖的后端缺口：

1. 推荐理由与进入限制此前**不在公开投影、也无法通过后台维护**（数据库有字段，API 丢弃）；
2. 个人数据模块只导出收藏/纠错，**不含本人打卡**；
3. 需要一份可复核的福大地点清单结论，而不是再抄一份清单。

## 五项交付与复核

| 任务                        | 本次可核对成果                                                                                                                                           | 预期与实际                                                                                                     | 状态 / 待验                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| JH01 核验福大地点并接入读取 | [5 条地点复核记录](w4-jh01-catalogue-review.json)、[公开读取记录](w4-jh02-recommendation-records.json)                                                   | 5/5 字段完整、ID 与打卡目录一致、有效期正确、无合成/停用；公开列表和详情已返回推荐理由与进入限制               | 待 Qinghan 确认字段、Xiang Yu 确认映射；复核只证明字段完整，不代替现场真实性 |
| JH02 手动打卡服务           | 复用已合入的 `production/checkins.js` 与客户端；本次补推荐字段读取与个人打卡导出                                                                         | 打卡写入未重复实现；本人打卡能进入导出与清理（见 JH05）                                                        | 待 Yuen、Qizhen Cai 复核既有打卡链路；真实设备/云未执行                      |
| JH03 运营授权与地点维护     | [7 组权限/维护记录](w4-jh02-recommendation-records.json)：普通用户 `FORBIDDEN`、停用运营 `ACCOUNT_DISABLED`、运营读改重读                                | 地点列表、读取、编辑、保存、重读在本地走通；推荐理由/进入限制可维护                                            | 待 Qizhen Cai 复核；真实 Web 主体与 `operator_roles` 仍阻塞                  |
| JH04 补齐后台维护能力       | [`admin-rules.js`](../../../cloudfunctions/moodsky/domains/admin-rules.js)、[`campus-rules.js`](../../../cloudfunctions/moodsky/domains/campus-rules.js) | 新增 `recommendationReason`、`entryRestrictions` 白名单与投影；201 码点拒绝、`null` 可显式清空、保存后重读一致 | 待 Qizhen Chen 联调页面；任务模板/支持资源仍为 `NOT_IMPLEMENTED`             |
| JH05 校园数据模块           | [`campus-personal.js`](../../../cloudfunctions/moodsky/domains/campus-personal.js)、[导出/清理记录](w4-jh05-campus-data-records.json)                    | 导出 v2 含收藏、纠错、本人打卡；首次清理 1+1+1，第二次 0+0+0；公共地点/资源/模板保留                           | 待 Xiang Yu 复核接入；真实生命周期与导出文件未执行                           |

## 本周源码改动

| 文件                                                | 改动                                                                    | 复核人     |
| --------------------------------------------------- | ----------------------------------------------------------------------- | ---------- |
| `cloudfunctions/moodsky/domains/campus-rules.js`    | 公开摘要/详情与后台视图加入 `recommendationReason`、`entryRestrictions` | Xiang Hong |
| `cloudfunctions/moodsky/domains/admin-rules.js`     | 两个推荐字段进入可维护白名单，沿用 1—200 码点或 `null` 的校验           | Xiang Hong |
| `cloudfunctions/moodsky/repositories.js`            | 新增 `checkins.listByOwner`/`removeByOwner`，复用有界幂等删除           | Xiang Yu   |
| `cloudfunctions/moodsky/domains/campus-personal.js` | 导出 v2：新增本人打卡投影与清理计数；保留共享资料                       | Xiang Yu   |
| `tests/week4-campus-backend.test.js`                | 新增 4 项：公开字段、后台读改重读、字段校验/越权、合成/过期不公开       | Yuen Lin   |
| `tests/campus-personal.test.js`                     | 扩展为收藏+纠错+打卡三类，校验无坐标/照片字段                           | Yuen Lin   |
| `tests/support/campus-repository.js`                | 内存仓储补打卡集合                                                      | —          |
| `tools/week4-jh/*`                                  | 清单复核与证据生成器（真实路由 + 固定时钟）                             | —          |

未新增 action、未改注册表；`campus.checkIn`/`checkins` 保持 #128/#129 的既有契约。

## W4 JH01：地点清单复核

[`w4-jh01-catalogue-review.json`](w4-jh01-catalogue-review.json) 读取 Qinghan 的 [`places-approved-import.json`](../qinghan-zhang/places-approved-import.json)（NDJSON，5 条），逐条检查：

- 必需文本：名称、校区、文字方位（`address`）、推荐理由、进入限制、来源；
- `placeId` 合法且唯一，并与打卡静态目录的 5 个 ID 完全一致；
- `tags` 1—5、`enabled === true`、`isSynthetic === false`；
- `verifiedAt`/`validUntil` 可解析且后者晚于前者；
- 文本不超过 200 码点。

结果：**5/5 字段完整、0 问题、0 缺失**，源文件 SHA-256 `14633b93…a240210d`。记录中的 `fields_complete` 仅表示“可进入启用审核”，**不等于**本人独立核实了现场、开放时间或来源真实性；没有执行数据库导入，也不把 Qinghan 的“用户转述组长审核”改写成独立签认。

复核同时确认：这 5 条与打卡目录一致，因此打卡接口不会因 ID 不匹配拒绝推荐列表中的地点。

## W4 JH02/JH03：推荐读取与后台维护

[`w4-jh02-recommendation-records.json`](w4-jh02-recommendation-records.json) 用真实路由跑了 7 组：

| 场景                      | 实际结果                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------- |
| 公开列表                  | 5 条地点，返回 `recommendationReason`、`entryRestrictions`、文字方位、来源、有效期 |
| 公开详情                  | 同上，并含 `stale:false`、`validForDays`                                           |
| 运营读取                  | 额外返回 `enabled`、`isSynthetic`、`verifiedBy`、`updatedAt`、`verificationState`  |
| 运营修改推荐理由/进入限制 | `saved:true`、`verified:true`，服务端盖 `updatedAt/updatedBy`                      |
| 修改后公开读取            | 返回新文案                                                                         |
| 普通用户修改              | `FORBIDDEN`                                                                        |
| 停用运营修改              | `ACCOUNT_DISABLED`（先于角色判定）                                                 |

字段校验：201 码点、空串、非字符串均 `INVALID_INPUT`；`null` 是“暂无可核实限制”的显式值，允许清空；客户端不能写 `verifiedAt`/`verifiedBy`/`updatedAt`。

后台链路的生产入口仍未组装，真实 Web 身份（可信主体 → 内部账号 → `operator_roles`）仍缺平台配置，因此 JH03 只验收本地授权与处理器，不宣称后台已可真实运营。

## W4 JH04：推荐字段维护白名单

`admin.updatePlace` 现在可维护：

```
name, campus, tags, openState, openHours, address,
recommendationReason, entryRestrictions,
contact, accessible, location, source, validUntil, enabled, isSynthetic
```

`recommendationReason`/`entryRestrictions` 与 `address` 一样按 1—200 码点或 `null` 校验；核验戳、更新人和时间仍只能由服务端写。保存后逐字段读回，`saved` 与 `verified` 分开返回。

任务模板、支持资源、纠错审核的现状：纠错审核已在 W3 实现；模板与支持资源写入仍为 `NOT_IMPLEMENTED`，不返回假保存。

## W4 JH05：校园数据模块

[`campus-personal.js`](../../../cloudfunctions/moodsky/domains/campus-personal.js) 从 v1 升到 v2：

| 函数                        | 输出                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `collectPersonalCampusData` | `version:2`、`favorites[]`、`corrections[]`、`checkins[{placeId,date,completedAt}]`、分类计数、`truncated` |
| `clearPersonalCampusData`   | `favoritesRemoved`、`correctionsRemoved`、`checkinsRemoved`、`sharedRetained:true`                         |

实际记录 [`w4-jh05-campus-data-records.json`](w4-jh05-campus-data-records.json)：

- 清理前导出 1 收藏、1 纠错、1 打卡；
- 第一次清理 1+1+1，第二次 0+0+0，不报错；
- 清理后导出为空；
- 地点、支持资源、任务模板数量前后一致；
- 打卡只含 `placeId/date/completedAt`，**没有经纬度、轨迹、照片或位置信息**。

本模块仍只是 Xiang Yu 导出/清理执行器的校园侧接缝：不生成导出文件、凭证、删除标记或恢复流程，也不判断账号是否可停用。

## 信息影响核对（隐私规则第 3 节）

| 必填项     | 本次填写                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 功能与入口 | 校园推荐列表/详情（`campus.listPlaces/getPlace`）、后台地点维护（`admin.updatePlace`）、本人导出/注销清理（`campus-personal`） |
| 信息与用途 | 新增展示：推荐理由、进入限制（公共资料，不含个人信息）；新增导出：本人打卡地点、业务日期、完成时间（私人，仅本人与清理执行器） |
| 流向与存储 | 服务端 → 小程序；打卡存 `place_checkins`，按服务端账号隔离；不接第三方 SDK、不上传位置/照片                                    |
| 授权与拒绝 | 浏览不需要登录；打卡/导出需微信登录；打卡为用户主动点击，不申请 GPS；拒绝授权不影响浏览                                        |
| 生命周期   | 打卡进入本人导出与注销清理；公共地点资料保留；本 PR 不改变导出文件 24 小时领取期                                               |
| 平台与验证 | 未新增隐私接口或权限；未执行云/真机；UGC 图片上传仍不开放；真实平台声明与设备验证待发布负责人核对                              |

## 验证与复现

```powershell
npm ci
npm run setup
npm run cloud:prepare
npm run check          # ESLint + Prettier + structure + docs + typecheck + 1414 tests
node tools/week4-jh/review-catalogue.cjs
node tools/week4-jh/run-evidence.cjs
npx prettier --write "docs/week4/Junhan_Huang/*.json"
```

专项：

```powershell
node --test tests/week4-campus-backend.test.js tests/campus-personal.test.js tests/campus.test.js tests/admin-campus.test.js
```

全量结果：**1414 项通过，0 失败**（2026-11-07，Windows，Node 24）。新增 4 项 W4 回归，个人数据测试扩展覆盖打卡；原有公开查询、后台维护、审核与清理用例保留。

## 未执行与边界

- 未执行真实云部署/数据库写入、地点导入、真实账号与 `operator_roles`、真实 Web OAuth、真实双账号、真机或微信公开版更新。
- 未重新实现或验收 #128/#129 的打卡写入与页面；只补推荐字段读取、维护与数据导出清理。
- 清单复核是字段与一致性检查，不是现场真实性复核；`fields_complete` 不等于个人签认。
- 后台生产入口未组装，未接线环境 campus/admin 返回 `NOT_IMPLEMENTED`。
- 未完成导出文件生成、24 小时领取、注销执行器与恢复；这些属于 Xiang Yu。
- 未取得 Qinghan、Qizhen Chen、Qizhen Cai、Xiang Yu、Yuen Lin 的独立复核。

## 复核清单

| 复核人      | 需要确认                                                          |
| ----------- | ----------------------------------------------------------------- |
| Qinghan     | 5 条清单的名称/方位/理由/限制是否与实际页面一致；字段是否够展示   |
| Qizhen Chen | 后台维护页能否编辑两个新字段；失败是否保留输入                    |
| Xiang Hong  | 公开投影新增字段是否可接受；未新增 action                         |
| Qizhen Cai  | 普通/停用/伪造身份拒绝；打卡导出是否仅本人可见                    |
| Xiang Yu    | `checkins` 集合字段与清理顺序；`campus-personal` 接入完整导出流程 |
| Yuen Lin    | 新增 4 项回归与打卡导出测试的归属                                 |

## 记录字段（计划 §16）

| 字段     | JH01              | JH02                         | JH03                 | JH04        | JH05                  |
| -------- | ----------------- | ---------------------------- | -------------------- | ----------- | --------------------- |
| 任务编号 | W4 JH01           | W4 JH02                      | W4 JH03              | W4 JH04     | W4 JH05               |
| 承接     | W3 JH01/JH02      | W3 JH04 / #128               | W3 JH03              | W3 JH04     | W3 JH05               |
| 协作人   | Qinghan、Xiang Yu | Jiawei、Qizhen Chen、Qinghan | Qizhen Chen、Qinghan | Qizhen Chen | Xiang Yu、Jiawei      |
| 复核人   | Qinghan、Xiang Yu | Yuen、Qizhen Cai             | Qizhen Cai           | Qizhen Chen | Xiang Yu、Qizhen Cai  |
| 前置输入 | QH01 清单         | 已合入打卡服务               | 真实 Web 身份        | 后台页面    | `place_checkins` 字段 |
| 实际耗时 | 待本人填写        | 待本人填写                   | 待本人填写           | 待本人填写  | 待本人填写            |
| 难度点   | 待本人估          | 待本人估                     | 待本人估             | 待本人估    | 待本人估              |
| 验收状态 | 待复核            | 待复核                       | 待复核               | 待复核      | 待复核                |
| 阻塞     | 现场真实性签认    | 真实设备/云                  | 平台身份配置         | 页面联调    | 完整生命周期          |

## 关键交接（计划 §15）

| 方向                      | 内容                             | 状态                   |
| ------------------------- | -------------------------------- | ---------------------- |
| Junhan → Qinghan          | 清单字段复核结论、公开字段       | 本目录 JH01            |
| Junhan → Qizhen Chen      | 后台可维护字段与失败语义         | 本目录 JH03/JH04       |
| Junhan → Xiang Yu         | 打卡/收藏/纠错导出字段与幂等清理 | 本目录 JH05            |
| Junhan → Yuen、Qizhen Cai | 权限与数据边界用例               | 本目录证据 JSON        |
| Qinghan → Junhan          | 首批地点清单与页面               | 已收，待现场真实性确认 |
| Xiang Hong → Junhan       | 打卡服务与契约                   | 已合入，沿用未改       |

> 难度点取 1、2、3、5、8；实际工时与难度由本人填写，不由工具代估。
