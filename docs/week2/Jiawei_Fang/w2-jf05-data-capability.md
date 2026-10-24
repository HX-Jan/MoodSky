# W2 JF05 任务与偏好数据能力交付及联合复核

| 项目     | 内容                                                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| 任务编号 | W2 JF05                                                                                      |
| 承接     | W1 JF04《任务与偏好数据处理能力清单》、W1 JF05《账号门禁联调与复核》                         |
| 关联需求 | UW3-F17/F19（任务建议与历史）、UW3-F21（偏好）、UW3-F22（导出字段投影）、UW3-F23（清理幂等） |
| 协作人   | Xiang Yu（导出组织、清理执行器）、Linghan Chen（前端状态）、Qizhen Chen（任务前端字段）      |
| 复核人   | Qizhen Cai（账号隔离与越权）、Yuen Lin（账号到记录调用）、Xiang Hong（接口口径）             |
| 版本     | 0.2.0（package.json 未改版本号）                                                             |
| 环境     | 本地 Node 24 + 内存 store 替身 + 注入 clock；真实云/数据库/回执密钥均为**未执行**            |
| 成果路径 | 见 §2；接口口径见 W2 JF02、JF03、JF04 三份文档                                               |
| 实际耗时 | 待本人确认（不得由代理代填）                                                                 |
| 验收状态 | **待复核**；真实云联调与联合复核项 **阻塞**                                                  |
| 阻塞     | 真实云授权、`CLOUD_RECEIPT_SECRET` 未配置、清理执行器未接通、联合复核人未参与                |

## 1. 结论先行

- 本人数据能力的**入口与字段口径已落地并有本地测试**：`tasks.history`（本人任务历史）、`account.preferences`（本人偏好）、`task_history` / `preferences` 的幂等清理约定。
- **导出**只交付字段投影与边界，文件生成/领取/到期仍由 Xiang Yu 主责，本次未实现也未声明可用。
- **清理执行器**未实现（按 2026-10-12 分工归 Xiang Yu）；本次交付的是可重复清理的**数据侧约定**（按 `ownerId` 分批、删不存在不报错、如实返回失败）与 `account.close` 幂等创建 `cleanup_jobs` 的入口。
- 联合复核（W1 JF05 §2 的 X05—X12）**本次未执行**，不能由本地替身结果推断已通过。

## 2. 能力清单（本次实际交付）

| 集合             | 归属             | 本人查询                                     | 导出字段                                             | 可重复清理             | 清理顺序               |
| ---------------- | ---------------- | -------------------------------------------- | ---------------------------------------------------- | ---------------------- | ---------------------- |
| `task_history`   | 本人             | `tasks.history`（private，仅本人，游标分页） | `date`、`taskId`、`state`、`createdAt`               | 目标是（执行器未实现） | 第 3 位，Xiang Yu 执行 |
| `preferences`    | 本人             | `account.preferences`（operation=get）       | `cardTextPreview`、`decorationsEnabled`、`updatedAt` | 目标是（执行器未实现） | 第 4 位，Xiang Yu 执行 |
| `task_templates` | **运营公共资料** | 只读（`tasks.suggestions`）                  | 否                                                   | **否**                 | 公共数据，不删除       |

代码位置：

- `cloudfunctions/moodsky/domains/tasks.js`（`tasks.suggestions/quickChoice/transition/history`）
- `cloudfunctions/moodsky/domains/account.js`（`account.preferences/close/cleanupStatus`）
- `cloudfunctions/moodsky/identity.js`（可信账号解析、回执签发/校验）
- `cloudfunctions/moodsky/stores/tasks-store.js`、`stores/account-store.js`（内存 + 云 DB 草案，云实现未对真云验证）

## 3. 导出投影边界

- 包含：本人 `task_history` 与 `preferences` 字段（见 §2）。
- 不包含：他人任何字段、`task_templates` 运营资料、内部账号标识与 `openid` 映射、日记正文。
- `ownerId` 只由服务端写入；导出条目不得回显 `ownerId`/`openid`。
- **待确认（沿用 W1 JF04 §6-3）**：导出是否固化任务模板标题快照。当前 `task_history` 只存 `taskId`，模板改名后导出可读性下降，本次未擅自加字段。

