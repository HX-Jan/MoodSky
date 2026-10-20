# MoodSky 第一周 Xiang Yu 协作交接

提供人：Xiang Hong。接收人：Xiang Yu。任务：W1 XY01—XY05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请按已整合的五份设计材料继续复核数据库约束，补齐导出和清理所需模块能力及待验证项。

## 我提供的环境和已整合资料

| 项目         | 提供的信息                                                       | 如何使用                                                |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------- |
| 团队项目     | HX-Jan/MoodSky；AppID wxf602e991ff44e6c8                         | 导入 MoodSky 仓库根目录；成员使用自己的微信开发者账号。 |
| 测试环境     | mood-sky / mood-sky-d5gqy3spkff37566d                            | 仅用于获批的测试；权限不足时交 Xiang Hong 协调。        |
| 运行时与 SDK | 本地 Node.js 24；已记录云运行时 Nodejs16.13；wx-server-sdk 4.0.2 | 本地版本和云运行时分别记录；按锁文件安装依赖。          |

你的 data-dictionary、db-constraint-verification、export-flow-design、cleanup-recovery-design、synthetic-data-and-handover 五份文档已整合；PR #3 已由整合 PR #5 吸收后关闭。请基于当前主分支修订，保留作者与证据，不重新合入旧版本。设计复核和真实执行分别登记。

## 记录和可靠写入给你的约束

- 同一 ownerId/date 最多一条有效记录；账号字段为 openid，状态为 active/disabled。客户端不直连私人集合，也不能指定 ownerId 授权。
- H02 定义新建 30 天窗口、旧记录编辑、expectedVersion 和 data.entry。H03 补充记录/回执同提交、同请求绑定原输入、删除后重建版本不重置、旧回执不恢复正文。
- 回顾只取当前有效本人记录，删除后过滤旧 entryId 的卡片/装饰关联；H04 的 journalRevision/sourceRevision 仍为待审字段提案，需与数据字典共同复核。

| 当前已有证据                                    | 怎样使用                                         | 尚待完成                                           |
| ----------------------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| 15 集合、7 组唯一索引；客户端读取拒绝的历史记录 | 从 H01 及配置证据核对；JSON 设计不等于当前云状态 | 成员独立复核及客户端写拒绝等缺口。                 |
| H03 新批次 17 项中 12 通过、5 失败              | 只用于对应隔离技术场景；查看原报告和错误码       | 并发失败及精确错误映射未解决，不能记正式写入通过。 |
| H03 两批次按历史只读计数各 60 条                | 保留旧批次 failed/报告缺失，新批次报告已留存     | 本次未重查数量，不重发实验、不清理、不补造旧报告。 |

## 导出和清理怎样接收我的模块输入

记录导出需要本人有效日记的分页查询与字段白名单；我负责的 journal/review 当前真实适配尚未实现，请在能力表标待实现。回顾为派生视图，不另复制全文成为新私有数据源。删除某记录后，与其相关的旧未领取导出必须失效，领取时重查删除与账号状态；不能靠生成时检查一次。

清理需要 journals、month_decorations、request_receipts、deletion_markers 的归属和重试规则。停用与清理入口由 Jiawei 负责；你负责执行器和导出生成；各业务后端交可重复清理能力，Linghan 清前端缓存，Qizhen Cai 独立验收。删除意图和主记录删除须有持久可靠衔接，jobId 不代表进度读取权限。

需求上限为临时领取凭证 5 分钟、服务端文件 24 小时；主库删除 24 小时、注销 7 天和备份保留约束是待验证目标。平台临时链接是否能立即撤销需要实际能力核验，不能用配置 TTL 宣称已保证失效。

## 你需要交回什么

1. 复核十五集合字段的类型、必填、归属、索引和负责人，逐项写接受或需修改；新增索引或字段变更先交审查。
2. 更新模块能力矩阵：查询、导出、清理、失效、账号校验，各列负责人、输入输出、实现/验证状态及缺口。
3. 交付 JSON/Markdown 合成导出样例、清理状态/重试/恢复方案、备份实际能力的证据或待确认项，交前端和测试复核。

完成判断：设计与接口一致，未知能力有负责人和替代方案；本包不授权创建索引、部署、重跑 H03 或删除保留数据。

## 共同回传格式与提交方法

每项交付请带：任务编号、成果路径或 PR、实际使用的提交版本、环境类型、预期和实际、复核意见、实际耗时、后续任务点数、阻塞与下一步。状态采用待开始、进行中、待复核、已验收、阻塞。接收与验收意见由本人实际确认后填写。

成果放 docs/week1/本人目录；修改代码时同步相关 service、校验与测试，检查通过后提交本人分支的 PR。成员 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再同步主分支、整合和发布。共享接口、数据库或导航变更交对应负责人共同复核。

本包仅整理已有资料和本地样例，未发消息、上传 GitHub、部署、修改云资源、执行新云端写入或清理。后续操作仍按已约定范围办理。管理员登录由本人手动完成，管理员密码、微信身份、指纹和凭证不进入公共文档。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [H01 环境与权限登记](../w1-h01.md)：`docs/week1/xiang-hong/w1-h01.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h01.md)。
- [H02 记录接口审查草稿](../w1-h02.md)：`docs/week1/xiang-hong/w1-h02.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h02.md)。
- [H03 可靠写入与删除设计](../w1-h03.md)：`docs/week1/xiang-hong/w1-h03.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h03.md)。
- [H04 回顾接口待审草稿](../w1-h04.md)：`docs/week1/xiang-hong/w1-h04.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h04.md)。
- [十五个集合及索引设计](../../../../database/collections.json)：`database/collections.json`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/database/collections.json)。
- [客户端数据库权限设计](../../../../database/client-access-policy.json)：`database/client-access-policy.json`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/database/client-access-policy.json)。
- [Xiang Yu 数据字典](../../XiangYu/data-dictionary.md)：`docs/week1/XiangYu/data-dictionary.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/data-dictionary.md)。
- [Xiang Yu 约束核验记录](../../XiangYu/db-constraint-verification.md)：`docs/week1/XiangYu/db-constraint-verification.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/db-constraint-verification.md)。
- [Xiang Yu 导出流程设计](../../XiangYu/export-flow-design.md)：`docs/week1/XiangYu/export-flow-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/export-flow-design.md)。
- [Xiang Yu 清理与恢复设计](../../XiangYu/cleanup-recovery-design.md)：`docs/week1/XiangYu/cleanup-recovery-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/cleanup-recovery-design.md)。
- [Xiang Yu 合成样本与交接表](../../XiangYu/synthetic-data-and-handover.md)：`docs/week1/XiangYu/synthetic-data-and-handover.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/synthetic-data-and-handover.md)。
- [H03 真实隔离批次报告](../w1-h03-report-retention-validation.md)：`docs/week1/xiang-hong/w1-h03-report-retention-validation.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h03-report-retention-validation.md)。
- [2026 年 10 月 15 日成果与证据边界](../../../test-reports/2026-10-15/README.md)：`docs/test-reports/2026-10-15/README.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/test-reports/2026-10-15/README.md)。
