# W2 YL05 第二周回归周报与第三周清单

- 负责人：Yuen Lin（[学号已隐去]）
- 报告日期：2026-10-24，Asia/Shanghai
- 基线提交：`ed1d76fd97312dd2a4bee0db87aed4e49a14f7eb`（0.2.3）
- 工作分支：`docs/yuen-lin-week2-delivery`（已推送；PR [#50](https://github.com/HX-Jan/MoodSky/pull/50)，quality CI 通过）
- 报告状态：工时/估点已由本人确认；待 Xiang Hong/Qizhen Cai 等复核人实际填写结论

## 1. 本周完成情况

| 任务                       | 交付物                                                                                                                                  | 实际结果                                                                                                         | 状态          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------- |
| W2 YL01 建立第二周工作基线 | [w2-yl01-baseline.md](w2-yl01-baseline.md)、[artifacts/yl01](artifacts/yl01/)                                                           | 同步最新 main；锁定依赖；593 项本地测试、lint/format/structure/typecheck、四项审计和云 SDK 检查通过；CI 基线成功 | 待复核        |
| W2 YL02 记录核心功能回归   | [w2-yl02-record-regression.md](w2-yl02-record-regression.md)、[w2-yl02-cases.csv](w2-yl02-cases.csv)、[artifacts/yl02](artifacts/yl02/) | 定向 144 项通过；覆盖保存、空正文、标签/码点、日期、旧记录、冲突、删除、重复点击、未知结果；真实云阻塞           | 待复核/阻塞   |
| W2 YL03 部署准备与健康验证 | [w2-yl03-deployment-health.md](w2-yl03-deployment-health.md)、[artifacts/yl03](artifacts/yl03/)                                         | 打包哈希与现网 0.2.3 完全一致；正式前端健康链路真实返回 `apiVersion=1`、`version=0.2.3`、请求号已记录            | 待复核        |
| W2 YL04 跨模块联调与设备   | [w2-yl04-integration-device.md](w2-yl04-integration-device.md)、[artifacts/yl04](artifacts/yl04/)                                       | 模拟器 8 项执行完成（7 项断言通过，1 项定位仅发起请求）；记录→回顾刷新、任务入口、偏好切换通过；真机未测         | 部分完成/阻塞 |
| W2 YL05 周回归结论与第三周 | 本文件、[w2-yl05-h05-return.csv](w2-yl05-h05-return.csv)                                                                                | 已测/失败/阻塞/未测分列；第三周输入已列                                                                          | 待复核        |

## 2. 验证数字（分环境，不混加）

| 项目              | 数字                               | 说明                                                                                             |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| 完整本地检查      | **593 通过 / 0 失败 / 0 跳过**     | [tests.tap](artifacts/yl01/tests.tap)；含 24 个需求 ID 结构检查                                  |
| 记录定向子集      | **144 通过 / 0 失败**              | [record-core-targeted.tap](artifacts/yl02/record-core-targeted.tap)；是 593 的子集，**不相加**   |
| 后台/校园定向子集 | **44 通过 / 0 失败**               | [admin-campus-targeted.tap](artifacts/yl04/admin-campus-targeted.tap)；**不相加**                |
| 模拟器检查        | **8 项执行 / 7 项通过 / 1 项部分** | [simulator-validation.json](artifacts/yl04/simulator-validation.json)；Campus 定位拒绝未取得结果 |
| 真实云端健康      | **1 次成功**                       | [health-frontend.json](artifacts/yl03/health-frontend.json)；仅健康只读，不代表私有业务          |
| 真实云端私有 CRUD | **0**                              | 生产域仍 `NOT_IMPLEMENTED`                                                                       |
| Android/iOS 真机  | **0**                              | 无设备/体验版；模拟器不计作真机                                                                  |

## 3. 学习内容与验证方法

- 用最新 main、锁文件和当前 CI 全门禁重建基线；第一次基线落后于远端时主动废弃并重跑。
- 用定向 TAP 与完整 TAP 分开记录；定向是完整套件子集，避免重复计数。
- 用 `npm run cloud:package` 生成完整包，按 SHA-256 与现网已部署候选逐文件比对，区分“可重复打包”和“已部署”。
- 用真实前端 `Me.runHealth()` 走 `services/api` → `wx.cloud.callFunction` 验证健康，不直接调用云函数、不注入响应。
- 用 `miniprogram-automator` 执行页面方法并读取结构化结果；明确 `journalDemo:true` 与 `cloudEnabled:false` 才走演示数据。
- 用固定业务日 2026-10-24 和合成账号验证日期窗口、版本推进与回顾刷新；不写真实日记。

## 4. 失败、阻塞与所需输入

| 编号   | 失败/阻塞                                | 影响                           | 所需输入/下一步                                   | 接收负责人               |
| ------ | ---------------------------------------- | ------------------------------ | ------------------------------------------------- | ------------------------ |
| W2-B01 | 生产 journal/review 仍 `NOT_IMPLEMENTED` | 真实云端记录闭环无法验收       | 正式处理器接入可信账号与数据库，按 C01—C14 复测   | Xiang Hong               |
| W2-B02 | 真实账号/唯一索引/布局/迁移未验证        | 同日唯一、账号隔离只有本地结论 | 提供真实测试账号与数据库配置证据                  | Jiawei Fang / Xiang Yu   |
| W2-B03 | 真实云并发冲突与超时未执行               | C06/C07/C11 只有本地离线结论   | 获批后在隔离环境固定批次执行                      | Xiang Hong / Qizhen Cai  |
| W2-B04 | Campus 定位拒绝未取得真实结果            | 只验证到请求发起               | 在模拟器/真机点击允许/拒绝并记录                  | Yuen Lin / Qinghan Zhang |
| W2-B05 | 真实 Web 身份与后台角色未联调            | 后台保存失败只有本地测试       | Qizhen Chen/Junhan 提供真实入口                   | Qizhen Chen / Junhan     |
| W2-B06 | Android/iOS 真机不可用                   | 设备兼容、弱网、权限未验证     | 提供设备与体验版；iOS 使用手机微信预览/体验版验证 | 用户 / @HX-Jan           |
| W2-B07 | 模拟器截图未取得                         | 只有结构化 JSON                | 需要可视化证据时在可见面板补截图                  | Yuen Lin                 |
| W2-B08 | 全链路性能未按 20 次采样                 | 不能报告性能达标               | 按 Qizhen Cai 方案采样，至少 20 次                | Qizhen Cai / Yuen Lin    |

本次没有发现由 Yuen Lin 新引入的产品缺陷；没有修改业务源码、数据库、云资源或共享契约。

## 5. F01—F24 与用例目录关联

| 功能段          | 本次证据                                                                 | 状态                                           |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| F01—F04/T01—T04 | 记录定向 144 项、模拟器保存/重进/编辑、YL02-C01—C14                      | 本地/离线通过；真实云阻塞                      |
| F05—F10/T05—T10 | review-backend、review-week2、review-store-invalidation、模拟器 Universe | 本地通过；真实回顾接口阻塞；装饰完整素材未接入 |
| F11—F16/T11—T16 | campus-week-two 定向、页面入口；定位拒绝仅本地注入测试                   | 本地部分通过；真实定位/地图/后台阻塞           |
| F17—F19/T17—T19 | tasks-demo/cloud/integration；模拟器任务入口 3 条建议、游客禁写          | 本地+模拟器通过；真实任务后端阻塞              |
| F20/T20         | 今日入口与轻选择入口在现有页面路径中可见                                 | 本地部分；真实入口未完整联调                   |
| F21—F24/T21—T24 | Me 偏好/账号切换/导出/注销本地测试；固定模拟天气说明                     | 本地通过；真实导出/清理/账号后端阻塞           |

S01—S06 的本地场景在 YL02 中复用；N 编号只使用设计稿 N01—N06，没有新增 `needs.*` 或 `n01.*`—`n08.*` 接口；N07—N08 仍无定义，保持阻塞。

## 6. 第三周回归输入

| 编号 | 回归项                                        | 前置                                                | 负责人                         |
| ---- | --------------------------------------------- | --------------------------------------------------- | ------------------------------ |
| R01  | 重跑完整检查、类型检查、四项审计和云 SDK 检查 | 最新 main + 干净依赖                                | Yuen Lin                       |
| R02  | 真实云保存/读取/编辑/删除与同日唯一           | 正式 journal 处理器 + 真实账号                      | Yuen Lin / Xiang Hong          |
| R03  | 真实云版本冲突、未知结果重试、删除重建        | 双客户端/版本注入 + 真实数据库                      | Yuen Lin / Xiang Hong          |
| R04  | 真实云回顾月历/档案/详情刷新                  | 正式 review 读取                                    | Yuen Lin / Zhifeng Dai         |
| R05  | 真实账号 A/B/disabled 与越权删除              | 可信身份适配器                                      | Yuen Lin / Jiawei / Qizhen Cai |
| R06  | Campus 定位允许/拒绝、地图失败、失效资料      | Qinghan 页面与真实资料                              | Yuen Lin / Qinghan Zhang       |
| R07  | 任务建议/状态/历史真实接口                    | JF02 正式后端                                       | Yuen Lin / Qizhen Chen         |
| R08  | Me 偏好、导出、注销进度真实链路               | JF03/JF04/XY03/XY04 执行器                          | Yuen Lin / Linghan / Xiang Yu  |
| R09  | 后台 Web 身份、角色与保存失败反馈             | QC03/JH03 真实入口                                  | Yuen Lin / Qizhen Chen         |
| R10  | Android/iOS 真机主流程与弱网                  | 体验版、体验成员、设备                              | Yuen Lin / 用户                |
| R11  | 首屏与关键路径性能采样（≥20 次）              | 设备、固定数据集、测量方法                          | Yuen Lin / Qizhen Cai          |
| R12  | 分支 PR、CI 与发布候选门槛核对                | PR #50 已推送，quality CI 通过；待 @HX-Jan 合入审批 | Yuen Lin / Xiang Hong          |

## 7. 发布候选建议

- **不建议**把当前版本作为“真实私人业务可发布候选”：生产记录/回顾域仍返回 `NOT_IMPLEMENTED`，真实数据库与真机没有证据。
- 可以作为**本地回归候选**进入 PR 评审：当前 main 的 593 项检查、正式健康 0.2.3 和打包哈希一致。
- 是否满足发布门槛最终由 Xiang Hong 与用户确认；本报告不代替拥有者审批，也不把本地通过扩大为云端完成。

## 8. 个人周报

| 项目                   | 内容                                                                                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本周任务编号及成果链接 | YL01—YL05，见第 1 节与 [README](README.md)                                                                                                                                                                                                                        |
| 本人补交的第一周内容   | 无；第一周 YL01—YL05 已由 PR #25 合入                                                                                                                                                                                                                             |
| 复核人和验收结论       | YL01：Xiang Hong / Qizhen Cai；YL02：Xiang Hong / Yifan Ji / Zhifeng Dai / Qizhen Cai；YL03：Xiang Hong / Xiang Yu；YL04：Yifan Ji / Zhifeng Dai / Linghan Chen / Qinghan Zhang / Qizhen Chen / Qizhen Cai；YL05：Xiang Hong / Qizhen Cai。结论待实际复核人填写。 |
| 实际耗时（人时）       | **4h（第二周，本人确认）**                                                                                                                                                                                                                                        |
| 学习内容与验证方法     | 见第 3 节                                                                                                                                                                                                                                                         |
| 已测与未测环境         | 本地/离线/模拟器已测；真实云私有业务、真机未测                                                                                                                                                                                                                    |
| 失败或阻塞及所需输入   | 见第 4 节                                                                                                                                                                                                                                                         |
| 第三周任务依赖         | 见第 6 节                                                                                                                                                                                                                                                         |
| 完整项目估点修订       | **W2 任务难度点 2/5/3/3/2，合计 15；第三周候选估点 15（真实云记录闭环 5、部署健康复测 2、跨模块与设备 3、权限生命周期 3、CI/报告 2）**                                                                                                                            |

## 9. 证据索引

- 基线：[w2-yl01-baseline.md](w2-yl01-baseline.md)、[artifacts/yl01](artifacts/yl01/)
- 记录回归：[w2-yl02-record-regression.md](w2-yl02-record-regression.md)、[w2-yl02-cases.csv](w2-yl02-cases.csv)、[artifacts/yl02](artifacts/yl02/)
- 部署与健康：[w2-yl03-deployment-health.md](w2-yl03-deployment-health.md)、[artifacts/yl03](artifacts/yl03/)
- 跨模块与设备：[w2-yl04-integration-device.md](w2-yl04-integration-device.md)、[artifacts/yl04](artifacts/yl04/)
- H05 回传：[w2-yl05-h05-return.csv](w2-yl05-h05-return.csv)
- 发布材料：[PR-body.md](PR-body.md)、[UPLOAD-CHECKLIST.md](UPLOAD-CHECKLIST.md)；已推送 PR [#50](https://github.com/HX-Jan/MoodSky/pull/50)，CI 证据 [pr-50-status.txt](artifacts/yl01/pr-50-status.txt)
- 规则：`E:\MoodSky\每次生成和上传都需要遵守的规则.md`（本地工作规则，不进入仓库）

## 10. 结论

- 第二周测试侧工作已完成到当前权限允许的范围：最新基线、记录回归、部署核对、真实健康、模拟器跨模块检查和周报。
- 真实云端私有记录、真实数据库约束、后台 Web 身份和 Android/iOS 真机没有通过结论；所有缺口已列负责人和下一步。
- 已按用户确认推送分支并创建 PR #50，quality CI 通过；没有部署云函数、上传小程序、写数据库或执行清理；合入仍需 @HX-Jan 审批。
