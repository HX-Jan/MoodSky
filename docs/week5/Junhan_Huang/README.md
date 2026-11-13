# Junhan Huang 第五周交付（W5-JH：校园数据与目标云打卡）

2026-11-12，按《第五周详细任务计划》W5-JH 与 W5-R06—R12 整理。结论先行：**本地链路通过，但目标云 `moodsky-release` 0.4.0 与当前客户端打卡契约不一致，私人打卡不能按已验证能力放行；建议 1.0.0 只开放五地点推荐与文字方位（只读），打卡保留为候选。**

本记录不改变 11/11 已提交的提审包，也不代替发布人对云端、平台和真机的核对。

|          |                                                                |
| -------- | -------------------------------------------------------------- |
| 分支     | `Junhan_Huang-W5-campus-checkin`                               |
| 基线     | `origin/main` `e985543`（含 #167/#171/#174/#175/#176）         |
| 环境     | Windows / Node.js 24 / 本地生产装配 + 模拟数据库；无云、无真机 |
| 专项结果 | 69 项通过，0 失败（打卡后端、历史客户端、刷新、outbox、导出）  |
| 全量检查 | `npm run check` 1601 项通过，0 失败                            |

## 一、关键结论：目标云接口不一致

[`w5-jh01-checkin-contract-audit.json`](w5-jh01-checkin-contract-audit.json) 对比了四处来源：

| 来源                                                            | 打卡相关 action                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 当前 Campus 页实际使用                                          | `campus.checkIn`（写入）、`campus.checkins`（当日状态）、`campus.checkinHistory`（历史） |
| 当前源码生产后端                                                | 同时接受 `campus.checkIn`、`campus.checkins`、`campus.checkin`、`campus.checkinHistory`  |
| 共享注册表                                                      | 四个都在                                                                                 |
| 目标云 `moodsky-release` 0.4.0（Qinghan 只读诊断 + 下载包比对） | 只有 `campus.checkin`、`campus.checkinHistory`                                           |

因此实际页面在目标云上会得到 `ACTION_NOT_FOUND`，这与 Qinghan 的模拟器/真机截图“接口不存在”一致。审计结论为 `blocked`，缺 `campus.checkIn`、`campus.checkins`。

**修复路径**：部署当前后端（源码已同时兼容四个别名，旧客户端与新客户端都能用），或在提审范围内把校园入口收敛为只读。仅改客户端为小写 `campus.checkin` 仍无法补上 `campus.checkins` 的当日状态读取，因此不是完整修复。

## 二、五地点核验与开放意见

[`w5-jh02-place-readiness.json`](w5-jh02-place-readiness.json) 复核 Qinghan 的 5 条已批准清单：

- 5/5 推荐字段完整（名称、校区、文字方位、推荐理由、进入限制、来源）；
- 5/5 在 2026-11-12 截止时仍在有效期（`validUntil` 2027-04），启用且显式非合成；
- 5/5 与打卡目录 ID 一致；
- **本人未独立到现场核验**，进入限制仍来自 Qinghan 的现场记录；`independentSiteVisitByJunhan: 0`。

所以可以支持“推荐 + 文字方位”的只读开放，但不能把“实际可进入/开放时间”写成 Junhan 已独立验证。推荐字段中的开放说明继续标注“以现场为准”。

## 三、本地真实链路（W5-R07—R12）

[`w5-jh03-checkin-chain-records.json`](w5-jh03-checkin-chain-records.json) 记录 8 组实际结果，源自真实生产装配与模拟数据库：

| 能力                | 实际结果                                                           |
| ------------------- | ------------------------------------------------------------------ |
| 同日并发/重复点击   | 只保留 1 条 `place_checkins`；两请求都成功                         |
| 跨日重放原请求      | 返回原日期与原 `completedAt`，`replayed:true`；当天新请求另建 1 条 |
| 原 requestId 换地点 | `CONFLICT`，不写入                                                 |
| 失效地点新增        | `INVALID_INPUT`，不写入                                            |
| 失效地点历史        | **仍可读**，历史保留                                               |
| 暂停打卡            | 原回执、当日状态、导出保留；新写入 `NOT_IMPLEMENTED`               |
| 账号隔离/历史分页   | A/B 隔离、分页稳定、旧数据兼容                                     |
| 导出/清理           | 打卡进入 JSON/Markdown 导出与本人清理                              |

### 本周代码修复：失效地点不再丢历史

此前 `production/checkins.js` 的存储投影要求 `placeId` 必须仍在当前 `PLACES` 目录中。地点一旦下架，旧打卡在历史读取时会 `CONFLICT`，与 W5-R11“拒绝新增、历史保留”相反。

修复：

- 存储历史只校验 `placeId` 形态（`^[A-Za-z0-9_-]{1,64}$`），不再要求当前目录成员；
- **新增写入仍要求当前 `PLACES`**，失效地点照旧拒绝；
- 客户端历史接受同样的形态，并对已下架地点显示“已下架地点”，不提供打卡入口；
- 新增后端与客户端各 1 项回归，69 项专项全部通过（日志见 [`w5-jh-check-log.txt`](w5-jh-check-log.txt)）。

## 四、与 Xiang Yu 的导出/清理对齐

