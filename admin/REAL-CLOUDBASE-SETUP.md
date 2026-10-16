# 真实 CloudBase 登录操作

> **未来验证清单，尚未执行。** 2026-10-17 整合版本未选定或验证真实 Web SDK 精确版本；下列控制台名称、OAuth 方法及回调流程均需按选定版本的官方资料重新核对，不能直接作为已验证的操作指引。代码使用的 `verifyOAuth()`、`getSession()` 及 `{ result: API响应 }` 包装是候选约定。真实登录验证须另行授权；本次整合仅做无网络的替身测试。即使恢复 Web 会话，真实资料提交也保持关闭，直到可信身份映射、运营授权与业务接口完成。

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

未来获准验证时，浏览器打开 <http://localhost:4173/admin/index.html>，点击“登录后台”，由账号持有人完成授权。目标是回调后恢复会话；是否成功须以所选 SDK 的实际结果登记，不能以顶部 `CloudBase Web SDK` 标识作为证明。该标识仅表示配置了环境和 SDK 对象。

验证三个动作：

1. 登录后刷新页面，页面仍能恢复会话，说明 `verifyOAuth()`/`getSession()` 链路正常。
2. 点击退出，页面回到登录状态；再次提交表单应被拒绝。
3. 检查浏览器开发者工具的云函数请求，业务 payload 不应出现 `uid`、`OPENID`、`ownerId`、`role` 或 token。

## 4. 真实登录成功后的下一步

真实登录尚未验证。将来确认登录成功，也只证明该次 OAuth 和回调可用；管理员资料真正写入还需要服务端完成以下工作：

- 将 Web 用户映射到 MoodSky 内部账号；
- 查询 `operator_roles` 并检查账号为 `active`；
- 实现 `admin.updatePlace`、`admin.updateTaskTemplate`、`admin.updateSupportResource` 和 `admin.reviewCorrection`；
- 部署 `moodsky` 云函数后再验证普通学生、停用账号和授权运营员三类结果。

这些服务端步骤没有在本地凭空标记为成功，避免把“能登录”误写成“后台业务已上线”。
