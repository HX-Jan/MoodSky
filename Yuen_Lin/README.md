# W4 · Yuen Lin — 功能回归、CI、设备与候选包验证

- 执行日期：2026-11-05（Asia/Shanghai）
- 任务范围：W4 YL01—YL05，承接 W3 YL01/YL02/YL04/YL03+YL05
- 源码基线：`09903ceb1e3b2ce38155484a2afd50297bab54a1`（GitHub `main`，2026-11-05 15:10:55Z）
- 固定发行版对照：`v0.4.0` / `1c2ed1a856a21be5a82c4f51ee538859b94e8f2b`
- 工作方式：本地干净归档快照；未从旧副本覆盖，未推送、未部署、未写云库、未上传微信
- 环境：Windows 11 / Node `v24.16.0` / npm `11.13.0`

> 说明：本机 Git 的 HTTPS 传输被网络重置，`git fetch` 无法取得最新 `main`；本轮用 GitHub 官方 `codeload` 归档固定 `09903ce`，并在独立本地仓库中登记为验证快照。源码目录的 blob 与上游一致，详见 [YL05 候选检查](w4-yl05-candidate-check.md)。

## 成果清单

| 编号 | 任务                   | 交付物                                                                                                                                              | 当前状态                                     |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| YL01 | 建立本周独立检查基线   | [基线报告](w4-yl01-baseline.md)、[artifacts/yl01](artifacts/yl01/)                                                                                  | 本地完成；远端 CI 未运行，待 Xiang Hong 核对 |
| YL02 | 回归已上线核心主线     | [回归报告](w4-yl02-core-regression.md)、[用例表](w4-yl02-cases.csv)、[artifacts/yl02](artifacts/yl02/)                                              | 本地/SDK 离线通过；真实云、真机未测          |
| YL03 | 验证新增模块完整链路   | [模块报告](w4-yl03-new-module.md)、[缺口表](w4-yl03-gaps.csv)、[artifacts/yl03](artifacts/yl03/)                                                    | 本地合成通过；真实身份/云/资料/设备未测      |
| YL04 | 补齐指定设备与兼容证据 | [设备矩阵](w4-yl04-device-matrix.md)、[设备清单](w4-yl04-device-matrix.csv)、[artifacts/yl04](artifacts/yl04/)                                      | 阻塞：无真机，开发者工具需重新登录           |
| YL05 | 提交候选检查与周报告   | [候选检查](w4-yl05-candidate-check.md)、[周报告](w4-yl05-week-report.md)、[H05 回传](w4-yl05-h05-return.csv)、[W5 表](w4-yl05-week5-regression.csv) | 本地候选包完成；未部署，待负责人确认候选范围 |

## 关键结果

- 完整检查 `npm run check`：**1398 项通过 / 0 失败 / 0 跳过**，退出码 `0`。加入本周文档后的交付目录复跑同为 1398/1398（[日志](artifacts/yl01/npm-run-check-delivery.txt)）。
- 九组 `team:check`：**9/9 通过**；当前生产装配 `team:check:production`：**7/7 通过**。两者都是本机合成适配器，不连接云端。
- YL02 定向回归：**405 项通过 / 0 失败**，覆盖 41 个测试文件；是 1398 项的子集，不重复相加。
- YL03 定向回归：**425 项通过 / 0 失败**，覆盖 37 个测试文件；同样不重复相加。
- 云 SDK 静态检查通过，未发送网络查询；云函数依赖 `npm audit --audit-level=high` 为 **0 漏洞**。
- 根依赖在 high 阈值下退出码 `0`；仍有 **3 个 moderate**（`eslint` → `minimatch`，[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)），未升级以避免破坏性变更。
- 候选包为 `0.4.0` / 服务构建 `0.3.0-rc2`，生成 177 个客户端文件；`uploaded=false`、`deployed=false`、`phoneVerified=false`。
- 候选云入口 `index.js` SHA-256 为 `06ed7bda…`，与文档记录的已部署 `d4e6c450…` 不同；只能称为本地候选，不能称为线上版本。
- 本轮未执行真实微信登录、真实云调用、写库、部署、体验版上传或真机测试；这些结果分别保留为未测或阻塞。

