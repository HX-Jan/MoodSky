# W6-JF｜Jiawei Fang · 任务服务、偏好与账号停用

2026-11-21。第六周任务卡 W6-JF，本地合成验证；**没有真实云、真实微信账号、真机或微信后台操作**。

- 计划基线：`987b19d675bfe7a8f4b14c0cb1b25d508483d329`
- 本次源码起点：`035b96b060ad45830f93f89a96847e7bb7ad91cd`（origin/main，含本周已合并成员成果）
- 环境：Windows 11 / Git Bash；Node.js v24.15.0；仓库合成夹具与离线 SDK 传输；无网络、无真实数据
- 证据采集时点：2026-11-21 23:38–23:58；审查修复后重跑定向 29/29、全量 1676，产品代码修正 `tasks.quickChoice` enabled 文案，并统一公共建议与私人任务的模板校验边界
- 分支：`week6/jiawei-fang`；远端已推送：<https://github.com/HX-Jan/MoodSky/tree/week6/jiawei-fang>；PR [#233](https://github.com/HX-Jan/MoodSky/pull/233)

## 交付

| 交付                           | 入口                                                                                                                           | 状态                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| 三种任务模式与模板读取规则样例 | [task-mode-samples.json](task-mode-samples.json)                                                                               | 本地通过，待 Qizhen Chen 对照       |
| 模式/模板逐行结果              | [mode-template-results.csv](mode-template-results.csv)                                                                         | 本地通过                            |
| 状态矩阵、回执、跨日与写入次数 | [W6-JF 任务模式与状态](w6-jf-task-modes.md)                                                                                    | 本地通过，待 Yuen 复核              |
| 账号边界与生命周期             | [账号状态图](account-state-map.md) + [account-boundaries.json](account-boundaries.json)                                        | 本地通过，待 蔡奇真 / Xiang Yu 复核 |
| 日志 1 服务供稿                | [progress.md](progress.md)                                                                                                     | 可交洪翔汇总                        |
| C1 周期回传                    | [c1-return.md](c1-return.md)                                                                                                   | 执行结果已填；待本人确认与复核      |
| 定向回归                       | `tests/week6-jf-task-modes.test.js`（23 项）                                                                                   | 23/23 通过                          |
| 账号边界回归                   | `tests/week6-jf-account-boundaries.test.js`（6 项）                                                                            | 6/6 通过                            |
| 复现工具                       | [collect-samples.cjs](../../../tools/week6-jf/collect-samples.cjs)、[local-world.cjs](../../../tools/week6-jf/local-world.cjs) | 可复跑                              |
| PR 文稿                        | [PR_BODY.md](PR_BODY.md)                                                                                                       | 待建 PR                             |

## 结论

1. **三种模式是两套门禁，不是一套枚举。** `closed/readOnly/enabled` 是客户端构建范围；服务端只有 `tasksWritesEnabled` / `MOODSKY_TASK_WRITES_PAUSED`。本文件验证能力矩阵（`M01`）；页面级“closed 不发请求 / readOnly 隐藏写按钮 / enabled 回执后跳转”由 W6-QC 的页面回归覆盖，两边不互相替代。`production` profile 下不可信会话或未配置云会落到 `unavailable`；非 production 开发配置不能用于发布判定（`M02` 特征化）。
2. **模板读取规则成立。** 正式 `task_templates` 有启用行时只用正式行；只有读取成功且启用行为空才回退内置三条建议；读取失败或正式行不合法时整次失败，不拼接、不伪造空成功。空集合的“成功为空”与读取失败的“明确错误”在响应中可区分。**“停用全部模板”等于回退内置，且内置任务可被写**（`T08`）；若运营要求停用=下线，需产品评审。
3. **任务状态与重试可计数。** select / complete / replace / skip 均按北京时间业务日写入；同一任务同日只保留一行当前状态。同 `requestId` 同摘要重放不新增历史/回执；**新 `requestId` 同终态重放不新增历史，但会新增 1 条回执**（`R05`、`terminalReplay`），二者不能混用。跨日首次送达的旧请求 `CONFLICT` 且零写入；已提交回执跨午夜仍按首次日期回放。
4. **账号停用与清理边界成立。** close 在同一事务里停用账号、建立唯一 `pending` 清理任务并置 `exportAccessRevoked=true`；停用后所有私人动作返回 `ACCOUNT_DISABLED`，公开建议仍可读；清理只删本账号在既定集合中的行，B 与公共模板保留，残留只有账号墓碑与清理台账。进度回执只读其绑定的 `jobId`。
5. **未测：** 目标云真实调用与权限、真实微信账号 A/B、真实服务器时钟跨时区/午夜、真实定时触发器与多实例并发清理、真机。不能把本次本地通过写成云端或平台生效。

## 风险与待决

