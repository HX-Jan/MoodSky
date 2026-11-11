# W5-YL02 候选包与封包核对

- 执行时间：2026-11-10 20:40—21:10（Asia/Shanghai）
- 源码基线：`28f810c77e5aae887e9753c65588d0bad85df7f3`（干净 worktree，`sourceWorktreeDirty=false`）
- 本机候选输出：仓库外新目录 `E:\MoodSky\w5-candidate-28f810c`（未上传、未部署）
- 结论：**本地候选可复核；1.0.0 封包不能签认**。仓库没有 1.0.0 标签、Release、版本号或洪翔封包清单；本机包版本仍为客户端 `0.4.0`、服务构建 `0.3.0-rc2`

## 一、本地候选清单

| 项目                     | 实际值                                            |
| ------------------------ | ------------------------------------------------- |
| `status`                 | `local-candidate-not-deployed`                    |
| `uploadVersion`          | `0.4.0`                                           |
| `serverBuildVersion`     | `0.3.0-rc2`                                       |
| `sourceCommit`           | `28f810c77e5aae887e9753c65588d0bad85df7f3`        |
| `sourceWorktreeDirty`    | `false`                                           |
| AppID                    | `wxf602e991ff44e6c8`（源码配置）                  |
| 云环境 ID                | `mood-sky-d5gqy3spkff37566d`                      |
| 主函数 / 维护函数        | `moodsky-release` / `moodsky-release-maintenance` |
| 客户端文件数             | 178                                               |
| 输出总文件数             | 188                                               |
| 输出总字节               | 1,022,112                                         |
| `uploaded`               | `false`                                           |
| `deployed`               | `false`                                           |
| `cloudLifecycleVerified` | `false`                                           |
| `phoneVerified`          | `false`                                           |
| `submittedForReview`     | `false`                                           |
| `publicRelease`          | `false`                                           |
| `locationApiEnabled`     | `false`                                           |

原始记录：[candidate-manifest.json](artifacts/yl03/candidate-manifest.json)、[candidate-summary.txt](artifacts/yl03/candidate-summary.txt)、[release-package.txt](artifacts/yl03/release-package.txt)。

## 二、关键指纹

| 文件                                                        | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| 候选 `manifest.json`                                        | `6aca6fc4b28ebea16adf0d7c99bd0e59d8ce67432e0c824a1995ec15419edb4b` |
| 客户端 `miniprogram/app.json`                               | `5c0356424b5733e92c735744a5392abbccaabed7b12612fde0fde77f3ee85679` |
| 客户端 `miniprogram/app.js`                                 | `80211169a10dc4605cf4d7ed2207c23d8e68d437c895231744a98d56bf10a32d` |
| 客户端 `miniprogram/shared/constants.js`                    | `7f2bd35fe42bae101aff096facbbb560bb138e020e9f0fcd330f734601fdd6d7` |
| 客户端 `miniprogram/config/environment.local.js`            | `bb49f63c4cb6b650a7e6526200103165081a2855fa538f2366050fe003a6c4e2` |
| 客户端 `project.config.json`                                | `ae877187b27ab5e1476c59bb578a96419753e3f4f49c115b10d45307a40ccf38` |
| 根 `project.config.json`                                    | `248b3e40d759d98d22efaaeea7d0e9cfaca201130076775a09022d2d1cd15f00` |
| 候选云主入口 `cloud/moodsky-release/index.js`               | `4edecab2cf966f6e64a6913fa3acb192b8ff8801ab466ce5723ba5c16a986b02` |
| 候选云维护入口 `cloud/moodsky-release-maintenance/index.js` | `44c7416a6a074e91a1edbdf414d04b60450935e1f5edcc806b74bc2a10bbc64b` |
| 普通 `cloud:package` 入口 `index.js`                        | `96ea9cfc1f4235bd436b192f40a4af09ee0759108c00f857d5b5867e9068c77f` |

原始记录：[candidate-hashes.txt](artifacts/yl03/candidate-hashes.txt)、[cloud-package.txt](artifacts/yl03/cloud-package.txt)。

## 三、实际功能开关

候选的 `environment.local.js` 由打包器生成，实际内容：

```js
module.exports = {
  cloudEnabled: true,
  cloudEnvId: 'mood-sky-d5gqy3spkff37566d',
  cloudFunctionName: 'moodsky-release',
  journalDemo: false,
  trustedSessionEnabled: true,
  releaseProfile: 'production',
  explicitWechatLogin: true,
  requestTimeoutMs: 25000,
};
```

| 开关/能力 | 候选实际值                                                                                | 风险                                                                                               |
| --------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 云启用    | `cloudEnabled=true`，指向目标环境                                                         | 代码已指向目标云；本轮没有调用，不能证明目标云已配套                                               |
| 信任会话  | `trustedSessionEnabled=true`、`explicitWechatLogin=true`                                  | 需要目标云身份密钥和会话配置；未验证                                                               |
| 演示数据  | `journalDemo=false`                                                                       | 不会主动回填演示记录                                                                               |
| 定位能力  | `locationApiEnabled=false`；打包器移除 `permission`/`requiredPrivateInfos`                | 与“手动打卡无 GPS”一致；未做真机权限检查                                                           |
| 校园能力  | `clientCapabilities().campus.state='readOnly'`                                            | 只读推荐与打卡入口的实际范围待真机/云核对                                                          |
| 普通任务  | 当前 `main` 在可信云条件下将 `tasks.state='available'`；候选 manifest **没有 `taskMode`** | #166 的 `closed/readOnly/enabled` 范围控制尚未合入；当前候选可能仍向用户展示任务入口，属于 P1 风险 |
| 上传版本  | `APP_VERSION='0.4.0'`                                                                     | 不是 1.0.0                                                                                         |