## 环境分列

| 环境                     | 本轮实际结果                                                               |
| ------------------------ | -------------------------------------------------------------------------- |
| 本地单元/合成数据        | `npm run check` 1398 项通过；YL02 405 项、YL03 425 项定向通过              |
| 锁定 SDK 离线替身        | 包含在完整检查中；未发网络请求，未初始化真实云凭据                         |
| 九组/生产装配合成联调    | `team:check` 9/9；`team:check:production` 7/7；固定合成身份与内存库        |
| 微信开发者工具模拟器     | 未执行：`open`/`auto` 返回 code 10「需要重新登录」，当前 `{"login":false}` |
| Android/iOS/华为 Pura 70 | 未执行：`adb devices -l` 为空，无设备连接；iOS 在 Windows 本机不可用       |
| 真实云端                 | 未调用；未申请权限、未部署、未读取云环境或健康响应                         |
| 线上微信版本             | 未复核；仅引用负责人 11 月 1 日 0.3.0 记录，不作为本轮通过                 |

## 当前阻塞

| 阻塞                          | 所需输入/下一步                                           | 接收负责人                   |
| ----------------------------- | --------------------------------------------------------- | ---------------------------- |
| 真实微信登录与云端打卡闭环    | 可登录的开发者工具/真实账号、明确云测试范围与批准         | 用户 / Xiang Hong            |
| 地点资料与打卡数据独立核实    | 可复核地点清单、导入记录、`place_checkins` 实际集合与权限 | Qinghan Zhang / Junhan Huang |
| Android/iOS/华为 Pura 70 真机 | 设备、微信版本、可用体验包或明确候选包                    | 用户 / Xiang Hong            |
| 开发者工具模拟器              | 由用户手动扫码登录开发者工具，且项目权限可用              | 用户                         |
| 收藏/纠错生产写入             | 服务仍返回 `NOT_IMPLEMENTED`，需 Junhan 完成生命周期围栏  | Junhan Huang                 |
| 任务正式模板与共同规则        | 正式模板、状态表与前后端共同确认                          | Jiawei Fang / Qizhen Chen    |
| 独立复核与签认                | Qizhen Cai 的权限/生命周期独立结论；页面负责人确认        | Qizhen Cai / 各页面负责人    |
| 本轮分支远端 CI               | 推送分支并创建 PR 后运行 quality；本轮未获上传确认        | Yuen Lin / Xiang Hong        |

## 边界

- 只新增 `docs/week4/Yuen_Lin/`；未修改业务源码、共享契约、数据库、云资源、CI、导航或其他成员文件。
- 未部署云函数、未上传体验版/正式版、未写数据库、未执行清理或恢复；未调用真实云业务接口。
- 测试仅使用合成数据、固定时钟和内存/离线替身，不包含真实身份、私人日记、令牌或位置轨迹。
- 队友报告中的云端部署、手机反馈和地点导入只作为来源引用，不转写为本人的独立验收。
- 本地通过、模拟器、真实云、真机、独立签认分别记录，不互相替代，也不把测试数量当作贡献或完成率。

## 关联来源

- [W4 任务导航](../README.md)、[60 项索引](../tasks.csv)
- [W4 校园手动打卡说明](../campus-recommendation-checkin.md)
- [H01 版本与能力表](../xiang-hong/h01-version-capabilities.md)
- [H04 数据接缝](../xiang-hong/h04-data-seams.md)
- [手动打卡实现](../xiang-hong/manual-checkin-20261104.md)
- [v0.4.0 发布说明](../../releases/v0.4.0.md)
- [Issue #22](https://github.com/HX-Jan/MoodSky/issues/22)、[Issue #23](https://github.com/HX-Jan/MoodSky/issues/23)、[Issue #102](https://github.com/HX-Jan/MoodSky/issues/102)
