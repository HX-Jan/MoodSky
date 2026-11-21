# DD-07 导出样例与回执对齐包（W6-XY → Linghan C2/C3）

Linghan 在 PR #216 的 `docs/alpha-sprint/l/c3/account-export-regression.csv` 最后一行留了「Xiang Yu 服务端领取／失效／停用／清理回执样例 — 待对齐」。这里补的就是那一格：**服务端真实返回**，不是界面稿。回执由生产入口 `cloudfunctions/moodsky/production` 在仓库现有的内存库与注入时钟上跑出，界面文案取自 `miniprogram/modules/account/production.js` 的现实现。

## 文件

| 文件                                                   | 内容                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| [export-sample-json.json](export-sample-json.json)     | A 账号合成数据的 JSON 导出（1.0-candidate，字段顺序即真实输出）         |
| [export-sample-markdown.md](export-sample-markdown.md) | 同一份数据的 Markdown 导出（中文标签、代码块保留换行）                  |
| [receipts.json](receipts.json)                         | 16 条回执，含 request／response 原文；`content` 与 `receipt` 已脱敏替换 |
| [receipt-matrix.csv](receipt-matrix.csv)               | 同内容表格，可直接并入 C3 结果表                                        |

生成命令：`node tools/week6-xy/export-receipts.cjs`（构建 `6e91ead92dd8ecc143e38bff956ff239e4765296`；账号、正文、地点均为 `SIMULATED` 合成值，无真实云、无真机）。

## 服务端状态 → 界面（与 `miniprogram/modules/account/production.js` 一致）

| `job.state`            | 状态标签 `exportState()` | 提示 `exportNotice()`                  | 可用动作                          |
| ---------------------- | ------------------------ | -------------------------------------- | --------------------------------- |
| `ready`                | 可领取                   | 导出已就绪，可领取文件或查看内容。     | 保存/发送、查看内容、领取兼容文本 |
| `pending`/`processing` | 处理中                   | 导出仍在处理中。                       | 查询导出状态                      |
| `expired`              | 已过期                   | 导出已过期，请保留所选格式并重新申请。 | 按原格式重新申请                  |
| `failed`               | 失败                     | 导出失败，请保留所选格式并重新申请。   | 按原格式重新申请                  |

停用后：页面标题「账号已停用」，提示「账号已停用。清理进度以服务器返回为准。」，只保留「查询清理进度」。

领取冲突（`CONFLICT`）要特别注意：客户端**不直接显示服务端这句文案**，而是回查状态再决定（`production.js:390-413`）——仍为 `ready` 时显示「领取未完成，服务状态仍为可领取。可重试保存或重新申请。」，已 `expired`/`failed` 时显示对应的过期/失败文案。同一句服务端 `CONFLICT` 同时覆盖「尚未生成完」「已失效」「正文校验失败」三种情况，DD-07 若按错误码画三个页面就会多画。

## 16 条回执

| 编号 | 事件                              | 服务端返回                                                                                                                                                          | 界面表现                                   |
| ---- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| R1   | 申请 JSON 导出                    | `ok`；`jobId`、`state=ready`、`format=json`                                                                                                                         | 进入「可领取」                             |
| R2   | 查询状态（ready）                 | `ok`；同 R1                                                                                                                                                         | 状态「可领取」，格式 JSON                  |
| R3   | 领取 JSON                         | `ok`；`jobId`、`format=json`、`extension=json`、`byteLength`、`content`                                                                                             | 保存/预览，文件名用 `extension`            |
| R4   | 申请并领取 Markdown               | `ok`；`format=markdown`、`extension=md`、`byteLength`、`content`                                                                                                    | 格式 Markdown，扩展名 `md`                 |
| R5   | 记录改动后查旧导出                | `ok`；`state=expired`                                                                                                                                               | 「已过期」，保留格式重新申请               |
| R6   | 记录改动后领取旧导出              | `CONFLICT`／导出尚未完成或已失效，请重新读取。                                                                                                                      | 回查为 expired → 过期文案 + 重新申请       |
| R7   | 到期后查状态（24 小时整点即过期） | `ok`；`state=expired`                                                                                                                                               | 同 R5                                      |
| R8   | 到期后领取                        | `CONFLICT`／导出尚未完成或已失效，请重新读取。                                                                                                                      | 同 R6                                      |
| R9   | B 账号查 A 的 job                 | `FORBIDDEN`／导出尚未完成或已失效，请重新读取。                                                                                                                     | 不显示他人任务，不提示是否存在             |
| R10  | 注销账号                          | `ok`；`accountStatus=disabled`、`sessionRevoked=false`、`sessionRevocation=not_implemented`、`privateActionsDenied=true`、`cleanup{jobId,state=pending}`、`receipt` | 「账号已停用。清理进度以服务器返回为准。」 |
| R11  | 停用后查询导出状态                | `ACCOUNT_DISABLED`／账号已停用。                                                                                                                                    | 不展示导出状态                             |
| R12  | 停用后申请新导出                  | `ACCOUNT_DISABLED`／账号已停用。                                                                                                                                    | 申请入口禁用                               |
| R13  | 清理进行中的进度回执              | `ok`；`state=processing`、`progress{journals,preferences}`                                                                                                          | 按集合显示已删除计数                       |
| R14  | 清理完成回执                      | `ok`；`state=completed`、`progress{journals,preferences,request_receipts,export_jobs}`                                                                              | 「清理完成」与总量                         |
| R15  | 状态刷新带不匹配的 jobId          | `FORBIDDEN`／导出尚未完成或已失效，请重新读取。                                                                                                                     | 拒绝替换已确认任务，保留当前视图           |
| R16  | 无注销回执读清理进度              | `FORBIDDEN`／清理进度回执无效。                                                                                                                                     | 不显示任何进度或分项                       |

