# 模块分工与共同修改范围

执行分工更新于2026-10-12，依据已经确认的项目计划。仓库内职责、代码边界和复核关系见下表；技术工具与部署步骤见[组员开发步骤](development.md)，功能范围和验收依据见[需求基线](requirements.md)。2026-10-11博客与PPT保留为开题版本；姓名是团队职责标识，不用于猜测GitHub账号。

| 成员          | 主责目录与成果                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Xiang Hong    | 项目管理、后端集成、router公共入口；cloudfunctions/moodsky/domains/journal.js、review.js；F01—F10及记录、装饰和回顾数据处理 |
| Junhan Huang  | domains/campus.js、admin.js；F11—F16、后台资料业务、运营角色查询与业务授权；校园私人数据处理                                |
| Jiawei Fang   | domains/tasks.js；account.js中的偏好、内部账号解析、停用、注销入口及受限进度接口；F17—F21及F23账号流程；任务和偏好数据处理  |
| Linghan Chen  | app.js、app.json、公共组件、services/api.js、pages/me、modules/account；F21—F24前端、前端集成及客户端缓存清理               |
| Yifan Ji      | pages/today、modules/journal；F01—F04及F20；输入保留、重复点击保护和记录刷新通知                                            |
| Zhifeng Dai   | pages/universe、modules/review；F05—F10；回顾更新、空态与素材失败处理                                                       |
| Qinghan Zhang | pages/campus、modules/campus；F11—F16；定位拒绝、地图失败和资料失效状态                                                     |
| Qizhen Chen   | modules/tasks；F17—F19前端；admin/后台界面及Web可信身份接入；后台身份适配模块在接口PR中确定                                 |
| Jiaqi Zhu     | styles/tokens.wxss、共享视觉规范、四页及后台原型、设计素材、访谈与视觉验收                                                  |
| Xiang Yu      | database/、shared/types.d.ts；F22完整后端、F23清理执行、到期维护、备份恢复；导出和清理执行模块按下文拆分                    |
| Yuen Lin      | tests/中的功能、集成、异常与兼容测试；CI、自动检查、测试环境部署清单与日常部署验证                                          |
| Qizhen Cai    | tests/中的权限、账号隔离、导出/注销/恢复测试；性能、12人可用性测量及独立验收                                                |

任务UI由Qizhen Chen在modules/tasks建设，Linghan Chen负责最终装配，Today/Me负责人配合，不增加第五个主标签页。F20不依赖先保存日记。

## 账号与数据任务的代码边界

account.js当前仍为未实现骨架。后续由Jiawei保留偏好、账号停用、注销请求与清理进度入口；Xiang Yu实现requestExport、exportStatus、downloadExport及后台清理、到期执行。实现时在cloudfunctions/moodsky内拆分导出、清理执行模块，经接口PR确认目录，避免两人同时大改account.js。拟拆分目录不代表已经实现。

Xiang Hong交付记录/装饰/回顾的查询与清理能力，Junhan交付收藏/纠错等校园私人数据处理，Jiawei交付任务/偏好数据处理。Xiang Yu负责导出组织与清理执行，Jiawei负责账号停用和受限进度，Linghan负责客户端缓存，Qizhen Cai独立验收完整流程。

## 共享修改与复核

| 文件或范围                                                                | 主责与复核                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| shared/constants.js、contracts.js、validation.js、docs/api.md、后端router | Xiang Hong协调；相关前后端及Xiang Yu共同复核；业务输入校验由各模块负责人实现                  |
| app.json、app.js、services/api.js、公共组件                               | Linghan Chen主责；相关页面负责人和Jiaqi Zhu复核                                               |
| database/、导出与清理执行、恢复流程                                       | Xiang Yu主责；Jiawei Fang、相关业务负责人及Qizhen Cai复核                                     |
| 账号解析、停用、进度回执                                                  | Jiawei Fang主责；Xiang Yu、Linghan Chen、Qizhen Cai复核                                       |
| Web可信身份接入、后台业务与运营权限                                       | Qizhen Chen负责身份接入；Junhan Huang负责角色与业务授权；Xiang Hong、Xiang Yu和Qizhen Cai复核 |
| 设计变量、共用样式与素材登记                                              | Jiaqi Zhu主责；相关前端复核                                                                   |
| CI、自动检查、测试部署                                                    | Yuen Lin主责；相关开发复核；数据库配置由Xiang Yu负责                                          |
| 平台账号、AppID、成员权限与仓库保护                                       | Xiang Hong负责管理员操作；Yuen Lin核对部署记录                                                |

每项任务有唯一交付负责人、协作人、复核人、期限与验收条件。各成员提供适用测试和文档；共享成果事先约定点数分配。第1周估点后计划比例归一化至100%，第2周末复查负担。

CODEOWNERS当前仍只使用已知真实账号@HX-Jan。成员提供GitHub账号并获得权限后，再通过PR补齐归属；姓名不是GitHub用户名。本次分工文档更新不代表权限、云环境或业务功能已经配置完成。
