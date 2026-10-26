# W1 YL03 首次部署清单与执行记录

## 2026-10-22 审批状态更正（Issue #22）

10月17日已[批准固定 1be13f8 / 0.2.1 三文件包的测试函数部署](https://github.com/HX-Jan/MoodSky/issues/22#issuecomment-6230926457)，同日已[接受双方独立下载且哈希一致的实际运行0.1.0包作为当次回滚依据](https://github.com/HX-Jan/MoodSky/issues/22#issuecomment-6234195256)。因此本文件原“未取得批准/待确认回滚来源”属于此前时点，不能继续当成当前状态；源代码commit未知这一历史事实仍保留。

上述授权只对应当时的版本、包哈希、函数及操作范围，不涵盖当前main或其他新包。议题尚未回填后续部署/正常客户端system.health的实际结果，不能推断当前云版本、运行时或健康状态。后续执行前应重新核对拟部署包和实际回滚快照；没有执行就继续标“待执行/待证据”，不能改成“已部署”。本次仅修正状态和补齐验收清单，没有部署、云调用或配置变更。

## 10月17日原始清单（保留历史时点）

- 负责人：Yuen Lin（832401211）
- 编写日期：2026-10-17，Asia/Shanghai
- 基线提交：`1be13f8287e177ae3f057a9298164eb631181778`
- 目标：按 Xiang Hong 已确认的环境和版本准备部署包，记录实际执行到哪一步；上传、云配置和数据库操作必须另行批准。
- 当前状态：**本地打包与检查完成；开发者工具已登录；只读云环境检查通过；云部署审批请求已发 Issue #22 评论，待 @HX-Jan 批准；未上传、未执行健康调用**

## 1. 角色与前置条件

| 项目                 | 值/负责人                                                       | 状态                           |
| -------------------- | --------------------------------------------------------------- | ------------------------------ |
| 团队 AppID           | `wxf602e991ff44e6c8` / Xiang Hong                               | 已记录；成员权限未全员核验     |
| 测试环境             | `mood-sky` / `mood-sky-d5gqy3spkff37566d`                       | 已记录                         |
| 云函数名称           | `moodsky`                                                       | 历史部署记录显示 Active        |
| 已验证云运行时       | `Nodejs16.13`                                                   | 历史记录；本次未重新查询       |
| 本地 Node.js         | `v24.16.0`                                                      | 本次实测                       |
| 云函数 SDK           | `wx-server-sdk 4.0.2`                                           | 本次打包清单核对               |
| 数据库集合/索引/权限 | Xiang Yu                                                        | 本次不修改                     |
| 上传批准             | 用户最后确认 + 仓库拥有者 @HX-Jan                               | **未取得**                     |
| 微信开发者工具登录   | 本人扫码登录                                                    | **已登录（`{"login":true}`）** |
| 可用部署工具         | 微信开发者工具 CLI `E:\WeChatDevTool\微信web开发者工具\cli.bat` | 已安装，可调用帮助命令         |

## 2. 部署前检查清单

### 2.1 版本与依赖

- [x] 确认提交号与 `package.json` 版本：`1be13f8` / `0.2.1`。
- [x] 使用 Node.js 24 执行 `npm ci`；根包 80 个依赖，0 漏洞。
- [x] 执行 `npm run setup`，生成本地配置和共享代码副本；不覆盖已有个人配置。
- [x] 执行 `npm ci --prefix cloudfunctions/moodsky`；云函数依赖 97 个，0 漏洞。
- [x] 执行 `npm run cloud:prepare`，确认 `miniprogram/shared` 与云函数副本一致。
- [x] 执行 `npm run check`；234 项测试通过，结构检查通过。
- [x] 执行 `node scripts/check-cloud.js`；SDK 加载与查询构造通过，未发送网络请求。

### 2.2 生成完整部署包

- [x] 执行 `npm run cloud:package`。
- [x] 确认输出目录只包含 `index.js`、`package.json`、`package-lock.json`。
- [x] 确认 `index.js` 为 esbuild 打包后的单文件，目标 `node16`，`wx-server-sdk` 保持 external。
- [x] 确认 `package.json` 与锁文件中的 `wx-server-sdk` 均为 `4.0.2`。
- [x] 保存文件大小与 SHA-256 清单：[package-manifest.json](artifacts/yl03/package-manifest.json)。
- [x] 保留命令输出：[cloud-package.txt](artifacts/yl03/cloud-package.txt)。

本次包信息：

| 文件                | 字节  | SHA-256（前 16 位） |
| ------------------- | ----- | ------------------- |
| `index.js`          | 18123 | `bd8767dc679f1118`  |
| `package.json`      | 227   | `926e92de65fbed9c`  |
| `package-lock.json` | 40850 | `badb025b86227567`  |

完整哈希、生成时间和目录见 [package-manifest.json](artifacts/yl03/package-manifest.json)。

### 2.3 上传前确认

- [x] 确认微信开发者工具已由本人登录（证据：[devtools-islogin-after.txt](artifacts/yl03/devtools-islogin-after.txt)，输出 `{"login":true}`）。
- [x] 确认部署目标为 `mood-sky-d5gqy3spkff37566d`、函数名 `moodsky`（只读检查见 [cloud-env-list.txt](artifacts/yl03/cloud-env-list.txt)、[cloud-functions-list-before.txt](artifacts/yl03/cloud-functions-list-before.txt)）。
- [x] 计划选择“云端安装依赖”，不上传本地 `node_modules`。
- [ ] 确认本次上传得到用户最后确认和 @HX-Jan 批准。
- [ ] 记录上传时间、版本、描述、操作人和返回结果。

**当前阻塞**：尚未取得上传批准（用户 + @HX-Jan）。登录已完成，但 2.3 的上传仍未执行。

> GitHub 审批请求：https://github.com/HX-Jan/MoodSky/issues/22#issuecomment-6230331868（等待 @HX-Jan 明确批准，批准前不上传）。

> 历史说明：登录前 CLI 曾返回 `{"login":false}`，原始输出保留在 [devtools-islogin.txt](artifacts/yl03/devtools-islogin.txt)，仅作阻塞历史；当前登录状态以 [devtools-islogin-after.txt](artifacts/yl03/devtools-islogin-after.txt) 为准。

## 3. 获批后的执行步骤

以下命令中登录与 `islogin` 已运行；部署命令只作为获批后的执行模板，本次**没有运行**：

```powershell
# 1. 登录（由本人扫码，不记录账号或凭证）
& "E:\WeChatDevTool\微信web开发者工具\cli.bat" login

# 2. 确认登录与环境
& "E:\WeChatDevTool\微信web开发者工具\cli.bat" islogin
& "E:\WeChatDevTool\微信web开发者工具\cli.bat" cloud env list --project "E:\MoodSky\MoodSky"

# 3. 使用 cloud:package 输出的完整目录部署，指定测试环境和云端安装依赖
& "E:\WeChatDevTool\微信web开发者工具\cli.bat" cloud functions deploy `
  --env "mood-sky-d5gqy3spkff37566d" `
  --paths "<cloud:package 输出目录>\moodsky" `
  --remote-npm-install `
  --project "E:\MoodSky\MoodSky"
```

上传后必须通过正常前端请求调用 `system.health`，核对 `ok:true`、版本和 `requestId`。不得用“上传成功”或 `cloudReady:true` 代替健康响应。

## 4. 部署后检查清单

- [ ] `system.health` 返回 `ok:true`，且 `apiVersion`、版本和 `requestId` 与请求一致。
- [ ] 记录响应原文（脱敏）和调用时间。
- [ ] 四页入口可加载；云关闭/失败状态有明确提示。
- [ ] 私人接口仍按预期返回 `NOT_IMPLEMENTED`，不出现虚假保存成功。
- [ ] 云函数日志无堆栈、身份、正文、令牌或环境变量泄露。
- [ ] 若健康检查失败，记录错误码、请求编号、复现步骤和接收负责人；不回退成“已通过”。
- [ ] 保留上一版部署包和提交号，必要时回滚并重新执行健康检查。

## 5. 实际执行结果

| 步骤                   | 结果       | 证据/说明                                                                                 |
| ---------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| 明确版本与目标环境     | 完成       | 提交 `1be13f8`；环境 `mood-sky-d5gqy3spkff37566d`                                         |
| 干净依赖与本地检查     | 完成       | [YL01](w1-yl01-baseline.md)                                                               |
| 生成完整部署包         | 完成       | [package-manifest.json](artifacts/yl03/package-manifest.json)                             |
| 核对包内容与 SDK 锁定  | 完成       | 3 个文件；SDK 4.0.2                                                                       |
| 微信开发者工具登录     | 完成       | [devtools-islogin-after.txt](artifacts/yl03/devtools-islogin-after.txt)：`{"login":true}` |
| 只读云环境/函数检查    | 完成       | 环境列表含 `mood-sky-d5gqy3spkff37566d`；函数列表含 `moodsky`、`moodsky-h03-probe`        |
| 上传云函数             | **未执行** | 依赖用户/拥有者批准和测试环境权限                                                         |
| 健康调用与版本核对     | **未执行** | 无新部署，不能复用历史结果；历史正式健康调用仍为 INVALID_REQUEST                          |
| 四页云端加载与错误检查 | **未执行** | 云函数未部署新包，未发起真实调用                                                          |

## 6. 阻塞、风险与下一步

| 阻塞/风险                            | 需要谁             | 下一步                                              |
| ------------------------------------ | ------------------ | --------------------------------------------------- |
| 上传权限/owner 批准未完成            | Xiang Hong/@HX-Jan | 只读访问已确认；审批请求已发 #22 评论，等待明确批准 |
| 上传/部署未获批准                    | 用户 + @HX-Jan     | 展示本清单、包哈希和测试结果，取得明确确认后再执行  |
| 历史正式健康响应为 `INVALID_REQUEST` | Xiang Hong         | 新包部署后重新调用；在成功前保留失败状态            |
| 数据库与权限配置不在本任务内         | Xiang Yu           | 保持现状；上传前后都不修改集合、索引或权限          |

## 7. 验收边界

- 本任务当前只能验收“部署清单、完整包生成、本地检查与阻塞记录”。
- 真实上传、云端运行、`system.health` 成功、业务写入和真机效果均未完成，不能写成已部署或已验收。
- 历史部署记录中的 Nodejs16.13、Active 状态和早期健康响应只作为背景，不代表本次新包已上线。
