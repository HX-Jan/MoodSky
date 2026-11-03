# MoodSky

11月2日新增开发要求：[福大地点推荐与手动打卡](docs/week4/campus-recommendation-checkin.md)由校园负责人推进；本周先做基本打卡，地图不接入、照片上传后续安排。此为需求变更，尚未作为新功能上线。

11月3日最新源码已[移除校园地图/定位入口及位置权限声明](docs/week4/xiang-hong/h04-campus-recommendation-20261103.md)，按推荐状态和文字方位浏览；手动打卡记录尚待成员交付，微信公开版未更新。

**GitHub最新源码版：v0.4.0（2026-11-02）**。已整合微信登录、分享、个人中心及第四周回顾复测/准备材料。见[发布说明](docs/releases/v0.4.0.md)与[第四周导航](docs/week4/README.md)。微信线上仍为0.3.0。

MoodSky是12人团队开发的原生微信小程序：用天气记录感受，在私人月历和档案里回顾生活。**GitHub最新源码已加入微信一键登录、可选头像昵称、当前页原生分享和新版个人中心**，以0.3.0发布实现为基线，保留PR #90的组员成果与账号安全修复。微信正式上线版本仍为负责人确认的0.3.0，新功能已推送手机预览，尚未上传新的公开客户端。

[微信登录与分享更新](docs/releases/wechat-login-share-20261101.md) · [0.3.0发布说明](docs/releases/v0.3.0.md) · [开发交接](docs/handoff.md) · [组员逐步使用手册](GETTING_STARTED.md) · [文档导航](docs/README.md)

## 最新版本与功能范围

