# W4 YL01 本周独立检查基线

- 执行日期：2026-11-05（Asia/Shanghai）
- 承接：W3 YL01
- 源码基线：`09903ceb1e3b2ce38155484a2afd50297bab54a1`（GitHub `main`）
- 基线时间：2026-11-05 15:10:55Z
- 包版本：`0.4.0`
- Node / npm：`v24.16.0` / `11.13.0`
- 验证工作区：GitHub 官方归档的独立本地快照（非本机旧副本）

## 来源与可复现性

本机 `E:\MoodSky\MoodSky` 当前分支为 `docs/yuen-lin-week3-delivery`，HEAD `123dae6`，`origin/main` 仍停在 `a2a6719`；`git fetch` 被网络重置，未能取得最新提交。为避免把旧副本当作最新 `main`，本轮固定 GitHub 官方归档：

| 项目               | 实际值                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| 上游 `main`        | `09903ceb1e3b2ce38155484a2afd50297bab54a1`                                   |
| 归档 SHA-256       | `f5be1207b5f8f91da80b86b78b92b99fc0366758b933c083fbf9756f83e2688d`           |
| 归档包版本         | `0.4.0`                                                                      |
| 本地快照 commit    | `767b63b2d83711d5364078a9e8aad1cf78d15bb0`（仅用于运行测试）                 |
| 上游 tree          | `88ef6ec9212d57b02daf2fb7e90d8d18f5bc1ec6`                                   |
| 本地快照 tree      | `bebc4a08f3d814c9c9b1724dca5ec13b32c3cb1c`                                   |
| 源码目录 blob 差异 | `miniprogram/`、`cloudfunctions/`、`tests/`、`tools/`、`scripts/` 均为 **0** |
| 文档目录 blob 差异 | 31 个文件仅因本地 CRLF/LF 规范化不同；不涉及源码                             |

逐项比较见 [source-tree-compare.txt](artifacts/yl05/source-tree-compare.txt)。本地快照 commit 不是上游 SHA，不能把它写成 GitHub 提交；上游来源以归档和 GitHub API 为准。

## 依赖与锁文件

| 项目                  | 实际值                                                                    |
| --------------------- | ------------------------------------------------------------------------- |
| `package-lock.json`   | `cd8e48015d7398a123f9520f348360a965bc3b02837fc9f6b0856692c816ea3f`        |
| 云函数锁文件          | `10c529b57648d2baf711e03adb8c94faef341c2f5410229261c5d0916ed406cd`        |
| 云函数 `package.json` | `61deb34ba0c3bfaccd8da27499e4496b84c460a545f74ff170b2ccfbc85c5868`        |
| 根目录直接依赖        | `esbuild@0.28.2`、`eslint@10.12.0`、`prettier@3.9.10`、`typescript@5.9.3` |

原始记录：[environment.txt](artifacts/yl01/environment.txt)、[baseline.txt](artifacts/yl01/baseline.txt)、[npm-ls.txt](artifacts/yl01/npm-ls.txt)。

## 已执行检查

