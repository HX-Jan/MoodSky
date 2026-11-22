# C2-JF 预生成与接续（日志 2 草稿）

C2-JF 周期为 2026-11-23—24。本页在 11-22 C1 收尾时预生成 C2 所需机器表，**不代表 C2 已开始或已通过**；C2 开始后需在当期主干与当期样例上复跑。

## 已预生成

| 文件                                                       | 行数 | 来源                                               | 覆盖                                                                                                                   |
| ---------------------------------------------------------- | ---- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [task-transition-results.csv](task-transition-results.csv) | 15   | [task-mode-samples.json](task-mode-samples.json)   | select/complete/replace/skip、同 requestId 重放、跨午夜回放、新 requestId 同终态、空 catalogue、提交失败与原请求重试   |
| [account-boundaries.csv](account-boundaries.csv)           | 34   | [account-boundaries.json](account-boundaries.json) | 偏好默认/部分写/回读/B 隔离、close、停用后 9 个私人动作、公开建议、回执 4 个边界、清理逐步进度、重复 close、B 私人访问 |

生成命令：

    node tools/week6-jf/collect-samples.cjs "$PWD/docs/week6/jiawei-fang"
    node tools/week6-jf/export-c2-csv.cjs "$PWD/docs/week6/jiawei-fang"

## C2 已可对应的条目

1. **四动作与本人历史**：task-transition-results.csv 的 transition-01—08 给出前置状态、动作、确认后状态、回执与历史行数；replace 同时记录原任务 replaced 与替代任务 selected。
2. **失败/未知/重试**：failure-first（注入提交失败，0 历史/0 回执）与 failure-retry（同 requestId、同 payload、同日期，1/1）可直接对账。客户端“结果未知”另见 W5/W6-QC 的 pending 用例，本轮不重复造页面夹具。
3. **北京时间跨日**：transition-08 为 11-19 首次送达 11-18 的旧请求，CONFLICT、零写入；transition-replay-midnight 为已提交回执跨午夜回放首次日期。
4. **偏好隔离**：pref-defaults-a/set-a/read-a 与 pref-defaults-b 为 A/B 两账号；B 不受 A 写入影响。
5. **停用/注销/清理**：account-close-a、denied-_、cleanup-step-_、cleanup-complete、repeat-close-* 对应 close→停用→入队→清理→完成回执；与 Xiang Yu 的 M3/M8 边界一致。

## C2 仍缺的输入

- Qizhen Chen 对页面提示、跳转、完成态的当期反馈；C2 需要把服务状态与页面实际状态对齐，不能只列服务结果。
- Xiang Yu 的停用/注销/清理当期结果；本页只证明本地 step/guard，不替代其真实触发器与多实例结论。
- Linghan 对 ACCOUNT_DISABLED 客户端清理的当期回归。
- 真实超时/断网/多端并发：本地用提交失败与 pending 夹具替代，未做真实网络与多端。

## 日志 2 段落草稿

> C2-JF 在 C1 服务样例上补了动作前后状态与原请求对账：select/complete/replace/skip 均以服务确认回执为准，同 requestId 重放不重复写历史，新 requestId 同终态只新增回执；失败请求零写入，原请求重试后 1 行历史/1 条回执。跨日旧请求 CONFLICT、已提交回执跨午夜按首次日期回放。偏好按账号隔离，停用后 9 个私人动作均 ACCOUNT_DISABLED，close 的入队、导出撤销与清理进度可逐条对上；B 与公共模板保留。以上为本地合成结果，真实超时、云端触发器与多实例并发未验。

## 与 C1 的边界

- C1 交付的是模式/模板/账号入口样例；C2 交付的是动作前后状态、失败/重试、偏好与停用边界。C1 文件不因 C2 预生成而改称已验收。
- C3（11/25—26）才做“当前主干复验 + 页面/生命周期独立验收”；C4（11/27—28）才做最终候选模式与个人总结。本轮不提前声明。
