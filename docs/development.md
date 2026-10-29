# 当前开发步骤

第一次接手项目，请先按[组员逐步使用手册](../GETTING_STARTED.md)完成安装、九组联调及所需界面/模块路径；本页保留当前开发约定。

本页是2026-10-28整理后的现行指引。功能与包范围见[项目首页](../README.md)，材料检索见[文档导航](README.md)。早期环境、权限和部署过程完整保留在[历史正文](development-history-20261028.md)，不要按旧的本机设置或“未实现”描述覆盖当前代码。

组内共享受阻时先看[共享入口与权限排障](collaboration/team-sharing.md)。GitHub源码、微信项目开发资格、云资源管理权限和业务账号分开核对，不用放开数据库或共享主账号来解决协作。

## 先确认运行的源码

从HX-Jan/MoodSky的最新main开始，不以旧v0.2.3标签、压缩包、本机同名副本或截图判断最新版。先查看状态与完整提交，保留自己的未提交改动：

```sh
git status --short
git rev-parse HEAD
git remote -v
```

Fork成员添加团队upstream，并在自己的任务分支推送；直接协作者使用团队origin。GitHub写权限与微信开发权限分开配置。当前七天气总数已含CUSTOM，风雨/暴雨合并到STORMY。

## 首次安装与本地检查

使用Node.js 24。克隆自己的Fork或团队仓库后，在仓库根目录执行：

```sh
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm run check
```

`setup`只在不存在时复制个人配置，并生成云函数共享副本，不覆盖已有个人配置。SDK依赖按锁文件安装；更改依赖需同时检查对应package.json和锁文件。后台另按[后台说明](../admin/README.md)安装与构建。

| 命令                        | 作用                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------- |
| npm run cloud:prepare       | 从miniprogram/shared生成云函数shared，不初始化SDK或连接云端                        |
| npm run check               | 代码、格式、结构、文档入口链接、类型和行为检查                                     |
| npm run team:check          | 无云权限的9组本地合成调用链，见[统一联调入口](../tools/team-integration/README.md) |
| npm run docs:check          | 检查维护入口中的本地文件链接，不访问远端网页                                       |
| npm run cloud:package       | 在本地生成完整云函数包，不部署                                                     |
| npm run cloud:database-plan | 按数据库设计生成配置清单，不应用索引或权限                                         |
| node scripts/check-cloud.js | 安装SDK后只验证加载和查询构造，不发送数据库查询                                    |

修改共享文件后先运行`npm run cloud:prepare`，再运行`npm run check`。生成副本被Git忽略；不要手改它、删断言或跳过结构检查来掩盖前后端差异。部分打包入口会在创建输出前拒绝陈旧副本。

## 同步与提交

有团队仓库写权限时：

```sh
git fetch origin
git switch main
git merge --ff-only origin/main
git switch -c fix/your-task
```

Fork按实际remote使用upstream/main；已有任务分支合并团队main后解决冲突。不要整包覆盖、强推main或改写其他成员历史。PR使用原周次和任务号，提交相关调用方、测试和约定，附真实检查与未完成项，详见[提交步骤](collaboration/submission-guide.md)。

[前两周索引](collaboration/README.md)是固定历史快照；后来的补交与审查查[后续收件记录](collaboration/updates.md)。[第三周60项台账](week3/README.md)只收本周，工时、点数和独立签认由实际人员填写。未通过审查的PR不能说成已合入。

## 小程序配置与本地演示

在微信开发者工具导入仓库根目录，团队AppID由project.config.json提供。`miniprogram/config/environment.local.js`不入Git，模板默认cloudEnabled:false、cloudEnvId为空、journalDemo:false。

只做本地内存演示时显式配置：

```javascript
module.exports = { cloudEnabled: false, cloudEnvId: '', journalDemo: true };
```

真实接口失败不会自动回退到演示。内存记录不保证关闭后保留；开发模式的诊断/合成偏好与团队体验模式不是同一界面。现有体验包固定0.2.3.1026/source c590247，后续源码合并不会自动更新手机包，见[体验记录](releases/experience-20261026.md)。

真实云能力和受限本人测试需要正确的服务端接线、身份/布局/索引条件及具体操作范围。旧探针/本人测试单次授权已经按原记录执行，不自动延期；本页不要求启用个人云配置、重新部署、写库或改资源。

## 存储服务和测试替身的当前接法

三个存储工厂均接收单个配置对象。通用数据库传`databaseFixture(...).db`；业务仓库、根数据库与事务tx各有接口，不能互换。特殊围栏测试有意不提供根文档操作，应沿用事务接线。彩色差异混排、导出任务返回值和删除账本pending/completed的具体排查见[存储排错](troubleshooting/storage-tests.md)。保留本节锚点供已有入口使用。

## 源码、构建与验收

先查[架构边界](architecture.md)、[接口](api.md)及[H01—H05交接](week3/xiang-hong/README.md)，再决定接入位置。正式默认入口、服务端显式候选、网页原型和测试替身不是同一运行环境。

本地/合成、SDK离线、模拟器、真实云、手机反馈和独立验收分别记录。角色/归属只从可信服务端身份获取，客户端不能提交ownerId、openid或role授权。后台Web登录也不能直接套用微信OPENID或浏览器角色来开放维护接口。

源码收录不表示功能已接入、云服务已部署或任务已验收。公开地点、联系方式与地图须核对真实来源/时效/坐标；未核验材料保持待复核。部署包、临时日志、密钥、私人正文和个人配置不提交仓库。
