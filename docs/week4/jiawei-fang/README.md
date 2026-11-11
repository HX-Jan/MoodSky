# Jiawei Fang 第四周交付（截至11月8日）

岗位：任务、偏好与账号流程后端。五项为**本轮交付、待独立复核**，不代签、不代填本人耗时与点数。真实云、真实设备、真实第二位用户**均未执行**，与合成证据分列；JF02 是**提案，未定稿**，在 Qizhen Chen / Junhan Huang / Qinghan Zhang 共同确认前不当作契约。

## 五项与入口

| 任务                    | 交付                                                                     | 状态                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| JF01 账号与停用接入差异 | [接入矩阵与四类边界](jf01-account-disable-matrix.md)                     | 待复核；本项未发现缺陷，真实登录/云未测                                                                    |
| JF02 与前端共同定稿规则 | [任务与打卡共同规则提案](jf02-task-checkin-contract.md)（C1—C11 待确认） | 提案，未定稿；待三方共同确认                                                                               |
| JF03 私人任务服务链路   | [复合服务](jf03-task-checkin-service.md)、候选实现与 T01—T25             | 待复核；写前地点预校验与 pending 重试已补测，候选未接线，真实事务/设备未测                                 |
| JF04 偏好与 Me 页面联调 | [偏好契约核对与修复](jf04-preference-me.md)                              | 待复核；源码级修复已完成，真机走查未做                                                                     |
| JF05 任务偏好导出与停用 | [导出覆盖与清理范围](jf05-export-cleanup.md)                             | 待复核；候选集合已隔离（正式导出/清理/白名单不含，导出为 opt-in 候选通道）；formatter 展示与纠错导出仍缺口 |

## 代码改动（正式路径只做隔离，候选能力未接线）

新增（候选）：

- `cloudfunctions/moodsky/services/task-checkins.js`：复合动作 `tasks.checkin` / `tasks.checkinHistory` / `tasks.checkinStatus`，把同一 `requestId` 原样转发给任务域与打卡服务；未注册进 `ACTIONS`、未接部署入口。
- `cloudfunctions/moodsky/stores/task-checkin-links.js`：关联记录（每账号单文档，`links` 只存 `committed` 关联，`requests` 保存 `pending` 意图与等价去重回执；`pending` 单独 50 条配额、超 24 小时回收，不计入 500 容量）。

修改：

- `cloudfunctions/moodsky/production/accounts.js`：`updatePreferences` 增加 `checkedPreferencePatch`，只写入 `cardTextPreview` / `decorationsEnabled` 两个布尔字段，其余键 `INVALID_INPUT` 且不写行、不推进来源修订。原先该函数直接展开任意 `patch`，属可信内部接缝的防御缺口（动作层 `services/account-candidate.js` 已收窄，客户端不可直达）。
- `cloudfunctions/moodsky/domains/cleanup.js`：候选 `COLLECTIONS` 仍含 `task_checkin_links`（该服务未接线），按 `ownerId` 只删本人关联文档；不扩到 `places`、`task_templates` 等公共数据，也不涉 `place_corrections`（见下）。
- `cloudfunctions/moodsky/production/cleanup.js`：正式 `COLLECTIONS` **不含** `task_checkin_links`，固定 11 项已部署集合；目标环境缺该集合时正式注销清理不再卡在待处理（`JF05-W4-10`、`JF05-W4-13`）。
- `cloudfunctions/moodsky/domains/export.js`：`SOURCES` **不含** `task_checkin_links`（只含已部署集合）；新增 `CANDIDATE_SOURCES` 候选通道，只有 `includeCandidateSources: true` 才读取，默认 `false`、非 boolean 抛 `TypeError`、opt-in 且集合缺失返回 `CONFLICT`；开启后条件键 `taskCheckins` 只投影 `ownerId/taskId/placeId/linkedDate/linkedAt`，既有导出键不变。
- `cloudfunctions/moodsky/production/database.js`：生产集合白名单**不含** `task_checkin_links`；候选集合沿白名单直接报 `Unknown production collection`（与「未部署」声明一致）。
- `database/collections.json`：保留 `task_checkin_links` 条目（SOURCE PLAN ONLY、本人任务与自报到访关联、Not deployed、`uniqueKeys=[["ownerId"]]`），作为将来部署的声明；未改 `defaultClientRule`。
- `tests/helpers/offline-wx-database.js`：撤销 `task_checkin_links` 的 owner 查询允许项，恢复主干形状；离线替身不再静默回答候选集合的查询。
- `cloudfunctions/moodsky/services/task-checkins.js` / `stores/task-checkin-links.js`：写路径先做地点预校验（与打卡服务同规则），预校验失败零写入且不写 pending；打卡半程失败返回 `CONFLICT` + `pending`，同 `requestId` 重试补全；未注入 `findPlace` 时 `tasks.checkin` 返回 `NOT_IMPLEMENTED`。
- `miniprogram/modules/account/production.js`：保存偏好时把用户选择作为**临时预览**保留，失败提示「未保存到云端，已保留你的选择」；只有服务端回包含两个布尔字段才允许提示「已保存到云端」，否则 `INVALID_RESPONSE` 并可重试原请求。

未改：`IDENTITY_KIND`、稳定身份密钥、`router.js`、`shared/contracts.js` 的 `ACTIONS`、`index.js`、`production/backend.js`、`services/checkins.js`、`services/tasks-candidate.js`。

## 验证证据（合成，可复现）

```
npx prettier --write <改动文件>            # All matched files use Prettier code style!
npx eslint <改动 .js>                      # exit 0
node --test tests/week4-task-checkins.test.js tests/week4-jf05-export-cleanup.test.js tests/week4-jf05-cleanup-isolation.test.js tests/week4-jf05-export-isolation.test.js tests/export-source-atomic.test.js
npm test                                  # tests 1475 / pass 1475 / fail 0（当前工作树快照）
```

