# W6-YL03 候选装配与 manifest 核对

- 执行时间：2026-11-20 13:31—13:34（Asia/Shanghai）
- 任务：W6-YL 第 3 项「从最终干净提交执行 release:package closed，核对 manifest」
- 产物位置（工作区外）：
  - 最终提交候选：`E:\MoodSky\w6-yuen-lin-candidate-5b27753`
  - 计划 0.5.1 口径批次候选：`E:\MoodSky\w6-yuen-lin-candidate-0.5.1-c0518e5`
- 结论：两个候选均从干净提交生成、任务模式 `closed`、新增校园打卡默认暂停、`sourceWorktreeDirty=false`、未上传/未部署/未真机验证。**它们只是本地候选，不是体验版、线上版或已部署云包。**

## 一、装配命令

在各自干净工作树中执行（输出目录均在工作区外）：

```powershell
npm.cmd run release:package -- E:\MoodSky\w6-yuen-lin-candidate-5b27753 closed
npm.cmd run release:package -- E:\MoodSky\w6-yuen-lin-candidate-0.5.1-c0518e5 closed
```

原始输出：[release-package.txt](artifacts/yl03/release-package.txt)、[batch-0.5.1-release-package.txt](artifacts/yl03/batch-0.5.1-release-package.txt)。

## 二、计划 0.5.1 口径批次候选

| 项目                                          | 实际值                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| 来源提交                                      | `c0518e58cbdc2aee75d675b2260df8d45529bdd8`（首批整合提交，`v0.5.1` 版本线）     |
| 装配时工作树                                  | `sourceWorktreeDirty=false`                                                     |
| 客户端 / 服务构建版本                         | `0.5.1` / `0.5.1`                                                               |
| 任务模式                                      | `closed`                                                                        |
| 新增校园打卡默认暂停                          | `true`                                                                          |
| 客户端文件哈希数                              | 181                                                                             |
| 云函数                                        | `moodsky-release`（3 文件）、`moodsky-release-maintenance`（4 文件）            |
| 文件总数 / 字节                               | 191 / 1,072,719                                                                 |
| 上传 / 部署 / 云生命周期 / 真机 / 提审 / 公开 | 全部 `false`                                                                    |
| 装配前完整检查                                | 1634/1634 通过（[batch-0.5.1-check.txt](artifacts/yl03/batch-0.5.1-check.txt)） |

摘要与清单：[batch-0.5.1-candidate-summary.txt](artifacts/yl03/batch-0.5.1-candidate-summary.txt)、[batch-0.5.1-candidate-manifest.json](artifacts/yl03/batch-0.5.1-candidate-manifest.json)、[batch-0.5.1-candidate-hashes.txt](artifacts/yl03/batch-0.5.1-candidate-hashes.txt)。

关键哈希（SHA-256）：

| 文件                                             | 哈希                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `manifest.json`                                  | `eac50dae28aed0a2081be2bd084eb58da91d47191c8bae2d87fb45e72b765128` |
| `project.config.json`                            | `dcbc6c46e77da2fb5b6a2f13a7a33034403a3e28256aa7300f98aa8911264b79` |
| `cloud/moodsky-release/index.js`                 | `dd636b28eb008383b209c0459cc265523c78613131837a62508c60393e2c232c` |
| `cloud/moodsky-release-maintenance/index.js`     | `52874cba17b47d472ddf7a6cc6200d0c6cac0254f328f5c9d92f6ff49793aecc` |
| `client/miniprogram/config/environment.local.js` | `0416ca1e5ee6d728737a2e0eedbd8981d5359dcce0f11105a9a667575d0c3e99` |

`environment.local.js` 固定 `buildCommit=c0518e58…`、`taskMode=closed`、`cloudEnabled=true`、`journalDemo=false`。

## 三、最终提交候选（5b27753）

