# W1 · Yuen Lin —— 功能测试、回归、自动检查与测试部署

- 学号：832401211
- 任务：YL01—YL05（依据 `docs/week1/first-week-detailed-plan.md` 与 `docs/week1/xiang-hong/handoffs/10-yuen-lin.md`）
- 代码基线：`1be13f8287e177ae3f057a9298164eb631181778`（`main`，0.2.1 开发预览）
- 工作分支：`docs/yuen-lin-week1-delivery`（本地，待用户确认后推送）
- 岗位主责：`tests/` 中的功能、集成、异常与兼容测试；CI、自动检查、测试环境部署清单与部署后检查
- 协作/复核：Xiang Hong（版本与平台权限）、Qizhen Cai（权限与生命周期）、Xiang Yu（数据库）、各页面/模块负责人

## 成果清单

| 编号 | 任务                   | 交付物                                                                                                                                                       | 当前状态                                                         |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| YL01 | 建立现有检查基线       | [w1-yl01-baseline.md](w1-yl01-baseline.md)、[artifacts/yl01](artifacts/yl01/)                                                                                | 本地完成；CI 基线已核对；待复核                                  |
| YL02 | 建立功能用例清单       | [w1-yl02-test-catalog.md](w1-yl02-test-catalog.md)、[w1-yl02-priority-cases.csv](w1-yl02-priority-cases.csv)、[N 编号口径说明](w1-yl02-n-numbering-note.md)  | 目录与 14 条优先用例完成；N01—N06 按设计稿，N07—N08 阻塞；待复核 |
| YL03 | 编写并执行首次部署清单 | [w1-yl03-deployment.md](w1-yl03-deployment.md)、[artifacts/yl03](artifacts/yl03/)                                                                            | 本地打包完成；上传/健康调用阻塞                                  |
| YL04 | 执行页面和身份小验证   | [w1-yl04-page-identity-validation.md](w1-yl04-page-identity-validation.md)、[artifacts/yl04](artifacts/yl04/)                                                | 本地 66 项 + 模拟器 10 项通过；真云/真机阻塞                     |
| YL05 | 汇总设备覆盖与周报告   | [w1-yl05-device-coverage.md](w1-yl05-device-coverage.md)、[w1-yl05-week-report.md](w1-yl05-week-report.md)、[w1-yl05-h05-return.csv](w1-yl05-h05-return.csv) | 设备表与周报完成；真机未测；H05 回传表待 Xiang Hong 合并         |

## GitHub 发布材料（未上传）

- PR 标题与正文：[PR-body.md](PR-body.md)
- Issue 草稿：[issue-drafts.md](issue-drafts.md)，包含主任务 W1 YL01—YL05、Campus 定位缺陷、N07—N08 口径共 3 个 Issue。云部署和真机检查保留在主任务未完成项与周报中。
- 云部署审批请求：[hx-deploy-approval-request.md](hx-deploy-approval-request.md)。
- 已创建：Issue #22（主任务）、#23（Campus 定位）、#24（N 编号口径）；PR #25；quality 检查通过。
- 云部署审批请求已发在 #22；@HX-Jan 批准前不上传云函数。

## 本地复现

在仓库根目录使用 Node.js 24：

```powershell
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm run cloud:prepare
npm run check
node scripts/check-cloud.js
npm audit --audit-level=high --prefix cloudfunctions/moodsky
```

本次结果：完整 **234 项测试通过 / 0 失败**；定向页面/身份 **66 项通过 / 0 失败**（是完整套件子集，不重复相加）；微信开发者工具模拟器 **10 项通过 / 0 失败**。原始 TAP 见 [YL01](artifacts/yl01/tests.tap) 与 [YL04](artifacts/yl04/targeted-pages-identity.tap)，模拟器结果见 [simulator-validation.json](artifacts/yl04/simulator-validation.json)。

## 状态口径

- 本地自动化通过只表示“该路径在 Node 页面替身/内存服务下通过”，不扩展为真实云端或真机完成。
- `待复核`：等待 Xiang Hong、Qizhen Cai 或模块负责人复核。
- `阻塞`：缺少实现、权限、设备、云环境或批准；已写明所需输入和接收负责人。
- 未执行的模拟器、真实云、真机和上传均不填通过。

## 当前阻塞

| 阻塞                             | 所需输入                                           | 接收负责人                        |
| -------------------------------- | -------------------------------------------------- | --------------------------------- |
| 真实云函数未上传/未部署          | 用户与 @HX-Jan 明确批准；按 YL03 清单部署          | 用户/@HX-Jan                      |
| Campus 定位拒绝无实现            | 首次不主动申请、拒绝后继续浏览列表                 | Qinghan Zhang                     |
| 真实云业务仍为 `NOT_IMPLEMENTED` | 保存/查询/删除/导出/注销适配器                     | Xiang Hong/Jiawei/Junhan/Xiang Yu |
| N07—N08 正式定义缺失             | 设计稿只有 N01—N06；请确认是笔误、另份规格还是预留 | Xiang Hong/用户                   |
| 模拟器截图未取得                 | 结构化工具结果已保存；需要可视化证据时补截图       | Yuen Lin                          |

## 与其他成员成果的衔接

- YL02 的 S01—S06 采用 Xiang Hong 的 [H02 合成场景](../xiang-hong/w1-h02.md)；X01—X08 采用 Jiawei Fang 的 [JF05 门禁检查表](../Jiawei_Fang/w1-jf05-gate-integration.md)。
- 权限与数据生命周期细节由 Qizhen Cai 主编；本目录只做测试侧关联，不替代她的矩阵和独立验收。
- 设计稿只有 N01—N06“此刻需求”，仓库内没有 N07—N08 定义；本目录按 N01—N06 关联，N07—N08 标为阻塞，并单独记录 [N 编号口径说明](w1-yl02-n-numbering-note.md)，避免接口和测试误用。
- 页面与模块的复核人：Today/Yifan Ji、Universe/Zhifeng Dai、Campus/Qinghan Zhang、Me/Linghan Chen、账号/Jiawei Fang、数据/Xiang Yu、整体/Xiang Hong。

## 复核与验收（由本人实际确认后填写）

| 项目                    | 内容                                  |
| ----------------------- | ------------------------------------- |
| 提交版本 / PR           | 待推送；本地基线 `1be13f8`            |
| Xiang Hong 复核意见     |                                       |
| Qizhen Cai 独立检查意见 |                                       |
| 实际耗时（人时）        | **待本人填写**                        |
| 后续任务估点            | **待本人确认**（周报第 6 节为建议值） |

## 边界

- 本次没有修改业务源码、数据库、云资源、共享接口或 CI 配置。
- 没有上传云函数、没有部署数据库、没有上传微信体验版/正式版、没有推送 GitHub。
- 所有截图/日志均为合成或脱敏内容；未记录真实身份、私人日记、令牌或管理员凭证。
