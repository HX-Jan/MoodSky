# MoodSky

MoodSky 是 12 人团队的原生 JavaScript 微信小程序项目。四个主页面为 Today、Campus、Weather Universe 和 Me。

当前源码版本为 **0.2.1 开发预览版**。在 0.2.0 基础上，先修正并合入 Qizhen Chen 的 #14，再审查整合新到的 Jiawei Fang #16；Yifan 的 #11 因五份文档仍为空而关闭，源分支保留，补齐后可重新打开。更新内容、验证及限制见 [本次整合报告](docs/test-reports/2026-10-17-pr-followup/README.md)与 [版本记录](CHANGELOG.md)。GitHub 源码发布不等同于微信体验版、正式版或云函数部署。

当前包含四个主页面、私人记录子页及共享接口骨架。Today 支持天气快选、标签/正文、保存修改、删除确认、失败重试、日期切换和确认写入后的跨页刷新；显式演示仅在内存保存。Campus 有固定虚构天气，Me 有本地合成账号、偏好、导出和注销进度演示。真实账号映射、云端记录、导出和注销仍待实现，正式业务接口继续明确返回 NOT_IMPLEMENTED。

2026-10-15 已整合 Xiang Yu 在 Phoenix-Yx/MoodSky 的第一周五份文档：数据字典、约束验证、导出流程、清理恢复及合成数据交接，并对齐字段、错误码、删除失效和实验边界。2026-10-16 又按先审查成员 PR、再整合发布的顺序合入 #9、#8、#7，并纳入 11 份协作交接说明。最新状态见[第一周成果索引](docs/week1/README.md)和[最新整合报告](docs/test-reports/2026-10-16-integration/README.md)。

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

在微信开发者工具中编译后，Today 可快存天气，也可从“想写几句”进入私人页填写标签和正文；确认保存/删除后返回可刷新卡片。正文默认隐藏。支持日期切换、冲突确认和原操作重试。页面明确显示“本地演示”；日记仅在共享内存会话保留，重启运行时或清除演示后丢失，不写云端或本地 Storage。真实云连接失败时不会自动切换为演示。

Me 单独演示本地合成账号，偏好和任务状态写入本机缓存；停用或完成注销后，重开页面仍保持相应状态，只有“重置演示”恢复。导出内容仅为合成偏好及空日记列表。它没有接入微信账号、Today 偏好或真实云端注销。Campus 五种天气固定虚构，地点资料仍待核验。

同一显式演示模式下，Universe 现在提供月历、月份档案、本人详情、7/30/90 天分布与时间线、0/2/3 条固定样例及装饰降级。Today 保存/删除后会刷新回顾视图；档案与统计不携带正文，详情按记录 ID 重读。种子和新记录均为当前内存会话的合成数据，关闭演示不会回退到这些内容。设计包的暴雨、台风、自定义天气仅为待确认提案，工程仍保持五类天气。

Me 新增“小任务 · 本地演示”入口：同一显式演示配置下可浏览三条合成建议，切换合成登录后演示选择、完成、替换、跳过及历史；退出隐藏私人状态，离开任务页丢弃该页内存。默认未连接模式不会显示这些合成内容。后台 [admin/index.html](admin/index.html) 可直接打开体验四类本地表单；真实 Web 登录、角色映射和业务提交仍待验证，真实资料提交保持关闭，操作说明见 [后台说明](admin/README.md)。

## 目录与边界

| 目录                             | 用途                                                   |
| -------------------------------- | ------------------------------------------------------ |
| miniprogram/pages/               | 四个主页面及私人记录子页；主导航统一维护               |
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

0.2.1 整合及整体优化后完整本地 **234 项测试通过**，实际微信模拟器 **17 项检查通过**；两组数字各自统计，不相加。#14、#16 均经拥有者复核和 GitHub quality 检查后合入。整体复核修正了响应互斥、合成账号重开状态和 Me 迟到检查覆盖问题，见 [复核记录](docs/test-reports/2026-10-17-pr-followup/whole-project-review.md)。新增页面/账号门禁均使用合成数据或本地替身；Web SDK、任务契约、偏好与清理方案仍有待确认项，详见 [整合报告](docs/test-reports/2026-10-17-pr-followup/README.md)。

0.2.0 合并前的完整本地检查为 **185 项测试通过**，包括成员 11 项回顾服务检查、整合新增 9 项页面/异步回归，以及拥有者新增 16 项候选与 SDK 离线检查。当前模拟器、类型、设计导入器及发布门禁分别登记在 [本次发布报告](docs/test-reports/2026-10-16-release/README.md)，不与下列历史次数混算。

2026-10-16 整合后的完整本地检查为 149 项测试通过；另有 27 项整合模拟器检查通过。成员 PR、修正、截图和证据边界见[最新整合报告](docs/test-reports/2026-10-16-integration/README.md)。以下保留原日期的历史验证结果。

npm run check 检查代码、格式、路由、24 项需求映射、共享代码一致性以及关键接口边界。CI 同时安装云 SDK 并检查入口加载。2026-10-13 已在微信开发者工具模拟器中验证四页显示、原生 switchTab 导航及默认隐私状态，22 项本地测试和云 SDK 加载检查通过，详见[测试报告与四页截图](docs/test-reports/2026-10-13/README.md)。

2026-10-14 已完成 mood-sky 测试环境的基础部署：moodsky 云函数真实调用正常，15 个空集合及 7 组唯一索引已建立，全部集合的小程序直接读取均被拒绝。详见[基础部署核验报告](docs/test-reports/2026-10-14/README.md)。个人云环境配置不提交仓库，新成员仍需按开发步骤配置本地环境。

2026-10-15 整合后本地 124 项测试通过；Today 第二版在隔离内存演示中完成 34 项模拟器检查。正式健康入口的附带字段兼容修正、H03 报告留存及并发诊断代码已纳入源码，本次 GitHub 同步不部署这些代码。线上健康入口最近一次仍返回 INVALID_REQUEST；H03 真实报告为 12 项通过、5 项失败，尚未证明并发写入修复。详见[最新验证报告](docs/test-reports/2026-10-15/README.md)。

真实日记保存、导出、账号清理及资料后台等业务适配器仍待开发，手机真机效果尚未验收，小程序未上传体验版或发布正式版。模拟器与基础部署验证不代表业务验收完成。

项目采用原生小程序云函数调用方式，参考[腾讯云开发官方接入文档](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)。分支保护依据 [GitHub 官方说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)设置。
