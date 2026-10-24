# W2 · Yuen Lin —— 功能回归、自动检查与测试部署

- 学号：832401211
- 任务：W2 YL01—YL05（依据 `MoodSky_第二周详细任务计划_20261017.docx` 与 `docs/week2/README.md`）
- 代码基线：`ed1d76fd97312dd2a4bee0db87aed4e49a14f7eb`（`origin/main`，0.2.3）
- 工作分支：`docs/yuen-lin-week2-delivery`（已推送；PR [#50](https://github.com/HX-Jan/MoodSky/pull/50)，quality CI 通过）
- 岗位主责：`tests/` 中的功能、集成与异常回归；CI/自动检查；测试部署清单与部署后只读健康验证

## 成果清单

| 编号 | 任务                   | 交付物                                                                                                                                  | 当前状态                                  |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| YL01 | 建立第二周工作基线     | [w2-yl01-baseline.md](w2-yl01-baseline.md)、[artifacts/yl01](artifacts/yl01/)                                                           | 本地完成；593 项通过；CI 基线成功；待复核 |
| YL02 | 记录核心功能回归       | [w2-yl02-record-regression.md](w2-yl02-record-regression.md)、[w2-yl02-cases.csv](w2-yl02-cases.csv)、[artifacts/yl02](artifacts/yl02/) | 本地/离线完成；真实云阻塞；待复核         |
| YL03 | 部署准备与健康验证     | [w2-yl03-deployment-health.md](w2-yl03-deployment-health.md)、[artifacts/yl03](artifacts/yl03/)                                         | 打包核对与真实健康完成；未部署；待复核    |
| YL04 | 跨模块联调与设备检查   | [w2-yl04-integration-device.md](w2-yl04-integration-device.md)、[artifacts/yl04](artifacts/yl04/)                                       | 模拟器部分完成；真机阻塞                  |
| YL05 | 周回归结论与第三周清单 | [w2-yl05-week-report.md](w2-yl05-week-report.md)、[w2-yl05-h05-return.csv](w2-yl05-h05-return.csv)                                      | 本地完成；PR #50 待复核                   |

## 本次关键结果

- 最新 main `ed1d76f`、0.2.3：**593 项本地测试通过 / 0 失败**；lint、格式、结构、TypeScript、四项依赖审计和云 SDK 检查通过。原始 TAP 见 [tests.tap](artifacts/yl01/tests.tap)。
- 记录定向子集 **144 项通过**，是 593 的子集，不重复相加；证据见 [record-core-targeted.tap](artifacts/yl02/record-core-targeted.tap)。
- 部署包三文件 SHA-256 与现网 0.2.3 完全一致；正式前端 `Me.runHealth()` 真实返回 `apiVersion=1`、`version=0.2.3`、请求号 `req_mvmj4sh6_2_2bbla7dt`。证据见 [health-frontend.json](artifacts/yl03/health-frontend.json)。
- 模拟器 8 项检查执行完成：保存、重进、编辑、回顾刷新、偏好切换、任务入口通过；Campus 定位只验证到请求发起，未取得拒绝/允许结果。
- Android/iOS 真机 **未测**；真实云端私有记录/回顾仍为 `NOT_IMPLEMENTED`。

## 环境分列

| 环境                 | 结果                                                 |
| -------------------- | ---------------------------------------------------- |
| 本地单元/内存替身    | 593 项完整通过；记录 144 项、后台/校园 44 项定向通过 |
| 锁定 SDK 离线替身    | 事务、回执、并发、回滚路径通过；未发网络请求         |
| 微信开发者工具模拟器 | 8 项执行完成；7 项断言通过；1 项定位仅请求发起       |
| 真实云端测试环境     | 健康只读 1 次成功；私有业务与数据库写入未执行        |
| Android/iOS 真机     | 0；无设备/体验版，模拟器不计作真机                   |

## 当前阻塞

| 阻塞                                         | 所需输入/下一步                                 | 接收负责人               |
| -------------------------------------------- | ----------------------------------------------- | ------------------------ |
| 生产 `journal`/`review` 仍 `NOT_IMPLEMENTED` | 正式处理器接入可信账号与数据库后复测            | Xiang Hong               |
| 真实账号、唯一索引、布局/迁移未验证          | 提供真实测试账号与数据库配置证据                | Jiawei Fang / Xiang Yu   |
| 真实云并发冲突与超时未执行                   | 获批后在隔离测试环境固定批次执行                | Xiang Hong / Qizhen Cai  |
| Campus 定位拒绝未取得真实结果                | 在模拟器/真机点击允许/拒绝并记录                | Yuen Lin / Qinghan Zhang |
| 真实 Web 身份与后台角色未联调                | 提供真实 Web 入口                               | Qizhen Chen / Junhan     |
| Android/iOS 真机不可用                       | 体验版、体验成员与设备；iOS 需 macOS/TestFlight | 用户 / @HX-Jan           |
| 全链路性能未按 ≥20 次采样                    | 固定设备、数据集和测量方法                      | Qizhen Cai / Yuen Lin    |

## 复核与验收（复核意见由实际复核人填写）

| 项目                   | 内容                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 提交版本 / PR          | PR [#50](https://github.com/HX-Jan/MoodSky/pull/50)；commit `3855a6e`；基线 `ed1d76f`；quality CI 通过（run `40106848494`）                                                                                                               |
| 复核人（按第二周分工） | YL01：Xiang Hong / Qizhen Cai；YL02：Xiang Hong / Yifan Ji / Zhifeng Dai / Qizhen Cai；YL03：Xiang Hong / Xiang Yu；YL04：Yifan Ji / Zhifeng Dai / Linghan Chen / Qinghan Zhang / Qizhen Chen / Qizhen Cai；YL05：Xiang Hong / Qizhen Cai |
| 复核/验收结论          | 待上述复核人实际确认                                                                                                                                                                                                                      |
| 实际耗时（人时）       | **4h（第二周，本人确认）**                                                                                                                                                                                                                |
| 后续任务估点           | **W2 任务难度点 2/5/3/3/2，合计 15；第三周候选估点 15（真实云记录闭环 5、部署健康复测 2、跨模块与设备 3、权限生命周期 3、CI/报告 2）**                                                                                                    |

## 边界

- 本次没有修改业务源码、共享契约、数据库、云资源、CI 或导航；只新增 `docs/week2/Yuen_Lin/`。
- 已推送 GitHub 分支并创建 PR #50；没有部署云函数、上传体验版/正式版、写数据库或执行清理。
- 真实健康验证使用临时个人配置（已恢复，哈希一致）；个人配置不进入提交。
- 所有测试数据为合成或演示数据；未记录真实身份、私人日记、令牌或管理员凭证。
- `miniprogram-automator 0.13.0` 仅安装在系统临时目录，不进入仓库依赖或 CI。
