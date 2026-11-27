# C4 预核候选（00c59a1）

- 装配人：Yuen Lin
- 来源：`00c59a1af7ccd27e9c2ae4bc77f6b65fc66b117c`（最新 main，含 #263）
- 产品树：`22be47ad17520215fc3d81d23536deaa3d98a8af`
- 候选目录（工作区外）：`E:\MoodSky\c4-candidate-00c59a1`
- 命令：`npm run release:package -- E:\MoodSky\c4-candidate-00c59a1 closed`
- 状态：**本地预核候选，不是最终冻结、不是部署包、不是微信版本、不是真机结果。**

## 候选摘要

| 项                       | 实际值                                                         |
| ------------------------ | -------------------------------------------------------------- |
| 任务模式                 | `closed`                                                       |
| 新增校园打卡默认暂停     | `true`                                                         |
| 客户端 / 服务版本        | `0.5.3` / `0.5.3`                                              |
| `sourceWorktreeDirty`    | `false`                                                        |
| 客户端哈希               | 185                                                            |
| 云函数                   | `moodsky-release` 3 文件、`moodsky-release-maintenance` 4 文件 |
| 文件总数 / 字节          | 195 / 1,195,240                                                |
| 页面 / 底栏              | 13 / 4                                                         |
| 上传/部署/真机/提审/公开 | 全部 `false`                                                   |
| 备案 / 微信认证          | `not-checked-by-packager`                                      |

## 关键 SHA-256

| 文件                                             | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `manifest.json`                                  | `711deb7e5f20c1c0c7473b3b9de4e0a52fafc8aea5e9c67524a2746abcd1edb0` |
| `project.config.json`                            | `060408913afc89e252e2f8e42853e6c87f0bddd6307e7af0de985a56fc855a2e` |
| `client/miniprogram/config/environment.local.js` | 见 `candidate-manifest.json`                                       |
| `cloud/moodsky-release/index.js`                 | `3668827f99163fbae86d86da4a9fce9101841ab1e82ab4394f0417d43860781a` |

`environment.local.js`：`cloudEnabled=true`、`journalDemo=false`、`taskMode=closed`、`buildCommit=00c59a1…`、`phoneLoginEnabled=false`。

## 入口（13 页 / 4 底栏）

`pages/today/index`（今天）、`pages/record/index`、`pages/campus/index`、`pages/universe/index`（天气宇宙）、`pages/me/index`（我的）、`pages/review/archive|month|detail|insights/index`、`pages/tasks/index`（小任务）、`pages/account/index`、`pages/login/index`、`pages/profile/index`。

机器可读：[entry-table.csv](artifacts/entry-table.csv)。

## 预览与边界

1. 导入候选根目录（根 `project.config.json` 指向 `client/miniprogram/` 与 `cloud/`）。
2. 核对 4 底栏与 13 页可达；`closed` 下只读/关闭行为按候选配置，不改 `enabled` 后混记。
3. 使用合成数据；不登录真实账号、不上传云函数、不写数据库、不发布体验版。
4. 最终 C4 冻结后需按最终 SHA 重新装配；本候选的 195/185/`711deb7e…` 仅为 `00c59a1` 预核。

## 边界

- 未上传、未部署、未写数据库、未清理、未真机、未提审。
- #263 后产品树已变；不能用 C3 的 183/`62b91…`/`29b31dd…` 代替本候选。
