# 资料维护后台

后台包含地点、任务模板、支持资源和纠错审核四类表单。Web SDK 已固定为 `@cloudbase/js-sdk@3.4.8`，锁文件和构建脚本位于 `admin/`；实际浏览器 bundle 在本地生成到被忽略的 `admin/vendor/`。真实配置下页面手动验证 OAuth 回调和当前会话，回调结果必须含 `user` 与 `session` 才视为已登录。浏览器会话仅证明 Web 身份登录，页面不会读取其中的 `role` 来授权资料操作。

所有真实资料写入仍关闭。`cloudfunctions/moodsky/domains/admin.js` 尚无业务处理器，服务端 Web 身份到 MoodSky 内部账号的映射与 `operator_roles` 检查也未接通。失败和 `NOT_IMPLEMENTED` 保留表单输入；本地合成演示只模拟表单，不产生云端写入。

执行 `npm install --prefix admin` 后运行 `npm run build --prefix admin` 生成本地 SDK bundle。复制 `config.example.js` 为 Git 忽略的 `config.js`，填写已配置环境的 ID、地域、OAuth 回调地址和可选 Publishable Key，再按 [`REAL-CLOUDBASE-SETUP.md`](REAL-CLOUDBASE-SETUP.md) 执行真实验证。不要填写 Secret Key 或提交真实用户信息。

职责：Qizhen Chen 负责后台界面与 Web 身份接入；Junhan Huang 负责后台业务及运营角色；Xiang Hong、Xiang Yu 和 Qizhen Cai 复核身份、权限和生命周期。第二周交付状态见[Qizhen Chen 交接记录](../docs/week2/qizhen-chen/README.md)。
