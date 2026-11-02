# MoodSky 第一周 Jiaqi Zhu 协作交接

提供人：Xiang Hong。接收人：Jiaqi Zhu。任务：W1 JQ01—JQ05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请据此完善首轮四页原型和公共视觉规范，并组织真实访谈；接口和输入边界直接用于设计说明。

## 我提供的产品与设计输入

本周主要路径为首次记录、Today 已有记录编辑/补记、校园筛选与详情、指定月份回顾、Me 偏好与导出注销；补充小任务选择和四项后台资料表单。私人记录与固定模拟校园天气分开展示；不加入公共树洞、评论、陌生人互动或诊断承诺。

| 设计输入    | 具体提供的信息                                                                                | 用在何处                                                   |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 天气与标签  | 晴天 SUNNY、晴间多云 PARTLY_CLOUDY、阴天 CLOUDY、雨天 RAINY、暴风雨 STORMY；固定标签最多 5 个 | 天气图标必须配文字；标签、正文可空，天气必选。             |
| 输入和日期  | 正文最多 1000 码点；新建今天及此前 29 天；已有较早旧记录可编辑                                | 补记、已有记录、超范围、冲突、保存失败与草稿保留状态。     |
| 卡片与空态  | cardTextPreview 默认 false；无记录留白；0/2 条不输出趋势结论                                  | 月历、月份档案和卡片默认不显示全文；空数据不伪装天气。     |
| Me 数据管理 | 导出 JSON/Markdown；处理中、失败、过期、完成；注销确认与清理进度                              | 按钮对应实际状态；完整执行尚未上线时用明确标注的合成页面。 |
| 现有样式    | miniprogram/styles/tokens.wxss 与公共组件                                                     | 在现有颜色、间距和字号基础上复核；变更先与 Linghan 对齐。  |

## 如何使用并反馈

1. 先按现有四页和任务入口画首轮可点击原型。与 Yifan 核对 Today 日期和失败反馈，与 Zhifeng 核对月历/档案，与 Qinghan 核对地点，与 Linghan 核对 Me 和公共状态。
2. 输出颜色、字体层级、间距、按钮、输入框和空态规范；交付五类天气图标与文字配对，记录来源与许可，检查正文对比度与触控目标。完整贴纸/背景放后续周。
3. 将每个原型节点关联需求与接口状态，标明采用的是已确认规则还是 H04 待审提案，避免设计稿提前决定新接口字段。

## 访谈招募与资料使用

全员各提供一条自愿受访学生线索，由你统一去重和排期；Xiang Hong 本人的招募线索与参与意愿本包尚未取得，不能代填学生或联系方式。联系方式通过团队私下渠道协调，公开材料只保留参与者编号。

与 Qizhen Cai 共用约 15 分钟提纲，覆盖记录习惯、私人范围、地点发现、小任务、导出和注销。你执行 P01—P06，Qizhen Cai 执行 P07—P12；无需收集真实日记、诊断信息或微信身份。真实原话与转述分开，访谈发生后再统计完成。

## 你需要交回什么

- JQ01 原型链接及页面负责人反馈；JQ02 视觉规范、素材包及许可；JQ03 提纲、意愿记录、去重编号与排期。
- JQ04 六份匿名访谈；JQ05 汇总 12 人问题、分歧、影响需求与原型修订。将需要接口调整的建议交 Xiang Hong 评审。

本周访谈与第六至七周可用性测试分别登记。12 人、成功率等是后续研究或验收目标，尚未执行时不填成已达成结果。

## 共同回传格式与提交方法

每项交付请带：任务编号、成果路径或 PR、实际使用的提交版本、环境类型、预期和实际、复核意见、实际耗时、后续任务点数、阻塞与下一步。状态采用待开始、进行中、待复核、已验收、阻塞。接收与验收意见由本人实际确认后填写。

成果放 docs/week1/本人目录；修改代码时同步相关 service、校验与测试，检查通过后提交本人分支的 PR。成员 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再同步主分支、整合和发布。共享接口、数据库或导航变更交对应负责人共同复核。

本包仅整理已有资料和本地样例，未发消息、上传 GitHub、部署、修改云资源、执行新云端写入或清理。后续操作仍按已约定范围办理。管理员登录由本人手动完成，管理员密码、微信身份、指纹和凭证不进入公共文档。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [天气 标签 限制和偏好默认值](../../../../miniprogram/shared/constants.js)：`miniprogram/shared/constants.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/constants.js)。
- [现有公共视觉变量](../../../../miniprogram/styles/tokens.wxss)：`miniprogram/styles/tokens.wxss`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/styles/tokens.wxss)。
- [H02 记录接口审查草稿](../w1-h02.md)：`docs/week1/xiang-hong/w1-h02.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h02.md)。
- [H04 回顾接口待审草稿](../w1-h04.md)：`docs/week1/xiang-hong/w1-h04.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h04.md)。
- [Xiang Yu 导出流程设计](../../XiangYu/export-flow-design.md)：`docs/week1/XiangYu/export-flow-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/export-flow-design.md)。
- [Xiang Yu 清理与恢复设计](../../XiangYu/cleanup-recovery-design.md)：`docs/week1/XiangYu/cleanup-recovery-design.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/cleanup-recovery-design.md)。
- [项目导入和本地演示方法](../../../development.md)：`docs/development.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/development.md)。
- [2026 年 10 月 15 日成果与证据边界](../../../test-reports/2026-10-15/README.md)：`docs/test-reports/2026-10-15/README.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/test-reports/2026-10-15/README.md)。
