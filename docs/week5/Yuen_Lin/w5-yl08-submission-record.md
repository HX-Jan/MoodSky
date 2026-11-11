# W5-YL06 提交记录

- 提交时间：2026-11-10 22:00—22:10（Asia/Shanghai）
- 提交人：Yuen Lin
- 用户确认：已确认“可以”，按“提交分支并创建 PR”执行
- 结论：分支已推送、PR 已创建；**未部署、未上传微信、未调用云、未写库**

## 一、提交信息

| 项目     | 实际值                                                                  |
| -------- | ----------------------------------------------------------------------- |
| 分支     | `docs/yuen-lin-week5-delivery`                                          |
| 提交     | `0d50f3a46f3f54823970626e4120d7557e8ca27c`                              |
| 提交标题 | `docs(week5): add Yuen Lin integration regression and candidate review` |
| PR       | [#170](https://github.com/HX-Jan/MoodSky/pull/170)                      |
| PR 标题  | `docs(week5): Yuen Lin 集成回归、候选核对与提审意见`                    |
| 目标分支 | `main` @ `28f810c77e5aae887e9753c65588d0bad85df7f3`                     |
| PR 状态  | `OPEN`、`MERGEABLE`、`mergeStateStatus=BLOCKED`（等待复核）             |
| 变更范围 | 只新增 `docs/week5/Yuen_Lin/`，未修改业务源码、云配置、数据库或 CI      |

## 二、CI

| 项目     | 实际值                                                                                        |
| -------- | --------------------------------------------------------------------------------------------- |
| Workflow | `MoodSky CI`                                                                                  |
| Run      | [`42830394800`](https://github.com/HX-Jan/MoodSky/actions/runs/42830394800)                   |
| Job      | [`129878584944`](https://github.com/HX-Jan/MoodSky/actions/runs/42830394800/job/129878584944) |
| Check    | `quality`                                                                                     |
| 结果     | `pass`，54 秒                                                                                 |
| 首次提交 | `0d50f3a`                                                                                     |

证据：[pr-view.json](artifacts/yl05/pr-view.json)、[pr-checks.txt](artifacts/yl05/pr-checks.txt)、[ci-run.json](artifacts/yl05/ci-run.json)。

本记录本身会作为后续文档提交推送到同一 PR，触发新的 CI；后续结果以 PR checks 为准，不把首次 CI 写成后续提交的结论。

## 三、未执行

- 未部署 `moodsky-release` 或 `moodsky-release-maintenance`。
- 未上传微信体验版/正式版，未提交审核，未发布。
- 未调用 `system.health` 或任何真实业务接口。
- 未写数据库、未改索引/权限、未执行清理或恢复。
- 未执行 Android/iOS 真机、目标云、A/B 账号、导出文件领取或注销。
- 未取得 1.0.0 候选包；本 PR 不改变 `uploaded/deployed/phoneVerified=false` 的候选状态。

## 四、后续

1. 请洪翔复核基线、候选缺口、验收矩阵和提审意见；请蔡奇真独立出具隐私/生命周期结论。
2. 若周三上传微信新版本后补 Android 真机，使用与提审包相同的版本/SHA 回填矩阵；提审后结果不能倒签为提审前通过。
3. 若 PR 需要修改，按新提交重新出包并复测受影响路径；不把本地通过写成真实云/真机通过。
4. 1.0.0 候选、目标云、旧 0.3.0 客户端兼容和独立签认仍是提审前缺口。
