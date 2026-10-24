# W2 YL04 跨模块联调与设备检查

- 负责人：Yuen Lin（832401211）
- 执行日期：2026-10-24，Asia/Shanghai
- 基线提交：`ed1d76fd97312dd2a4bee0db87aed4e49a14f7eb`（0.2.3）
- 环境：Windows x64；Node.js `v24.16.0`；微信开发者工具 Stable `2.01.2510290`；模拟器 iPhone 12/13 (Pro) 390×844
- 状态：本地与模拟器检查完成；真实云端私有业务、Android/iOS 真机**未测/阻塞**

## 1. 执行范围

优先验证记录到回顾刷新、账号切换和任务入口，再覆盖校园定位、Me 偏好与后台失败反馈。四类环境分开记录：

| 环境                 | 本次执行                                          |
| -------------------- | ------------------------------------------------- |
| 本地单元/替身        | 完整 593 项；记录定向 144 项；后台/校园定向 44 项 |
| 微信开发者工具模拟器 | 8 项结构化检查执行完成                            |
| 真实云端测试环境     | 仅健康只读调用（见 YL03）；私有业务未执行         |
| Android/iOS 真机     | **未执行**，无可用设备/安装包                     |

## 2. 模拟器结果

方法：`miniprogram-automator` 连接 `ws://127.0.0.1:9422`，在显式 `journalDemo:true`、`cloudEnabled:false` 下运行。原始结果：[simulator-validation.json](artifacts/yl04/simulator-validation.json)；控制台：[simulator-validation.console.txt](artifacts/yl04/simulator-validation.console.txt)。

| 检查                        | 结果            | 关键数据                                                                                |
| --------------------------- | --------------- | --------------------------------------------------------------------------------------- |
| today-initial               | 通过            | `isDemo:true`；日期 2026-10-24；7 类天气；8 个标签；`canSave:false`                     |
| today-save-sunny            | 通过            | `entryWeather:SUNNY`；`entryVersion:1`；`phase:idle`                                    |
| today-reenter-read          | 通过            | 重新进入仍为 `SUNNY` / version 1                                                        |
| record-edit-version         | 通过            | 版本 1→2；天气改为 RAINY；ID 保持                                                       |
| universe-refresh-after-edit | 通过            | 2026-10 月记录数 6；当天单元格 `RAINY` / `recorded:true`                                |
| me-preferences-and-switch   | 通过            | 偏好保存成功；`demo-a`→`demo-b`→`demo-a`                                                |
| tasks-guest-entry           | 通过            | `isDemo:true`；3 条建议；游客 `writeBlocked:true`；历史为空                             |
| campus-location-denial      | **部分/未完成** | 演示地点 2 条；拒绝定位请求已发起，页面停在“正在请求定位权限…”，未取得真实允许/拒绝结果 |

统计口径：**8 项检查执行完成，7 项断言通过，1 项（Campus 定位拒绝）只验证到请求发起**，不能写成定位拒绝通过。

当天的回顾数据由 [universe-today-check.json](artifacts/yl04/universe-today-check.json) 单独核对：

```json
{
  "today": "2026-10-24",
  "weather": "RAINY",
  "recorded": true,
  "id": "demo_entry_1"
}
```

## 3. 本地跨模块与后台反馈

| 检查                    | 方法/证据                                                                                              | 结果                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 记录→回顾刷新           | `review-backend.test.js`、`review-week2.test.js`、`review-store-invalidation.test.js`                  | 通过；删除/编辑立即反映，重建使用新 ID                         |
| 账号切换与旧响应隔离    | `linghan-ui.test.js`、`me-lifecycle.test.js`                                                           | 通过；合成账号 A/B 隔离，迟到响应不回填                        |
| 任务入口与游客写入门禁  | `tasks-demo.test.js`、`tasks-cloud.test.js`、`tasks-integration.test.js`                               | 通过；3 条建议可见，游客写入被阻止                             |
| 校园定位拒绝与地图失败  | `campus-week-two.test.js`：ok 47（拒绝后列表可用）、ok 48（地图失败返回）、ok 56（隐私拒绝不调用 API） | 本地通过                                                       |
| 后台保存失败不报成功    | `admin-integration.test.js`、`admin-sdk.test.js`、`qizhen-admin.test.js`                               | 定向 44 项通过；FORBIDDEN、NOT_IMPLEMENTED、网络失败均保留输入 |
| 真实 Web 身份与后台授权 | 需要 Qizhen Chen/Junhan 的真实 Web 入口                                                                | **未执行/阻塞**                                                |

后台/校园定向原始结果：[admin-campus-targeted.tap](artifacts/yl04/admin-campus-targeted.tap)（44 通过 / 0 失败，是完整套件子集，不与 593 相加）。

## 4. 设备检查

原始记录：[device-check.txt](artifacts/yl04/device-check.txt)。

| 设备/环境            | 结果     | 说明                                                              |
| -------------------- | -------- | ----------------------------------------------------------------- |
| 微信开发者工具模拟器 | 已执行   | iPhone 12/13 (Pro)，390×844；结果见第 2 节                        |
| Android 真机         | **未测** | 本机 `adb` 不可用；未检测到已连接的 Android/ADB 设备              |
| iOS 真机             | **未测** | Windows 环境无法执行 iOS 真机调试；需要 macOS/Xcode 或 TestFlight |
| 华为 Pura 70         | **未测** | 第一周确认有设备（HarmonyOS 4.2.0 / 微信 8.0.79），但未安装体验版 |

设备缺口需要：

1. 由 @HX-Jan 批准并上传体验版，加入体验成员；
2. 提供 Android 调试设备或可用的 `adb`；
3. iOS 侧提供 macOS/TestFlight 环境；
4. 准备合成账号与合成数据，禁止输入真实日记或个人信息。

模拟器结果不能计作真机覆盖；本次没有真机通过结论。

## 5. 失败、阻塞与移交

| 编号    | 问题/阻塞                     | 期望/下一步                                            | 接收负责人               |
| ------- | ----------------------------- | ------------------------------------------------------ | ------------------------ |
| YL04-B1 | Campus 真实定位拒绝结果未取得 | 在可见模拟器或真机点击允许/拒绝，记录两种结果          | Yuen Lin / Qinghan Zhang |
| YL04-B2 | 真实云端私有记录与回顾未接线  | 生产域接入可信账号/数据库后复测                        | Xiang Hong / Xiang Yu    |
| YL04-B3 | 真实 Web 身份与后台角色未联调 | 由 Qizhen Chen/Junhan 提供真实入口后执行               | Qizhen Chen / Junhan     |
| YL04-B4 | Android/iOS 真机不可用        | 提供设备与体验版后补测；设备缺口记入第三周输入         | 用户 / @HX-Jan           |
| YL04-B5 | 模拟器截图未取得              | 以结构化 JSON 为证据；需要可视化证据时在可见面板补截图 | Yuen Lin                 |

## 6. 工具说明与边界

- `miniprogram-automator 0.13.0` 仅安装在系统临时目录 `opencode/yl03-automator`，不进入仓库依赖、CI 或云函数；其自身依赖审计有 11 项告警（3 critical、1 high 等），只影响本地测试工具，不影响项目 `npm audit` 的 0 漏洞结论。
- 自动化调用页面方法而不是伪造响应；模拟器仍为本地合成数据，不代表真实云端。
- 本次未修改业务源码、共享契约、数据库、云资源或 CI。
