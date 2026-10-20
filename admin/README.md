# 资料维护后台

## 2026-10-17 整合范围

本预览交付四类表单、合成账号切换和 Web SDK **候选适配层**。真实 SDK 精确版本、方法签名、OAuth 回调及云函数响应包装尚未实测。当前代码假设 `callFunction` 返回 `{ result: { apiVersion, requestId, ok, data/error } }`，本地替身测试不能证明真实 SDK 与该约定相容。

真实配置下所有资料提交按钮保持禁用；浏览器会话中的 `role` 不能开启提交。现阶段仅显式本地演示可模拟成功，界面会注明没有保存到云端。失败或未知结果保留表单输入，失败退出不声称 SDK 会话已清除。`config.js` 已被 Git 忽略，不提交个人配置。

后续验证须先确定固定 SDK 版本、核对 API 和返回结构，再完成可信 Web 身份映射、服务端运营授权与业务实现。本 PR 没有执行真实登录、云调用或部署，也不代表 QC01 的真实身份链路验收完成。整合检查见[复核记录](../docs/test-reports/2026-10-17-pr-followup/README.md)。

执行职责更新于2026-10-12。界面、登录页及Web可信身份接入：Qizhen Chen；资料业务、运营角色查询与业务授权：Junhan Huang；数据库与权限设计复核：Xiang Yu；身份接入复核：Xiang Hong；权限测试：Qizhen Cai。

首版只维护地点、任务模板、支持资源和纠错审核。界面建议采用HTML、CSS、JavaScript和CloudBase Web SDK，第一周先验证后台登录→可信云端身份→运营角色校验→资料接口调用，再确定SDK版本和部署方式。学生端仍采用原生微信小程序。

当前目录包含第一周可评审的后台低保真原型和 Web 身份接入候选适配层：`index.html` 是地点、任务模板、支持资源和纠错审核四个表单的可点击演示；`auth.js` 提供 OAuth 会话、回调、退出和无身份字段调用的候选约定。没有配置环境时页面明确运行在“本地演示”模式，合成运营账号不能作为真实云端验收证据。

真实验证前复制 `config.example.js` 为未入库的 `config.js`，填写环境 ID、回调地址、已批准且固定版本的 SDK 浏览器 bundle URL 和版本号；`load-sdk.js` 会先加载该 SDK，再加载认证适配层。当前目标登录方式为 CloudBase Web SDK 的微信 OAuth（`provider: wechat`，`detectSessionInUrl: true`）；仓库不锁定 SDK 的具体补丁版本，需由 Xiang Hong 在测试环境确认后填写。回调域名必须先加入 CloudBase Web 安全域名，不能把 access key 或回调配置提交到仓库。详细操作见 [`REAL-CLOUDBASE-SETUP.md`](REAL-CLOUDBASE-SETUP.md)。

服务端仍只接受可信调用上下文，并通过内部账号和 `operator_roles` 查询角色。浏览器表单不会发送 `uid`、`OPENID`、`ownerId` 或 `role`；普通学生、停用账号和伪造 payload 均应由服务端拒绝。当前 `cloudfunctions/moodsky/domains/admin.js` 仍是业务占位，原型提交成功只表示调用边界和字段已演示，不表示资料已写入云端。

资料业务接口位于cloudfunctions/moodsky/domains/admin.js。实现前补齐读取、编辑、审核、分页、错误与并发约定，不以直接数据库访问绕过授权。运营员不得读取私人天气、正文、微信身份映射或导出文件。

本地预览可直接打开 `index.html`；默认合成登录会演示授权运营员和四类表单，不会发出网络请求。第1周真实 Web 登录、服务端 Web 身份到内部账号的映射、角色查询及业务写入仍需环境负责人和权限复核后执行；第4周再完成主要界面和后台资料服务，第5周完成学生端资料联调。详见[模块分工](../docs/team.md)。
