# MoodSky 第一周 Qizhen Cai 协作交接

提供人：Xiang Hong。接收人：Qizhen Cai。任务：W1 QT01—QT05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请使用现有访问策略、H02/H03 和数据管理设计，形成可执行的权限与生命周期用例，并独立核对真实身份结果。

## 我提供的角色与数据规则

| 访问范围 | 可信前提                             | 你要检查的边界                                            |
| -------- | ------------------------------------ | --------------------------------------------------------- |
| public   | 公开校园资料或固定模拟说明           | 响应不包含私人记录；模拟天气持续标识模拟。                |
| private  | 可信平台身份映射 active 内部账号     | 只操作本人数据；A/B 互不可见；客户端 ownerId 不提供权限。 |
| operator | active 账号且服务端 data_operator    | 维护规定校园资料；不读取其他学生私人日记或回顾。          |
| receipt  | 服务端校验的 cleanup_status 受限回执 | 只能查询所属清理进度；不能导出、恢复或读取日记。          |

Xiang Yu 的样本提供两个 active、一个 disabled 合成账号和运营角色；它们是虚构数据，不是可直接登录的微信身份。真实平台映射由受信环境另行建立。当前真实账号、角色、回执适配器仍待实现，先用明确标注的本地替身验证。

## 至少八条权限用例输入

| 用例                     | 前置和输入                                     | 预期或验收依据                                               |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------ |
| P01 无可信身份           | journal.get({date:"2026-10-15"})；上下文无身份 | UNAUTHENTICATED。                                            |
| P02 伪造归属             | 请求外层添加 ownerId 或 role                   | INVALID_REQUEST；不能把客户端字段用于授权。                  |
| P03 A 读 B               | A/B 同日各有记录；A 按 date 查询               | 仅返回 A，无法通过 payload 选择 B；检查结果字段不泄露 B。    |
| P04 A 写 B               | A 请求中伪造 B 的 ownerId/身份                 | 被校验拒绝，B 记录不变；未知字段精确错误由对应入口校验确认。 |
| P05 停用身份             | disabled 账号进入 private/operator             | ACCOUNT_DISABLED，不自动恢复为 active。                      |
| P06 普通学生调后台       | active 无 data_operator；直接调 admin action   | FORBIDDEN，隐藏菜单不能代替此验证。                          |
| P07 运营尝试跨账号读日记 | 运营账号尝试指定其他账号                       | 身份字段拒绝或只返回本人；不获得跨账号阅读能力。             |
| P08 非法进度回执         | A 使用 B 的回执、过期回执或只提交 jobId        | 拒绝越权/失效回执；具体缺字段错误先与 Jiawei 确认。          |

## 生命周期和 H03 证据怎样使用

分别写导出换账号、领取凭证 5 分钟上限、文件 24 小时上限、记录删除使旧未领取导出失效、注销立即停用、部分清理失败可重试、受限回执越权、恢复前重放删除标记八条详细用例。给出测试时钟和隔离数据需求，完整执行等待功能具备并获批。链接立即撤销等平台能力没有证据时保留待验证。

H03 新批次真实报告为 17 项中 12 通过、5 失败；旧批次 failed 且逐项报告缺失。历史按批次只读计数各 60 条，本次未重查，不推断旧批次逐项成绩、不重发写入或清理。H03 是隔离技术验证，不代表普通账号授权、正式日记或生命周期全部通过。

## 访谈和性能方法

按 Jiaqi 统一提纲执行 P07—P12 的六次真实访谈，匿名化后交 Jiaqi 去重汇总。性能模板记录设备、网络、数据量、冷启动和至少 20 次采样方式；后续 12 人可用性任务为保存、理解私人范围、找地点、查月份。本周合成练习不计为真实达标。

## 你需要交回什么

- QT01 角色权限矩阵和八条以上详细用例；QT02 八条以上生命周期用例及隔离/时钟需求。
- QT03 六份匿名访谈；QT04 测量模板和明确标注的合成练习；QT05 微信/Web 身份、角色、双账号缓存及日志泄露的独立通过/失败/阻塞记录。
- 缺陷包含最小复现、预期、实际、版本与脱敏证据；不得在公开截图中放正文、OPENID、指纹或凭证。正式 Issue 分派及通知由团队安排。

## 共同回传格式与提交方法

回传任务编号、成果或 PR、版本和环境、预期及实际、证据、复核、耗时、点数与阻塞。状态采用待开始、进行中、待复核、已验收、阻塞；签收和验收由本人填写。

成果放 docs/week1/本人目录，经本人分支 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再整合发布。共享接口、数据库和导航变更共同复核。

本包未发消息、上传 GitHub、部署、修改云资源、运行云端写入或清理。管理员本人登录，身份、指纹和凭证不进入公开文档；后续操作仍按约定范围办理。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [唯一 action 和错误码注册表](../../../../miniprogram/shared/contracts.js)：`miniprogram/shared/contracts.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/contracts.js)。
- [可信身份门禁与三个适配器](../../../../cloudfunctions/moodsky/router.js)：`cloudfunctions/moodsky/router.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/cloudfunctions/moodsky/router.js)。
- [H02 记录接口审查草稿](../w1-h02.md)：`docs/week1/xiang-hong/w1-h02.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h02.md)。
- [H03 可靠写入与删除设计](../w1-h03.md)：`docs/week1/xiang-hong/w1-h03.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h03.md)。
- [H03 真实隔离批次报告](../w1-h03-report-retention-validation.md)：`docs/week1/xiang-hong/w1-h03-report-retention-validation.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h03-report-retention-validation.md)。
- [Xiang Yu 导出流程设计](../../XiangYu/export-flow-design.md)：`docs/week1/XiangYu/export-flow-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/export-flow-design.md)。
- [Xiang Yu 清理与恢复设计](../../XiangYu/cleanup-recovery-design.md)：`docs/week1/XiangYu/cleanup-recovery-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/cleanup-recovery-design.md)。
- [Xiang Yu 合成样本与交接表](../../XiangYu/synthetic-data-and-handover.md)：`docs/week1/XiangYu/synthetic-data-and-handover.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/synthetic-data-and-handover.md)。
- [2026 年 10 月 15 日成果与证据边界](../../../test-reports/2026-10-15/README.md)：`docs/test-reports/2026-10-15/README.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/test-reports/2026-10-15/README.md)。
- [H05 验收与估点收集草稿](../w1-h05.md)：`docs/week1/xiang-hong/w1-h05.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h05.md)。
