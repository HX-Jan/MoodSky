# 日志 1 服务供稿｜W6-JF

- 对应：[AS-JF01 / #205](https://github.com/HX-Jan/MoodSky/issues/205)、W6-JF 第 1—3 项
- 本人：Jiawei Fang / GitHub `Karl-syst3m`
- 源码起点：`035b96b060ad45830f93f89a96847e7bb7ad91cd`；交审 head 以 PR 为准
- 环境：Windows 11、Git Bash、Node.js v24.15.0；本地合成夹具/离线 SDK，无云、无真实账号
- 状态：本地通过，待 Qizhen Chen（三模式/样例）、Yuen（复跑/候选）、蔡奇真（账号边界）复核

## 本期实际完成

1. 产出 [task-mode-samples.json](task-mode-samples.json) 与 [mode-template-results.csv](mode-template-results.csv)：三模式、模板空/少/多/停用/非法/读取失败、select/complete/replace/skip、跨日重放与 A/B 隔离。所有请求带固定 `requestId`、`expectedDate`、业务日与时钟；响应含 `readOnly`、状态、`replayed` 和写后行数。
2. 新增 `tests/week6-jf-task-modes.test.js`（18 项）：客户端三模式能力、模板回退与失败、只读拒绝、四动作、终态/跨日/原请求重试/提交失败重试、A/B 隔离、生产 history 形态。
3. 新增 `tests/week6-jf-account-boundaries.test.js`（6 项）：偏好隔离与部分写、close 一次性停用/入队/撤销导出、停用后私人访问、清理进度与 B/公共数据完整性、回执绑定、失败回滚、重复 close。
4. 产出 [account-state-map.md](account-state-map.md) 与 [account-boundaries.json](account-boundaries.json)，把停用、入队、清理、回执和客户端 `ACCOUNT_DISABLED` 收敛写清，并与 Xiang Yu（清理/导出）、Linghan（客户端状态）对齐。
5. 全量 `npm run check` 通过；实际数量见 [evidence/full-check.txt](evidence/full-check.txt)。

## 对日志 1 有用的结论

- 任务三模式是客户端构建范围，服务端只有布尔写入门禁；候选 `taskMode=closed` 关闭 UI，但部署入口默认仍接受写，除非设 `MOODSKY_TASK_WRITES_PAUSED=true`。放行结论必须同时写这两个值。
- 模板规则：正式启用行优先；仅“成功读取且为空”回退内置三条；读取失败/非法行整次失败，不拼接。
- 同 `requestId` 同摘要重试恢复原结果，不二次写；跨日旧请求零写入；已提交回执跨午夜按首次日期回放。
- 停用后私人访问全部 `ACCOUNT_DISABLED`；公开建议仍可读；清理只删本账号，B 与公共模板保留；残留为账号墓碑 + 清理台账。

## 仍需他人完成

- Qizhen Chen：用 [task-mode-samples.json](task-mode-samples.json) 对照其页面矩阵与 `service-samples.json`，确认三模式/模板/回执口径；其独立复核意见由其本人填。
- Yuen：在本提交上复跑定向与全量，核对最终候选 `taskMode` 与云环境写入门禁；候选数字不得用本轮本地数字替代。
- 蔡奇真：独立核对偏好、停用、清理残留与 B/公共数据；本报告不代签。
- Xiang Yu：确认真实触发器和多实例清理仍在其 M1—M9 补验单；本轮只证明本地 step/guard。
- Linghan：真机上的停用首屏、A/B 切号、导出预览清理仍待真机；本轮只复跑源码回归。

## 未测

目标云真实调用/权限、真实微信账号、真实服务器时钟午夜与跨时区、真实定时触发器、多实例并发清理、真机与微信后台。未执行项不得在放行结论中记为通过。
