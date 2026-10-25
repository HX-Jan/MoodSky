# W2 Yuen Lin 上传前检查清单

状态：**已推送分支并创建 PR #50，quality CI 通过；未部署云函数、未上传小程序、未写数据库。合入仍需 @HX-Jan 审批。**

- PR：https://github.com/HX-Jan/MoodSky/pull/50
- CI：`quality` 通过，run `40106848494`

## 1. 已上传内容

目标分支：`docs/yuen-lin-week2-delivery` → `main`（PR，Squash merge）。

- `docs/week2/Yuen_Lin/README.md`
- `docs/week2/Yuen_Lin/w2-yl01-baseline.md`
- `docs/week2/Yuen_Lin/w2-yl02-record-regression.md`
- `docs/week2/Yuen_Lin/w2-yl02-cases.csv`
- `docs/week2/Yuen_Lin/w2-yl03-deployment-health.md`
- `docs/week2/Yuen_Lin/w2-yl04-integration-device.md`
- `docs/week2/Yuen_Lin/w2-yl04-huawei-p70-test-guide.md`
- `docs/week2/Yuen_Lin/w2-yl04-huawei-p70-results.csv`
- `docs/week2/Yuen_Lin/w2-yl05-week-report.md`
- `docs/week2/Yuen_Lin/w2-yl05-h05-return.csv`
- `docs/week2/Yuen_Lin/PR-body.md`
- `docs/week2/Yuen_Lin/UPLOAD-CHECKLIST.md`
- `docs/week2/Yuen_Lin/artifacts/yl01/`（文本日志、TAP、版本与环境）
- `docs/week2/Yuen_Lin/artifacts/yl02/`（定向 TAP）
- `docs/week2/Yuen_Lin/artifacts/yl03/`（包清单、云函数只读信息、健康 JSON）
- `docs/week2/Yuen_Lin/artifacts/yl04/`（模拟器 JSON、设备检查、后台/校园定向 TAP）

不包含：`node_modules`、个人 `environment.local.js`、真实身份/日记/令牌、管理员凭证、临时安装目录、第一周 4 个未跟踪遗留文件。

## 2. 变更摘要

- 只新增第二周测试交付文档与证据；无业务源码、共享契约、数据库、CI、导航变更。
- 记录定向 144 项、后台/校园 44 项、完整 593 项通过；定向均为完整套件子集，不重复计数。
- 正式包哈希与现网 0.2.3 一致；正式前端健康真实通过。
- 模拟器 8 项执行完成，7 项断言通过；Campus 定位结果未取得。

## 3. 目标环境与结果

| 项目          | 值                                                                   |
| ------------- | -------------------------------------------------------------------- |
| 基线提交/版本 | `ed1d76fd97312dd2a4bee0db87aed4e49a14f7eb` / 0.2.3                   |
| 分支          | `docs/yuen-lin-week2-delivery`                                       |
| 本地完整检查  | 593 通过 / 0 失败                                                    |
| CI（main）    | run `40074201757` 成功                                               |
| CI（PR #50）  | run `40106848494`，`quality` 通过，39 s                              |
| 云环境        | `mood-sky-d5gqy3spkff37566d`，函数 `moodsky`，`Nodejs16.13`          |
| 真实健康      | `apiVersion=1`、`version=0.2.3`、`requestId=req_mvmj4sh6_2_2bbla7dt` |
| 真机          | 未测                                                                 |

## 4. 风险

- 真实云端私有记录、回顾与数据库约束没有验收，不能把本 PR 写成业务完成。
- Campus 定位、真实 Web 身份和真机仍阻塞。
- 工时 4h 与估点已填；复核意见仍由实际复核人填写，不能由 PR 合入自动视为已验收。
- 本 PR 只新增文档；若需上传任何云函数或小程序版本，必须另走部署审批，不在本清单范围。

## 5. 回滚

- 文档 PR：在 GitHub 上 Revert 对应 Squash 提交，或在合入前关闭 PR。
- 不涉及数据库、云函数或小程序版本，无需数据回滚。
- 若误上传云函数：由 Xiang Hong 按现有备份哈希回滚并重新执行健康检查；Yuen Lin 不自行操作。

## 6. 最终确认

- [x] 用户已明确要求按 week1/其他成员 week2 的方式推送并创建 PR。
- [x] 已推送 `docs/yuen-lin-week2-delivery` 并创建 PR #50。
- [x] 已记录 PR 链接与 quality CI 结果。
- [ ] @HX-Jan 同意合入。
- [ ] 如另行批准部署/上传，单独记录审批、目标、健康响应与回滚包。
