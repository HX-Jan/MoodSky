# MoodSky 第一周 Jiawei Fang 协作交接

提供人：Xiang Hong。接收人：Jiawei Fang。任务：W1 JF01—JF05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请先验证可信微信身份到内部账号的最小路径，再完善任务、偏好、注销入口和受限进度回执的约定。

## 我提供的输入

| 项目         | 提供的信息                                                       | 如何使用                                                |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------- |
| 团队项目     | HX-Jan/MoodSky；AppID wxf602e991ff44e6c8                         | 导入 MoodSky 仓库根目录；成员使用自己的微信开发者账号。 |
| 测试环境     | mood-sky / mood-sky-d5gqy3spkff37566d                            | 仅用于获批的测试；权限不足时交 Xiang Hong 协调。        |
| 运行时与 SDK | 本地 Node.js 24；已记录云运行时 Nodejs16.13；wx-server-sdk 4.0.2 | 本地版本和云运行时分别记录；按锁文件安装依赖。          |

账号入口已经保留在 createRouter 的三个适配器中。当前默认适配器仍返回 NOT_IMPLEMENTED；接口门禁结构存在，不等于真实账号映射已经完成。Xiang Yu 提供数据结构，你负责共用账号校验和账号入口，Xiang Hong 复核接入。

| 交接项       | 提供的约定                                                                       | 如何使用                                                                       |
| ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 可信微信身份 | 云函数 index.js 获取平台可信上下文；resolveAccount(OPENID) 返回内部 id 和 status | 用受信上下文查账号；status 仅 active 可继续私人业务。禁止从 payload 指定账号。 |
| 任务入口     | tasks.suggestions / transition / history / quickChoice；建议最多 3 条            | 与 Qizhen Chen 确认状态转换，与 Yifan 确认未保存日记也可使用轻选择。           |
| 偏好默认值   | cardTextPreview:false；decorationsEnabled:true                                   | 与 Linghan 明确 get/set operation 或拆分提案；两个字段命名沿用共享常量。       |
| 注销与进度   | account.close；account.cleanupStatus({receipt})                                  | 先停用账号再安排清理；进度只认受限回执，jobId 不能代替权限。                   |

## 使用顺序

1. 先与 Xiang Yu 复核 accounts.openid 唯一约束、active/disabled 和首次创建规则。使用本地账号替身验证正常、无可信身份、重复进入和停用四种结果；保留真实云验证为空的状态。
2. 同一身份重复进入应取得同一内部账号；停用身份不自动新建 active 账号，不恢复历史数据。把输入、预期、实际及依赖版本交 Xiang Hong 和 Qizhen Cai。
3. 与前端确认 SELECTED、COMPLETED、SKIPPED、REPLACED 相关转换，给出重复操作、跨日历史和非法转换样例；共享状态名存在不代表每种转换已定。
4. 与 Xiang Yu 定义 close 的持久停用和清理任务衔接、部分失败恢复、cleanupStatus 回执权限和过期处理；与 Linghan 确认处理中、失败、完成各自显示依据。

## 模块数据交接

给 Xiang Yu 提供 task_history 与 preferences 的本人查询、导出字段、可重复清理约定和共用账号校验调用方式。任务模板保留，个人历史按清理规则处理；私人字段不因运营角色而可读。导出生成和清理执行器继续由 Xiang Yu 负责。

## 你需要交回什么

- JF01 可信账号最小验证及四种结果；JF02 任务接口样例和状态表；JF03 偏好、停用、清理进度接口初稿。
- JF04 任务与偏好数据能力清单；JF05 与 Yuen、Qizhen Cai 的门禁联调记录。
- 明确本地测试、真实云调用、尚未实现三类状态。账号解析通过只登记该路径通过，不扩展为全部账号功能完成。

阻塞时提供具体错误、所在层次和所需权限；可继续完善替身测试、状态表和接口样例，保持服务端授权门禁。

## 共同回传格式与提交方法

每项交付请带：任务编号、成果路径或 PR、实际使用的提交版本、环境类型、预期和实际、复核意见、实际耗时、后续任务点数、阻塞与下一步。状态采用待开始、进行中、待复核、已验收、阻塞。接收与验收意见由本人实际确认后填写。

成果放 docs/week1/本人目录；修改代码时同步相关 service、校验与测试，检查通过后提交本人分支的 PR。成员 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再同步主分支、整合和发布。共享接口、数据库或导航变更交对应负责人共同复核。

本包仅整理已有资料和本地样例，未发消息、上传 GitHub、部署、修改云资源、执行新云端写入或清理。后续操作仍按已约定范围办理。管理员登录由本人手动完成，管理员密码、微信身份、指纹和凭证不进入公共文档。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [微信云函数可信上下文入口](../../../../cloudfunctions/moodsky/index.js)：`cloudfunctions/moodsky/index.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/cloudfunctions/moodsky/index.js)。
- [可信身份门禁与三个适配器](../../../../cloudfunctions/moodsky/router.js)：`cloudfunctions/moodsky/router.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/cloudfunctions/moodsky/router.js)。
- [接口信封与职责分工](../../../api.md)：`docs/api.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/api.md)。
- [唯一 action 和错误码注册表](../../../../miniprogram/shared/contracts.js)：`miniprogram/shared/contracts.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/contracts.js)。
- [天气 标签 限制和偏好默认值](../../../../miniprogram/shared/constants.js)：`miniprogram/shared/constants.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/constants.js)。
- [H02 记录接口审查草稿](../w1-h02.md)：`docs/week1/xiang-hong/w1-h02.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h02.md)。
- [H03 可靠写入与删除设计](../w1-h03.md)：`docs/week1/xiang-hong/w1-h03.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h03.md)。
- [Xiang Yu 数据字典](../../XiangYu/data-dictionary.md)：`docs/week1/XiangYu/data-dictionary.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/data-dictionary.md)。
- [Xiang Yu 导出流程设计](../../XiangYu/export-flow-design.md)：`docs/week1/XiangYu/export-flow-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/export-flow-design.md)。
- [Xiang Yu 清理与恢复设计](../../XiangYu/cleanup-recovery-design.md)：`docs/week1/XiangYu/cleanup-recovery-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/cleanup-recovery-design.md)。
- [Xiang Yu 合成样本与交接表](../../XiangYu/synthetic-data-and-handover.md)：`docs/week1/XiangYu/synthetic-data-and-handover.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/synthetic-data-and-handover.md)。
