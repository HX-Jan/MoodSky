# MoodSky

12人团队开发的原生 JavaScript 微信小程序：用天气记录感受，在私人月历和档案里回顾生活，浏览校园资料和自愿轻任务。

[成员与前两周提交](docs/collaboration/README.md) · [44个历史PR去向](docs/collaboration/pull-requests.md) · [组员提交步骤](docs/collaboration/submission-guide.md) · [需求基线](docs/requirements.md) · [模块分工](docs/team.md)

第三周已开始：[本周60项任务](docs/week3/README.md)、[H01—H05首轮交付](docs/week3/xiang-hong/README.md)。新增回顾会话隔离与跨月回归属于源码更新，现有`0.2.3.1026`体验包仍固定在`c590247`，本轮没有重新上传。

最新核对：[10月27日成员交付整合](docs/reviews/2026-10-27-member-integration/README.md)，PR #59/#64已按当前七天气审查合并，797项本地测试通过；[H01字段与投影答复](docs/week3/xiang-hong/contract-reply-20261027.md)已给出。此前[登录竞态修复](docs/week3/xiang-hong/readiness-20261026.md)和[回顾/恢复预检](docs/week3/xiang-hong/continuation-20261026.md)保留；真实云并发/恢复和新版手机验收继续单列。

## 当前可体验的范围

| 项目         | 当前状态                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- |
| 最新源码     | [main](https://github.com/HX-Jan/MoodSky/tree/main)；固定`v0.2.3`标签仅为10月21日历史快照         |
| 微信体验版   | **0.2.3.1026**，固定源码`c590247`；已实际上传，用户已确认设为体验版                               |
| 天气与记录   | 晴天、多云、阴天、雨天、雷雨、台风、自定义七项；保存、修改、删除及回顾采用明确标记的内存体验      |
| 保存范围     | 记录与示例仅本次运行保留，未同步云端；关闭后可能丢失，不用于长期保存                              |
| 校园与任务   | 成员地点资料待复核，不启用真实导航；任务为示例建议和本页交互，不写入真实账号                      |
| 正式业务     | 默认私人业务关闭；完整云导出、注销、Web身份/运营维护尚未开放                                      |
| 已有真实验证 | 正式健康0.2.3已验证；本人受限云34次SDK调用/66项断言及手机重开用户确认已完成，测试入口随后恢复关闭 |

参阅[体验版说明与截图](docs/releases/experience-20261026.md)、[本人受限云验证及关闭结果](docs/deployment/private-pilot-business-20261026.md)。源码、云部署、手机现有包和独立验收分别记录；本轮仓库资料整理不会自动更新体验包或开启云业务。

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
