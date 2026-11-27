# Alpha C1–C4 校园模块收尾

关联 [#203](https://github.com/HX-Jan/MoodSky/issues/203)。2026-11-27 由
Codex 在 Qinghan 授权下辅助执行。C2、C3 是本次实际补验日期，原计划周期见下表。
附件 Git tree 与核对时 GitHub 主干相同，基线
`00c59a1af7ccd27e9c2ae4bc77f6b65fc66b117c`。

| 周期           | 核验成果                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1（11/21–22） | [原交付](../../c1/qinghan-zhang/progress.md)及 [#239](https://github.com/HX-Jan/MoodSky/pull/239) 的两入口原生证据继续可查。                                         |
| C2（11/23–24） | [页面与服务矩阵](page-service-results.csv)，含可写夹具、暂停和任务往返。                                                                                             |
| C3（11/25–26） | [边界回归矩阵](campus-boundary-results.csv)，含跨日、去重、分页、下架及 A/B 隔离。                                                                                   |
| C4（11/27–28） | [最终矩阵](final-campus-results.csv)、[候选来源](evidence/candidate.json)、[演示](demo-campus.md)、[地点表](final-places.csv)与[本人总结草稿](personal-summary.md)。 |

Windows / Node 24。执行 `node scripts/setup.js`、`node scripts/prepare-cloud.js`，
再执行 `node --test --test-reporter=tap tests/manual-campus-client.test.js tests/campus-history-client.test.js tests/manual-campus-checkin.test.js tests/week6-qc-task-flows.test.js`。
退出码 0，94/94。[测试原始日志](evidence/campus.tap)

在干净工作区运行 `node scripts/package-production.js <新的绝对输出目录> enabled`，
独立核对 185 项客户端哈希、项目配置与两个云包共七项哈希。隔离预览磁盘配置禁云、
环境 ID 为空、记录 demo 关闭，应用内临时桥接只访问本地生产入口和离线 SDK。
本地开放写入另用可写测试夹具。真机、真实云及发布方最终放行待验。

## 日志与测试博客供稿

- **日志 2**：区分在任务中选地点、显式请求打卡以及得到确定回执。独立可写夹具验证成功，暂停模式仍可读取本人历史。
- **日志 3／测试博客**：连点同日只保留一条，跨午夜的原请求保留旧业务日期；历史翻页验证边界，旧地点仍可读，切号后丢弃迟到结果。
- **日志 4**：以附件对应的主干生成 enabled 本地候选并核对哈希。演示走隔离预览，其配置与原样候选分开登记。

Junhan 核对接口、暂停回执和地点限制；Yuen 复核构建与测试；Qizhen Chen
对照往返；蔡奇真复核 A/B 隔离；Jiaqi 与洪翔可取本期演示与媒体。独立意见、本人确认和实际工时待相关成员填写。

两条同源原生链路均复跑成功；首次运行出现自动化响应超时，散心随后一次等待列表超时，
最终从独立初始状态成功重跑。[原图索引](evidence-index.csv)收录十张原图。
业务日期、右对齐几何与请求顺序见[散心报告](evidence/walk/native-results.json)和
[阅读报告](evidence/read/native-results.json)。C1 原标准 11 项套件的失败记录保留，本次复跑范围为两条校园链路。
