# 资料维护后台

执行职责更新于2026-10-12。界面、登录页及Web可信身份接入：Qizhen Chen；资料业务、运营角色查询与业务授权：Junhan Huang；数据库与权限设计复核：Xiang Yu；身份接入复核：Xiang Hong；权限测试：Qizhen Cai。

首版只维护地点、任务模板、支持资源和纠错审核。界面建议采用HTML、CSS、JavaScript和CloudBase Web SDK，第一周先验证后台登录→可信云端身份→运营角色校验→资料接口调用，再确定SDK版本和部署方式。学生端仍采用原生微信小程序。

当前目录包含第一周可评审的后台低保真原型和 Web 身份接入适配层：`index.html` 是地点、任务模板、支持资源和纠错审核四个表单的可点击演示；`auth.js` 封装 CloudBase Web SDK OAuth 会话、回调验证、退出清理及无身份字段的云函数调用。没有配置环境时页面明确运行在“本地演示”模式，合成运营账号不能作为真实云端验收证据。

真实验证前复制 `config.example.js` 为未入库的 `config.js`，填写环境 ID、回调地址、已批准且固定版本的 SDK 浏览器 bundle URL 和版本号；`load-sdk.js` 会先加载该 SDK，再加载认证适配层。当前目标登录方式为 CloudBase Web SDK 的微信 OAuth（`provider: wechat`，`detectSessionInUrl: true`）；仓库不锁定 SDK 的具体补丁版本，需由 Xiang Hong 在测试环境确认后填写。回调域名必须先加入 CloudBase Web 安全域名，不能把 access key 或回调配置提交到仓库。详细操作见 [`REAL-CLOUDBASE-SETUP.md`](REAL-CLOUDBASE-SETUP.md)。

服务端仍只接受可信调用上下文，并通过内部账号和 `operator_roles` 查询角色。浏览器表单不会发送 `uid`、`OPENID`、`ownerId` 或 `role`；普通学生、停用账号和伪造 payload 均应由服务端拒绝。当前 `cloudfunctions/moodsky/domains/admin.js` 仍是业务占位，原型提交成功只表示调用边界和字段已演示，不表示资料已写入云端。

资料业务接口位于cloudfunctions/moodsky/domains/admin.js。实现前补齐读取、编辑、审核、分页、错误与并发约定，不以直接数据库访问绕过授权。运营员不得读取私人天气、正文、微信身份映射或导出文件。

本地预览可直接打开 `index.html`；默认合成登录会演示授权运营员和四类表单，不会发出网络请求。第1周真实 Web 登录、服务端 Web 身份到内部账号的映射、角色查询及业务写入仍需环境负责人和权限复核后执行；第4周再完成主要界面和后台资料服务，第5周完成学生端资料联调。详见[模块分工](../docs/team.md)。