## 4. 可重复清理（数据侧约定，执行器另派）

「可重复执行」= 同一清理动作执行 N 次与 1 次结果一致：

1. 删除已不存在的行不报错，返回「已清理」；
2. 不以「先查总数再删」作为唯一依据；
3. 每次执行产出可核对结果（已清理行数），供 `cleanup_jobs.progress` 使用；
4. 失败如实返回失败与原因，不得标 `completed`。

本次**未交付**执行器与分批器：`account.close` 只负责幂等创建 `cleanup_jobs(pending)` 并置账号 `disabled`，`account.cleanupStatus` 只做受限回执读取，`progress` 不返回（避免编造计数）。因此「清理完成」在本周不可达，属**阻塞**而非缺陷。

## 5. 联调记录（只登记实际执行过的）

| 项目     | 内容                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 执行日期 | 2026-10-24（本地）                                                                                                                                          |
| 参与人   | 仅本人（Jiawei Fang 交付物由代理协助生成，联合复核人未参与）                                                                                                |
| 环境     | 本地 Node 24、内存 store、注入 clock；未连真实云                                                                                                            |
| 覆盖     | `npm run check` 全绿（rebase 到 de4ed97 后 677 项；pre-rebase 快照 306）；JF01 9 项、JF02 40 项、JF03 8 项、JF04 16 项、入口装配 3 项、repository 对接 8 项 |
| 未执行   | X05—X12 真云/跨模块项、导出领取、清理执行、双账号真机隔离                                                                                                   |
| 通过项   | 见 `docs/test-reports/2026-10-24-week2-jiawei/README.md` 的逐项结论                                                                                         |
| 阻塞项   | 真实云授权、回执密钥、清理执行器、联合复核人排期                                                                                                            |

数字来源（可回指命令输出）：JF01 = `node --test tests/week2-account-identity.test.js` 的 `tests` 行 = 9（复审后新增 D10 的「唯一键冲突但回查为空」用例）；account 三个测试文件合计 9 + 8 + 16 = 33。旧稿写的「JF01 30 项」是不同口径的错记，已改为真实来源。JF02 = 建议 6 + 转换 22（复审后新增 T21/T22）+ 历史 12 = 40。

## 6. 第一周欠缺交接的补齐情况

- W1 JF01—JF05 五份文档已在库（`docs/week1/Jiawei_Fang/`），本次不重写、不重复计分。
- 仍缺本人输入：**实际工时、完整项目估点、独立验收意见**（W1 H05 收集项），属本人填写范围，代理不代填 → 记**阻塞**。
- W1 JF05 §2 的 X05—X12 联合执行项仍为「待执行」，本次仅在本地补强了对应的自动化用例（门禁/回执/隔离），不改变其执行状态。

## 7. 剩余缺陷与待确认（与三份子文档一致）

| 编号 | 问题                                                           | 影响                             | 归属/下一步                        |
| ---- | -------------------------------------------------------------- | -------------------------------- | ---------------------------------- |
| R1   | 重复 `account.close` 被 router 以 `ACCOUNT_DISABLED` 先拒      | 与 W1 提案「返回同一 jobId」不同 | 待 Xiang Hong 复核（数据层已幂等） |
| R2   | `cleanup_jobs` 无唯一键，read-then-insert 有竞态窗口           | 极端并发可能建两个 job           | Xiang Yu（数据库变更）             |
| R3   | 三处 payload 白名单写在域模块，未进 `shared/validation.js`     | 校验口径分散                     | 接口 PR 统一（shared 本周冻结）    |
| R4   | `task_history` 同日一行 upsert，不保留中间转换                 | 缺同日审计轨迹                   | 待确认是否加事件集合               |
| R5   | `tasks.history` 返回 `entries`、replace 用 `replacementTaskId` | 与 W1 样例/未定字段可能不一致    | 前端（Qizhen Chen）确认后统一      |
| R6   | 回执 TTL 900 秒为提案值，未与 Xiang Yu 的清理设计对齐          | 长任务进度查询可能过期           | Xiang Yu + Xiang Hong              |
