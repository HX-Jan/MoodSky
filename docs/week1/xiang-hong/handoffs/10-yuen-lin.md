# MoodSky 第一周 Yuen Lin 协作交接

提供人：Xiang Hong。接收人：Yuen Lin。任务：W1 YL01—YL05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请据已有代码和真实证据建立可复现基线，准备第二周优先用例，并把未测、失败与阻塞如实分列。

## 我提供的版本 环境和证据

| 项目         | 提供的信息                                                       | 如何使用                                                |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------- |
| 团队项目     | HX-Jan/MoodSky；AppID wxf602e991ff44e6c8                         | 导入 MoodSky 仓库根目录；成员使用自己的微信开发者账号。 |
| 测试环境     | mood-sky / mood-sky-d5gqy3spkff37566d                            | 仅用于获批的测试；权限不足时交 Xiang Hong 协调。        |
| 运行时与 SDK | 本地 Node.js 24；已记录云运行时 Nodejs16.13；wx-server-sdk 4.0.2 | 本地版本和云运行时分别记录；按锁文件安装依赖。          |

本包基线为 a75e207，历史整合报告记载 124 项本地测试通过及 Today 第二版累计 34 项模拟器检查；不是本次重新运行，也不等于真机或真实日记云端闭环通过。正式健康接口最近的已记录结果仍为 INVALID_REQUEST，本地兼容源码尚未部署。

## 本地复核步骤

```powershell
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm run cloud:prepare
npm run check
node scripts/check-cloud.js
```

记录自己的提交号、Node/npm、开发者工具、设备和执行时间。check-cloud.js 只验证 SDK 加载与查询构造；这些命令不发送真实数据库写入。若已有未提交内容先保留，避免以同步主分支为名覆盖队友工作。

| 第二周优先用例     | 给你的前置或预期                                                             |
| ------------------ | ---------------------------------------------------------------------------- |
| 正常保存与空正文   | 天气必选，标签正文可空；完整 payload、data.entry 和 expectedVersion 按 H02。 |
| 标签和正文限制     | 标签最多 5 个固定值；正文 1000 码点；中文、emoji、1001 码点分别记录。        |
| 日期边界           | 固定今天 2026-10-15：09-16 可新建，09-15 不可新建；已有旧记录仍可编辑。      |
| 版本冲突           | 客户端持有旧版本；拒绝覆盖、保留草稿，重新读取前确认放弃输入。               |
| 删除               | 携带当前正版本；冲突不误删；无记录 deleted:false；关联失效另列集成验收。     |
| 重复点击和网络失败 | 保存中禁止重复提交；失败保留输入；不确定结果重试复用原 ID 和 payload。       |

## 部署准备与实际部署的分界

部署前可本地执行 npm run cloud:package，检查完整目录中的 index.js、package.json、package-lock.json 和 SDK 锁定版本。实际上传、修改云配置、数据库操作及 H03 实验需要按已有审批边界另行批准；本交接不发起这些操作。数据库由 Xiang Yu 配置，平台权限由 Xiang Hong 协调。

正式获批部署后，核对目标 mood-sky / moodsky，记录创建完成与代码上传成功，再通过正常前端请求读取 system.health，核对版本与 requestId。上传成功或 cloudReady:true 均不能代替健康响应。moodsky-h03-probe 是隔离技术测试函数，不能作为正式 moodsky 的健康证明。

## 你需要交回什么

- YL01 独立本地检查和 CI 记录；YL02 F01—F24 对应 T01—T24 的目录，关联 S/N/X，至少八条详细优先用例。
- YL03 部署清单与真实执行状态；YL04 四页、表单、定位拒绝、空月、Me 处理中和身份联调证据；失败写复现步骤。
- YL05 Android/iOS 设备覆盖、已测/失败/未测、修复复测和第二周回归表。模拟器与真机分列。

用例回传包含编号、前置、步骤、预期、实际、环境、证据、负责人及状态；缺陷先登记给对应成员，再由负责人安排修复。

## 共同回传格式与提交方法

每项交付请带：任务编号、成果路径或 PR、实际使用的提交版本、环境类型、预期和实际、复核意见、实际耗时、后续任务点数、阻塞与下一步。状态采用待开始、进行中、待复核、已验收、阻塞。接收与验收意见由本人实际确认后填写。

成果放 docs/week1/本人目录；修改代码时同步相关 service、校验与测试，检查通过后提交本人分支的 PR。成员 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再同步主分支、整合和发布。共享接口、数据库或导航变更交对应负责人共同复核。

本包仅整理已有资料和本地样例，未发消息、上传 GitHub、部署、修改云资源、执行新云端写入或清理。后续操作仍按已约定范围办理。管理员登录由本人手动完成，管理员密码、微信身份、指纹和凭证不进入公共文档。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [项目导入和本地演示方法](../../../development.md)：`docs/development.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/development.md)。
- [H01 环境与权限登记](../w1-h01.md)：`docs/week1/xiang-hong/w1-h01.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h01.md)。
- [H02 记录接口审查草稿](../w1-h02.md)：`docs/week1/xiang-hong/w1-h02.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h02.md)。
- [H03 可靠写入与删除设计](../w1-h03.md)：`docs/week1/xiang-hong/w1-h03.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h03.md)。
- [H04 回顾接口待审草稿](../w1-h04.md)：`docs/week1/xiang-hong/w1-h04.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h04.md)。
- [H04 十组合成输入输出](../w1-h04-examples.json)：`docs/week1/xiang-hong/w1-h04-examples.json`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h04-examples.json)。
- [H05 验收与估点收集草稿](../w1-h05.md)：`docs/week1/xiang-hong/w1-h05.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h05.md)。
- [全员任务回传表](../w1-h05-task-intake.csv)：`docs/week1/xiang-hong/w1-h05-task-intake.csv`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h05-task-intake.csv)。
- [2026 年 10 月 15 日成果与证据边界](../../../test-reports/2026-10-15/README.md)：`docs/test-reports/2026-10-15/README.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/test-reports/2026-10-15/README.md)。
- [H03 真实隔离批次报告](../w1-h03-report-retention-validation.md)：`docs/week1/xiang-hong/w1-h03-report-retention-validation.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h03-report-retention-validation.md)。
- [Today 日期 冲突与重试本地测试](../../../../tests/today-controller.test.js)：`tests/today-controller.test.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/tests/today-controller.test.js)。
- [成员 PR 与整合发布顺序](../../../../CONTRIBUTING.md)：`CONTRIBUTING.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/CONTRIBUTING.md)。