| 项目           | 当前情况                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| 微信正式版本   | **0.3.0，已发布上线（负责人确认）**；当前未重新读取公众平台版本页                                                   |
| GitHub最新源码 | [main](https://github.com/HX-Jan/MoodSky/tree/main)，包含微信登录、资料、原生分享及个人中心更新；旧标签只作历史快照 |
| 天气与记录     | 晴天、多云、阴天、雨天、雷雨、台风、自定义；云端保存、修改、重试、删除及回顾                                        |
| 账号与资料     | 点击头像区进入微信一键登录，设置头像昵称；私人账号隔离、JSON/Markdown导出、注销与定时清理继续保留                   |
| 微信原生分享   | 13页适配右上角“…”好友与朋友圈分享，保留当前页合法日期/月份；接收者读取本人数据，朋友圈单页显示功能介绍              |
| 日常使用       | 新版头像昵称区和分组菜单、微信隐私/反馈入口、断网恢复提示、更新提示与未保存操作保护                                 |
| 真实验证       | 10月30日SDK业务调用、7/30/90天回顾、独立配置空间注销与自动清理通过；用户手机保存、重开读取和领取导出通过            |
| 正式服务       | moodsky-release；维护函数moodsky-release-maintenance，五分钟调度；10月30日健康构建标识0.3.0-rc2                     |
| 校园与任务     | 校园公开资料为空；源码任务持久化已接线，正式模板与共同验收仍缺；收藏、纠错、定位和装饰未开放                        |
| 本地开发       | 默认保持云业务关闭；内存演示只在本次运行保留，与线上持久化分别使用                                                  |

本次GitHub整合不重新部署云函数或上传微信代码。11月1日登录资料服务已按确认任务完成主函数单文件更新，手机预览已推送；真实手机登录/头像昵称保存、好友或朋友圈发送及实际新版重启仍待反馈。原上线客户端来源576499f，维护代码来源6d5d725；完整来源与证据分见[最新源码更新](docs/releases/wechat-login-share-20261101.md)和[0.3.0发布说明](docs/releases/v0.3.0.md)。

## 团队共享与开发

组员第一次使用先读[逐步使用手册](GETTING_STARTED.md)。没有团队云权限，也可在Node.js 24下执行`npm ci`和`npm run team:check`，检查九组本地合成调用链；该命令不会启动网页服务或连接真实云环境。

微信项目开发资格、腾讯云资源权限和业务账号是不同层级，按[共享入口与权限排障](docs/collaboration/team-sharing.md)逐步核对。不要共享主账号或密钥来解决访问问题。

[开发步骤](docs/development.md) · [成员历史索引](docs/collaboration/README.md) · [后续收件与审查](docs/collaboration/updates.md) · [提交步骤](docs/collaboration/submission-guide.md) · [需求](docs/requirements.md) · [模块分工](docs/team.md)

10月31日[PR #83—#89整合](docs/reviews/2026-10-31-member-integration/README.md)经PR #90接收，账号预检与清理归属保护已保留。第三周58项有收件状态、2项待本人回传，这是收件统计，不是完成率。个人验收、真实研究和Web运营身份仍按各项要求推进。

## 前两周成果与协作

- [12名成员、账号、两周来源及剩余验收](docs/collaboration/README.md)
- [120项任务检索表](docs/collaboration/task-deliveries.csv)，关联两周各60项原始台账
- [W1计划和成果](docs/week1/README.md)、[W2计划和成果](docs/week2/README.md)、[W3计划与60项台账](docs/week3/README.md)
- [原始提交、交审快照、最终head与实际接收PR](docs/collaboration/registry.json)
- [提交和补交步骤](docs/collaboration/submission-guide.md)、[协作规定](CONTRIBUTING.md)、[成员整合核对表](docs/reviews/member-integration-checklist.md)

PR #31已合入main。#3及#39—#41虽关闭未直接合并，成果已有明确整合去向；#11当时为空文档，正文后来由#51补交。具体来源见[完整PR表](docs/collaboration/pull-requests.md)，不把“已提交”“已合入”“已接入”“已验收”混为同一状态。

## 本地运行

使用Node.js 24，克隆后执行：

```sh
git clone https://github.com/HX-Jan/MoodSky.git
cd MoodSky
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm run check
```

在微信开发者工具导入仓库根目录；团队AppID已配置，微信开发权限需单独授予。生成的`miniprogram/config/environment.local.js`默认关闭云能力，不提交个人配置。

需要本地内存演示时，将该个人配置设为：

```javascript
module.exports = { cloudEnabled: false, cloudEnvId: '', journalDemo: true };
```

此模式的开发工具、合成账号偏好缓存与正式体验展示不同，范围见[开发步骤](docs/development.md)。真实云连接失败不会自动退回演示。后台本地表单、SDK构建和真实接入边界见[后台说明](admin/README.md)。

修改共享契约后先执行`npm run cloud:prepare`，再执行`npm run check`。仓库CI运行代码/格式/类型/结构和行为检查、后台构建、依赖审计及SDK离线检查；通过不等于生产业务或真机已验收。

## 目录与文档

| 路径                                  | 用途                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| miniprogram/                          | 今天、私人记录、校园、天气宇宙、我的及共享模块       |
| cloudfunctions/moodsky/               | 正式入口骨架、领域模块和显式候选；默认门禁保留       |
| tools/、scripts/、tests/              | 隔离候选、打包、验证与行为测试                       |
| database/                             | 集合、索引、权限与数据布局设计；JSON不代表平台已应用 |
| admin/                                | 本地后台表单和Web SDK候选，真实维护未开放            |
| docs/collaboration/                   | 成员、任务、PR与提交规范的统一入口                   |
| docs/week1/、docs/week2/、docs/week3/ | 原始成员材料、计划、台账与验收边界                   |
| docs/reviews/、docs/deployment/       | 逐项取舍、实际部署和分环境验证                       |

[架构](docs/architecture.md) · [接口](docs/api.md) · [Assignment 3 SRS正文](docs/assignment3/README.md) · [SRS PDF](docs/assignment3/MoodSky_A3_SRS.pdf) · [SRS Word](docs/assignment3/MoodSky_A3_SRS.docx) · [历史整合与部署记录](PROJECT_HISTORY.md)

旧报告中的测试数量、五天气、未合入或未部署按原时点保留。历史记录移到`PROJECT_HISTORY.md`，当前入口不再用多轮旧状态代替最新版。原作者、失败证据、个人工时和独立签字保持可追溯，不以PR数量或代码行数核算成员贡献。
