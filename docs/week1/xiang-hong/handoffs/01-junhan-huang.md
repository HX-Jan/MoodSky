# MoodSky 第一周 Junhan Huang 协作交接

提供人：Xiang Hong。接收人：Junhan Huang。任务：W1 JH01—JH05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请据此完善校园与后台接口，复核可信运营角色路径，并把本人数据处理清单交给 Xiang Yu 和 Jiawei。

## 我提供的输入

| 项目         | 提供的信息                                                       | 如何使用                                                |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------- |
| 团队项目     | HX-Jan/MoodSky；AppID wxf602e991ff44e6c8                         | 导入 MoodSky 仓库根目录；成员使用自己的微信开发者账号。 |
| 测试环境     | mood-sky / mood-sky-d5gqy3spkff37566d                            | 仅用于获批的测试；权限不足时交 Xiang Hong 协调。        |
| 运行时与 SDK | 本地 Node.js 24；已记录云运行时 Nodejs16.13；wx-server-sdk 4.0.2 | 本地版本和云运行时分别记录；按锁文件安装依赖。          |

提供现有校园和后台 action、请求外层格式、可信身份门禁和数据库设计入口。你的校园字段与后台读取方案仍由你牵头，与对应前端共同确认；本交接不替你签署接口验收。

| 接口范围     | 已有入口                                                                          | 本周要明确                                                           |
| ------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 公开校园资料 | campus.listPlaces / getPlace / supportResources                                   | 校区、开放状态、标签、无障碍、核验期限、分页及空结果。               |
| 私人校园数据 | campus.favorites / correctPlace                                                   | 收藏读写 operation 与去重；纠错 1—200 码点、本人可见范围及审核反馈。 |
| 后台资料维护 | admin.updatePlace / reviewCorrection / updateTaskTemplate / updateSupportResource | 字段、输入校验、角色要求、保存反馈；列表和待审队列读取缺口单列。     |

## 接入和复核方法

1. 先读 docs/api.md 与 miniprogram/shared/contracts.js，按现有 action 逐项编写 payload、成功 data、空态和错误样例；尚未共同评审的字段标为提案。
2. 与 Qinghan 复核校园筛选和详情字段，与 Qizhen Chen 复核四种后台表单及读取需求。新增 action 先交接口评审，再同步注册表与调用方。
3. 角色适配入口是 router.js 的 resolveOperatorRoles(account.id)。可信身份先映射 active 内部账号，再从服务端 operator_roles 得到 data_operator。浏览器提交 role 不参与授权。
4. 用本地替身分别提供普通学生、授权运营、停用运营三组输入，写清预期与实际。private 日记及回顾入口始终只操作本人数据，运营角色不赋予查阅其他学生日记的权力。

## 交给导出和清理负责人的信息

提供 favorites、place_corrections 的字段归属、本人查询筛选、分页边界、导出字段及重复清理行为；说明地点主资料、支持资源和任务模板不会随某位学生注销整体删除。若查询或清理能力尚未实现，列出函数约定和缺口。记录删除相关的旧导出失效规则复用 H03。

## 你需要交回什么

- JH01 校园接口样例和 Qinghan 的反馈；JH02 后台业务矩阵及读取缺口；JH03 三类角色验证记录。
- JH04 至少三份小任务模板草稿和资料核验字段；来源、核验人、日期、有效期、启用状态必须可核对。未核验支持资源保持空态。
- JH05 本人数据查询、导出和清理清单，写明 Xiang Yu 与 Jiawei 的接收状态；实际部署需求转交 Yuen。

完成判断：前端能按样例做页面，两名测试能按角色输入执行本地测试；真实角色解析与云端调用未通过时继续标记待验证。

## 共同回传格式与提交方法

每项交付请带：任务编号、成果路径或 PR、实际使用的提交版本、环境类型、预期和实际、复核意见、实际耗时、后续任务点数、阻塞与下一步。状态采用待开始、进行中、待复核、已验收、阻塞。接收与验收意见由本人实际确认后填写。

成果放 docs/week1/本人目录；修改代码时同步相关 service、校验与测试，检查通过后提交本人分支的 PR。成员 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再同步主分支、整合和发布。共享接口、数据库或导航变更交对应负责人共同复核。

本包仅整理已有资料和本地样例，未发消息、上传 GitHub、部署、修改云资源、执行新云端写入或清理。后续操作仍按已约定范围办理。管理员登录由本人手动完成，管理员密码、微信身份、指纹和凭证不进入公共文档。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [接口信封与职责分工](../../../api.md)：`docs/api.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/api.md)。
- [唯一 action 和错误码注册表](../../../../miniprogram/shared/contracts.js)：`miniprogram/shared/contracts.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/contracts.js)。
- [可信身份门禁与三个适配器](../../../../cloudfunctions/moodsky/router.js)：`cloudfunctions/moodsky/router.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/cloudfunctions/moodsky/router.js)。
- [H01 环境与权限登记](../w1-h01.md)：`docs/week1/xiang-hong/w1-h01.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h01.md)。
- [H03 可靠写入与删除设计](../w1-h03.md)：`docs/week1/xiang-hong/w1-h03.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h03.md)。
- [Xiang Yu 数据字典](../../XiangYu/data-dictionary.md)：`docs/week1/XiangYu/data-dictionary.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/data-dictionary.md)。
- [Xiang Yu 导出流程设计](../../XiangYu/export-flow-design.md)：`docs/week1/XiangYu/export-flow-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/export-flow-design.md)。
- [Xiang Yu 清理与恢复设计](../../XiangYu/cleanup-recovery-design.md)：`docs/week1/XiangYu/cleanup-recovery-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/cleanup-recovery-design.md)。
- [成员 PR 与整合发布顺序](../../../../CONTRIBUTING.md)：`CONTRIBUTING.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/CONTRIBUTING.md)。
