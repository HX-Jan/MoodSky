# MoodSky 第一周 Qinghan Zhang 协作交接

提供人：Xiang Hong。接收人：Qinghan Zhang。任务：W1 QZ01—QZ05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请复用 Campus 骨架完成合成列表和导航路径，把地点资料与接口需求交 Junhan，把必要权限和集成问题交 Xiang Hong。

## 我提供的输入

| 项目         | 提供的信息                                                       | 如何使用                                                |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------- |
| 团队项目     | HX-Jan/MoodSky；AppID wxf602e991ff44e6c8                         | 导入 MoodSky 仓库根目录；成员使用自己的微信开发者账号。 |
| 测试环境     | mood-sky / mood-sky-d5gqy3spkff37566d                            | 仅用于获批的测试；权限不足时交 Xiang Hong 协调。        |
| 运行时与 SDK | 本地 Node.js 24；已记录云运行时 Nodejs16.13；wx-server-sdk 4.0.2 | 本地版本和云运行时分别记录；按锁文件安装依赖。          |

Campus 页面及 campus service 已有骨架。地点业务字段和 payload 由 Junhan 与你共同确认；我提供项目环境、公共接口约定和权限协调入口。campus.listPlaces、getPlace、supportResources 为公开入口，favorites 与 correctPlace 为私人入口。

| 你可使用的信息 | 使用方法与边界                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------- |
| 列表与详情入口 | 沿用现有 service 和 action；把校区、标签、开放状态、核验期限、分页和空结果问题列给 Junhan。     |
| 资料候选表字段 | 至少 5 条；记录名称、校区、来源、开放时间、环境标签、无障碍、核验状态；坐标不能确认时标待核实。 |
| 定位与地图     | 首次进入不主动申请定位；用户主动选择后申请，拒绝后仍可浏览列表；地图失败可回列表。              |
| 收藏与纠错     | 收藏按本人去重、可取消；纠错 1—200 Unicode 码点；读写 operation 和审核反馈由 Junhan 确认。      |

## 怎么准备页面与权限需求

1. 从当前 Campus 骨架开始，用清楚标注的合成数据展示列表、校区/标签筛选、无结果、资料过期和关闭状态。合成地址或未核验资料不列成正式可前往推荐。
2. 详情列出地址、开放信息、无障碍说明、核验日期；导航由用户主动点击。记录技术验证所需地图字段、平台能力、错误提示及已有权限，交 Xiang Hong 协调。
3. 在开发者工具或真机记录首次进入、主动定位、拒绝继续浏览、地图失败返回四条步骤；把设备和证据类型写清，交 Yuen 复核。
4. 把用到的位置用途、触发时机、是否保存或上传等实际行为交 Qizhen Cai；未知处保留待确认，避免把计划写成已配置权限。

## 给我的回传以及给其他成员的交接

- 给 Xiang Hong：平台权限或地图能力需求表，包含所需功能、当前报错、对本周任务的影响和本地替代路径。
- 给 Junhan：至少 5 条资料候选和来源；筛选、详情、收藏与纠错的字段问题；支持资源未核验时的空态。
- 给 Yuen：QZ02—QZ04 页面步骤和截图；给 Qizhen Cai：位置与地图信息处理说明；给 Jiaqi：需要视觉复核的页面。

完成判断：资料真假与核验状态清楚，拒绝定位仍有可用页面，操作步骤能复现；真实收藏、纠错保存未接通时保持待验证。

## 共同回传格式与提交方法

每项交付请带：任务编号、成果路径或 PR、实际使用的提交版本、环境类型、预期和实际、复核意见、实际耗时、后续任务点数、阻塞与下一步。状态采用待开始、进行中、待复核、已验收、阻塞。接收与验收意见由本人实际确认后填写。

成果放 docs/week1/本人目录；修改代码时同步相关 service、校验与测试，检查通过后提交本人分支的 PR。成员 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再同步主分支、整合和发布。共享接口、数据库或导航变更交对应负责人共同复核。

本包仅整理已有资料和本地样例，未发消息、上传 GitHub、部署、修改云资源、执行新云端写入或清理。后续操作仍按已约定范围办理。管理员登录由本人手动完成，管理员密码、微信身份、指纹和凭证不进入公共文档。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [项目导入和本地演示方法](../../../development.md)：`docs/development.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/development.md)。
- [接口信封与职责分工](../../../api.md)：`docs/api.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/api.md)。
- [唯一 action 和错误码注册表](../../../../miniprogram/shared/contracts.js)：`miniprogram/shared/contracts.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/contracts.js)。
- [H01 环境与权限登记](../w1-h01.md)：`docs/week1/xiang-hong/w1-h01.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h01.md)。
- [天气 标签 限制和偏好默认值](../../../../miniprogram/shared/constants.js)：`miniprogram/shared/constants.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/constants.js)。
- [Xiang Yu 数据字典](../../XiangYu/data-dictionary.md)：`docs/week1/XiangYu/data-dictionary.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/XiangYu/data-dictionary.md)。
- [2026 年 10 月 15 日成果与证据边界](../../../test-reports/2026-10-15/README.md)：`docs/test-reports/2026-10-15/README.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/test-reports/2026-10-15/README.md)。
