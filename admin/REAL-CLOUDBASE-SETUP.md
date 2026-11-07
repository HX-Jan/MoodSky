# CloudBase Web 登录验证

代码固定使用 `@cloudbase/js-sdk` 3.4.8。OAuth 登录调用 `signInWithOAuth({ provider: 'wechat' })`，由 SDK 生成并在浏览器会话中保存 state；初始化将 `detectSessionInUrl` 关闭，回到后台后由页面检查回调参数并手动调用 `verifyOAuth()`。没有登录会话时，`getSession()` 返回空结果并保持未登录。SDK 真实包的类型声明和官方 Web v3 文档确认了这些方法及 `{ data, error }`、`data.user`、`data.session` 结构；这只是本地接口核对，尚未连接项目 CloudBase 环境。

## 本地准备

在仓库根目录安装 SDK 并生成页面使用的浏览器 bundle：

```bash
npm ci --prefix admin --ignore-scripts
npm run build --prefix admin
```

bundle 输出到 `admin/vendor/cloudbase-3.4.8.js`，该文件由 Git 忽略。复制 `admin/config.example.js` 为 `admin/config.js`，填写：

- `envId` 和 `region`：CloudBase 测试环境信息。
- `loginMethod`：默认 `'oauth'` 保留微信授权；使用已配置的应用用户名密码时设为 `'password'`。
- OAuth 方式填写 `provider: 'wechat'` 和 `redirectTo`（已部署且加入允许域名的后台回调地址）；密码方式不需要微信网站应用 AppSecret 或 OAuth 回调。
- `publishableKey`：如果当前环境要求则填写平台生成的 Publishable Key；不得填写 Secret Key。
- `sdkUrl: 'vendor/cloudbase-3.4.8.js'` 与 `sdkVersion: '3.4.8'`。

使用 HTTP(S) 服务访问 `admin/index.html`，不能通过 `file://` 测试 OAuth。由环境所有者在 CloudBase 配置身份源、回调和允许域名，并在浏览器完成微信登录。退出时页面调用 SDK `signOut()`；页面不自行存储令牌。

## 真实环境验收仍未完成

2026-10-29已重新核实团队环境ID为`mood-sky-d5gqy3spkff37566d`，关联AppID为`wxf602e991ff44e6c8`；当前微信开发者工具登录能列出环境和三个函数，并读取其状态。见[访问入口核对](../docs/deployment/environment-access-20261029.md)。独立腾讯云账号授权与Web身份接入仍需分别核验；示例`ap-shanghai`须按目标环境实际地域核对。

团队环境ID已有来源；Web后台仍缺已核实的回调域名、身份源和对应账号授权，因此本次没有执行真实 OAuth、令牌过期/撤销、业务云函数调用或部署。SDK 会话恢复不代表运营授权。#72 已提供依赖可信 OPENID 的内部账号/角色与地点候选；仍需将可信 Web 身份映射到内部账号，并在平台核验后使用 `admin/places.html` 完成真实地点链路。默认 `placeMaintenanceEnabled:false`，旧四表单的真实提交继续关闭；普通用户、停用运营员和伪造浏览器角色必须由服务端拒绝，之后由 Qizhen Cai 独立复核。

完整验证记录应注明 SDK 3.4.8、环境、浏览器、身份源、回调路径、成功/失败结果和复核人。不要在报告中粘贴令牌、私人用户资料或真实账号身份。

第三周新增地点维护页默认关闭。只有目标环境已核实 Web 凭证、内部映射、服务端角色和候选组装后，才在本地 `config.js` 设置 `placeMaintenanceEnabled:true`。使用 HTTP(S) 访问 `admin/places.html`；开关不授予运营权限，也不改变服务端生产入口。真实 Web UID 不能由浏览器伪装为云上下文 OPENID。先验证普通用户、停用运营、无效/过期凭证及伪造 role/owner 均拒绝，再记录成功的保存与重读。

第四周新增 `catalogue.html` 与 `catalogueMaintenanceEnabled:false`，提供已具备服务的模板/资源读取和纠错审核；真实身份条件与地点页相同。执行 `node tools/week4-qc/web-readiness.cjs` 只检查本地配置形状和固定包/bundle，不输出配置值或令牌；退出码2表示准备未齐，0仍不是平台验收。编译期接口核对：`npx tsc --noEmit --strict --skipLibCheck --esModuleInterop --lib es2020,dom tools/week4-qc/sdk-contract.ts`。该命令不运行SDK、不联网登录。真实Web缺口和后续步骤见[第四周交付](../docs/week4/qizhen-chen/README.md)。

## 可选的应用用户名密码登录

在环境已开启应用用户名密码登录时，可使用 `loginMethod: 'password'`，通过 `places.html` / `catalogue.html` 的“账号登录”进入 `login.html`。这条路径是替代登录方式，不是微信 OAuth 已完成的证据；默认仍为 OAuth，两个资料维护开关仍保持关闭。

- 环境负责人准备专用的 CloudBase **应用测试用户**；不共享腾讯云主账号，不重用内置管理员作为日常测试运营。页面不提供开放注册、创建用户或重置密码。
- 固定 SDK 3.4.8 使用 `auth.signInWithPassword({ username, password })`，随后用 `getSession()` 再读并核对同一身份；SDK 失败或读回不一致不跳转，不把浏览器角色当授权。
- 生产使用 HTTPS，并按环境要求配置允许域名和可公开 Key；本机 HTTP 仅允许 localhost / loopback 预览，不能通过 file:// 或远程 HTTP 输入密码。密码不是本地 config 字段，不能放入 URL、仓库、截图或日志；页面提交、隐藏或离开后清空输入，仅 SDK 管理会话。
- 回跳目标仅允许同目录 index.html、places.html、catalogue.html；已有会话先退出并获 SDK 确认后才能切换账号。认证策略要求验证码/额外验证时明确停止，不能通过关闭平台保护绕过。
- 后端仍须验证可信 Web 主体、内部 active 账号与运营角色，并组装目标测试环境的后台服务。身份选择从微信改为用户名密码不会自动补齐映射、授权或维护服务。

准备就绪后，由账号本人在页面输入凭证，不发到聊天。真实登录、普通/停用账号拒绝、会话到期、退出与每页业务读写须分别验证；未执行前不标真实 Web 完成。官方接口依据：[Web v3 认证](https://docs.cloudbase.net/api-reference/webv3/authentication)。

## 独立服务端候选补充

11月7日补充[独立后台候选](WEB-ADMIN-CANDIDATE.md)，可本地打包后交接口/权限评审。它不改原函数入口、不自动部署或授予角色；浏览器新增允许列表 `functionName`，默认仍为 `moodsky`。候选即使配置成功也默认只读，真实映射、平台校验和读写仍需逐项验证。上文日期化的平台状态及验证说明保留原时点，本补充没有发布新的私有环境发现。
