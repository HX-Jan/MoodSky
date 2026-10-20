# Yuen Lin 第一周 GitHub 上传清单

- 负责人：Yuen Lin（832401211）
- 日期：2026-10-17
- 基线：`1be13f8287e177ae3f057a9298164eb631181778`
- 状态：**已推送分支 `docs/yuen-lin-week1-delivery`；已创建 Issue #22、#23、#24；PR #25；quality 检查通过；云函数未上传**
- 用户确认：**GitHub 发布已确认**；云部署还需 @HX-Jan 在 #22 批准

## 1. 将要上传的内容

只新增 `docs/week1/Yuen_Lin/`，不修改业务源码、共享接口、数据库、CI 或云资源。

| 类别     | 文件                                                                                   | 用途                                                                     |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 入口     | `README.md`                                                                            | 成果索引与状态                                                           |
| YL01     | `w1-yl01-baseline.md`、`artifacts/yl01/`（16 个文件）                                  | 干净依赖、234 项测试、CI 基线                                            |
| YL02     | `w1-yl02-test-catalog.md`、`w1-yl02-priority-cases.csv`、`w1-yl02-n-numbering-note.md` | F/T 目录、14 条优先用例、N 编号口径                                      |
| YL03     | `w1-yl03-deployment.md`、`artifacts/yl03/`（5 个文件）                                 | 部署清单、完整包哈希、登录/上传边界                                      |
| YL04     | `w1-yl04-page-identity-validation.md`、`artifacts/yl04/`（3 个文件）                   | 本地 66 项 + 模拟器 10 项、身份门禁                                      |
| YL05     | `w1-yl05-device-coverage.md`、`w1-yl05-week-report.md`、`w1-yl05-h05-return.csv`       | 设备覆盖（华为 Pura 70 / HarmonyOS 4.2.0 / 微信 8.0.79）、周报、H05 回传 |
| 发布材料 | `PR-body.md`、`issue-drafts.md`、`UPLOAD-CHECKLIST.md`                                 | PR 正文、3 个 Issue 草稿、本清单                                         |
| 清单     | `artifacts/delivery-manifest.json`                                                     | 全部交付文件的 SHA-256 与大小                                            |

完整文件清单与哈希见 [delivery-manifest.json](artifacts/delivery-manifest.json)。

## 2. Git 提交记录（已执行）

已推送分支 `docs/yuen-lin-week1-delivery`；提交 `b36b7c9`、`03b9c05`。

```powershell
git switch -c docs/yuen-lin-week1-delivery
git add docs/week1/Yuen_Lin
git status --short
git diff --cached --stat
git commit -m "docs(week1): add Yuen Lin test baseline, cases and deployment records"
```

提交前必须确认：

- [ ] `git status` 只有 `docs/week1/Yuen_Lin/`，没有 `project.config.json`、`environment.local.js` 或其他成员文件。
- [ ] 没有真实身份、私人日记、令牌、密钥、个人路径。
- [ ] `npm run check` 通过（234 项）。
- [ ] `npm run format:check` 通过。
- [ ] 用户已最后确认要提交/推送。

## 3. Issue 创建记录（已执行）

草稿见 [issue-drafts.md](issue-drafts.md)：

| 顺序                                                                                                                                                                                                                       | Issue    | 标题                                                               | 负责人        | 与 PR 关系              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ | ------------- | ----------------------- |
| 1                                                                                                                                                                                                                          | ISSUE-01 | `[W1][Test] YL01—YL05 检查基线、用例目录、部署清单与页面/身份验证` | Yuen Lin      | PR `Closes #<ISSUE-01>` |
| 2                                                                                                                                                                                                                          | ISSUE-05 | `[W1][Requirements] 确认 N01—N08 编号口径；仓库内只有 N01—N06`     | Xiang Hong    | follow-up；先定口径     |
| 3                                                                                                                                                                                                                          | ISSUE-02 | `[Bug][Campus] 拒绝定位后继续浏览列表的流程未实现`                 | Qinghan Zhang | follow-up               |
| 真实云部署和华为 Pura 70 真机检查不单独建 Issue，保留在 ISSUE-01 的未完成验收项与 YL05 周报中。创建顺序建议：先 ISSUE-01 和 ISSUE-05，再 ISSUE-02。所有 Issue 创建前需要用户确认；Issue 标题、标签和正文可直接从草稿复制。 |

## 4. PR 记录（已创建）

- 标题：`docs(week1): add Yuen Lin test baseline, cases and deployment records`
- 正文：[PR-body.md](PR-body.md)
- PR：https://github.com/HX-Jan/MoodSky/pull/25
- base：`HX-Jan/MoodSky` 的 `main`
- head：用户 Fork 或团队仓库的 `docs/yuen-lin-week1-delivery`
- 合并：等待 @HX-Jan 审批 + quality 通过 + 与最新 main 一致 + 讨论解决；使用 Squash merge。

其他成员的做法是任务分支/Fork + PR，由 @HX-Jan 审批；本目录按同样方式准备。

## 5. 上传前事实边界

- 本地完整测试 234 项通过；定向 66 项通过；模拟器 10 项通过（三者分开统计）。
- 真实云函数未上传/未部署；`system.health` 未重新调用。
- 微信体验版/正式版未上传。
- 华为 Pura 70 未执行真机测试；HarmonyOS 4.2.0 / 微信 8.0.79 已记录。
- Campus 定位拒绝流程未实现；真实 Web/后台身份未联调；导出/清理执行器未实现。
- N01—N06 按设计稿使用；N07—N08 未定义，标为阻塞。

## 6. 当前待确认

1. 等待 @HX-Jan 在 #22 批准云部署。
2. 批准后上传 `moodsky` 并补 `system.health` 证据。
3. 华为 Pura 70 真机测试待体验版上传批准。
