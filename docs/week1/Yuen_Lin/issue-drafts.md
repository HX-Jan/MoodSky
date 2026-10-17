# Yuen Lin 第一周 GitHub Issue 草稿

- 负责人：Yuen Lin（832401211）
- 日期：2026-10-17
- 状态：已创建 Issue #22（ISSUE-01）、#23（ISSUE-02）、#24（ISSUE-05）；PR #25。云部署审批请求已发在 #22，等待 @HX-Jan 批准。
- 关联 PR 草稿：[PR-body.md](PR-body.md)

## ISSUE-01 主任务：W1 YL01—YL05 测试基线、用例、部署清单与页面验证

**标题**：`[W1][Test] YL01—YL05 检查基线、用例目录、部署清单与页面/身份验证`

**建议标签**：`test`、`docs`、`week1`

**主责与复核**：Yuen Lin（主责）；Xiang Hong（整体/版本）、Qizhen Cai（权限/生命周期）、Xiang Yu（数据/部署边界）

**需求/任务编号**：W1 YL01、W1 YL02、W1 YL03、W1 YL04、W1 YL05

**修改目录与依赖**：`docs/week1/Yuen_Lin/`（只新增文档与脱敏证据，不改业务源码）；依赖 H01 环境登记、H02 记录场景、JF05 门禁检查、Qizhen Cai 权限矩阵。

**输入、输出、错误和验收条件**：

- 输入：基线提交 `1be13f8287e177ae3f057a9298164eb631181778`；Node.js 24；微信开发者工具 Stable 2.01.2510290；合成演示数据。
- 输出：
  - YL01 基线：`w1-yl01-baseline.md`、`artifacts/yl01/`
  - YL02 用例：`w1-yl02-test-catalog.md`、`w1-yl02-priority-cases.csv`、`w1-yl02-n-numbering-note.md`
  - YL03 部署：`w1-yl03-deployment.md`、`artifacts/yl03/`
  - YL04 页面/身份：`w1-yl04-page-identity-validation.md`、`artifacts/yl04/`
  - YL05 设备/周报：`w1-yl05-device-coverage.md`、`w1-yl05-week-report.md`、`w1-yl05-h05-return.csv`
- 验收：
  - 干净依赖下 `npm run check` 通过；完整 234 项、定向 66 项、模拟器 10 项分别记录，不重复相加。
  - F01—F24/T01—T24 目录和 14 条优先用例可追溯；S01—S06、X01—X08 已关联。
  - N01—N06 按设计稿“此刻需求”使用；N07—N08 未定义并标为阻塞；不得新增 `needs.*`。
  - 部署包 3 个文件、SDK 4.0.2、哈希已记录；未获批准不上传。
  - 模拟器 10/10 通过；真实云、真机、后台 Web 未通过的内容如实标为阻塞。
- 边界：本地通过不代表真实云或真机；没有真实身份、私人日记、令牌或密钥。

**阻塞/后续**：Campus 定位（ISSUE-02）、N07—N08 定义（ISSUE-05）；真实云部署与华为 Pura 70 真机检查并入本 Issue 的未完成验收项，等执行时再拆 Issue。

**计划完成日期**：2026-10-17（第一周）

**云部署审批请求（请 @HX-Jan 在本 Issue 回复确认）**：

- 目标：测试环境 `mood-sky-d5gqy3spkff37566d`、函数 `moodsky`。
- 版本：`1be13f8287e177ae3f057a9298164eb631181778` / 0.2.1；包内 `index.js`、`package.json`、`package-lock.json`；SDK 4.0.2；云端安装依赖。
- 范围：只部署 `moodsky`，不部署 `moodsky-h03-probe`，不改数据库/索引/权限，不上传体验版。
- 目的：补齐 YL03 的真实 `system.health` 证据（版本、requestId、错误响应）。
- 回滚：保留上一版包和提交号；失败时回滚并复测。
- 在得到明确“批准部署”回复前，**不上传**；批准后把评论链接和结果回填 YL03。

## ISSUE-02 Campus 拒绝定位流程未实现

**标题**：`[Bug][Campus] 拒绝定位后继续浏览列表的流程未实现`

**建议标签**：`bug`、`campus`、`week1`

**提交版本/环境/需求编号**：`1be13f8`；微信开发者工具模拟器 + 本地代码阅读；关联 UW3-F11—F13、W1 QZ04/YL04。

**复现步骤、预期与实际行为**：

1. 打开 Campus 页面。
2. 查找“离我近/定位”入口，或首次进入时的定位说明。
3. 预期：首次不主动申请定位；用户主动选择后再申请；拒绝后仍可浏览和筛选列表；地图失败返回列表。
4. 实际：`miniprogram/pages/campus/index.wxml` 只有固定模拟说明，没有定位、地图或拒绝定位交互；模拟器只能验证页面入口。

**影响范围与已脱敏证据**：`docs/week1/Yuen_Lin/w1-yl04-page-identity-validation.md`、`docs/week1/Yuen_Lin/artifacts/yl04/simulator-validation.json`。不影响记录/回顾模块。

**接收负责人**：Qinghan Zhang；Yuen Lin 复测。

**验收条件**：首次不主动弹权限；拒绝后列表仍可用；地图失败有回退；真机（华为 Pura 70，HarmonyOS 4.2.0 / 微信 8.0.79）复测记录。

## ISSUE-05 N07—N08 编号定义确认

**标题**：`[W1][Requirements] 确认 N01—N08 编号口径；仓库内只有 N01—N06`

**建议标签**：`requirements`、`week1`、`blocked`

**背景**：第一周计划写“关联 N01—N08”，但设计稿 `docs/design/w1/specs/03_UI全部功能清单.md` 只有 N01—N06“此刻需求/小任务”；仓库内没有 N07—N08 的定义、字段、接口或测试。YL02 已按 N01—N06 关联，N07—N08 标为阻塞。

**需要确认（三选一）**：

1. 计划笔误，实际只有 N01—N06：请修改计划或注明 N07—N08 不存在。
2. N07—N08 来自另一份中英文需求规格：请提供原文（编号、名称、验收条件、对应接口/页面）。
3. N07—N08 是预留编号：请在需求基线登记“未定义”并指定负责人。

**接口防守线**：不得新增 `needs.*`、`n01.*`—`n08.*`；任务 action 只使用 `tasks.suggestions`、`tasks.quickChoice`、`tasks.transition`、`tasks.history`。详见 `docs/week1/Yuen_Lin/w1-yl02-n-numbering-note.md`。

**验收条件**：在 `docs/week1/README.md` 或需求基线留下明确结论；YL02 的 N 映射据此更新或保持阻塞。

**负责人**：Xiang Hong；Yuen Lin 更新 YL02。

## 创建顺序建议

1. 先创建 ISSUE-01（主任务）和 ISSUE-05（编号口径），确保需求口径先定。
2. ISSUE-02 作为 Campus 缺陷单独指派给 Qinghan Zhang。
3. PR 描述用 `Closes #<ISSUE-01>`；ISSUE-02、ISSUE-05 作为 follow-up 引用，不用 `Closes`。
4. 真实云部署和华为 Pura 70 真机检查暂不单独建 Issue，保留在 ISSUE-01 的未完成验收项和 YL05 周报中；执行时再按需拆。
5. 创建 Issue、推送分支、开 PR 前都需要用户最后确认。
