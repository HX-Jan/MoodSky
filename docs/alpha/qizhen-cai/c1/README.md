# 蔡奇真｜C1 独立验证材料

周期：C1（2026-11-21—2026-11-22）
成员：蔡奇真（Qizhen Cai，GitHub：`@Cai5133`）
原任务：AS-C01、AS-C02；Issue：[ #209 ](https://github.com/HX-Jan/MoodSky/issues/209)
约定复核：洪翔

本目录是 C1 的独立首轮材料，不是全组验收结论，也不替代真实云、真机文件送达、微信后台或维护环境的验证。

测试设备：A 为 iPhone 17 Pro Max，B 为 iPhone XR；两台设备均使用测试当时可用的最新版微信。实际操作与证据核对耗时约 30 分钟。

仓库基线：GitHub `main` 于 2026-11-21 查询到的完整提交为 [`6e91ead92dd8ecc143e38bff956ff239e4765296`](https://github.com/HX-Jan/MoodSky/commit/6e91ead92dd8ecc143e38bff956ff239e4765296)。该 SHA 是本报告引用的源码基线；手机截图未显示构建标识，不能据此断言两台设备正在运行该提交。

| 文件 | 用途 |
| --- | --- |
| `independent-plan.csv` | A/B 测试数据、预期、入口与用例计划 |
| `independent-baseline-results.csv` | 基于本次实际页面截图的首轮结果 |
| `privacy-review.csv` | 截图、导出预览与待补的分享／日志脱敏审查 |
| `progress.md` | 周期回传、日志 1 供稿、交接和外部证据门槛 |
| `evidence/` | 已脱敏命名的 A/B 页面证据；只含测试标识，不含真实日记内容或账号标识 |

## 结论边界

- 已有页面证据证明：A 与 B 分别建立并读取了不同的当日私有测试记录；两边导出预览分别只显示自己的测试标识；两边均可查看同一组校园公共地点。
- B 在建立自己的记录前显示同日“还没有记录”，其后只显示 `B-C1-1122`；B 端页面看不到 A 的历史记录，也没有显示 A 导出回执的入口。因此，客户端可见性隔离通过；本期没有接口级 `FORBIDDEN`／`UNAUTHENTICATED` 回执证据。
- B 对 A 历史和 A 导出回执的定向拒绝、分享参数、服务日志、实际云、文件送达、微信后台隐私状态和真实维护运行均保留为待验。
- 仓库公开资料记录了团队 CloudBase 环境 ID `mood-sky-d5gqy3spkff37566d`，但示例客户端配置仍为 `cloudEnabled: false` 且环境 ID 为空，真实 `environment.local.js` 不入库。因此，本次 A/B 截图实际连接的云环境仍未由构建或后台回执确认。

