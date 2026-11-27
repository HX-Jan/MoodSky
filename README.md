# MoodSky

MoodSky 是 12 人团队开发的原生微信小程序。用户可以用天气记录感受，并在私人月历、档案和回顾页查看自己的记录。

11月27日：[第四期负责人交付与候选范围](docs/alpha/xiang-hong/c4-20261127/README.md)，含英文日志4、实际提交统计、同包指纹、逐功能结论和课堂交接。冻结产品00c59a1；成员及外部最终意见单独登记。

11月27日登录调整：当前小程序无法开放手机号能力，采用[微信一键登录、首次自动注册](docs/reviews/2026-11-27-wechat-login/README.md)，不依赖手机号或短信；注销后经明确确认可注册空账号，旧数据不恢复。

**最新整合版 v0.5.3** 接收第六周与 Alpha 预跑成果，补齐任务未知结果、保存重开和发布来源核对；保留版本页构建核对、月历返回重读、校园到访提示和卡片右侧的「选这里」。沿用微信登录、可选头像昵称、微信原生分享，以及 JSON／Markdown 导出与账号清理。[v0.5.3 发布说明](docs/releases/v0.5.3.md) · [第六周成员交付](docs/week6/README.md) · [组员逐步使用手册](GETTING_STARTED.md)

## 最新版本与功能范围

| 项目              | 当前情况                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 微信正式版本      | 最近经负责人确认的公开版本为 **0.3.0**（11 月 1 日）。当前平台各阶段以后台实际记录为准。                                                                       |
| GitHub 源码与发行 | [main](https://github.com/HX-Jan/MoodSky/tree/main) 用于开发，[v0.5.3](docs/releases/v0.5.3.md) 固定本轮正式发布准备包来源。                                   |
| 天气与记录        | 晴天、多云、阴天、雨天、雷雨、台风、自定义；云端保存、修改、重试、删除及回顾                                                                                   |
| 账号与资料        | 点击头像区进入微信一键登录，设置头像昵称；私人账号隔离、JSON/Markdown导出、注销与定时清理继续保留                                                              |
| 微信原生分享      | 13页适配右上角“…”好友与朋友圈分享，保留当前页合法日期/月份；接收者读取本人数据，朋友圈单页显示功能介绍                                                         |
| 日常使用          | 新版头像昵称区和分组菜单、微信隐私/反馈入口、断网恢复提示、更新提示与未保存操作保护                                                                            |
| 目标云            | 业务 `moodsky-release` 和维护 `moodsky-release-maintenance`。最近实测的健康构建为 `43550e2`、版本 0.5.1，当时新增校园打卡暂停；v0.5.3 实际部署与健康回执另记。 |
| 校园与任务        | 普通任务提供散心、校园阅读、记录心情等入口。校园提供福大推荐地点和本人手动打卡，用户自行前往后显式完成。联调包保留新增打卡默认暂停。                           |
| 本地开发          | 默认保持云业务关闭；内存演示只在本次运行保留，与线上持久化分别使用                                                                                             |

v0.5.3 的目标云部署、设备验证及微信平台状态按实际回执登记，GitHub 发行不表示微信已上线。[历史上线记录](docs/releases/v0.3.0.md) · [开发交接](docs/handoff.md) · [文档导航](docs/README.md)

## 团队共享与开发

所有后续开发必须遵守[隐私与内容安全开发规则](docs/privacy-development-rules.md)，在PR说明采集、用途、授权、SDK、UGC及保存/清理影响。平台隐私/UGC编辑截图不是已生效证据；当前内容安全审核缺口和相关版本发布前核对项见规则，不因文档合入而视为完成。

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
