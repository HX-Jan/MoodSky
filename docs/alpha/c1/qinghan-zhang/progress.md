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
