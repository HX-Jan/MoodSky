# AS-YL02 最终包、入口与指纹核对

- 执行人：Yuen Lin / @Yuminu
- 执行日期：2026-11-22 21:07—21:09（Asia/Shanghai）
- 基线：`36ff7f54476ff19cbacba7238b11ee34a5adcdf6`（最新 `main`）
- 候选目录（工作区外）：`E:\MoodSky\alpha-yuen-lin-candidate-36ff7f5`
- 装配方式：在独立 detached 工作树检出 `36ff7f5`，`npm ci` 与 `npm run cloud:prepare` 后执行
  `npm run release:package -- E:\MoodSky\alpha-yuen-lin-candidate-36ff7f5 closed`
- 结论：**本地候选，不是部署包、不是微信体验版、不是同包真机结果。**

## 一、装配可追溯性

| 项目                                          | 实际值                                                               |
| --------------------------------------------- | -------------------------------------------------------------------- |
| 装配工作树                                    | 独立 detached 工作树，`git status --porcelain` 为空                  |
| 来源完整 SHA                                  | `36ff7f54476ff19cbacba7238b11ee34a5adcdf6`                           |
| `sourceWorktreeDirty`                         | `false`                                                              |
| 客户端 / 服务构建版本                         | `0.5.3` / `0.5.3`                                                    |
| 任务模式                                      | `closed`                                                             |
| 新增校园打卡默认暂停                          | `true`                                                               |
| 客户端哈希文件数                              | 183                                                                  |
| 云函数                                        | `moodsky-release`（3 文件）、`moodsky-release-maintenance`（4 文件） |
| 文件总数 / 字节                               | 193 / 1,165,385                                                      |
| 上传 / 部署 / 云生命周期 / 真机 / 提审 / 公开 | 全部 `false`                                                         |
| 备案 / 微信认证                               | `not-checked-by-packager`，保持未测                                  |

装配原始输出：[release-package.txt](artifacts/yl03/release-package.txt)；摘要与清单：[candidate-summary.txt](artifacts/yl03/candidate-summary.txt)、[candidate-manifest.json](artifacts/yl03/candidate-manifest.json)、[candidate-hashes.txt](artifacts/yl03/candidate-hashes.txt)。

## 二、关键 SHA-256

| 文件                                             | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `manifest.json`                                  | `f97c64deff4f10b02e707401068706653333dd32dbb1d7042149d786b70ec49d` |
| `project.config.json`                            | `060408913afc89e252e2f8e42853e6c87f0bddd6307e7af0de985a56fc855a2e` |
| `client/project.config.json`                     | `85e0ee5954198bab8b10e85d0a0085c2c8680b35a476a303f7f9f0b452bef92f` |
| `client/miniprogram/config/environment.local.js` | `da91c3674ebcc00cb954d0a9e10e4a3c0077b1618e3319475e5e091184788500` |
| `cloud/moodsky-release/index.js`                 | `dc197c9ccae941cd267b751ddf88d7fe36e10379ad8e3296dbc45b83f208905a` |
| `cloud/moodsky-release-maintenance/index.js`     | `61b45279004def092de9c793fb151329548c34777625669fa79aadc6cf7ebae4` |

`environment.local.js` 实际值：`cloudEnabled=true`、`journalDemo=false`、`trustedSessionEnabled=true`、`releaseProfile=production`、`buildCommit=36ff7f5…`、`taskMode=closed`、`explicitWechatLogin=true`、`requestTimeoutMs=25000`。
`server.env.example` 保持服务端开关示例：`MOODSKY_PRODUCTION_ENABLED=false`、`MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED=true`，不含密钥。

## 三、manifest 逐项核对

