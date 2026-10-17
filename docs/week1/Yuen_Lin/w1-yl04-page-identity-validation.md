# W1 YL04 页面和身份小验证

- 负责人：Yuen Lin（832401211）
- 执行日期：2026-10-17，Asia/Shanghai
- 基线提交：`1be13f8287e177ae3f057a9298164eb631181778`
- 环境：Windows x64；Node.js `v24.16.0`；微信开发者工具 Stable 2.01.2510290（已登录）；本地页面替身、内存服务与 iPhone 12/13 (Pro) 模拟器
- 结论：四页入口、Today 表单、Universe 空月、Me 处理中状态、本地身份门禁和模拟器 10 项检查通过；Campus 真实定位拒绝、真实云端身份和后台 Web 联调**未测/阻塞**

## 1. 验证范围与方法

### 1.1 本地自动检查

```powershell
node --test --test-reporter=tap `
  tests/journal-pages.test.js `
  tests/review-pages.test.js `
  tests/linghan-ui.test.js `
  tests/me-lifecycle.test.js `
  tests/account-identity.test.js `
  tests/identity-adapters.test.js `
  tests/router.test.js `
  tests/validation.test.js
```

结果：**66 通过 / 0 失败**，原始 TAP 见 [targeted-pages-identity.tap](artifacts/yl04/targeted-pages-identity.tap)。

### 1.2 微信开发者工具模拟器

使用 `miniprogram-automator` 连接本机开发者工具自动化端口 `ws://127.0.0.1:9420`，在 `journalDemo:true`、`cloudEnabled:false` 的本地配置下执行；不连接真实云、不写数据库。结果：**10 通过 / 0 失败**，原始 JSON 见 [simulator-validation.json](artifacts/yl04/simulator-validation.json)。

> 工具说明：本机开发者工具的 `page.data()`/截图 CDP 命令会挂起，因此页面数据通过 `miniProgram.evaluate(() => getCurrentPages())` 读取；这不改变页面行为。IDE 模拟器面板未被窗口截图渲染，故本轮没有可用模拟器截图，以结构化工具结果为准，不伪造截图。

### 1.3 页面入口静态核对

结果见 [page-entry-check.json](artifacts/yl04/page-entry-check.json)：4 个 tab、10 个注册页面、每个页面的 `js/json/wxml/wxss` 齐全，四个主页面均在 tabBar 中。

## 2. 分项结果

| 验证项                  | 方法                                                                      | 实际结果                                                                  | 状态            | 边界                               |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------- | ---------------------------------- |
| 四页入口                | `app.json` 路由/文件核对 + 结构检查 + 模拟器 tab 切换                     | 4 个 tab、10 个页面全部存在；模拟器 Today/Campus/Universe/Me 均可进入     | 本地+模拟器通过 | 真机未测                           |
| Today 本地表单          | `journal-pages.test.js`、`validation.test.js` + 模拟器选天气并保存        | 5 类天气、8 个标签、天气必选、模拟器保存 SUNNY 版本 1；边界由本地测试覆盖 | 本地+模拟器通过 | 仅显式 `journalDemo:true` + 云关闭 |
| Campus 拒绝定位         | 阅读 `pages/campus` 实现 + 模拟器进入页面                                 | 当前页面只有固定模拟说明，没有定位、地图或拒绝定位交互                    | **未测/阻塞**   | 需 Qinghan Zhang 实现后才能验收    |
| Universe 空月           | `review-pages.test.js`、`review-demo.test.js` + 模拟器选择 2026-08        | 空月 `recordCount:0`、无记录日期不显示天气印                              | 本地+模拟器通过 | 真实回顾接口未实现                 |
| Me 处理中状态           | `linghan-ui.test.js`、`me-lifecycle.test.js` + 模拟器启动导出             | 导出 processing → completed；注销 35/70/100% 等由本地测试覆盖             | 本地+模拟器通过 | 合成演示，不代表真实导出/清理      |
| 本地身份门禁            | `account-identity.test.js`、`identity-adapters.test.js`、`router.test.js` | 未登录拒绝、active 放行到桩、disabled 拒绝、payload 身份字段拒绝          | 本地替身通过    | 真实 OPENID/Web 身份未联调         |
| 真实 system.health 调用 | 需要已部署云函数和测试环境                                                | 未执行                                                                    | **阻塞**        | 本轮未上传/部署新包                |
| 后台 Web 身份与角色联调 | 需要 Qizhen Chen/Junhan 的 Web 入口和真实环境                             | 未执行                                                                    | **未测/阻塞**   | 当前只有候选适配层，不能当真实授权 |

## 3. 完整执行记录一：Today 日期边界与冲突

- 用例：YL04-E01（关联 T03/T04、S04/S06）
- 前置：本地显式演示模式；固定业务日 `2026-10-15`；内存中已有版本 3 的旧记录。
- 步骤：
  1. 打开 Today，切换到 2026-09-16（今天前 29 天），输入天气并保存。
  2. 切换到 2026-09-15（今天前 30 天），尝试新建。
  3. 打开 2025-01-01 的旧记录，使用当前版本编辑。
  4. 模拟另一设备把版本推进到 4，再用旧版本 3 提交。
- 预期：第 1 步创建版本 1；第 2 步禁止新建；第 3 步编辑成功且保持原 ID；第 4 步返回 `CONFLICT`、保留草稿并要求确认后重读。
- 实际：`journal-pages.test.js` 的 “creation includes day 29 but excludes day 30 and future dates”“an existing old entry can be edited with its current version and stable id”“a conflict preserves draft and requires explicit discard confirmation before a reread” 均通过。
- 证据：[targeted-pages-identity.tap](artifacts/yl04/targeted-pages-identity.tap) 中 `ok 20`—`ok 25` 相关用例。
- 状态：本地替身通过；真实云端未测。

