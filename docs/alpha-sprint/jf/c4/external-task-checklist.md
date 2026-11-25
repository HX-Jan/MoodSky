# C4-JF 外部待验清单

基线：7feca53ff0ed461cac270b7da7e7c36f36b7973b（C4 提前执行；最终冻结提交待洪翔指定）。本清单只列本地无法完成、需要实际凭据或设备的项目；未执行前状态一律外部待验，不写入本地通过。

| 编号 | 待验项                     | 通过所需证据                                                                                                                           | 当前状态 | 建议接手              |
| ---- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------- |
| E1   | 冻结提交与候选模式         | 洪翔确认的完整 SHA、taskMode、候选清单；与本目录基线的差异说明                                                                         | 未取得   | 洪翔                  |
| E2   | 候选 manifest 与哈希       | Yuen 从干净提交装配；manifest.sourceCommit、sourceWorktreeDirty、版本、taskMode、campusCheckinWritesPausedByDefault、客户端/两云包哈希 | 未执行   | Yuen                  |
| E3   | 目标云真实身份             | 目标环境真实 OPENID 登录、账号隔离与健康响应；不得用合成身份替代                                                                       | 未执行   | 洪翔 / Yuen           |
| E4   | 正式 task_templates 与边界 | 目标云启用模板逐行在收紧边界内（id≤64、标题≤60、步骤 1—10 每步≤120、时长 1—600、标签≤10 每项≤20）；空/停用状态如何处理                 | 未核对   | 模板归属人 / 洪翔     |
| E5   | 服务端写入开关             | 候选 taskMode 与 MOODSKY_TASK_WRITES_PAUSED 一致；closed/readOnly 候选不得被云端写入口绕过                                             | 未核对   | 洪翔 / Yuen           |
| E6   | 真实时钟与时区             | 北京时间跨午夜首次送达旧 expectedDate 返回 CONFLICT；已提交回执跨午夜回放首次日期                                                      | 未执行   | Yuen                  |
| E7   | 真实清理执行               | 定时触发器、多实例并发、progress 单调、A 残留 0、B/公共保留；备份/日志残留说明                                                         | 未执行   | Xiang Yu / 蔡奇真     |
| E8   | 真机任务页与切号           | 三模式入口、提示、跳转、完成态；停用首屏；A/B 切号与迟到响应                                                                           | 未执行   | Qizhen Chen / Linghan |
| E9   | 独立验收意见               | Qizhen Chen（页面/服务）、蔡奇真（账号边界）、Yuen（最终回归）在 #205 的实际意见                                                       | 未回传   | 三位复核人            |
| E10  | 发布/博客/CSDN             | 微信上传、后台隐私与审核、CSDN 第五次作业合集提交与链接                                                                                | 未执行   | 洪翔 / 发布负责人     |

## 本地已具备、可直接复跑

    npm run cloud:prepare
    node --test tests/week6-jf-task-modes.test.js tests/week6-jf-account-boundaries.test.js tests/week6-qc-task-flows.test.js
    npm run check

预期：40/40、1693/1693。C4 实际日志见 evidence/c4-final-recheck.tap 与 evidence/full-check.txt。

## 使用边界

- 本清单不是发布检查单；E1—E10 未完成前不能写“最终候选通过”或“云端已验”。
- 候选模式若为 closed，不能用 enabled 的本地页面/写入结果替代 closed 候选验证。
- 所有证据只保留脱敏状态、计数和摘要，不写真实 openid、正文或回执原文。
