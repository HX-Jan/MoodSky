# PR 描述（W1 Jiawei Fang）

> 用途：开 PR 时直接复制下方正文粘贴到 GitHub。本文件只是描述文本，不含代码。
> 分支：`week1/jiawei-fang-account-tasks`｜需求编号：UW3-F17 / F18 / F19 / F20 / F21 / F23

---

## 本次改动

关联 Issue：无对应 Issue（如需可先开 feature issue）

需求编号：UW3-F17 / F18 / F19 / F20 / F21 / F23

说明具体行为与涉及模块：

- 新增 `tests/account-identity.test.js`：用本地账号替身验证 `createRouter` 门禁，覆盖正常、无可信身份、重复/并发进入、停用账号四类结果，以及受限清理回执的门禁行为（11 个用例，无任何云调用）。
- 新增 `docs/week1/Jiawei_Fang/`：JF01 结果记录与机读证据、JF02 任务接口与状态转换契约、JF03 偏好/停用/受限回执契约、JF04 数据能力清单、JF05 门禁检查表。
- **未改动任何生产文件**；`domains/tasks.js`、`domains/account.js` 仍为 `NOT_IMPLEMENTED` 骨架。

## 验证

- [ ] 整合或发布前已核对成员 PR……（拥有者流程，本 PR 不适用）
- [x] `npm run cloud:prepare` 和 `npm run check` 通过（lint / format / structure / 196 项测试，0 失败）
- [x] 已记录关键正常/异常行为的验证；环境与结果：本地 Node.js 24.15.0 + 本地替身，无云调用，明细见 `docs/week1/Jiawei_Fang/w1-jf01-local-results.json`
- [x] 若改接口/数据/公共变量，已同时更新约定、调用方和测试 —— 本 PR 未改接口、数据或公共变量
- [x] 未上传个人配置、真实私人数据或凭证

需要的评审人（按 docs/team.md）：

Xiang Hong（路由器与账号解析）、Xiang Yu（accounts / task_history 字段与唯一键）、Junhan Huang（adapters.js 边界）；独立检查 Qizhen Cai。

尚未完成或影响其他成员的部分：

1. 首次创建规则 R1–R4 仅为提案 + 替身验证；生产实现与接线涉及 `adapters.js` / `index.js`，需另开接口 PR，由 Junhan Huang、Xiang Hong 共同复核。
2. 回执字段名冲突：`router.js` 读 `payload.receipt`，清理设计写 `receiptCredential`，需统一后才能接通 `account.cleanupStatus`。
3. `task_history` 当前无唯一键；建议 `ownerId + taskId + date`。平台支持复合唯一索引已有探针证据（W1XY02 / PR #3），是否在正式集合建索引需 Xiang Yu 决定。
4. `tasks.*` 的 payload 白名单校验尚未实现（当前只有 `journal.upsert` 有校验器）。
5. 真实云验证未执行；JF05 需与 Yuen Lin、Qizhen Cai 联合执行。
