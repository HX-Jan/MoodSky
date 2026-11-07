# 独立 Web 后台云函数候选

本候选只供接口与权限评审。新入口位于 `cloudfunctions/moodsky/web-admin/index.js`，函数名约定为 `moodsky-web-admin`；原 `moodsky`、正式入口、微信客户端和其余业务域不导入它。默认不加载云 SDK、不访问数据库，也不新增账号、角色或集合。源码和本地打包不代表云端部署。

## 可信身份与服务范围

浏览器继续发送严格 v1 信封 `{apiVersion,requestId,action,payload}`。固定 Web SDK 自动处理认证；业务请求不得传 UID、OpenID、账号或角色。服务端丢弃传输附加的 `userInfo/tcbContext`，只解析本次平台 `context.environment` JSON，或旧 `context.environ` 字符串；不从 `process.env` 补调用身份，避免复用实例遗留身份。

候选要求 `TCB_SOURCE=web_client`、非空 `TCB_UUID`、`TCB_ISANONYMOUS_USER=false`，且本次提供的 `TCB_ENV/SCF_NAMESPACE/context.namespace` 至少有一个并全部等于目标环境。缺失、歧义、匿名或跨环境均拒绝。以上字段形状依据锁定服务端 SDK 的上下文解析实现，**仍须在目标运行时验证**；字段不符时保持拒绝，不能用 payload 或进程残留身份替代。

服务端配置将可信 Web UID 绑定到一个既有内部 `accounts._id`，不是将 UID 冒充微信 OpenID。每次请求先按内部文档 ID 查询账号并验证 `status=active`，再查询既有 `operator_roles` 的启用 `data_operator` 角色。无绑定、无账号、停用或无角色均拒绝；不会由登录自动创建账号或授予权限。账号和角色预检与后续资料写入不是同一事务，尚不能承诺并发撤权与写入的原子性；写入开关保持关闭，待复核后再决定开放。

入口仅允许五项读取 `admin.listPlaces/getPlace/listCorrections/listTaskTemplates/listSupportResources`，以及四项已有写动作的候选路径。私人日记、任务、账号和校园用户动作均拒绝。地点更新与纠错审核复用既有校验、版本冲突、写入和读回；模板/资源写入仍为 `NOT_IMPLEMENTED`。纠错审核不自动改地点。

## 本地打包和评审

```sh
npm run cloud:prepare
node scripts/package-web-admin.js /absolute/new/directory/outside-checkout
```

输出仅有 `moodsky-web-admin/index.js`、锁定的依赖清单/锁文件及包外 `manifest.json`。bundle 外置 `wx-server-sdk`，部署运行时仍需按锁文件安装依赖。manifest 记录源码 HEAD、工作树是否有未提交内容、文件 SHA-256、未部署标记和默认关闭开关；可交审包应来自提交后的干净工作树。构建器不调用云接口，不读取个人前端配置或平台凭证。

## 获得云端变更授权后的配置

本节是操作方案，未执行。部署、真实资料写入、身份绑定与角色变更须按仓库 `AGENTS.md` 的授权范围分别确认。先检查新函数名无冲突、目标环境/地域/运行时、函数访问规则和新增资源费用，再部署独立函数；不得覆盖现有函数、增加公开 HTTP 入口或放开数据库客户端权限。

| 服务端变量                              | 含义与默认值                                                           |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `MOODSKY_WEB_ADMIN_ENABLED`             | 必须为字符串 `true`，否则业务入口关闭                                  |
| `MOODSKY_WEB_ADMIN_ENV`                 | 必须精确等于 `production/config.js` 中已登记的团队环境                 |
| `MOODSKY_WEB_ADMIN_BINDINGS`            | 1–20条严格 `{uid,accountId}` JSON 数组，两列各自唯一；缺失或无效则关闭 |
| `MOODSKY_WEB_ADMIN_WRITES_ENABLED`      | 只有字符串 `true` 才开放已实现写动作；默认只读                         |
| `MOODSKY_WEB_ADMIN_CONTEXT_DIAGNOSTICS` | 只有字符串 `true` 才在健康响应添加上下文字段分类；默认关闭             |

