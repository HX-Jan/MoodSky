# CloudBase Web 登录验证

代码固定使用 `@cloudbase/js-sdk` 3.4.8。OAuth 登录调用 `signInWithOAuth({ provider: 'wechat' })`，由 SDK 生成并在浏览器会话中保存 state；初始化将 `detectSessionInUrl` 关闭，回到后台后由页面检查回调参数并手动调用 `verifyOAuth()`。没有登录会话时，`getSession()` 返回空结果并保持未登录。SDK 真实包的类型声明和官方 Web v3 文档确认了这些方法及 `{ data, error }`、`data.user`、`data.session` 结构；这只是本地接口核对，尚未连接项目 CloudBase 环境。

## 本地准备

在仓库根目录安装 SDK 并生成页面使用的浏览器 bundle：

```bash
npm install --prefix admin
npm run build --prefix admin
```

bundle 输出到 `admin/vendor/cloudbase-3.4.8.js`，该文件由 Git 忽略。复制 `admin/config.example.js` 为 `admin/config.js`，填写：

- `envId` 和 `region`：CloudBase 测试环境信息。
- `provider: 'wechat'`。
- `redirectTo`：部署并加入 CloudBase Web 安全域名的后台回调地址。
- `publishableKey`：如果当前环境要求则填写平台生成的 Publishable Key；不得填写 Secret Key。
- `sdkUrl: 'vendor/cloudbase-3.4.8.js'` 与 `sdkVersion: '3.4.8'`。

使用 HTTP(S) 服务访问 `admin/index.html`，不能通过 `file://` 测试 OAuth。由环境所有者在 CloudBase 配置身份源、回调和允许域名，并在浏览器完成微信登录。退出时页面调用 SDK `signOut()`；页面不自行存储令牌。

## 真实环境验收仍未完成

该仓库没有提供环境 ID、回调域名或已开通的身份源，因此本次没有执行真实 OAuth、令牌过期/撤销、云函数调用或部署。SDK 会话恢复仅显示身份已登录，所有后台写入按钮继续关闭。仍需 Junhan Huang 将服务端 Web 身份映射到内部账号并从 `operator_roles` 校验 active 角色，再接通 JH03 地点读取、编辑、保存和重读链路；普通用户、停用运营员和伪造浏览器角色必须由服务端拒绝，之后由 Qizhen Cai 独立复核。

完整验证记录应注明 SDK 3.4.8、环境、浏览器、身份源、回调路径、成功/失败结果和复核人。不要在报告中粘贴令牌、私人用户资料或真实账号身份。
