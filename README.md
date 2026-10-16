# MoodSky

MoodSky 是 12 人团队的原生 JavaScript 微信小程序项目。四个主页面为 Today、Campus、Weather Universe 和 Me。

当前包含四页导航、共享接口骨架，以及可操作的 Today 记录表单：天气、标签、正文、保存修改、删除确认、失败重试和日期切换。显式开启本地演示时，记录只在内存中保留。真实账号映射、云端记录、导出和注销仍待实现，正式接口继续明确返回 NOT_IMPLEMENTED。

2026-10-15 已整合 Xiang Yu 在 Phoenix-Yx/MoodSky 的第一周五份文档：数据字典、约束验证、导出流程、清理恢复及合成数据交接，并对齐字段、错误码、删除失效和实验边界。最新状态见[第一周成果索引](docs/week1/README.md)和[本次整合报告](docs/test-reports/2026-10-15/README.md)。

## 从这里开始

1. 阅读[组员开发步骤](docs/development.md)和[协作规定](CONTRIBUTING.md)。
2. 在[模块分工表](docs/team.md)找到自己的目录，在 GitHub Issues 领取或创建任务。
3. 当前执行分工日期为2026-10-12：导出与清理执行由Xiang Yu负责，Jiawei保留账号入口和进度；Qizhen Chen负责后台界面及Web登录接入，Junhan负责后台业务；Linghan负责前端集成，Yuen负责CI和测试部署。
4. 对照[最终需求基线](docs/requirements.md)、[架构说明](docs/architecture.md)和[接口约定](docs/api.md)开始实现。

安装 Node.js 24，克隆仓库后执行：

```sh
git clone https://github.com/HX-Jan/MoodSky.git
cd MoodSky
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm run check
```

然后使用微信开发者工具导入此目录。项目已配置 MoodSky 团队 AppID；成员仍需获得对应小程序开发权限。云服务默认关闭；Today 表单会准确提示服务未连接。需要体验表单时使用下方的显式内存演示；真实云端联调见[云配置步骤](docs/development.md#云端联调)。

## 体验 Today 表单

在被 Git 忽略的 miniprogram/config/environment.local.js 中设置：

```javascript
module.exports = { cloudEnabled: false, cloudEnvId: '', journalDemo: true };
```

在微信开发者工具中编译后，可以选择天气、标签、写正文、保存修改、删除、切换日期，并体验连接失败后的原操作重试。页面会明确显示“本地演示”；数据不写云端或本地 Storage，退出页面实例或重新编译后不保证保留。真实云连接失败时不会自动切换为演示。

## 目录与边界

| 目录                             | 用途                                                   |
| -------------------------------- | ------------------------------------------------------ |
| miniprogram/pages/               | 四个主页面；不要各自另建导航入口                       |
| miniprogram/modules/             | journal、review、campus、tasks、account 前端模块       |
| miniprogram/components/、styles/ | 公共组件与设计变量                                     |
| miniprogram/shared/              | 唯一共享来源：天气、标签、限制、日期、接口、错误和类型 |
| miniprogram/services/api.js      | 唯一云函数调用入口                                     |
| cloudfunctions/moodsky/domains/  | 按记录、回顾、校园、任务、账号和资料管理拆分的服务骨架 |
| database/                        | 集合、索引与客户端权限设计；测试环境基础结构已部署     |
| admin/                           | 校园资料后台预留入口                                   |
| tests/                           | 接口、权限门禁、日期和输入边界测试                     |
| docs/、.github/                  | 团队文档、Issue/PR 模板、代码归属与 CI                 |

前端通过统一服务调用云函数；云函数从可信微信调用上下文取得身份，再检查内部账号、归属与运营权限。共享代码由命令复制进云函数部署目录，禁止手工维护第二份。

## 协作入口

main 是稳定分支。每人一个任务分支，通过 Pull Request 合并，使用 Squash 保持提交历史清晰。普通成员的更新须由仓库拥有者 @HX-Jan 审批；@HX-Jan 自己的更新无需其他成员批准。所有更新仍须通过 quality 检查、与最新主分支一致并处理完评审讨论；禁止强推和删除主分支。

公开仓库让组员可以立即 Fork、开发并提交 PR。直接推送任务分支需要负责人邀请实际 GitHub 账号；访问公开仓库不会自动获得写权限。不要共享 GitHub 或微信主账号。

## 当前验证范围

npm run check 检查代码、格式、路由、24 项需求映射、共享代码一致性以及关键接口边界。CI 同时安装云 SDK 并检查入口加载。2026-10-13 已在微信开发者工具模拟器中验证四页显示、原生 switchTab 导航及默认隐私状态，22 项本地测试和云 SDK 加载检查通过，详见[测试报告与四页截图](docs/test-reports/2026-10-13/README.md)。

2026-10-14 已完成 mood-sky 测试环境的基础部署：moodsky 云函数真实调用正常，15 个空集合及 7 组唯一索引已建立，全部集合的小程序直接读取均被拒绝。详见[基础部署核验报告](docs/test-reports/2026-10-14/README.md)。个人云环境配置不提交仓库，新成员仍需按开发步骤配置本地环境。

2026-10-15 整合后本地 124 项测试通过；Today 第二版在隔离内存演示中完成 34 项模拟器检查。正式健康入口的附带字段兼容修正、H03 报告留存及并发诊断代码已纳入源码，本次 GitHub 同步不部署这些代码。线上健康入口最近一次仍返回 INVALID_REQUEST；H03 真实报告为 12 项通过、5 项失败，尚未证明并发写入修复。详见[最新验证报告](docs/test-reports/2026-10-15/README.md)。

真实日记保存、导出、账号清理及资料后台等业务适配器仍待开发，手机真机效果尚未验收，小程序未上传体验版或发布正式版。模拟器与基础部署验证不代表业务验收完成。

项目采用原生小程序云函数调用方式，参考[腾讯云开发官方接入文档](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)。分支保护依据 [GitHub 官方说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)设置。