绑定形状示例仅为合成占位：`[{"uid":"synthetic_web_uid","accountId":"synthetic_internal_account"}]`。实际绑定只放受控的服务端环境配置，不进入浏览器 `config.js`、聊天、PR、截图或日志。内部账号必须已有明确归属和正常生命周期；本候选不创建“万能运营账号”。删除绑定、停用账号、撤销服务端角色或关闭入口均在后续请求生效；绑定配置的备份、撤回及账号停用后的清理归环境负责人管理，不宣称 SDK 令牌已撤销。

首次验证保持写入关闭和前端两个维护开关关闭：先验证 `system.health`（空 payload，只返回 stage/configured/readOnly），再确认本次可信上下文、绑定账号及最小角色；经授权只读检查正常、普通、停用、未绑定、过期/无效凭证及伪造身份拒绝。平台凭证拒绝由平台负责，本地合成测试不能证明其已生效。

只有前述条件及独立复核通过后，才在被 Git 忽略的 `admin/config.js` 选择 `functionName:'moodsky-web-admin'`，按需开放已核准的页面。`functionName` 仅允许原 `moodsky` 或此独立候选，默认仍为原函数。前端维护开关不授予权限，也不能覆盖服务端只读开关。真实保存/读回需另外明确授权和测试资料范围，不能在真实地点上试写。

## 可选的上下文形状诊断

为复核目标运行时字段形状，服务端可临时启用 `MOODSKY_WEB_ADMIN_CONTEXT_DIAGNOSTICS=true`，通过空 payload 的 `system.health` 获取固定分类。它不要求开放业务或设置身份绑定，不加载云 SDK、不查询账号、角色或业务数据；浏览器 payload 无法开启此开关。

返回的 `contextDiagnostics` 仅含：封装类型 `envelope`（json/legacy/unavailable）、UID 格式 `uid`（missing/valid_format/invalid_format）、来源 `source`（missing/web_client/wx_client/wx_devtools/other）、匿名标记的类型和值分类 `anonymousMarker`、目标环境比较 `environment`（missing/match/mismatch）及严格身份解析是否通过的 `accepted` 布尔值。没有原始 UID、环境名、任意来源字符串、令牌、绑定或角色信息；分类不持久化、不新增日志。`accepted` 只表示上下文解析符合候选要求，不代表绑定、角色、平台凭证或业务验收通过。

诊断仍属于按授权范围执行的临时运行时检查。先准备干净提交与包，再取得独立函数更新及临时开关授权；业务、写入和绑定保持关闭。仅调用健康检查，完成后关闭诊断并复核配置。分类结果只供授权操作人本机排错，不将真实会话或平台访问发现上传仓库。诊断不会放宽原身份校验，也没有进程身份回退。

## 验证与剩余事项

`tests/web-admin-entry.test.js` 覆盖服务端默认关闭、当前调用身份、跨环境/匿名/未绑定/停用/无角色拒绝、逐次账号角色读取、默认只读、合成写后读回，以及浏览器 SDK 传输到真实入口/handler 的链路。`tests/web-admin-package.test.js` 验证实际 bundle、散列及未配置时不加载云 SDK。这些都是本地合成检查，没有部署、绑定身份、授予权限或真实业务写入。

原微信网站 OAuth、运行时可信上下文、真实内部映射/运营角色、平台声明、业务读写及独立验收均不能由本候选代签。目标环境访问与登录检查的私有记录保留在仓库外，本页不发布真实账号、平台配置或访问发现。

参考：[CloudBase 普通云函数调用](https://docs.cloudbase.net/cloud-function/how-use)、[固定 Web SDK 认证文档](https://docs.cloudbase.net/api-reference/webv3/authentication)；版本与接口仍以本仓库锁文件和实际运行时验证为准。
