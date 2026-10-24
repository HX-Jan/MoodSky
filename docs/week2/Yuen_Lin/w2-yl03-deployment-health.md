# W2 YL03 部署准备与健康验证记录

- 负责人：Yuen Lin（832401211）
- 执行日期：2026-10-24，Asia/Shanghai
- 基线提交：`ed1d76fd97312dd2a4bee0db87aed4e49a14f7eb`（0.2.3）
- 目标环境：`mood-sky-d5gqy3spkff37566d`，函数 `moodsky`，运行时 `Nodejs16.13`
- 状态：**部署包与现网版本核对完成；正式前端健康只读验证通过；本次未由本人部署、未写数据库、未上传小程序**

## 1. 与 Xiang Hong 的分工

| 项目                 | 负责人/来源                        | 本次实际状态                                                                      |
| -------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| 正式健康入口修复包   | Xiang Hong；已获用户单独批准并部署 | 现网运行 0.2.3；记录见[健康部署说明](../xiang-hong/health-deployment-20261023.md) |
| 本次部署             | 不由 Yuen Lin 执行                 | **未执行**；本人只做打包核对、只读现网检查和健康调用                              |
| 数据库集合/索引/权限 | Xiang Yu                           | 未修改；未执行真实业务写入                                                        |
| 平台账号与 AppID     | Xiang Hong                         | 使用团队测试环境，未记录个人凭证                                                  |
| 小程序体验版/正式版  | 需单独批准                         | **未上传**                                                                        |

## 2. 目标环境与运行时核对

使用微信开发者工具 CLI 只读查询，原始输出在 [artifacts/yl03](artifacts/yl03/)：

| 检查           | 实际结果                                | 证据                                                                |
| -------------- | --------------------------------------- | ------------------------------------------------------------------- |
| 开发者工具登录 | `{"login":true}`                        | [devtools-islogin.txt](artifacts/yl03/devtools-islogin.txt)         |
| 云环境列表     | 含 `mood-sky-d5gqy3spkff37566d`         | [cloud-env-list.txt](artifacts/yl03/cloud-env-list.txt)             |
| 云函数列表     | `moodsky`、`moodsky-h03-probe`          | [cloud-functions-list.txt](artifacts/yl03/cloud-functions-list.txt) |
| `moodsky` 状态 | `Active`；超时 60；运行时 `Nodejs16.13` | [cloud-function-info.txt](artifacts/yl03/cloud-function-info.txt)   |

## 3. 完整部署包核对

执行 `npm run cloud:package`，输出目录只含三个文件；使用输出目录作为部署包，不直接上传源码目录。

命令输出：[cloud-package.txt](artifacts/yl03/cloud-package.txt)。完整哈希见 [package-manifest.json](artifacts/yl03/package-manifest.json)。

| 文件                | 字节  | SHA-256                                                            |
| ------------------- | ----- | ------------------------------------------------------------------ |
| `index.js`          | 20224 | `7c70deb704614890beec70dc237337a23df17d30c5b11bd88636732d4cf46a26` |
| `package.json`      | 227   | `2190849cc579a76b4e7e4862b648d0eda6f3d6392e1e58dac7374737d1cc7ca7` |
| `package-lock.json` | 40850 | `13e30eb99216195aa091a3c227a67912c2b617108eb3792b24707e1abd2481bc` |

以上三个哈希与 Xiang Hong 的[已部署固定候选](../xiang-hong/health-deployment-20261023.md)完全一致（入口 `7c70deb…`、`package.json` `2190849…`、锁文件 `13e30eb…`）。这说明**当前源码可重复生成与现网一致的包**，但不等于本次又执行了一次部署。

依赖边界：

- `wx-server-sdk 4.0.2`，以云函数锁文件为准；未升级 SDK。
- 云端安装依赖，不上传本地 `node_modules`。
- 正式包不导入 H03 探针或候选数据库组装；默认私人业务保持关闭。

## 4. 正式前端健康调用（真实云端）

### 4.1 方法

1. 备份个人 `miniprogram/config/environment.local.js`（SHA-256 `9E7B6859A88B26239B8010DE598B240F8EBCAEB3B375C17512380B5E2592A4DE`）。
2. 临时设置 `cloudEnabled:true`、`cloudEnvId:'mood-sky-d5gqy3spkff37566d'`、`journalDemo:false`；个人配置已被 `.gitignore` 排除，不进入提交。
3. 使用微信开发者工具 Stable `2.01.2510290` 与 `miniprogram-automator 0.13.0` 连接自动化端口，进入 `pages/me/index`。
4. 调用页面真实的 `runHealth()`，走 `checkHealth('formal')` → `services/api` → `wx.cloud.callFunction`，而不是直接调用云函数或注入响应。
5. 读取页面展示字段后恢复原配置；恢复后 SHA-256 与备份一致，`git status` 无新增已跟踪改动。

### 4.2 实际结果

原始结构化结果：[health-frontend.json](artifacts/yl03/health-frontend.json)；控制台输出：[health-frontend.console.txt](artifacts/yl03/health-frontend.console.txt)。

| 字段              | 实际值                            |
| ----------------- | --------------------------------- |
| 路径              | `pages/me/index`                  |
| 模式              | `formal`                          |
| 页面文案          | `正式接口校验通过 · apiVersion=1` |
| `healthVersion`   | `0.2.3`                           |
| `healthRequestId` | `req_mvmj4sh6_2_2bbla7dt`         |
| `healthCode`      | 空                                |
| `feedbackState`   | `empty`（成功态）                 |
| 调用时间（UTC）   | `2026-10-24T15:04:08Z`            |

该请求编号是本次本人调用产生的前端请求号，与 Xiang Hong 的独立记录 `req_mvl5txwn_1_urw0o5ov` 不同，说明不是复用旧结果。

## 5. 未执行项与边界

| 项目                       | 状态       | 原因/接收人                                             |
| -------------------------- | ---------- | ------------------------------------------------------- |
| 由 Yuen Lin 执行云函数部署 | **未执行** | 无部署授权；本轮由 Xiang Hong 经批准部署                |
| 数据库集合、索引、权限配置 | **未执行** | 归 Xiang Yu；本次不修改                                 |
| 真实记录写入/清理/迁移     | **未执行** | 私有业务未接线；需要单独批准                            |
| 小程序体验版/正式版上传    | **未执行** | 需用户与 @HX-Jan 单独确认                               |
| 四页真实云端业务加载       | **未执行** | 本次只做健康只读调用；页面数据仍可能显示未实现/演示状态 |

## 6. 风险、回滚与结论

- 风险：健康成功只证明正式入口可调用并返回 0.2.3，不证明私人记录、回顾、任务或后台业务已在云端可用。
- 回滚：现网上一版备份与哈希由 Xiang Hong 保存在工作区；如需回滚，应由 Xiang Hong 按原批准范围重新部署并再次执行健康检查，Yuen Lin 不自行操作。
- 结论：部署包可重复生成且与现网一致；正式前端健康链路真实通过，版本 0.2.3、请求号已记录。本次没有新的部署、数据库写入或小程序发布。
