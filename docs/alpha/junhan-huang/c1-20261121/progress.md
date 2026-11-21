# JH C1 周期回传（2026-11-21—22）

周期／日期：C1，2026-11-21。姓名／实际账号：Junhan Huang / @Drose-2301。原任务及 Issue：AS-JH01、AS-JH02；[Issue #204](https://github.com/HX-Jan/MoodSky/issues/204)。

| 字段                                   | 实际记录                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本期工作类型                           | 测试／资料（接口样例与回归证据），未改业务源码                                                                                                    |
| 期初与期末完整 SHA                     | 期初 `6e91ead92dd8ecc143e38bff956ff239e4765296`；期末源码仍为同一提交，本目录为文档提交（PR head 见 Issue/PR）                                    |
| 系统、Node、开发者工具或设备、配置模式 | Windows / Node.js 24 / 本地 production entry + `tests/helpers/w2-database` 模拟库；禁云，无开发者工具或真机                                       |
| 计划与实际做的事                       | 计划：三个校园 action 的未登录、A/B、分页样例。实际：12 组聚焦样例 + 23 组源样例、CSV 结果、检查日志；未调用目标云                                |
| 初始数据、操作和重置                   | 合成账号 A/B、五地点目录、固定时钟 `2026-11-18T15:59:59Z`；每次运行工具重建模拟库，无持久状态                                                     |
| 预期与实际结果                         | 三个 action 未登录均 `UNAUTHENTICATED`；A 当日两地点 2 条；B 读取为空；`pageSize:1` 首末页 `hasMore` 正确；重放 `replayed:true`；并发同地点仅一行 |
| Issue、commit／PR 或其他成果           | Issue #204；#196（W6 样例工具）已合入 main `60b1253`；C1 交付为 `docs/alpha/junhan-huang/c1-20261121/`                                            |
| 用例与原始日志                         | `npm run check` 1638 通过/0 失败，退出 0；定向 41 通过，退出 0；见 `evidence/check-20261121.txt`、`evidence/targeted-20261121.txt`                |
| 图片／视频或报告附件                   | `campus-api-samples.json`、`api-results.csv`、`evidence/w6-source-samples.json`；无页面截图，接口证据不用假图代替                                 |
| 问题、修复和复测                       | 未发现接口缺陷。动态停用（`places.enabled=false`）实时传播仍未实现，沿 W6 记录保留                                                                |
| 交给谁复核、对方实际意见               | Qinghan（页面字段／样例）、蔡奇真（独立重跑与隔离）待复核；Yuen 取来源与结果                                                                      |
| 未完成与阻塞                           | 目标云、真机、真实 A/B 未执行；真实云接口是否含四个 action 未确认；无外部条件                                                                     |
| 本人实际工时和依据                     | 待本人填写                                                                                                                                        |
| 下期安排                               | C2：同地点同日去重／并发、跨日重放与新请求、暂停、下架历史、生命周期表                                                                            |

## 可用于当期日志的事实段落

C1 从 `6e91ead` 出发复核当前校园接口：用本地 production entry 与固定北京时间，对 `campus.checkIn`、`campus.checkins`、`campus.checkinHistory` 跑了 12 组聚焦样例（源 23 组）。未登录三接口均 `UNAUTHENTICATED`；A 当日两地点 2 条、B 为空；`pageSize:1` 第 1 页 `total:2/hasMore:true`、第 2 页 1 条 `hasMore:false`；原请求同日重放 `replayed:true`，同地点并发只留一行。工具与样例来自已合入 #196 的生成器，本次重新生成并去掉 session scope；`npm run check` 1638 项、定向 41 项通过。目标云、真机与独立复核未执行，保留待验。

## 本人确认

待本人填写确认时间。