回执外层固定为 `{apiVersion:"1", requestId, action, ok, data|error{code,message}}`；`R10` 的 `receipt` 是清理进度唯一凭证，原文已替换为 `<redacted:N-chars>`，不复用、不外传。

## 与 C3 `account-export-regression.csv` 的对照

| C3 行                    | 本包对应      | 说明                                                                    |
| ------------------------ | ------------- | ----------------------------------------------------------------------- |
| 正常领取（state=ready）  | R1—R4         | JSON 与 Markdown 各一条完整链路                                         |
| 状态刷新返回不匹配       | R15           | 未知/他人 jobId 一律 `FORBIDDEN`，文案与冲突一致，不泄露存在性          |
| 下载冲突但服务端仍可领取 | R6 反面       | 服务端到期才回 `CONFLICT`；仍 ready 时客户端回查得到 ready 并保留重试   |
| 任务到期（time／source） | R5—R8         | 状态与领取两侧都覆盖；来源失效与时间到期同一 `expired`                  |
| 记录改动使旧导出失效     | R5、R6        | 改动后旧 job 立即 `expired`，不重写任务                                 |
| 账号停用后新建导出       | R12           | `ACCOUNT_DISABLED`，围栏先于业务逻辑                                    |
| 停用后的旧账号视图       | R11、R9       | 迟到的状态回执不能回填旧视图                                            |
| 清理进度（注销后）       | R10、R13、R14 | 注销回执 → 处理中 → 完成；进度按已提交分项持久化                        |
| 清理文件删除重试         | R13—R14       | 分批 `step` 语义，重放不重复计数                                        |
| 状态元数据不泄露内容     | R2、R5、R7    | 状态只回 `jobId/state/format`，无正文、无文件引用                       |
| 导出与源版本一致性       | R5            | 源变更后旧导出失效                                                      |
| 界面反馈的中文可辨识性   | 全部          | 每条 `message` 与页面文案一一对应                                       |
| Xiang Yu 服务端回执样例  | 本目录        | 原「待对齐」行可改为「通过（样例已到）」，证据写 `receipts.json#R1–R16` |

## 边界（照实写，便于复核）

- 本构建的导出为同步生成，`pending`/`processing` 在本地没有观察到；界面仍按代码保留「处理中」，该态只在云函数分片或超时后出现。
- `planClaim`/`authorizeRead`（300 秒领取凭证）**未接入**领取路径；领取是会话范围 + 库内哈希校验。回执里没有 claim token，DD-07 不要画「领取码/凭证」。
- 清理进度只能凭注销回执读取；无回执一律拒绝（R16）。
- 样例全部为合成数据；真实云、真机文件送达、自然到期与多实例并发仍按 [维护与补验单](../W6XY-维护与补验单.md) 的 M1—M9 待验。
- 在同一构建上复跑 `node tools/week6-xy/verify-export-cleanup.cjs`：14/14 场景、137 项检查通过（与 W6 报告一致）。
