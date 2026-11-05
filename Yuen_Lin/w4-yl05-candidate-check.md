# W4 YL05 候选包检查与回滚来源

- 执行日期：2026-11-05（Asia/Shanghai）
- 承接：W3 YL03/YL05
- 源码基线：`09903ceb1e3b2ce38155484a2afd50297bab54a1`
- 结论：本地候选包已生成并核对；**未部署、未上传、未做手机验证**，不能称为线上版本

## 版本与来源矩阵

| 层级                | 来源/版本                                                                | 本次核对方式                    | 结论                        |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------- | --------------------------- |
| GitHub `main`       | `09903ceb1e3b2ce38155484a2afd50297bab54a1`（2026-11-05T15:10:55Z）       | GitHub API + 官方归档           | 本轮验证基线                |
| GitHub 固定 Release | `v0.4.0` / `1c2ed1a856a21be5a82c4f51ee538859b94e8f2b`                    | GitHub API 标签                 | 固定发行快照；不是本轮 main |
| 微信线上版本        | `0.3.0`（负责人 2026-11-01 确认）                                        | 未查询公众平台                  | 仅引用，不由本轮证明        |
| 线上客户端来源      | `576499f8b5a5d6a182c9356e11fc862a8df6fb70`（H01 记录）                   | 未下载线上包                    | 仅引用，未逐字节比较        |
| 主云服务            | `moodsky-release` / 健康构建 `0.3.0-rc2` / `index.js` `d4e6c450…`（H01） | 未调用云                        | 仅引用，未独立验证          |
| 维护云服务          | `moodsky-release-maintenance` / 来源 `6d5d725…`（H01，2026-10-30）       | 未调用云                        | 仅引用，未独立验证          |
| 已推送手机预览      | `candidate-account-ui` / `c78acc5…`（H01）                               | 未连接手机                      | 仅引用，未复验              |
| 本轮本地候选        | 源码 `09903ce` / 客户端 `0.4.0` / 服务构建 `0.3.0-rc2`                   | 本地 `release:package isolated` | 本地候选，未部署            |

原始来源记录：[remote-sources.txt](artifacts/yl05/remote-sources.txt)。

## 本地候选包

| 项目                 | 实际值                                            |
| -------------------- | ------------------------------------------------- |
| 输出目录             | 仓库外新目录，构建后未上传                        |
| `status`             | `local-candidate-not-deployed`                    |
| `uploadVersion`      | `0.4.0`                                           |
| `serverBuildVersion` | `0.3.0-rc2`                                       |
| AppID                | `wxf602e991ff44e6c8`                              |
| 云环境 ID            | `mood-sky-d5gqy3spkff37566d`                      |
| 主函数 / 维护函数    | `moodsky-release` / `moodsky-release-maintenance` |
| 客户端文件数         | 177                                               |
| 输出总文件数         | 187                                               |
| 输出总字节           | 1,009,594                                         |
| 打包时工作区         | 干净（`sourceWorktreeDirty=false`）               |
| `uploaded`           | `false`                                           |
| `deployed`           | `false`                                           |
| `phoneVerified`      | `false`                                           |
| `locationApiEnabled` | `false`                                           |

候选清单：[candidate-manifest.json](artifacts/yl05/candidate-manifest.json)；哈希摘要：[candidate-hashes.txt](artifacts/yl05/candidate-hashes.txt)；构建日志：[release-package-clean.txt](artifacts/yl05/release-package-clean.txt)。

## 关键哈希

| 文件                                                    | SHA-256                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| 客户端 `miniprogram/app.json`                           | `5c0356424b5733e92c735744a5392abbccaabed7b12612fde0fde77f3ee85679` |
| 客户端 `miniprogram/app.js`                             | `80211169a10dc4605cf4d7ed2207c23d8e68d437c895231744a98d56bf10a32d` |
| 客户端 `project.config.json`                            | `ae877187b27ab5e1476c59bb578a96419753e3f4f49c115b10d45307a40ccf38` |
| 生产配置 `environment.local.js`                         | `bb49f63c4cb6b650a7e6526200103165081a2855fa538f2366050fe003a6c4e2` |
| 校园页 `pages/campus/index.js`                          | `d17bfd306dbce6de4fccb05c588fa9e13bb2c5dabd43c391fe9cbfd2547f870a` |
| 校园页 `pages/campus/index.wxml`                        | `1ced082752f7eb7159c4d9a68189701f9af831003f6d74128dccb520fb01fdac` |
| 打卡控制器 `modules/campus/checkin/controller.js`       | `da411081f583534faadfae25202da42a994d5e83661631971476042f3b44716f` |
| 云主函数 `cloud/moodsky-release/index.js`               | `06ed7bda367ca4210ecd4aa8917029cdc49e29771dcfa265881e4b49f28b61ff` |
| 云维护函数 `cloud/moodsky-release-maintenance/index.js` | `44c7416a6a074e91a1edbdf414d04b60450935e1f5edcc806b74bc2a10bbc64b` |
| 根 `project.config.json`                                | `248b3e40d759d98d22efaaeea7d0e9cfaca201130076775a09022d2d1cd15f00` |
| 候选 `manifest.json`                                    | `54fa2a4fdc0b4782d6226526a67849a3c8590b75254bb93996cd42e8c1e986c3` |

