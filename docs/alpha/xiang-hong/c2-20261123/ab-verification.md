# 成员本地A/B验收入口

用途：解决Bug232中“缺少成员可直接使用的独立身份和定向请求”的本地测试条件。工具使用真实生产业务入口、两套合成身份及一次性内存库。它不是微信账号切换界面，不操作真实微信、云数据或手机。

## 从最新源码执行

在实际Git源码目录打开PowerShell，使用Node.js 24。首次依赖未安装时先执行前两条；已有依赖可直接从setup开始。

```powershell
npm.cmd ci
npm.cmd ci --prefix cloudfunctions/moodsky
npm.cmd run setup
npm.cmd run cloud:prepare
$abEvidence = Join-Path $env:TEMP ('MoodSky-AB-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node tools/alpha-h/ab-workbench.cjs --out $abEvidence
Get-Content -LiteralPath (Join-Path $abEvidence 'results.csv')
```

正常输出为`cases:16, passed:16, failed:0`，同时生成`results.json`和`results.csv`。每次使用新的绝对目录；非空目录会拒绝覆盖。数据只在本次运行内存在，退出后释放；不用注销真实账号来重置。工具不需要云密钥或个人配置中的环境ID；setup默认配置保持禁云。

| 检查点  | 观察内容                                                                   |
| ------- | -------------------------------------------------------------------------- |
| H01/H02 | A、B均能读取本人不同地点的历史，证明不是所有请求都失败                     |
| H03/H04 | B夹带A ownerId被INVALID_REQUEST拒绝，B身份混用A scope被UNAUTHENTICATED拒绝 |
| E01/E02 | A/B本人JSON可领取，正文只含本人合成标记                                    |
| E03/E04 | B定向查询/领取A真实生成的jobId，均应FORBIDDEN                              |
| E05/E06 | A修改记录使旧导出CONFLICT；B文件继续可领                                   |
| L01/L02 | A停用后被拒；B记录继续可读                                                 |
| L03—L06 | 显式重新注册得到不同scope，空账号不读旧记录/旧文件，旧scope被拒            |

JSON中保存构建、dirty状态、真实执行时间和固定夹具业务日；两者分开。scope、注销回执、导出正文和记录text在落盘时遮蔽，内容归属通过facts记录。actor=A/B明确是哪套合成身份；正式服务的身份限制没有被放宽。

## 独立回传

蔡奇真本人执行后，交`results.json`、`results.csv`，另写真实执行人、环境、步骤、预期与实测、未测和实际意见。工具默认executor未填写、independentAcceptance=false；不要改维护者的预跑日期或直接复制通过结论冒作本人执行。若失败，保留原文件和退出结果，附用例编号交洪翔/对应服务主责。

命令找不到模块：先确认在实际源码目录、Node24和依赖已安装。ACTION_NOT_FOUND：先cloud:prepare再用新输出目录复跑。只需普通本地依赖，不需要成员腾讯云权限。本轮只补本地支持条件，真实设备切号、文件送达、后台状态和清理维护仍按各自验收。
