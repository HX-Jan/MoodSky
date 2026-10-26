# 正式健康入口修复的固定部署范围

2026-10-23。只读检查仍确认云函数 moodsky 使用 0.1.0 包；真实微信调用 system.health 返回 INVALID_REQUEST（请求包含未约定字段），平台请求编号 a2f9d04f-924c-47b5-9990-ce51eed0c0cb。该结果独立于 H03 探针，不能用探针通过替代。

本地已有的 0.2.3 正式入口会先排除微信附带的 userInfo/tcbContext，再做严格请求校验；未知字段仍拒绝，身份仍只来自可信上下文。当前打包代码不导入候选路由或数据库组装，不启用个人记录、任务写入或其他私人业务。已通过入口/传输回归、打包语法和锁定 SDK 检查；当前完整本地检查 593 项通过，正式云依赖审计 0 项漏洞。

## 申请范围

仅部署环境 mood-sky-d5gqy3spkff37566d、AppID wxf602e991ff44e6c8 的既有 moodsky 函数，三个固定文件并远程安装锁定依赖；保持运行时、超时、内存和既有配置。SDK 仍为 wx-server-sdk 4.0.2 / database 1.5.1，不是依赖升级。成功后仅执行真实微信 system.health 只读检查。

不包含数据库读写、索引/权限调整、身份或业务门禁开放、私人账号初始化、数据迁移、清理或小程序上传。H03 探针保持已验证版本及全部批次数据。

| 文件              | 待部署 SHA-256                                                   | 当前实际下载备份 SHA-256                                         |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| index.js          | 7c70deb704614890beec70dc237337a23df17d30c5b11bd88636732d4cf46a26 | c811c0486a92f4d84637bedb0d0e57bf5588949a37e6e773014ec2d2e3c0afdb |
| package.json      | 2190849cc579a76b4e7e4862b648d0eda6f3d6392e1e58dac7374737d1cc7ca7 | 567007d1ab307bf03c2f65d70218e1501b45d5de538348038449d693b4ad0f5e |
| package-lock.json | 13e30eb99216195aa091a3c227a67912c2b617108eb3792b24707e1abd2481bc | 0477265c9bf4532104743deb3582f59ccbf323988e5355e2fd584d4d026629c4 |

本地 test-results/2026-10-23-week2-completion/moodsky-health-candidate/moodsky 为固定候选，moodsky-live-backup 为本轮新下载的实际备份，moodsky-health-scope.json 保存范围。用户已同意此固定范围，部署前重新下载三文件均与旧版备份一致；工具确认任务 confirmation_cloud_fn_deploy_b2ed76c3-dd96-4bf0-8641-cb7bfcbd4526 经用户点击后返回 success。部署后再次下载，三文件全部与上表待部署 SHA 一致。

## 实际验证完成

直接微信调用的 system.health 已成功返回 apiVersion:1、version:0.2.3、stage:foundation，平台请求号 48c47257-0206-4f06-b9b3-f0088099ac1b。10 月 24 日继续使用独立只读测试项目的原有 Me.runHealth → checkHealth(formal) → services/api → 微信云函数链路，实际显示“正式接口校验通过 · apiVersion=1”、healthVersion:0.2.3、healthCode 为空，请求号 req_mvl5txwn_1_urw0o5ov；[结构化结果](health-cloud-20261024.json)。没有注入成功响应。

测试项目的健康模块、API 客户端和 Me 页源码已逐字节对比，与当前源码相同；仅该独立项目本地环境启用云，并从 Me 启动，避免调用私人业务。当前正式源码的本地环境配置仍保持默认；没有上传新的手机包，没有新增手机测试。

取证时自动化页面方法接口出现过期上下文错误，刷新并确认实际页面后，使用受控运行时调用真实 page.runHealth 并读取状态完成验证；不把自动化故障写成产品失败，也不把仅触发刷新写成编译通过。本次健康成功不代表正式私人云业务完成。
