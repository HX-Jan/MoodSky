# W1 YL01 现有检查基线

- 负责人：Yuen Lin（832401211）
- 执行日期：2026-10-17，Asia/Shanghai
- 基线提交：`1be13f8287e177ae3f057a9298164eb631181778`（`main`，0.2.1 开发预览）
- 环境：Windows 10/11 x64；Node.js `v24.16.0`；npm `11.13.0`；微信开发者工具已安装（基线时未登录；后续已登录，见 [YL04](w1-yl04-page-identity-validation.md)）
- 状态：本地基线完成；CI 状态已核对；真实云端与真机不在本任务范围

## 1. 干净依赖与执行顺序

在 `E:\MoodSky\MoodSky` 的独立克隆中，按仓库 README 与交接说明执行：

```powershell
git rev-parse HEAD
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm run cloud:prepare
npm run check
node --test --test-reporter=tap tests/*.test.js
node scripts/check-cloud.js
npm audit --audit-level=high
npm audit --audit-level=high --prefix cloudfunctions/moodsky
```

原始输出保存在 [`artifacts/yl01/`](artifacts/yl01/)；`node-version.txt`、`npm-version.txt`、`git-head.txt`、`executed-at.txt` 和 `os-version.txt` 记录本次环境。

## 2. 实际结果

| 检查                      | 实际结果                                                                                | 证据                                                      |
| ------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 根依赖安装                | 成功；80 个包；0 个已知漏洞                                                             | [npm-ci-root.txt](artifacts/yl01/npm-ci-root.txt)         |
| 本地配置与共享代码生成    | 成功；云能力保持关闭，个人配置未被覆盖                                                  | [npm-run-setup.txt](artifacts/yl01/npm-run-setup.txt)     |
| 云函数依赖                | 成功；97 个包；0 个已知漏洞                                                             | [npm-ci-cloud.txt](artifacts/yl01/npm-ci-cloud.txt)       |
| 共享代码准备              | 成功                                                                                    | [cloud-prepare.txt](artifacts/yl01/cloud-prepare.txt)     |
| lint / format / structure | 通过；24 项需求 ID、共享契约副本、客户端禁读写策略均通过                                | [npm-run-check.txt](artifacts/yl01/npm-run-check.txt)     |
| 完整单元与集成测试        | **234 通过 / 0 失败 / 0 跳过**；耗时约 0.59 s                                           | [tests.tap](artifacts/yl01/tests.tap)                     |
| 云 SDK 加载与查询构造     | 通过；未发送真实数据库请求                                                              | [cloud-sdk-check.txt](artifacts/yl01/cloud-sdk-check.txt) |
| 根包依赖审计              | 0 个漏洞                                                                                | [npm-audit-root.txt](artifacts/yl01/npm-audit-root.txt)   |
| 云函数依赖审计            | 0 个漏洞                                                                                | [npm-audit-cloud.txt](artifacts/yl01/npm-audit-cloud.txt) |
| CI 文件                   | `.github/workflows/ci.yml` 已存在，包含 quality 检查与云 SDK 检查                       | [ci.yml](../../../.github/workflows/ci.yml)               |
| `main` 最近基线 CI        | [MoodSky CI #54](https://github.com/HX-Jan/MoodSky/actions/runs/38959662311) 成功，24 s | GitHub Actions 页面，2026-10-17 核对                      |

`tests.tap` 的汇总行为：

```text
# tests 234
# pass 234
# fail 0
```

## 3. CI 状态与历史对照

- 当前 `main` 基线 `1be13f8` 的 `quality` 运行成功，对应 [run 38959662311](https://github.com/HX-Jan/MoodSky/actions/runs/38959662311)。
- GitHub Actions 页面另显示 PR [#20](https://github.com/HX-Jan/MoodSky/pull/20)（Qizhen Cai 的第一周交付分支）最新运行成功；该分支尚未合入 `main`，本基线不把它计入本地测试数。
- 历史整合报告记载的 234 项本地测试与本次独立重跑一致；本次是重新执行，不是引用旧结果。历史报告中的模拟器、云端和 H03 结果不在本次基线内。
- 本次未重新运行微信模拟器、真实云端、云函数部署或 H03 实验。

## 4. 发现与处理

| 观察                                         | 影响                                | 处理                                                                                                     |
| -------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm` 提示可升级到 12.2.0                    | 不影响当前 Node 24 与锁文件安装     | 本次不升级，避免改变团队工具基线                                                                         |
| PowerShell 控制台显示部分中文/勾选符号为乱码 | 仅影响显示，不影响退出码和 TAP 结果 | 以 TAP、退出码和英文摘要为准；不把乱码当作失败                                                           |
| 微信开发者工具已安装但基线时未登录           | 基线时不能执行模拟器自动化          | 基线后已由用户扫码登录，模拟器 10 项检查见 [YL04](w1-yl04-page-identity-validation.md)；真实上传仍需批准 |
| GitHub REST API 受匿名速率限制               | 不能程序化读取 Actions 列表         | 使用公开 Actions 页面核对，并记录 run 链接                                                               |

## 5. 结论与边界

- YL01 的“干净依赖 + 现有检查基线”已完成：代码、格式、结构、完整测试和云 SDK 本地检查均通过，无直接阻碍团队运行的问题。
- 没有新增或重写既有检查，也没有为了数量复制测试。
- 本基线**不**证明真实云函数已部署、真实数据库可写、真实账号门禁已联调或真机可用；这些分别属于 YL03、YL04 和 YL05 的后续验证。
- 后续每次提交前仍按本文件命令重跑，并在 PR 中附最新 TAP 和 CI 结果。