## 4. 完整执行记录二：Universe 空月

- 用例：YL04-E02（关联 T05/T08、S03）
- 前置：本地回顾演示数据；选择没有记录的月份 `2026-08`。
- 步骤：进入 Universe → 选择 2026-08 → 查看月历 → 返回。
- 预期：月历 `recordCount:0`、`entries:[]`；无记录日期留白，不显示任何天气印；不出现趋势结论。
- 实际：
  - 本地：`review-pages.test.js` 的 “review month and detail pages complete their first load and remove deleted content”“review insights loads and switching to an empty fixture completes without NaN request tokens” 通过；`review-demo.test.js` 的空月断言也通过（完整套件内）。
  - 模拟器：`universe-empty-month` 检查通过，`monthRecordCount:0`、`calendarBusy:false`。
- 证据：[targeted-pages-identity.tap](artifacts/yl04/targeted-pages-identity.tap) 中 `ok 41`—`ok 45`；[simulator-validation.json](artifacts/yl04/simulator-validation.json)。
- 状态：本地+模拟器通过；真实回顾后端未实现。

## 5. 身份小验证结果

| 检查项                           | 结果                                       | 证据（TAP 编号）  |
| -------------------------------- | ------------------------------------------ | ----------------- |
| 无可信身份调用 private action    | `UNAUTHENTICATED`，未读取账号              | ok 2、ok 51       |
| active 账号调用本人 action       | 门禁放行，到达业务桩                       | ok 1、ok 15       |
| disabled 账号调用 private action | `ACCOUNT_DISABLED`，不会自动恢复           | ok 4、ok 52       |
| payload 携带 7 个保留身份字段    | 7/7 `INVALID_REQUEST`，未读取账号          | ok 6、ok 53       |
| 普通学生调用运营 action          | `FORBIDDEN`；运营角色只能由服务端解析      | ok 14、ok 54      |
| 清理回执越权                     | 无回执/错权限 `FORBIDDEN`；回执不能当登录  | ok 9—ok 12、ok 56 |
| 未接线适配器                     | 私人业务保持 `NOT_IMPLEMENTED`，不虚假成功 | ok 8、ok 55       |

以上均为**本地替身**结果，不等于真实微信 OPENID、Web 登录、内部账号映射或运营角色已在测试环境通过。

## 6. 模拟器自动化结果（10/10）

| 检查项                 | 结果 | 关键数据                                                            |
| ---------------------- | ---- | ------------------------------------------------------------------- |
| connect                | 通过 | `ws://127.0.0.1:9420`                                               |
| today-initial          | 通过 | `isDemo:true`；5 类天气；8 个标签；`canSave:false`；日期 2026-10-17 |
| today-weather-selected | 通过 | 选择“晴天”后 `canSave:true`                                         |
| today-save             | 通过 | `entryWeather:SUNNY`；`entryVersion:1`；`phase:idle`                |
| campus-tab             | 通过 | 进入 `pages/campus/index`；仅有固定模拟说明，定位流程未实现         |
| universe-current-month | 通过 | 进入 `pages/universe/index`；`calendarBusy:false`                   |
| universe-empty-month   | 通过 | 选择 2026-08 后 `monthRecordCount:0`                                |
| me-tab                 | 通过 | 版本 `0.2.1`；合成账号 `demo-a`；`active`                           |
| me-export-processing   | 通过 | `exportTask.status:processing`                                      |
| me-export-completed    | 通过 | `exportTask.status:completed`                                       |

原始结果：[simulator-validation.json](artifacts/yl04/simulator-validation.json)。

## 7. 失败、阻塞与移交

| 编号    | 问题/阻塞                        | 复现或依据                                                         | 期望/下一步                                                   | 接收负责人                |
| ------- | -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------- |
| YL04-B1 | Campus 拒绝定位无法验证          | `miniprogram/pages/campus/index.wxml` 只有固定模拟说明，无定位入口 | 实现“首次不主动申请 → 用户选择后申请 → 拒绝后继续浏览列表”    | Qinghan Zhang             |
| YL04-B2 | 真实 `system.health` 未调用      | 本轮未上传/部署新包；历史正式健康响应仍为 `INVALID_REQUEST`        | 按 YL03 清单部署后调用，记录版本与 requestId                  | Yuen Lin/Xiang Hong       |
| YL04-B3 | 真实微信身份/后台 Web 身份未联调 | 当前仅有本地替身与候选适配层                                       | 由 Jiawei、Junhan、Qizhen Chen 接入后在测试环境联调           | Jiawei/Junhan/Qizhen Chen |
| YL04-B4 | 模拟器截图未取得                 | IDE 模拟器面板未被窗口截图渲染；`page.data()`/截图 CDP 命令挂起    | 以 `mp.evaluate` 结构化结果为准；后续可在可见模拟器面板补截图 | Yuen Lin                  |

本次没有发现由 Yuen Lin 引入的代码缺陷；没有修改业务源码、云资源或数据库。

## 8. 验收边界

- “本地通过”仅指现有自动检查在 Node 页面替身/内存服务下通过。
- “模拟器通过”仅指 10 项自动化检查在开发者工具 iPhone 12/13 (Pro) 模拟器下通过；不代表真机、真实云或后台。
- 真实云端、真机结果仍为空；Campus 定位拒绝、真实身份和后台联调保持阻塞，待对应负责人实现或提供环境后复测。
- 模拟器检查使用合成账号和本地演示数据，未写入真实日记或云端。