| 项目                                          | 实际值                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| 来源提交                                      | `5b2775393a4adbf5d9a77ff2a3c61b3c3bb3958c`（`v0.5.2`，当前远端 `main`） |
| 装配时工作树                                  | `sourceWorktreeDirty=false`                                             |
| 客户端 / 服务构建版本                         | `0.5.2` / `0.5.2`                                                       |
| 任务模式                                      | `closed`                                                                |
| 新增校园打卡默认暂停                          | `true`                                                                  |
| 客户端文件哈希数                              | 181                                                                     |
| 云函数                                        | `moodsky-release`（3 文件）、`moodsky-release-maintenance`（4 文件）    |
| 文件总数 / 字节                               | 191 / 1,074,637                                                         |
| 上传 / 部署 / 云生命周期 / 真机 / 提审 / 公开 | 全部 `false`                                                            |
| 装配前完整检查                                | 1634/1634 通过（[npm-run-check.txt](artifacts/yl01/npm-run-check.txt)） |

摘要与清单：[candidate-summary.txt](artifacts/yl03/candidate-summary.txt)、[candidate-manifest.json](artifacts/yl03/candidate-manifest.json)、[candidate-hashes.txt](artifacts/yl03/candidate-hashes.txt)。

关键哈希（SHA-256）：

| 文件                                             | 哈希                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `manifest.json`                                  | `2a7a84f09107a56e71ca77ec48c3e5ba8829282a00738fe93dfa11efa2773617` |
| `project.config.json`                            | `aff5ad161883f089438dafc56b7462c1976919dc0875e1f2df24f286efe03ebc` |
| `cloud/moodsky-release/index.js`                 | `a98326c8f6afb2e1aa7e17e46ce73eb339e90373222fae915d74ae17bc92b00f` |
| `cloud/moodsky-release-maintenance/index.js`     | `86f99a99d4e0ef9197df804fdbacd9659da04eef81a3fc6ecbb1e543d3c0436c` |
| `client/miniprogram/config/environment.local.js` | `6a8d90b90574f2ac5b101c89e1148d222a6e76b8ab086161936f9366f96a73f9` |

`environment.local.js` 固定 `buildCommit=5b277539…`、`taskMode=closed`、`cloudEnabled=true`、`journalDemo=false`。

## 四、manifest 逐项核对

| 核对项                                 | 要求             | 最终候选（5b27753）        | 批次候选（c0518e5） | 判定           |
| -------------------------------------- | ---------------- | -------------------------- | ------------------- | -------------- |
| `sourceCommit` 完整提交号              | 与出包提交一致   | `5b27753…`                 | `c0518e5…`          | 通过           |
| `sourceWorktreeDirty`                  | 干净             | `false`                    | `false`             | 通过           |
| `uploadVersion` / `serverBuildVersion` | 版本一致         | `0.5.2` / `0.5.2`          | `0.5.1` / `0.5.1`   | 通过           |
| `taskMode`                             | `closed`         | `closed`                   | `closed`            | 通过           |
| `campusCheckinWritesPausedByDefault`   | `true`           | `true`                     | `true`              | 通过           |
| 客户端哈希                             | 覆盖全部打包文件 | 181                        | 181                 | 通过           |
| 两支云包哈希                           | 业务 + 维护      | 3 + 4 文件                 | 3 + 4 文件          | 通过           |
| 私有配置 / 服务端密钥                  | 不包含           | `false` / `false`          | `false` / `false`   | 通过           |
| 定位 API                               | 不启用           | `locationApiEnabled=false` | `false`             | 通过           |
| 上传/部署/真机/提审/公开               | 未执行           | 全部 `false`               | 全部 `false`        | 通过           |
| 备案 / 微信认证                        | 不由装配器核验   | `not-checked-by-packager`  | 同左                | 未测，保持阻塞 |

## 五、候选边界

- **不是部署包**：未上传云函数、未写数据库、未改索引/权限、未执行清理或恢复。
- **不是微信版本**：未上传体验版或正式版，未取得微信后台版本回执。
- **不是同包真机结果**：本机无 Android/iOS 设备；成员真机材料来自其他构建，不能与本候选拼成同一包。
- **不是 1.0.0**：第六周范围为 `0.5.1/0.5.2`；不得把本候选写成 1.0.0 或已提审。
- **两候选不合并统计**：0.5.1 批次候选用于满足计划字面口径；0.5.2 最终候选用于当前主干复核。任何复测必须注明候选目录和 `sourceCommit`。