| 命令                                                           | 实际结果                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm ci`                                                       | 退出码 `0`；根依赖安装完成                                   |
| `npm run setup`                                                | 退出码 `0`；生成本地配置，云能力默认关闭                     |
| `npm ci --prefix cloudfunctions/moodsky`                       | 退出码 `0`；97 个包，0 漏洞                                  |
| `npm run cloud:prepare`                                        | 退出码 `0`；生成云函数共享契约副本                           |
| `npm run check`                                                | 退出码 `0`；lint、格式、结构、文档、类型、测试全部通过       |
| `npm test`（包含在 check 中）                                  | **1398 项通过 / 0 失败 / 0 跳过**，退出码 `0`                |
| `npm run team:check`                                           | 九组全部通过，退出码 `0`                                     |
| `npm run team:check:production`                                | 七组当前生产装配全部通过，退出码 `0`                         |
| `node scripts/check-cloud.js`                                  | 通过；构造云查询与入口加载均离线完成，未发送网络查询         |
| `npm audit --audit-level=high --prefix cloudfunctions/moodsky` | 退出码 `0`；0 漏洞                                           |
| `npm audit --audit-level=high`                                 | 退出码 `0`；3 个 moderate（`eslint` → `minimatch`），无 high |

原始输出：

- [npm-run-check-final.txt](artifacts/yl01/npm-run-check-final.txt)（验证工作区最终完整检查）
- [npm-run-check-delivery.txt](artifacts/yl01/npm-run-check-delivery.txt)（加入本周文档后的交付目录复跑）
- [team-check.txt](artifacts/yl01/team-check.txt)（九组）
- [team-check-production.txt](artifacts/yl01/team-check-production.txt)（当前生产装配七组）
- [check-cloud.txt](artifacts/yl01/check-cloud.txt)
- [npm-audit-root.txt](artifacts/yl01/npm-audit-root.txt)
- [npm-audit-cloud.txt](artifacts/yl01/npm-audit-cloud.txt)
- [npm-ci-root.txt](artifacts/yl01/npm-ci-root.txt)、[npm-run-setup.txt](artifacts/yl01/npm-run-setup.txt)、[npm-ci-cloud.txt](artifacts/yl01/npm-ci-cloud.txt)、[cloud-prepare.txt](artifacts/yl01/cloud-prepare.txt)
- 交付目录补充：[npm-ci-cloud-clean.txt](artifacts/yl01/npm-ci-cloud-clean.txt)、[npm-run-setup-clean.txt](artifacts/yl01/npm-run-setup-clean.txt)

## 环境事件与处理

1. 首次在归档目录直接运行 `npm run check` 时，6 个打包测试因目录没有 `.git` 元数据失败，错误为 `fatal: not a git repository`。原始日志保留在 [npm-run-check.txt](artifacts/yl01/npm-run-check.txt)。
2. 在独立快照中执行本地 `git init` 并提交同一归档内容后重跑，打包测试通过，完整检查结果为 **1398/1398**。这不是修复业务代码，只是为 `git ls-files` 打包器提供本地元数据。
3. 本机旧工作区的 `git fetch` 失败记录保留在 [local-workspace.txt](artifacts/yl01/local-workspace.txt)；本轮没有把旧工作区当作最新 `main`。
4. 在交付目录加入本周文档后复跑完整检查时，先出现 `Cannot find module '../config/environment.local'` 等失败（首次 119 项、补装云依赖后 95 项）。根因是新快照尚未执行 `npm run setup`，且未安装云函数依赖；执行 `npm ci --prefix cloudfunctions/moodsky` 和 `npm run setup` 后，交付目录完整检查恢复为 **1398/1398**。两次失败尝试的原始日志未单独留存，只保留控制台汇总，不作为通过证据；最终成功日志见 [npm-run-check-delivery.txt](artifacts/yl01/npm-run-check-delivery.txt)，补装日志见 [npm-ci-cloud-clean.txt](artifacts/yl01/npm-ci-cloud-clean.txt) 与 [npm-run-setup-clean.txt](artifacts/yl01/npm-run-setup-clean.txt)。这不是业务代码修复。

## CI 记录

| 项目            | 实际结果                                                   |
| --------------- | ---------------------------------------------------------- |
| 上游 `main` CI  | run `42052346861`，`MoodSky CI`，`success`，head `09903ce` |
| PR #149 quality | job `127330588949`，`quality`，`SUCCESS`                   |
| 本轮交付分支 CI | 未运行；分支未推送，未获用户上传确认                       |

上游 CI 只证明 `main` 的合并结果，不证明本轮新增文档分支，也不证明真实云或真机。

## 说明

- 任务计划中的历史 1036 项仅作参考；本轮按实际 `1398` 项记录，不把测试数量作为贡献或完成率。
- 本地测试使用合成平台、内存替身和锁定 SDK 离线替身，不代表微信模拟器、真实账号、真实云或手机通过。
- 本轮没有修改业务源码，也没有升级依赖。