说明：普通任务的当前源码在 `miniprogram/modules/system/capabilities.js` 中按 `trustedCloudReady(config)` 判定可用；`scripts/package-production.js` 在 `28f810c` 还没有 `taskMode` 参数。Qizhen Chen 的 #166 才增加该范围控制，但 #166 仍开放且以 `9f58ed8` 为基线，未进入本次 `28f810c` 候选。

## 四、目标云与旧客户端对照

### 4.1 目标云版本

- 本轮**没有**目标云凭据，未调用 `system.health`、未读取数据库、未部署。
- 引用 Qinghan [#169](https://github.com/HX-Jan/MoodSky/pull/169) 的只读诊断：目标函数 `moodsky-release` 可达，`system.health` 返回 `ok=true`、`version=0.4.0`；`campus.checkins` 返回 `ACTION_NOT_FOUND`。
- Qinghan 下载的目标部署包只包含 `campus.checkin`（小写 i）和 `campus.checkinHistory`，不包含 `campus.checkIn` 或 `campus.checkins`。当前本地客户端使用 `campus.checkIn` 写入、`campus.checkins` 读取，契约不一致。
- 当前源码 `28f810c` 的生产路由同时支持四个名称：`campus.checkIn`、`campus.checkins`、`campus.checkin`、`campus.checkinHistory`；因此**源码层不是缺接口，而是目标云没有部署当前源码包**。是否重部署、如何兼容旧客户端与旧数据，需要洪翔/Junhan 按发布流程决定。
- 版本号 `0.4.0` 只能说明目标函数返回的版本字段，不能证明部署包内容；未取得目标云构建指纹。

### 4.2 旧客户端兼容

| 项目                     | 结果                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 0.3.0 线上客户端对目标云 | **未执行**：无线上包、无目标云权限、无真实账号                                                                            |
| 0.4.0 候选对目标云       | **未执行**：无目标云权限                                                                                                  |
| 旧数据/旧请求源码兼容    | 92 项定向通过：`artifacts/yl03/legacy-compat-tests.txt`；覆盖旧 outbox 键、旧回执、旧记录、老客户端更新降级、旧导出围栏等 |
| 旧校园接口名             | 源码同时支持 `campus.checkin`/`checkinHistory` 与 `campus.checkIn`/`checkins`；未验证目标云实际部署                       |
| 旧任务状态               | 源码对 legacy 日行拒绝改写、保留原数据；未验证真实云旧数据                                                                |

结论：源码级兼容有证据；真实旧客户端兼容没有证据。不能把 92 项源码测试写成“0.3.0 线上客户端已兼容”。

## 五、1.0.0 封包缺口

| 检查项               | 现状                                                                                    | 结论                                         |
| -------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| `APP_VERSION`        | `0.4.0`                                                                                 | 未升到 1.0.0；不能把本机包称 1.0.0           |
| 发布用版本号         | 未找到独立发布版本来源                                                                  | 无法核对“APP_VERSION 与发布用版本号一致”     |
| `uploadVersion`      | 本机候选为 `0.4.0`                                                                      | 未达到计划要求的 `1.0.0`                     |
| 1.0.0 标签/Release   | 无                                                                                      | 无固定 1.0.0 来源                            |
| 洪翔封包清单         | 未找到                                                                                  | 无法核对同一候选                             |
| 客户端/云/维护包指纹 | 本机候选有哈希；目标云无指纹                                                            | 无法确认“提审文件与已测候选指纹一致”         |
| 能力开关             | 本地候选已记录；目标云实际开关未取                                                      | 无法确认“候选关联实际开启能力”               |
| 回退目标             | `v0.4.0` 源码标签 `1c2ed1a` 可作源码回退；线上 0.3.0 与云入口 `d4e6c450…` 仅见 H01 记录 | 需发布人确认当前回退目标与负责人；本轮未操作 |

## 六、回滚来源（仅登记，不执行）

| 回滚目标       | 固定来源                                              | 可用性/边界                                               |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| 源码           | `v0.4.0` / `1c2ed1a856a21be5a82c4f51ee538859b94e8f2b` | 标签固定；只回退源码，不等于回退云端或客户端              |
| 微信线上客户端 | `0.3.0`（负责人 2026-11-01 确认）                     | 需公众平台操作；本轮未操作                                |
| 主云函数       | H01 记录的 `moodsky-release` / `index.js d4e6c450…`   | 需云控制台/CLI 回滚；本轮未操作，且需确认是否仍为当前部署 |
| 维护云函数     | H01 记录的 `moodsky-release-maintenance` / `6d5d725…` | 需云控制台/CLI 回滚；本轮未操作                           |
| 本机候选       | `E:\MoodSky\w5-candidate-28f810c`                     | 本地目录，不是线上版本                                    |

## 七、封包结论

本机候选可用于源码审查、指纹登记和后续差异比较，但只能称为“本地候选”：

- 未获得洪翔的 1.0.0 候选包，不能核对 1.0.0 的同一候选、版本、指纹、开关和回退目标；
- 未部署、未上传、未做真机、未调用目标云；
- 当前 `main` 的普通任务入口控制不等同于 #166 的 `closed` 候选，若直接提审，存在展示未定稿任务入口的风险；
- 目标云与当前客户端校园接口不一致，若直接提审，P1 校园打卡/历史不可用。

上述任一项未解决，均不应把本机候选写成“已封版”或“可提审”。