另用 `npm run cloud:package` 生成普通部署目录：`index.js` SHA-256 `1fa7993b1cba417f211f24d4df046eaa887893b317e20335415731d864ed1b11`，包清单哈希与候选一致。日志：[cloud-package-clean.txt](artifacts/yl05/cloud-package-clean.txt)。

## 与已部署版本的差异

- 候选云入口 `06ed7bda…` 与 H01 记录的已部署 `d4e6c450…` **不同**；源码版本同为 `0.4.0`/服务构建 `0.3.0-rc2`，但不能据此说云端已更新。
- 线上微信仍按负责人 11 月 1 日确认的 `0.3.0`；候选客户端为 `0.4.0`。本轮没有下载线上包，不能给出逐字节 diff，也不能说线上已包含 W4 手动打卡。
- `main` 相较线上新增的手动打卡、本人历史、登录返回、隐私/退出保护等，按 [H01](../xiang-hong/h01-version-capabilities.md) 和 [H04](../xiang-hong/h04-data-seams.md) 的源码记录引用；这些是源码事实，不是线上部署事实。
- 新集合 `place_checkins`、索引与客户端禁读禁写规则属于部署计划；H04 明确记录“尚未部署”。队友的部署续报未由本轮独立核对。

## 回滚来源

| 回滚目标       | 固定来源                                                    | 可用性/边界                                  |
| -------------- | ----------------------------------------------------------- | -------------------------------------------- |
| GitHub 源码    | `v0.4.0` / `1c2ed1a856a21be5a82c4f51ee538859b94e8f2b`       | 标签固定；可回退源码，不等于回退云端或客户端 |
| 微信线上客户端 | `0.3.0` / `576499f8b5a5d6a182c9356e11fc862a8df6fb70`（H01） | 需公众平台版本回退；本轮未操作               |
| 主云服务       | `moodsky-release` / `index.js` `d4e6c450…`（H01）           | 需云控制台/CLI 回滚；本轮未操作              |
| 维护云服务     | `moodsky-release-maintenance` / `6d5d725…`（H01）           | 需云控制台/CLI 回滚；本轮未操作              |
| 手机预览       | `candidate-account-ui` / `c78acc5…`（H01）                  | 需重新推送预览；本轮未操作                   |
| 本机旧回滚目录 | `E:\MoodSky\rollback\moodsky-0.1.0-20261017`                | 旧 0.1.0 包，仅作历史，不用于本轮候选        |

## 打包与部署分列

- 本地 `release:package` 只读源码、复制客户端文件、打包云入口并写清单；不登录云、不上传、不写库、不改权限。
- 本轮 `uploaded=false`、`deployed=false`、`submittedForReview=false`、`publicRelease=false`。
- 真的部署/上传需要：负责人确认目标与包、云备份/回滚材料、用户明确批准；部署后还必须调用正常前端 `system.health` 并记录版本、`requestId` 与业务验收，上传成功不算通过。
- 本轮没有执行上述任何发布动作。

## 远端 CI

| 项目            | 结果                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游 `main`     | run `42052346861`，`MoodSky CI`，`success`，head `09903ce`                                                                                                |
| PR #149 quality | job `127330588949`，`SUCCESS`                                                                                                                             |
| 本轮分支        | [PR #150](https://github.com/HX-Jan/MoodSky/pull/150)；首次提交 run `42057330952` / job `127349186017`，`quality`，`SUCCESS`，39 秒；后续提交见 PR checks |
| PR 状态         | `OPEN`、`MERGEABLE`、`mergeStateStatus=BLOCKED`（等待复核）                                                                                               |

PR 记录见 [pr-status.txt](artifacts/yl05/pr-status.txt)。上游 CI 不能引用为本轮分支结果；本轮分支 CI 也不证明部署或真机。

## 结论

候选包可用于后续审查和候选范围确认，但只能称为“本地候选”。在获得明确批准并完成真实云、微信上传和真机验证前，不能把它写成已部署、已上线或已验收。文档已通过 [PR #150](https://github.com/HX-Jan/MoodSky/pull/150) 提交，CI 通过；PR 仍等待 Xiang Hong 复核与 Qizhen Cai 独立结论。