[`w5-jh04-export-cleanup-alignment.json`](w5-jh04-export-cleanup-alignment.json) 记录：

- 生产导出读取 `place_checkins`（`placeId/date/completedAt`）并兼容旧 `campus_checkin_states`；
- 生产清理按 owner 删除 `place_checkins`、`campus_checkin_states`、回执与删除标记，公共地点/资源/模板保留；
- W4 的 `campus-personal` v2 返回 `favoritesRemoved/correctionsRemoved/checkinsRemoved`；
- **未执行**真实文件生成、24 小时领取、真实注销清理与目标云集合/权限核对。

## 五、W5-R06—R12 状态

| 编号 | 内容                         | 本地                 | 目标云/真机                            | 状态               |
| ---- | ---------------------------- | -------------------- | -------------------------------------- | ------------------ |
| R06  | 五地点推荐/文字方位/游客浏览 | 5/5 字段与有效期通过 | 页面可见，筛选/详情入口待 Qinghan 定稿 | 只读可开，待真机   |
| R07  | 手动打卡与当日状态           | 通过                 | `campus.checkins` `ACTION_NOT_FOUND`   | **阻塞**           |
| R08  | 同日去重/并发/跨日原请求     | 通过                 | 未执行                                 | 本地通过，云端阻塞 |
| R09  | 断网/超时/隐藏恢复           | 客户端保护通过       | 无弱网真机                             | 阻塞               |
| R10  | 历史分页/切号/迟到响应       | 通过                 | 历史接口存在，当日状态接口缺失         | 部分阻塞           |
| R11  | 失效地点拒绝新增、历史保留   | 修复后通过           | 无失效地点云资料                       | 本地通过，云端未测 |
| R12  | 打卡导出/注销清理            | 模拟链路通过         | 文件后端与清理未执行                   | 阻塞               |

## 六、放行建议

1. **1.0.0 只读放开校园**：五地点、推荐理由、文字方位、来源与有效期可以展示；隐藏或明确禁用打卡按钮，避免用户看到“接口不存在”。
2. **不把私人打卡写成已验证**：目标云缺两个 action，真机也没有成功写入证据。
3. 若发布人决定更新目标云：用当前 `main` 构建 `moodsky-release`，确认四个 action、`place_checkins`/`campus_checkin_states`/`request_receipts` 集合与“客户端禁直读写”权限，然后用旧 0.3.0 客户端验证兼容，再按候选包流程复测 R07—R12。
4. 现场开放时间仍以 Qinghan 记录为准，Junhan 未独立到访；不新增虚构时间。

## 七、复现

```powershell
npm ci
npm run setup
npm run cloud:prepare
npm run check
node --test tests/manual-campus-checkin.test.js tests/campus-history-client.test.js tests/campus-daily-refresh.test.js tests/checkin-outbox.test.js tests/checkin-export-compatibility.test.js
node tools/week5-jh/audit-checkin-contract.cjs
node tools/week5-jh/review-place-readiness.cjs
```

全量检查结果见提交 PR 正文；专项 69 项通过，日志保存在本目录。

另修正 `tests/journal-pages.test.js` 中一处依赖真实日期的共享 demo 用例：原固定使用 2026-10-14，超过 30 天新建窗口后必然失败；改为最近一个未播种业务日，保留“清空共享服务仍保留原适配器”的原断言意图。这与打卡功能无关，但不修正会让当前 main 的全量检查在 11/13 之后持续失败。

## 八、边界与隐私

- 未调用 CloudBase、未部署、未改目标云权限、未使用真实账号或真实私人记录。
- 打卡仍是用户自报完成，不申请 GPS、地图、照片；导出只含 `placeId/date/completedAt`。
- 未执行真实文件导出、24 小时领取、注销清理；这些需要 Xiang Yu 的文件后端与专门测试账号。
- 未取得 Yuen、Qizhen Cai 的独立复核；真机结果引用 Qinghan 的用户反馈，不作为本人验收。

## 九、复核清单

| 复核人     | 需要确认                                                |
| ---------- | ------------------------------------------------------- |
| Yuen Lin   | 69 项专项与新增回归；候选包是否包含本次后端修复         |
| Qizhen Cai | 打卡历史只读本人、失效地点不新增、导出/清理不含他人数据 |
| Qinghan    | 五地点只读展示；失效地点历史的“已下架地点”文案          |
| Xiang Yu   | `place_checkins` 字段、导出/清理顺序与目标云集合权限    |
| 发布人     | 目标云是否重部署；若不部署，1.0.0 校园入口收敛为只读    |

## 十、记录字段

| 字段              | 内容                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| 任务编号          | W5-JH，对应 W5-R06—R12                                                |
| 协作人            | Qinghan Zhang、Xiang Yu、Yuen Lin、Qizhen Cai                         |
| 复核人            | Yuen Lin、Qizhen Cai                                                  |
| 前置输入          | 五地点清单、目标云只读诊断、当前 `main` 生产装配                      |
| 实际耗时 / 难度点 | 待本人填写                                                            |
| 验收状态          | 本地通过；目标云与真机阻塞                                            |
| 阻塞              | `campus.checkIn`/`campus.checkins` 未部署；无真实 A/B、弱网与文件后端 |