| 核对项                                 | 要求             | 实际                       | 判定           |
| -------------------------------------- | ---------------- | -------------------------- | -------------- |
| `sourceCommit`                         | 与出包提交一致   | `36ff7f5…`                 | 通过           |
| `sourceWorktreeDirty`                  | 干净             | `false`                    | 通过           |
| `uploadVersion` / `serverBuildVersion` | 版本一致         | `0.5.3` / `0.5.3`          | 通过           |
| `taskMode`                             | `closed`         | `closed`                   | 通过           |
| `campusCheckinWritesPausedByDefault`   | `true`           | `true`                     | 通过           |
| 客户端哈希                             | 覆盖全部打包文件 | 183                        | 通过           |
| 两支云包哈希                           | 业务 + 维护      | 3 + 4 文件                 | 通过           |
| 私有配置 / 服务端密钥                  | 不包含           | `false` / `false`          | 通过           |
| 定位 API                               | 不启用           | `locationApiEnabled=false` | 通过           |
| 上传/部署/真机/提审/公开               | 未执行           | 全部 `false`               | 通过           |
| 备案 / 微信认证                        | 不由装配器核验   | `not-checked-by-packager`  | 未测，保持阻塞 |

## 四、入口表（13 页 / 4 底栏）

| 序号 | 页面                          | 类型   | 底栏文字 |
| ---: | ----------------------------- | ------ | -------- |
|    1 | `pages/today/index`           | tabBar | 今天     |
|    2 | `pages/record/index`          | stack  | —        |
|    3 | `pages/campus/index`          | stack  | —        |
|    4 | `pages/universe/index`        | tabBar | 天气宇宙 |
|    5 | `pages/me/index`              | tabBar | 我的     |
|    6 | `pages/review/archive/index`  | stack  | —        |
|    7 | `pages/review/month/index`    | stack  | —        |
|    8 | `pages/review/detail/index`   | stack  | —        |
|    9 | `pages/review/insights/index` | stack  | —        |
|   10 | `pages/tasks/index`           | tabBar | 小任务   |
|   11 | `pages/account/index`         | stack  | —        |
|   12 | `pages/login/index`           | stack  | —        |
|   13 | `pages/profile/index`         | stack  | —        |

机器可读版本：[entry-table.csv](artifacts/yl03/entry-table.csv)。`pages` 共 13 项，`tabBar.list` 共 4 项；无定位权限声明（`app.json` 权限与私有信息字段已由装配器删除）。

## 五、预览前检查（原生与云端验收尚未执行）

本轮维护者核查补充：原候选的 `cloudEnabled=true`、目标环境已写入配置，因此“本地导入”不保证不会连接目标云。下列入口表是交接步骤，不能作为已运行的原生或离线证据。纯离线页面检查使用单独的源码副本和既有合成桥接，先确认 `cloudEnabled=false`、环境ID为空；修改配置的副本须另登记哈希，不能冒作本候选原包。未获准目标云验证时，不直接编译运行该正式候选。

1. 在获准相应目标环境验证后，才在微信开发者工具导入候选根目录 `E:\MoodSky\alpha-yuen-lin-candidate-36ff7f5`（根 `project.config.json` 已把 `miniprogramRoot` 指向 `client/miniprogram/`，`cloudfunctionRoot` 指向 `cloud/`）。
2. 确认 AppID 为候选 `project.config.json` 中的值；不要替换为个人 AppID 后再把运行结果写回本候选。
3. 编译后核对 4 个底栏（今天／小任务／天气宇宙／我的）与 13 个页面可达；记录、校园、回顾、账号子页从实际控件进入。
4. `taskMode=closed` 下，小任务只读／关闭行为按候选配置检查；不要手工改成 `enabled` 后与本次结论混记。
5. 使用合成数据；不要登录真实账号、不要上传云函数、不要写数据库、不要上传体验版。
6. 若需要核对文件完整性，在候选目录外执行 PowerShell：
   `Get-FileHash -Algorithm SHA256 (Get-ChildItem <candidate> -Recurse -File)`
   并与 `artifacts/yl03/candidate-hashes.txt` 对照；`manifest.json` 内另含客户端与云包逐文件哈希。

## 六、边界

- **不是部署包**：未上传云函数、未写数据库、未改索引/权限、未执行清理或恢复。
- **不是微信版本**：未上传体验版/正式版，无平台回执。
- **不是同包真机结果**：本机无 Android/iOS 设备；成员真机材料来自其他构建，不能与本候选拼成同一包。
- **不是 1.0.0**：本候选版本为 `0.5.3`。
- **与 W6 候选不合并**：`0.5.1`（`c0518e5`）与 `0.5.2`（`5b27753`）是旧候选；本候选来源为 `36ff7f5`，任何复测必须注明目录与 `sourceCommit`。
