# C1-QH 校园资料与选点回传

- 周期：2026-11-21 至 11-22。任务 [#203](https://github.com/HX-Jan/MoodSky/issues/203)，AS-QH01 / AS-QH02。
- 测试基线：最新 main `11a34159ab4e606ae269c9e23f51acfdaf748ab2`。本次交付提交仅含资料与证据，测试源码与基线相同。
- 环境：Windows，Node v24.22.3；由 setup 生成个人配置，cloudEnabled=false、journalDemo=false。用例使用本地合成状态。
- 运行：在仓库执行 `node scripts/setup.js`、`node scripts/prepare-cloud.js`，再执行 `node --test --test-reporter=tap tests/manual-campus-client.test.js tests/campus-history-client.test.js`。退出码 0，59/59 通过。重跑时测试自行建立合成账户和页面状态。
- 材料：[五地点对照](places-review.csv) · [入口结果](campus-entry-results.csv) · [原始 TAP](campus.tap)。

## 日志 1 供稿

本期核对福友阁、大梦书屋、望舒湖、阳光园和光彩创咖的 ID、校区、文字方位、推荐理由及开放限制。当前校园页面对五处统一提示以现场为准，另显示大梦书屋的分层入座限制和光彩创咖的消费提示。手动校园与历史客户端的 59 项本地测试通过，覆盖选择、显式提交与历史状态。模拟器自动化因服务端口关闭尚未运行，右侧按钮实点、任务返回状态和当期运行图待补。

## 接口与补验交接

- Junhan：请对照 `campus.checkins` 查询、`campus.checkin` 完成及 `campus.checkinHistory` 历史三条调用。前端需要稳定的 placeId、业务日期、完成回执、暂停错误及历史分页；确认历史地点下架后 ID 的保留规则，并提供合成响应样例。场所现行公告由 Qinghan 在取得新资料时更新。
- Yuen / Jiaqi：在同 SHA 的隔离项目启用开发者工具服务端口，连接 9420，使用 `tools/week6-qc/wechat-task-flows.cjs` 的本地桥接。补拍任务入口、右侧选点前后和返回任务已选；桥接保持暂停，显式完成只验证暂停反馈。两条任务入口分别记录；运行图按日期、SHA、模式登记。
- 个人工时和本人确认待填。Junhan / Yuen 独立复核待回传。真实云与真机未执行。

## 2026-11-23 补交

本次由 Codex 在 Qinghan 授权下辅助执行。基线为当时最新主干
`36ff7f54476ff19cbacba7238b11ee34a5adcdf6`，晚于补交指定起点
`84edfef5ffba8f52bc5ab9a28e1fe0a6a32c38bc`。#230 的原交付由 #231 收件；上节保留历史状态。

- Windows / Node v24.22.3。执行 `npm.cmd run setup`、`npm.cmd run cloud:prepare` 和
  `node --test --test-reporter=tap tests/manual-campus-client.test.js tests/campus-history-client.test.js`。
  退出码 0，59/59 通过。[原始 TAP](evidence/targeted-20261123.tap)
- 磁盘个人配置经校验为禁云、空环境 ID、记录 demo 关闭。生产入口与离线 SDK 的独立探测使用
  固定夹具业务日，查询返回 `writesPaused: true`，显式服务请求返回 `NOT_IMPLEMENTED`，
  `place_checkins` 保持 0。[离线回执](evidence/offline-pause.json)
- 已对照 [Junhan 的 C1 样例](../../junhan-huang/c1-20261121/campus-api-samples.json)。
  完成操作名为区分大小写的 `campus.checkIn`；`campus.checkins` 查询业务日与暂停状态，
  `campus.checkinHistory` 分页读取。五地点沿用原来源；现行限制仍由 Qinghan 和 Junhan 复核。
- 两条原生入口分别用 `tools/alpha-qc/wechat.cjs --campus-task moodsky_01_walk` 和
  `--campus-task moodsky_02_read` 运行，各自使用新的绝对输出目录和独立合成世界。
  标准回归仍用无参数调用。运行状态及附件见[证据索引](evidence-index.csv)和[来源](source.json)。

### 两条入口的原生结果

散心、校园阅读均从各自独立初始状态实点任务，再实点福友阁右侧「选这里」。
五张卡的名称和方位已逐项从渲染树读取，右缘几何实测见每条运行报告。两条入口的
业务日期均为 2026-11-23，选点前后及暂停探测后 `place_checkins` 均为 0。
选择后显示「暂不可打卡」，按钮处于禁用状态。独立服务探测通过同一离线夹具
发送 `campus.checkIn` 并取得 `NOT_IMPLEMENTED`。返回任务列表后原任务保持
`selected`，任务历史中无 `completed`。两套预览均恢复禁云状态。

Jiaqi 可从[证据索引](evidence-index.csv)取得 10 张未加工原图。请 Junhan
复核接口动作、暂停回执和资料限制，请 Yuen 复核构建、几何量测及两条操作链。
本人确认、个人工时、独立评审、真实云和真机仍按实际验收登记。

原生标准套件 `node tools/alpha-qc/wechat.cjs` 已实际运行。旧 W6 runner
生成部分中间截图后报 `timeout waiting for automator response`，退出码 1，
未产出完整 11 项报告。本轮标准套件登记 BLOCKED，复核时需在稳定的 9420
会话中重跑。两条 QH 专项链路均独立执行成功，保留各自的报告和原图。
见[标准套件错误](evidence/standard-native-error.txt)。
