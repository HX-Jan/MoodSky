# W1 · Jiawei Fang —— 小任务、偏好及账号流程后端

- 学号：832401110
- 任务：JF01—JF05（依据 `docs/week1/first-week-detailed-plan.md` 与 `handoffs/02-jiawei-fang.md`）
- 代码基线：`5c4aa3f`（main）；工作分支：`week1/jiawei-fang-account-tasks`
- 岗位主责目录：`cloudfunctions/moodsky/domains/tasks.js`、`account.js` 中的偏好 / 内部账号解析 / 停用 / 注销入口 / 受限进度接口；`F17—F21、F23`
- 复核：Xiang Hong；独立检查：Qizhen Cai；协作：Xiang Yu、Linghan Chen、Qizhen Chen、Yifan Ji

## 成果清单

| 编号 | 任务                 | 成果                                                                                          | 状态                                               |
| ---- | -------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| JF01 | 可信微信账号解析验证 | `w1-jf01-account-identity.md`、`w1-jf01-local-results.json`、`tests/account-identity.test.js` | 本地替身验证通过（11/11）；真实云未执行            |
| JF02 | 任务接口与状态转换   | `w1-jf02-task-contract.md`                                                                    | 契约草案，待接口评审                               |
| JF03 | 偏好、停用与受限回执 | `w1-jf03-preference-close-receipt.md`                                                         | 契约草案 + 回执门禁本地验证通过                    |
| JF04 | 任务与偏好数据能力   | `w1-jf04-data-capability.md`                                                                  | 清单已就绪，待 Xiang Yu 确认                       |
| JF05 | 账号门禁联调         | `w1-jf05-gate-integration.md`                                                                 | 检查表已就绪；**需 Yuen Lin、Qizhen Cai 共同执行** |

## 本地验证结果（可复现）

```
node --test tests/account-identity.test.js
# tests 11 / pass 11 / fail 0
```

11 项全部为本地替身与内存账号集合，**没有任何云调用**。真实云结果按要求保持为空，不代填。

## 状态口径

- 本地替身验证通过：仅登记「该路径在替身下通过」，不扩展为账号功能完成。
- 真实云调用：**未执行**，原因与所需权限见表内阻塞项。
- 未实现业务：`account.js`、`tasks.js` 仍为 `NOT_IMPLEMENTED` 骨架，本目录不含其实现。

## 与作业文档草稿的契约对齐修正

初版草稿写于拿到仓库之前，按作业描述推断，与仓库真实契约有 6 处不一致，已全部改按仓库为准：

| 项             | 草稿（错误）                           | 仓库真实契约                                                                     |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| 任务 action 名 | `task.suggestions` 等                  | `tasks.suggestions` / `tasks.transition` / `tasks.history` / `tasks.quickChoice` |
| 偏好 action    | `preference.get` / `preference.update` | 单一 `account.preferences`（`mutates: true`），需定 `operation` 或拆分           |
| 偏好字段       | 自拟 `motionEnabled` / `version`       | `cardTextPreview`(false) / `decorationsEnabled`(true)，见 `shared/constants.js`  |
| 错误码         | 自拟 `TASK_STATE_CONFLICT` 等          | 只能用 `shared/contracts.js` 既有枚举，新增需注册表评审                          |
| 身份字段处理   | 「忽略 payload 身份字段」              | `validation.js` 直接 `INVALID_REQUEST` 拒绝（7 个保留字段）                      |
| 回执鉴权       | 会话校验                               | `account.cleanupStatus` 为 `receipt` 访问级别，不看 OPENID                       |

## 阻塞项与所需输入

| #   | 需要什么                                                                    | 向谁                               | 影响                             |
| --- | --------------------------------------------------------------------------- | ---------------------------------- | -------------------------------- |
| 1   | `task_history` 是否加唯一键 `ownerId + taskId + date` 的决定                | Xiang Yu（`database/` 主责）       | JF02 并发转换是否可能产生重复行  |
| 2   | 回执字段名统一：router 读 `payload.receipt`，清理设计写 `receiptCredential` | Xiang Yu + Xiang Hong              | `account.cleanupStatus` 能否接通 |
| 3   | `account.preferences` 采用 `operation` 还是拆成两个 action                  | Xiang Hong（注册表）+ Linghan Chen | JF03 接口形状                    |
| 4   | 测试环境权限与真实云验证授权                                                | Xiang Hong                         | JF01/JF05 真云结果               |
| 5   | 与 Yuen Lin、Qizhen Cai 的联调时间                                          | 二人                               | JF05 完成                        |

## 复核与验收（由本人实际确认后填写）

| 项目                    | 内容                                   |
| ----------------------- | -------------------------------------- |
| 提交版本 / PR           |                                        |
| Xiang Hong 复核意见     |                                        |
| Qizhen Cai 独立检查意见 |                                        |
| 实际耗时（人时）        |                                        |
| 后续任务估点            | JF01=5、JF02=5、JF03=3、JF04=2、JF05=3 |
