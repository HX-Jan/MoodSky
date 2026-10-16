# 真实 CloudBase 登录操作

这份步骤只做测试环境登录验证。不要把腾讯云密码、微信验证码、Access Key 或 Secret Key 发给任何人，也不要写入 `admin/config.js`。

## 1. 准备测试环境

1. 在浏览器打开 [CloudBase 控制台](https://console.cloud.tencent.com/tcb)，用项目负责人的腾讯云账号登录；如果出现短信、微信扫码或二次验证，请由账号持有人在浏览器中完成。
2. 进入或新建一个测试环境，记录“环境 ID”和地域。上海环境填写 `ap-shanghai`，其他地域按控制台显示值填写。
3. 在 CloudBase 控制台的身份认证/Web 登录设置中启用 Web OAuth，并选择微信登录。记录控制台要求的回调地址格式。
4. 将后台页面的访问来源加入 Web 安全域名/允许来源。`file://` 不能作为回调来源，必须通过本地 HTTP 服务或已部署的 HTTPS 域名访问。

## 2. 填写本地配置

在仓库根目录执行：

```bash
cp admin/config.example.js admin/config.js
```

然后编辑 `admin/config.js`：

```js
globalThis.MOODSKY_ADMIN_CONFIG = {
  envId: '控制台里的环境 ID',
  region: 'ap-shanghai',
  provider: 'wechat',
  redirectTo: 'http://localhost:4173/admin/index.html',
  sdkUrl: '已批准版本的 @cloudbase/js-sdk 浏览器 bundle 地址',
  sdkVersion: '已批准的精确版本号',
};
```

`sdkUrl` 必须使用团队确认过的固定版本，不能使用 `latest`。当前页面会先加载 `sdkUrl`，再加载 `auth.js` 和 `app.js`。配置了 `envId` 却没有加载 SDK 时，页面会显示“配置错误”，不会伪装成本地演示。

## 3. 启动页面并登录

在仓库根目录启动静态服务：

```bash
python3 -m http.server 4173
```

浏览器打开 <http://localhost:4173/admin/index.html>，点击“登录后台”。接下来由你在腾讯云/微信页面完成账号登录和授权；回调回到后台页面后，顶部应显示 `CloudBase Web SDK`，并恢复登录会话。

验证三个动作：

1. 登录后刷新页面，页面仍能恢复会话，说明 `verifyOAuth()`/`getSession()` 链路正常。
2. 点击退出，页面回到登录状态；再次提交表单应被拒绝。
3. 检查浏览器开发者工具的云函数请求，业务 payload 不应出现 `uid`、`OPENID`、`ownerId`、`role` 或 token。

## 4. 真实登录成功后的下一步

登录成功只证明 Web OAuth 和会话回调可用。管理员资料真正写入还需要服务端完成以下工作：

- 将 Web 用户映射到 MoodSky 内部账号；
- 查询 `operator_roles` 并检查账号为 `active`；
- 实现 `admin.updatePlace`、`admin.updateTaskTemplate`、`admin.updateSupportResource` 和 `admin.reviewCorrection`；
- 部署 `moodsky` 云函数后再验证普通学生、停用账号和授权运营员三类结果。

这些服务端步骤没有在本地凭空标记为成功，避免把“能登录”误写成“后台业务已上线”。
