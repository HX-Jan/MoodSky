# PR 说明

> 已按用户 2026-11-20 确认推送分支并创建 [PR #197](https://github.com/HX-Jan/MoodSky/pull/197)。本文件保留为 PR 说明来源；首次提交 `df193ee` 的 `quality` CI 通过。

## 标题

`docs(week6): Yuen Lin 回归矩阵、候选装配与证据归档`

## 分支与基线

- 分支：`docs/yuen-lin-week6-delivery`
- 基线：`origin/main` @ `5b2775393a4adbf5d9a77ff2a3c61b3c3bb3958c`（`v0.5.2`）
- 任务：W6-YL「回归、候选装配与证据归档」第 1—4 项
- 复核：洪翔

## 本次改动

仅新增 `docs/week6/Yuen_Lin/`，包含：

- W6-YL01 基线、环境与执行人锁定；
- W6-YL02 回归矩阵（28 项，覆盖正常、失败、重试、切号、设备与平台）；
- W6-YL03 两个 `closed` 本地候选的 manifest 与哈希核对；
- W6-YL04 未测项与阻塞清单（B01—B15）；
- W6-YL05 队友第六周材料复核（含 #196 工具独立复跑）；
- W6-YL06 放行与提审意见；
- W6-YL07 本 PR 说明；
- W6-YL08 提交记录；
- `artifacts/` 原始命令输出、定向测试日志、候选清单与哈希。

未修改业务源码、云函数、数据库、导航、CI、共享契约或成员文件。

## 实际验证

- 在最终干净提交 `5b27753` 运行：`npm ci`、`npm run setup`、`npm ci --prefix cloudfunctions/moodsky`、`npm run cloud:prepare`、`npm run check`、`node scripts/check-cloud.js`、`npm audit --audit-level=high --prefix cloudfunctions/moodsky`、`npm run team:check`、`npm run team:check:production`、`git diff --check`，全部退出码 0。
- 完整检查 **1634/1634** 通过；定向 7 组共 **1258** 项（子集，不重复相加）全部通过。
- 从 `c0518e5` 装配 **0.5.1**、从 `5b27753` 装配 **0.5.2** 两个 `closed` 本地候选；`sourceWorktreeDirty=false`、`campusCheckinWritesPausedByDefault=true`、客户端与两支云包哈希已记录；`uploaded/deployed/phoneVerified/submittedForReview/publicRelease` 均为 `false`。
- 独立复跑 #196 的 `tools/week6-jh/checkin-samples.cjs`，23 组样例摘要与提交件一致（PR 未合并，不进入候选）。

## 隐私与内容安全影响

| 项目                                 | 本次变化、依据及未完成项                     |
| ------------------------------------ | -------------------------------------------- |
| 信息字段、来源、用途和可见范围       | 无新增字段或采集；仅文档、测试日志与候选清单 |
| 接口/权限、SDK/插件及数据流向        | 未改接口/权限/SDK；未连接真实云              |
| 告知、同意、拒绝及撤回/用途变更      | 不适用：验证与文档                           |
| 保存、导出、删除、注销、日志和备份   | 未执行；仅记录既有测试与阻塞                 |
| 隐私/UGC/审核机制/类目声明及生效证据 | 未新增；未声称平台审核                       |
| 客户端/后端构建、验证结果和发布阻塞  | 本地通过；目标云、真机、平台与独立结论仍阻塞 |

## 边界与待办

- 未上传云函数、未部署、未写数据库、未执行清理或恢复、未上传微信体验版/正式版。
- 未使用真实微信身份、真实日记、导出凭证、令牌或位置轨迹。
- 未取得洪翔签认、蔡奇真独立结论；W6-JQ/W6-JF/W6-C 未回传。
- 0.5.1/0.5.2 两个候选不是同一包；任何复测需注明目录与 `sourceCommit`。

## 复核请求

请洪翔核对：基线选择、两个候选的来源与 manifest、回归矩阵状态、W6-JQ/JF/C 缺件、#196 未合并，以及周末放行/提审意见。Yuen 的本地结果只作为候选证据，不能替代发布决定、独立隐私结论或成员真机回填。
