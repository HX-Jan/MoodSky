# docs(week1): add Yuen Lin test baseline, cases and deployment records

## 概述

本 PR 只新增 Yuen Lin 第一周 YL01—YL05 的测试文档和脱敏证据，不修改业务源码、共享接口、数据库、CI 配置或云资源。

- 基线：`1be13f8287e177ae3f057a9298164eb631181778`（`main`，0.2.1 开发预览）
- 分支：`docs/yuen-lin-week1-delivery`
- 目录：`docs/week1/Yuen_Lin/`
- 关联 Issue：`Refs #22`；follow-up：#23（Campus 定位）、#24（N 编号口径）

## 变更内容

| 任务 | 交付物                                                                                 | 结果                                                                                                      |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| YL01 | `w1-yl01-baseline.md`、`artifacts/yl01/`                                               | 干净依赖下 234 项测试通过；lint/format/structure/云 SDK 检查通过；CI 基线成功                             |
| YL02 | `w1-yl02-test-catalog.md`、`w1-yl02-priority-cases.csv`、`w1-yl02-n-numbering-note.md` | F01—F24/T01—T24 目录、S/N/X 关联、14 条第二周优先用例；N01—N06 按设计稿，N07—N08 阻塞                     |
| YL03 | `w1-yl03-deployment.md`、`artifacts/yl03/`                                             | 完整部署包生成并核对；上传与健康调用阻塞                                                                  |
| YL04 | `w1-yl04-page-identity-validation.md`、`artifacts/yl04/`                               | 66 项本地定向测试 + 10 项模拟器检查通过；四页/Today/Universe/Me/本地门禁通过；Campus 定位、真云、后台阻塞 |
| YL05 | `w1-yl05-device-coverage.md`、`w1-yl05-week-report.md`、`w1-yl05-h05-return.csv`       | 设备表、周报、H05 回传表；真机未测                                                                        |

## 验证

```powershell
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm run cloud:prepare
npm run check
node scripts/check-cloud.js
npm audit --audit-level=high --prefix cloudfunctions/moodsky
```

- 完整本地测试：**234 通过 / 0 失败**。
- 定向页面/身份测试：**66 通过 / 0 失败**（完整套件子集，不重复相加）。
- 微信开发者工具模拟器：**10 通过 / 0 失败**（iPhone 12/13 Pro；合成演示数据）。
- 云 SDK 本地加载与查询构造通过；未发送真实数据库请求。
- 原始 TAP：`artifacts/yl01/tests.tap`、`artifacts/yl04/targeted-pages-identity.tap`；模拟器结果：`artifacts/yl04/simulator-validation.json`。
- CI 基线：`main` 提交 `1be13f8` 的 quality run [38959662311](https://github.com/HX-Jan/MoodSky/actions/runs/38959662311) 成功。

## 证据边界

- 本地通过只表示 Node 页面替身/内存服务下的结果，不代表真实云端或真机。
- 模拟器 10 项已执行，但不代表真机；模拟器截图未取得，以结构化 JSON 为准。
- 真实云函数未上传；`system.health` 未重新调用；微信体验版/正式版未上传。
- Campus 定位拒绝当前未实现；真实 Web/后台身份未联调；导出/清理执行器未实现。
- 华为 Pura 70（HarmonyOS 4.2.0 / 微信 8.0.79）已确认可用但未测。
- 未包含真实身份、私人日记、令牌、密钥或个人环境配置。

## 需要复核

- Xiang Hong：整体、版本/平台权限、部署清单。
- Qizhen Cai：权限与生命周期用例关联、身份门禁边界。
- Xiang Yu：部署包、数据库/云环境边界。
- Yifan Ji / Zhifeng Dai / Linghan Chen / Qinghan Zhang：对应页面与状态验证结果。

## 待确认事项

1. N01—N06 采用设计稿“此刻需求”原文；N07—N08 在仓库内没有定义。请 Xiang Hong 确认是笔误、另份规格还是预留编号，详见 `w1-yl02-n-numbering-note.md`。
2. `w1-yl05-h05-return.csv` 仅供 Xiang Hong 合并到 H05 台账；未直接修改他的文件。
3. 实际工时、个人估点和验收签名保留“待本人填写/待复核”，不代填。
4. 是否在 `docs/week1/README.md` 增加 Yuen Lin 索引段，请拥有者在整合时决定，避免与当前成员 PR 冲突。
5. 已创建主任务 #22、Campus 定位 #23、N 编号口径 #24；本 PR 只关联 #22，云部署和真机验收尚未完成，不自动关闭主任务。
6. 华为 Pura 70 已记录为 HarmonyOS 4.2.0 / 微信 8.0.79；真机测试待体验版上传批准。

## 合并前检查

- [ ] 用户已确认上传/发布
- [ ] @HX-Jan 审批
- [ ] quality 检查通过
- [ ] 与最新 main 一致
- [ ] 评审讨论已解决
- [ ] 使用 Squash merge