新增用例：T01—T25（复合服务 25 项）、JF01 4 项、JF04 5 项；本轮新增 JF05 隔离回归 9 项（W4-10—13、ISO-01—05），连同原有 W4-01—09 共 18 个顶层用例（`node --test` 计 20 项，含 W4-11 的 2 个子用例）；未放宽既有断言。本次按要求未运行 `npm run check`。独立复审见 [11月7日记录](../../reviews/2026-11-07-week4-jiawei-review.md)。

## 跨模块风险（接线前必须先解决）

1. **存在两套打卡实现**：`production/backend.js` 实际接的是 `production/checkins.js`（写 `place_checkins` + 兼容读 `campus_checkin_states`），而候选复合服务复用 `services/checkins.js`（单文档 `campus_checkin_states`）。两者布局不同，直接接线会让复合记录与线上打卡读写不同集合。`docs/week4/qinghan-zhang/checkin-implementation.md` 与 `merge-review-handoff.md` 均写「已将 services/checkins 接入 production/backend」，与代码不符，建议由 Qinghan / Xiang Hong 更正文档或统一实现。
2. **`task_checkin_links` 仍未部署**：`database/collections.json` 条目写明 SOURCE PLAN ONLY、本人任务与自报到访关联、Not deployed、`uniqueKeys=[["ownerId"]]`。本轮已把它从正式导出（`SOURCES`）、正式清理（`production/cleanup.js`）与生产白名单（`production/database.js`）隔离，正式路径不再查询它；部署时需按该条目创建集合与索引、沿用 `defaultClientRule` 的客户端禁读禁写，并登记回正式清理与白名单。
3. **`requestId` 规则不一致**：任务域 8—80 无前缀要求，打卡服务要求 `req_` 前缀；复合取交集 `^req_[A-Za-z0-9_-]{4,76}$`，建议接口评审时统一。
4. **`place_corrections` 未覆盖**：候选 `domains/cleanup.js` 与导出 `SOURCES` 均缺该集合（`production/cleanup.js` 已有）。属收藏纠错范围，未擅自扩入本次改动。
5. **`task_checkin_links` 已隔离为 opt-in 候选通道**：`domains/export.js` 的 `SOURCES` 不含它，只有 `includeCandidateSources: true` 才读取并输出 `taskCheckins`；正式清理与生产白名单不含；候选 `domains/cleanup.js` 仍含但未接线；集合尚未部署，正式环境清理/导出需接入后验证。残余是候选 formatter 尚未渲染该键、字段命名与保留期待评审，见 [JF05 §5](jf05-export-cleanup.md) 与 §8 E6。
6. **关联文档的增长与 pending 上限**：`links` 受 500 条容量约束，但等价去重的 `committed` 回执无 TTL，会随请求累计；`pending` 单独 50 条配额，极端情况下合法请求仍可能 `CONFLICT`。接线前需确认保留期/拆表与配额是否满足上线量级。
7. **停用校验不是同一事务**：`transition`/`taskHistory` 的 write path 前有一次独立 `assertActive`，`router.js:72-74` 另有账号状态门；任务域候选自身没有 active 门。窗口已被 router 压小，但接线评审需确认是否需要更强门（见 [JF03 §1.4](jf03-task-checkin-service.md)）。

## 未测与阻塞

| 事项                                             | 所需输入 / 提供人                         | 恢复条件                                                               |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| 真实微信登录、真实云事务与索引                   | 云环境权限；Xiang Hong / Xiang Yu         | 取得测试环境并完成一次真实登录                                         |
| 真实设备（任务页、打卡页、Me 页）                | 候选包与设备；Qizhen Chen / Qinghan Zhang | 打包候选并走查                                                         |
| 第二位真实用户的跨账号隔离                       | 真实第二账号；Qizhen Cai                  | 独立账号到位                                                           |
| 正式地点目录、有效期与开放状态                   | Junhan Huang / Qinghan Zhang              | 地点清单核验通过                                                       |
| 导出文件生成/下载、真实清理执行器                | Xiang Yu                                  | 部署候选入口后执行一次真实流程                                         |
| `task_checkin_links` 部署与正式环境清理/导出验证 | 集合与索引部署；Xiang Yu / Xiang Hong     | 集合部署并登记回正式清理与白名单后，用真实停用账号跑一次正式清理与导出 |
| JF02 共同结论（C1—C11）                          | Qizhen Chen / Junhan / Qinghan            | 三方确认后转为本项定稿契约                                             |

## 第五周输入

- 复合服务的接口评审结论：动作名、是否注册 `ACTIONS`、两套打卡实现如何统一、停用校验是否需要更强门。
- 偏好白名单与失败保留在真机上的表现，以及 Me 页面字段与服务端契约的最终对齐。
- `task_checkin_links` 的部署与接入：部署集合与索引、登记回 `production/cleanup.js` 与 `production/database.js` 白名单、补 formatter/页面渲染；之后用真实停用账号验收正式清理幂等与部分失败（Xiang Yu / Xiang Hong）。
- `taskCheckins` 的候选 formatter/页面渲染、字段命名与保留期/拆表方案（Xiang Yu / Xiang Hong / Linghan Chen）。
- 写前地点预校验与打卡半程 `CONFLICT`/`pending` 恢复语义的接口确认（Qizhen Chen / Junhan Huang / Qinghan Zhang）。
- `place_corrections` 的导出与清理归属确认。

本文件只汇总已发生的改动与证据；未执行项目一律标注未测，不因源码合并或测试数量追认验收。