- **候选 `taskMode=closed` 只关客户端，不关云函数。** `createProductionEntry` 的 `tasksWritesEnabled` 默认 `false`；但部署入口 `exports.main` 采用 `process.env.MOODSKY_TASK_WRITES_PAUSED !== 'true'`，未设该环境变量时服务端仍接受写请求。`0.5.1` 候选以客户端 `closed` 关闭入口；若要求服务端同时拒绝，部署时须显式设置 `MOODSKY_TASK_WRITES_PAUSED=true`。这是部署配置，不是源码默认，建议在放行结论中写明。
- **读取失败没有任务专用错误码。** 生产入口统一返回 `INTERNAL_ERROR`；客户端显示“任务读取失败，请重试”，不会伪装成空列表。若产品希望区分“目录不可用/权限失败/网络失败”，需另立接口评审，本周不改契约。
- **清理进度回执是 bearer 能力，不按账号二次绑定。** 它只返回 `state/progress` 计数，不含正文或身份；回执泄漏时应按凭证处理，不写入日志或截图。
- **生产 `tasks.quickChoice` 形状与 W2 域测试仍不一致。** 生产入口走 public candidate，只返回一条 `tasks` 入口且没有 `suggestions`；W2 S05 期望两条入口加建议，W1 契约示例只列两条入口。本轮修正了 enabled 下“任务操作仍待接入”的假文案（`Q01`），但入口数量、`places` 保留与是否返回建议仍需接口负责人统一；客户端只消费 `entries`，未观察到功能中断。

## 复现

```sh
npm run cloud:prepare
node tools/week6-jf/collect-samples.cjs "$PWD/docs/week6/jiawei-fang"
node --test tests/week6-jf-task-modes.test.js tests/week6-jf-account-boundaries.test.js
npm run check
```

样例由本地 `createProductionEntry` 生成；任务样例走离线 SDK 原生数据库传输，账号样例走既有本地合成夹具。所有请求 ID、业务日、时钟和种子固化在脚本内，重复运行应得到相同结构。账号、`openid`、`scope`、`receipt`、`jobId` 在输出中已脱敏。

## 变异验证

为避免测试空转，临时移除三处关键实现并确认对应用例先失败，再还原到 29/29 通过。实际输出见 [evidence/mutation.txt](evidence/mutation.txt)。

| 临时移除                                        | 失败用例                 |
| ----------------------------------------------- | ------------------------ |
| `production/backend.js` 的内置模板回退          | `W6-JF-T01`、`W6-JF-T05` |
| `tasks-candidate.js` 的 `expectedDate` 跨日拒绝 | `W6-JF-R03`              |
| `tasks-candidate.js` 的只读写拒绝               | `W6-JF-S01`              |

还原后 `git diff` 为空，定向 29/29、全量 1676 通过（完整结果见 [evidence/full-check.txt](evidence/full-check.txt)）。

## 四周期任务对照

依据成员任务分册中的 JF 分册（Issue #205）：

| 周期        | 计划要求                                       | 当前状态                                                                                                                                                                    |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 11-21—22 | 三模式、模板有效/空/失败、账号入口与日志 1     | 本页交付；待 Qizhen Chen / 蔡奇真复核                                                                                                                                       |
| C2 11-23—24 | 动作前后状态、失败/重试、偏好/停用边界、日志 2 | 已预生成 [task-transition-results.csv](task-transition-results.csv)、[account-boundaries.csv](account-boundaries.csv)；见 [C2 说明](c2-progress.md)。周期未开始，未宣称通过 |
| C3 11-25—26 | 当前主干复验、页面/生命周期独立验收、日志 3    | 未开始；需 C2 合入与 Qizhen/Xiang Yu 反馈                                                                                                                                   |
| C4 11-27—28 | 最终候选模式、外部待验清单、个人总结           | 未开始                                                                                                                                                                      |

C2 的 15 行动作表与 34 行账号表由当前 C1 样例派生，C2 开始后仍须在当期主干复跑；不代表 C2 已验收。

## 交接

- **Qizhen Chen：** 以 [task-mode-samples.json](task-mode-samples.json) 对照其 [W6-QC 三模式矩阵](../qizhen-chen/README.md) 与 `service-samples.json`；重点核对客户端 `taskMode` 与服务端 `readOnly` 各自值、模板空/少/多种子、以及同一 `requestId` 的 `replayed` 语义。
- **Yuen Lin：** 在本提交上复跑两个定向文件和全量检查，核对最终候选的 `taskMode` 与云环境 `MOODSKY_TASK_WRITES_PAUSED` 是否一致；不要用本轮本地数字替代候选复测。
- **蔡奇真：** 独立核对偏好、停用后私人访问、清理残留与 B/公共数据完整性；[account-boundaries.json](account-boundaries.json) 是可复跑的合成结果，不是独立验收。
- **Xiang Yu：** 对齐 close 的入队字段、`exportAccessRevoked`、清理集合和回执绑定；其 [W6-XY](../XiangYu/README.md) 的真实触发器、自然到期与多实例并发仍列补验。
- **Linghan Chen：** 对齐 `ACCOUNT_DISABLED` 的客户端清理：`services/api.js` 清会话、记录页清空、任务页进入不可用态、导出预览与迟到响应不落地；本轮不改其页面。

信息影响：仅新增本地合成测试、样例与报告；不改产品字段、权限、SDK、采集、UGC、分享或数据生命周期。
