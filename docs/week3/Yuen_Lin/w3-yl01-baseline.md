# W3 YL01 第三周可复现基线

- 执行日期：2026-10-29（Asia/Shanghai）
- 工作分支：`docs/yuen-lin-week3-delivery`
- 源码基线：`a2a671980a392df1db0e2ec63bd4ec7af4f6b86e`
- 提交说明：`fix(campus): release support loading after catalog refresh (#82)`
- 包版本：`0.2.3`
- Node / npm：`v24.16.0` / `11.13.0`

## 基线与依赖

| 项目                  | 实际值                                                                    |
| --------------------- | ------------------------------------------------------------------------- |
| `package-lock.json`   | `3f04d75aaa8537bbe4fb9326cd7c8c28c07c9beb6f68cf29c97c5783ae6ae3f7`        |
| 云函数锁文件          | `13e30eb99216195aa091a3c227a67912c2b617108eb3792b24707e1abd2481bc`        |
| 云函数 `package.json` | `2190849cc579a76b4e7e4862b648d0eda6f3d6392e1e58dac7374737d1cc7ca7`        |
| 根目录直接依赖        | `esbuild@0.28.2`、`eslint@10.12.0`、`prettier@3.9.10`、`typescript@5.9.3` |

工作区未提交差异：`docs/week1/Yuen_Lin/artifacts/yl03/` 下 4 个历史未跟踪文件；本轮新增 `docs/week3/Yuen_Lin/`。没有已跟踪源码改动。

## 已执行检查

| 命令                            | 实际结果                                                 |
| ------------------------------- | -------------------------------------------------------- |
| `node scripts/prepare-cloud.js` | 通过，生成云函数共享契约副本                             |
| `npm run lint`                  | 通过                                                     |
| `npm run format:check`          | 通过，`All matched files use Prettier code style!`       |
| `npm run structure:check`       | 通过，24 项需求 ID、共享契约副本和客户端访问策略检查通过 |
| `npm run docs:check`            | 通过，16 份维护文档 / 293 个本地链接                     |
| `npm run typecheck`             | 通过                                                     |
| `npm test`                      | **924 项通过 / 0 失败 / 0 跳过**，耗时约 9.4 秒          |
| `npm run check`                 | 退出码 `0`，上述步骤全部串联通过                         |

原始输出：[npm-run-check.txt](artifacts/yl01/npm-run-check.txt)、[environment.txt](artifacts/yl01/environment.txt)、[npm-ls.txt](artifacts/yl01/npm-ls.txt)、[cloud-prepare.txt](artifacts/yl01/cloud-prepare.txt)。

## CI 记录

分支已推送并创建 PR #86。`.github/workflows/ci.yml` 的 `quality` 任务实际运行通过，run `40901000226`（job `123542929539`），耗时约 40 秒。CI 与本地检查分列记录，不合并为同一证据。

## 说明

- 任务计划中的 593 项是 10 月 25 日快照；最新 main 实际为 **924 项**。本报告按实际结果记录，测试数量不作为贡献指标。
- 本地测试使用合成平台、内存替身和锁定 SDK 离线替身，不代表真实微信模拟器、手机、真实账号或云端通过。
- 本轮没有修改业务源码，也没有升级依赖。
