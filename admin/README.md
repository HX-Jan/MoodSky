# 资料维护后台

`index.html` 保留地点、任务模板、支持资源、纠错审核四类合成表单，真实提交关闭。`places.html` 是第三周新增的地点维护候选，复用 #72 已整合的 `admin.listPlaces/getPlace/updatePlace`，支持列表、详情、编辑、版本冲突与保存后重读。其余三类已有候选读取处理器，写入仍返回 NOT_IMPLEMENTED。

Web SDK 精确固定 `@cloudbase/js-sdk@3.4.8`。在仓库根目录执行 `npm ci --prefix admin --ignore-scripts` 和 `npm run build --prefix admin`，生成 Git 忽略的 `admin/vendor/cloudbase-3.4.8.js`。复制 `config.example.js` 为 Git 忽略的 `config.js`，按 [真实环境准备](REAL-CLOUDBASE-SETUP.md) 配置环境、允许域名及 OAuth。不要填写 Secret Key 或提交真实身份、令牌。

新地点页默认不调用业务服务。只有本地配置 `placeMaintenanceEnabled:true` 且 SDK 会话已确认才进入候选；该配置不能授予角色，业务服务每次仍验证内部 active 账号和 `operator_roles`。当前缺真实 Web 身份源、凭证校验/内部映射、测试账号和独立复核；默认生产入口也没有组装地点服务，不能把候选视为已上线。

OAuth 回调手动验证，SDK 管理令牌；页面监听会话事件并在资料操作前复核，浏览器 role/owner 不授权。保存需服务端明确确认及第二次读取一致才显示成功。失败保留草稿；不确定的写结果阻止继续写，仅允许重读核对和明确放弃草稿后重新读取。登录失效/停用/切号会清除旧资料。后台不直接访问数据库或学生私人集合。

职责：Qizhen Chen 负责界面和 Web 身份接入，Junhan Huang 负责后台服务与运营角色；Jiawei、Xiang Hong、Xiang Yu 和 Qizhen Cai 配合身份/权限复核。见[第三周交付与验证](../docs/week3/qizhen-chen/README.md)；[第二周原交接](../docs/week2/qizhen-chen/README.md)保留为历史记录。
