# PR：docs(alpha-yl): C1 共同回归矩阵、候选装配与成员复核

Refs #208

## 本次改动

交付周次：Alpha C1（2026-11-21—11-22）。
本人姓名 / 实际 GitHub 账号：Yuen Lin / Yuminu。
任务编号：AS-YL01、AS-YL02。
基线完整 SHA：`36ff7f54476ff19cbacba7238b11ee34a5adcdf6`。
具体行为与涉及模块：仅新增 `docs/alpha/yuen-lin/c1-20261122/`；未修改业务源码、云函数、数据库、导航、CI、共享契约或成员文件。

包含：

- AS-YL01 共同回归矩阵：完整 1691/1691、7 组定向 1258 项、9 组团队联调、8 组生产装配、CI 链接、问题单与未测项；
- AS-YL02 本地候选：从干净 `36ff7f5` 装配 `0.5.3 / closed`，13 页 / 4 底栏、183 个客户端哈希、两支云包 3+4 文件、193 文件 / 1,165,385 字节、入口表与预览步骤；
- 对 #198/#185/#186/#199/#200/#201/#202/#203/#204/#205/#206/#207/#216/#235 的共同复核意见与原始复跑日志；
- 成员材料独立复跑：Linghan 49/49、Qinghan 59/59、Zhifeng c1—c4 40/25/41/60、Qizhen Chen 24 行 + 4 条未知结果、Xiang Yu 14/14、Junhan 12 组逐字节一致、Jiawei 22/22、Yifan 37/37。

## 实际验证

在 `36ff7f5` 运行：

- `npm ci`、`npm run setup`、`npm ci --prefix cloudfunctions/moodsky`、`npm run cloud:prepare`；
- `npm run check`：**1691/1691**，fail 0、skipped 0；
- `node scripts/check-cloud.js`、`npm audit --audit-level=high --prefix cloudfunctions/moodsky`；
- `npm run team:check`（9 组）、`npm run team:check:production`（8 组）、`git diff --check`；
- 七组定向：177/155/272/124/244/220/66，合计 1258，全部通过（完整集子集，不重复加总）。

以上退出码均为 0。原始输出在 `docs/alpha/yuen-lin/c1-20261122/artifacts/`。

## 候选边界

- 候选目录在工作区外：`E:\MoodSky\alpha-yuen-lin-candidate-36ff7f5`，`sourceWorktreeDirty=false`。
- `uploaded/deployed/cloudLifecycleVerified/phoneVerified/submittedForReview/publicRelease` 全部 `false`。
- 未上传云函数、未部署、未写数据库、未清理、未上传微信体验版/正式版。
- 备案与微信认证为 `not-checked-by-packager`。

## 隐私与内容安全影响

| 项目                                 | 本次变化、依据及未完成项                     |
| ------------------------------------ | -------------------------------------------- |
| 信息字段、来源、用途和可见范围       | 无新增字段或采集；仅文档、测试日志与候选清单 |
| 接口/权限、SDK/插件及数据流向        | 未改接口/权限/SDK；未连接真实云              |
| 告知、同意、拒绝及撤回/用途变更      | 不适用：验证与文档                           |
| 保存、导出、删除、注销、日志和备份   | 未执行；仅记录既有测试与阻塞                 |
| 隐私/UGC/审核机制/类目声明及生效证据 | 未新增；未声称平台审核                       |
| 客户端/后端构建、验证结果和发布阻塞  | 本地通过；目标云、真机、平台与独立验收仍阻塞 |

## 边界与待办

- 真实微信登录、目标云、真机、真实文件送达、平台后台与发布未执行，保持阻塞。
- PR #236 需恢复 `synthetic-records.json` 并提供仓库内可核证据；Yifan AS-YF02 未回传。
- JQ-C1-02、JQ-C1-03、Qinghan 原生右侧选点/返回、Junhan 动态停用仍待模块负责人处理。
- 本 PR 为资料与验证，不改变业务数据、功能开关或发布状态。

## 复核请求

请洪翔核对 AS-YL01 的检查口径、AS-YL02 的候选指纹与入口表，以及各成员复核结论是否可作为 C1 独立意见；真实云/真机/平台仍按阻塞保留。
