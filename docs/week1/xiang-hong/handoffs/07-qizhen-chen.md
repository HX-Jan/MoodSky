# MoodSky 第一周 Qizhen Chen 协作交接

提供人：Xiang Hong。接收人：Qizhen Chen。任务：W1 QC01—QC05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请优先核验 Web 登录能力和服务端可信身份来源；任务前端与后台表单可用合成数据并行推进。

## 我提供的环境与现有门禁

| 项目         | 提供的信息                                                       | 如何使用                                                |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------- |
| 团队项目     | HX-Jan/MoodSky；AppID wxf602e991ff44e6c8                         | 导入 MoodSky 仓库根目录；成员使用自己的微信开发者账号。 |
| 测试环境     | mood-sky / mood-sky-d5gqy3spkff37566d                            | 仅用于获批的测试；权限不足时交 Xiang Hong 协调。        |
| 运行时与 SDK | 本地 Node.js 24；已记录云运行时 Nodejs16.13；wx-server-sdk 4.0.2 | 本地版本和云运行时分别记录；按锁文件安装依赖。          |

现有路由只从 trustedContext.OPENID 进入内部账号解析，尚未接入 Web 身份。CloudBase Web 登录方式、Web SDK 版本、站点授权配置及可信标识仍需验证，本交接不预设某种登录方式已经可用。

| 信息       | 当前边界                                        | 你如何使用                                                                          |
| ---------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| 微信云入口 | index.js 从平台上下文取可信身份                 | 与 Web 调用进行区分，不能把浏览器提交的 OPENID、uid、role 直接传为 trustedContext。 |
| 内部账号   | resolveAccount 返回内部 id/status，停用先拒绝   | 与 Jiawei 明确 Web 身份到内部账号的受信映射，合成 ID 不能直接充当真实登录凭证。     |
| 运营角色   | resolveOperatorRoles 从服务端返回 data_operator | 与 Junhan 验证授权和撤销/停用；菜单隐藏不作为服务端授权证据。                       |
| 后台范围   | 四项 admin 资料维护 action 已注册               | 地点、模板、资源、纠错；读取列表/待审队列缺口先评审，不增加私人日记查询功能。       |

## 验证和开发顺序

1. 先确认环境对 Web 登录的实际支持，登记 SDK、登录方式、域名配置需求、平台可信上下文字段名称和到内部账号的映射位置；不在日志或文档保存字段值、token 或登录凭证。
2. 提供最小登录演示与身份流向图，分别记录授权、未授权和停用结果。客户端伪造身份或角色的请求也应交服务端拒绝验证。真实环境未通时，本地替身结果另列。
3. 累计排查 4 小时仍未跑通时，交具体错误、已经尝试的路径和备选接入方案给 Xiang Hong；把继续验证拆成团队任务，同时继续低保真表单和任务流程。
4. 与 Jiawei 确认最多 3 个建议、选择/完成/替换/跳过/历史；与 Linghan 确认页面注册和入口，与 Jiaqi 复核布局。

## 后台表单输入及读取缺口

请给 Junhan 四张低保真表单：地点编辑、任务模板、支持资源、纠错审核。每张列输入、校验、保存中/成功/失败、角色与读取队列。字段仍以双方接口草稿为准。退出后台后清除浏览器登录显示及相关私人状态；直接调用接口仍要求服务端授权。

## 你需要交回什么

- QC01 身份流向、SDK/版本、可信来源核验、授权和拒绝证据及未解决项，交 Xiang Hong、Jiawei、Junhan、Qizhen Cai。
- QC02 任务可点击演示；QC03 四项表单与接口读取缺口；QC04 三类角色的实际联调记录；QC05 后续任务和部署需求交 Yuen。

完成判断：可信身份来源与角色查询可解释、拒绝路径有证据；没有真实身份验证结果时，不把页面登录动画登记为授权通过。

## 共同回传格式与提交方法

每项交付请带：任务编号、成果路径或 PR、实际使用的提交版本、环境类型、预期和实际、复核意见、实际耗时、后续任务点数、阻塞与下一步。状态采用待开始、进行中、待复核、已验收、阻塞。接收与验收意见由本人实际确认后填写。

成果放 docs/week1/本人目录；修改代码时同步相关 service、校验与测试，检查通过后提交本人分支的 PR。成员 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再同步主分支、整合和发布。共享接口、数据库或导航变更交对应负责人共同复核。

本包仅整理已有资料和本地样例，未发消息、上传 GitHub、部署、修改云资源、执行新云端写入或清理。后续操作仍按已约定范围办理。管理员登录由本人手动完成，管理员密码、微信身份、指纹和凭证不进入公共文档。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [H01 环境与权限登记](../w1-h01.md)：`docs/week1/xiang-hong/w1-h01.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h01.md)。
- [接口信封与职责分工](../../../api.md)：`docs/api.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/api.md)。
- [唯一 action 和错误码注册表](../../../../miniprogram/shared/contracts.js)：`miniprogram/shared/contracts.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/contracts.js)。
- [微信云函数可信上下文入口](../../../../cloudfunctions/moodsky/index.js)：`cloudfunctions/moodsky/index.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/cloudfunctions/moodsky/index.js)。
- [可信身份门禁与三个适配器](../../../../cloudfunctions/moodsky/router.js)：`cloudfunctions/moodsky/router.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/cloudfunctions/moodsky/router.js)。
- [项目导入和本地演示方法](../../../development.md)：`docs/development.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/development.md)。
- [Xiang Yu 数据字典](../../XiangYu/data-dictionary.md)：`docs/week1/XiangYu/data-dictionary.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/data-dictionary.md)。
- [2026 年 10 月 15 日成果与证据边界](../../../test-reports/2026-10-15/README.md)：`docs/test-reports/2026-10-15/README.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/test-reports/2026-10-15/README.md)。
