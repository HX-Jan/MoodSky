# MoodSky 第一周 Linghan Chen 协作交接

提供人：Xiang Hong。接收人：Linghan Chen。任务：W1 L01—L05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请复用现有四页、统一请求和 Today 交互，完成公共状态与 Me 流程约定，并登记健康链路和账号缓存的待验证项。

## 我提供的输入

四个页面是 Today、Campus、Universe、Me，使用现有 app.json 页面注册和模块 service。Today 已整合内存表单和重试控制；其余占位页面的可进入状态不能替代业务验收。

| 项目         | 提供的信息                                                       | 如何使用                                                |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------- |
| 团队项目     | HX-Jan/MoodSky；AppID wxf602e991ff44e6c8                         | 导入 MoodSky 仓库根目录；成员使用自己的微信开发者账号。 |
| 测试环境     | mood-sky / mood-sky-d5gqy3spkff37566d                            | 仅用于获批的测试；权限不足时交 Xiang Hong 协调。        |
| 运行时与 SDK | 本地 Node.js 24；已记录云运行时 Nodejs16.13；wx-server-sdk 4.0.2 | 本地版本和云运行时分别记录；按锁文件安装依赖。          |

## 本地使用方法

1. 安装 Node.js 24，在仓库根目录运行 npm ci、npm run setup、npm ci --prefix cloudfunctions/moodsky；用微信开发者工具导入该目录。
2. 需要体验 Today 时，只修改被忽略的 miniprogram/config/environment.local.js 为下面配置并重新编译；先保留自己原配置，不提交个人配置。
3. 公共状态继续走 miniprogram/services/api.js。成功时从 result.data 读取；失败按 AppError.code 显示，不把未实现转成保存成功。

```javascript
module.exports = {
  cloudEnabled: false,
  cloudEnvId: '',
  journalDemo: true,
};
```

该模式只操作合成内存记录，退出页面或重新编译后不保证保留；真实云调用失败不会自动切换到内存演示。

| 状态或流程         | 交给页面的使用约定                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 加载和空结果       | 加载时防止重复操作；journal.get 的拟约定为 data.entry:null，空记录不画成某种天气。                                                       |
| 网络失败与版本冲突 | NETWORK_ERROR 保留原请求和输入；CONFLICT 保留草稿并提示重新读取，放弃草稿须用户确认。                                                    |
| 身份与未实现       | UNAUTHENTICATED、ACCOUNT_DISABLED、NOT_IMPLEMENTED 分别反馈；停用后清空私人页面缓存。                                                    |
| Me 数据管理        | 与 Jiawei 确认偏好/close/cleanupStatus；与 Xiang Yu 确认 requestExport/exportStatus/downloadExport。处理中、失败、过期、完成有独立状态。 |

## 健康链路和缓存边界

system.health 请求为 {apiVersion:"1",requestId:"req_l04_health_001",action:"system.health",payload:{}}。预期 data 为 app: MoodSky、version:0.1.0、stage:foundation；请求与响应的版本和 ID 必须一致。历史报告显示正式云端最近返回 INVALID_REQUEST；本地兼容修正虽在源码中，尚未部署，因此 L04 真实链路仍待验证。

与各页面负责人盘点内存记录、正文草稿、卡片、收藏、任务历史、下载状态及异步回调。约定账号切换、停用、注销时的清空入口；迟到的旧账号响应不能回填当前账号。controller 已提供 onChanged 回调，成功后携带 {date,kind}；当前页面尚未接入该回调，跨页刷新事件名和消费方式需与 Yifan、Zhifeng 共同确认。

## 你需要交回什么

- 四页目录与导航说明；公共状态接入样例；Me 原型及字段问题；真实健康调用的版本和脱敏证据，未执行时标待验证。
- 缓存清单、清空与刷新接口提案、两个合成账号切换结果；任务入口和页面注册变化由 Qizhen Chen 共同复核。

注销确认后只展示实际返回的状态；尚未接入执行程序的按钮不能显示“文件已生成”或“所有数据已清理”。

## 共同回传格式与提交方法

每项交付请带：任务编号、成果路径或 PR、实际使用的提交版本、环境类型、预期和实际、复核意见、实际耗时、后续任务点数、阻塞与下一步。状态采用待开始、进行中、待复核、已验收、阻塞。接收与验收意见由本人实际确认后填写。

成果放 docs/week1/本人目录；修改代码时同步相关 service、校验与测试，检查通过后提交本人分支的 PR。成员 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再同步主分支、整合和发布。共享接口、数据库或导航变更交对应负责人共同复核。

本包仅整理已有资料和本地样例，未发消息、上传 GitHub、部署、修改云资源、执行新云端写入或清理。后续操作仍按已约定范围办理。管理员登录由本人手动完成，管理员密码、微信身份、指纹和凭证不进入公共文档。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [项目导入和本地演示方法](../../../development.md)：`docs/development.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/development.md)。
- [统一请求创建与响应检查](../../../../miniprogram/services/api.js)：`miniprogram/services/api.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/services/api.js)。
- [天气 标签 限制和偏好默认值](../../../../miniprogram/shared/constants.js)：`miniprogram/shared/constants.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/constants.js)。
- [H01 环境与权限登记](../w1-h01.md)：`docs/week1/xiang-hong/w1-h01.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h01.md)。
- [H02 记录接口审查草稿](../w1-h02.md)：`docs/week1/xiang-hong/w1-h02.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h02.md)。
- [H04 回顾接口待审草稿](../w1-h04.md)：`docs/week1/xiang-hong/w1-h04.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h04.md)。
- [Xiang Yu 导出流程设计](../../XiangYu/export-flow-design.md)：`docs/week1/XiangYu/export-flow-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/export-flow-design.md)。
- [Xiang Yu 清理与恢复设计](../../XiangYu/cleanup-recovery-design.md)：`docs/week1/XiangYu/cleanup-recovery-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/cleanup-recovery-design.md)。
- [2026 年 10 月 15 日成果与证据边界](../../../test-reports/2026-10-15/README.md)：`docs/test-reports/2026-10-15/README.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/test-reports/2026-10-15/README.md)。
- [现有公共视觉变量](../../../../miniprogram/styles/tokens.wxss)：`miniprogram/styles/tokens.wxss`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/styles/tokens.wxss)。
