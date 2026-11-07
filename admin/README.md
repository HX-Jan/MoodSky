# 资料维护后台

`index.html` 保留地点、任务模板、支持资源、纠错审核四类合成表单，真实提交关闭。`places.html` 是第三周新增的地点维护候选，复用 #72 已整合的 `admin.listPlaces/getPlace/updatePlace`，支持列表、详情、编辑、版本冲突与保存后重读。任务模板和支持资源写入仍返回 NOT_IMPLEMENTED；新增 `catalogue.html` 接入任务模板/支持资源只读列表与既有纠错审核候选；明确确认后提交审核，再读回一致才提示成功，审核不会自动修改地点。

Web SDK 精确固定 `@cloudbase/js-sdk@3.4.8`。在仓库根目录执行 `npm ci --prefix admin --ignore-scripts` 和 `npm run build --prefix admin`，生成 Git 忽略的 `admin/vendor/cloudbase-3.4.8.js`。复制 `config.example.js` 为 Git 忽略的 `config.js`，按 [真实环境准备](REAL-CLOUDBASE-SETUP.md) 配置环境、允许域名及 OAuth。不要填写 Secret Key 或提交真实身份、令牌。

新地点页默认不调用业务服务。只有本地配置 `placeMaintenanceEnabled:true`（地点）或 `catalogueMaintenanceEnabled:true`（资料/审核） 且 SDK 会话已确认才进入候选；该配置不能授予角色，业务服务每次仍验证内部 active 账号和 `operator_roles`。当前缺真实 Web 身份源、凭证校验/内部映射、测试账号和独立复核；默认生产入口也没有组装地点服务，不能把候选视为已上线。

OAuth 回调手动验证，SDK 管理令牌；页面监听会话事件并在资料操作前复核，浏览器 role/owner 不授权。保存需服务端明确确认及第二次读取一致才显示成功。失败保留草稿；不确定的写结果阻止继续写，仅允许重读核对和明确放弃草稿后重新读取。登录失效/停用/切号会清除旧资料。后台不直接访问数据库或学生私人集合。

职责：Qizhen Chen 负责界面和 Web 身份接入，Junhan Huang 负责后台服务与运营角色；Jiawei、Xiang Hong、Xiang Yu 和 Qizhen Cai 配合身份/权限复核。见[第三周交付与验证](../docs/week3/qizhen-chen/README.md)；[第二周原交接](../docs/week2/qizhen-chen/README.md)保留为历史记录。

第四周地点维护补齐 `recommendationReason`、`directions`、`entryRestrictions`（各最多200码点，可清为null）。其候选资料与生产固定五地点清单分别维护；保存不会自动改写共享清单或部署。两个维护开关默认关闭。未知保存/审核结果保留草稿并阻止重复写，只允许重新读取核对；刷新/离开页面有草稿提醒，但浏览器草稿不写本机持久存储。见[第四周交付](../docs/week4/qizhen-chen/README.md)。

可选应用账号登录：本地配置 `loginMethod: 'password'` 后，地点/资料页跳到 `login.html`；输入 CloudBase 应用测试用户而非腾讯云主账号。密码仅交给固定 SDK，页面提交/隐藏后清空输入；回读同一会话后才能返回后台。OAuth 仍为默认；两种认证均不授予运营角色。见[准备说明](REAL-CLOUDBASE-SETUP.md#可选的应用用户名密码登录)。
