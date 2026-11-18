# W6-QC｜小任务页面与完成状态

Qizhen Chen / GitHub `grrrced`，2026-11-18。本地交付完成，状态为**待复核**；Jiawei、Yuen 的独立结论由本人提供。此报告不代签、不登记个人工时，不把其他成员开放 PR 视为已合并。

完整基线：main `13afb20956f5b115cfd393487aee8bbe570ea8d3`。分支 `fix/w6-qizhen-chen-task-flows`。本次交审的完整提交号以关联 PR head 为准；关键实测文件 SHA-256 固定在 [模拟器记录](evidence/simulator.json)，候选包 manifest 另记录最终完整 sourceCommit。计划中的 `987b19d675bfe7a8f4b14c0cb1b25d508483d329` 是制定计划时的历史基线。

## 任务与采用来源

按用户提供的《第六周详细任务计划》W6-QC 执行：三种模式、选择/完成/替换/跳过/历史、校园与记录往返、连点/失败/离页/原请求待处理。本周只做本地验证：开发者工具禁用真实云，服务端使用合成 A/B 和已有 SDK 离线数据库。候选 `0.5.1` 保持 `taskMode: closed`、新增校园打卡默认暂停。

| 来源                                                                                                   | 固定提交与采用情况                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#166](https://github.com/HX-Jan/MoodSky/pull/166)，Qizhen Chen                                        | 最终 head `932624d9bad1fcc999cd995ecfe11d190d4884ef`，已合并；沿用原请求待处理、三模式入口保护。第五周手机反馈保持原周状态。                                                                                                                                 |
| [#171](https://github.com/HX-Jan/MoodSky/pull/171)，Jiawei                                             | head `d9847effae19834de730e0e2ceacc80f3f71c1f5`，已合并；采用[任务契约](../../week5/jiawei-fang/w5-jf-task-contract.md)、日期/回执和只读行为。未找到 W6-JF 新交审样例；本次从当前正式入口实际生成[输入输出](evidence/service-samples.json)，交 Jiawei 确认。 |
| [#175](https://github.com/HX-Jan/MoodSky/pull/175)、[#176](https://github.com/HX-Jan/MoodSky/pull/176) | 已在基线接入的任务 tab、校园/记录活动和历史；直接验证现有页面，不覆盖其他成员实现。                                                                                                                                                                          |
| [#182](https://github.com/HX-Jan/MoodSky/pull/182)，HX-Jan                                             | head `cba3e139eb1569d58b5c1288f6088bbb9f31bcbf`，已合并；按钮视觉为基线，任务 WXML/WXSS 均未修改。                                                                                                                                                           |
| [#183](https://github.com/HX-Jan/MoodSky/pull/183)                                                     | head `de659b4f41240ff94fd1fd4accd7125cb395359d`，已合并；本次基线最新提交沿用其说明。                                                                                                                                                                        |

2026-11-18 再次查询 main 未前进。下列开放 PR 均待仓库审查；未合入本次代码，也不替作者签验收：

| PR / 作者                                                                | 查询时 head                                | 与本次的关系                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------ |
| [#184](https://github.com/HX-Jan/MoodSky/pull/184) / HX-Jan              | `9b489189278792935c4e86c0278cd8c8694b9fa8` | 健康/构建/打卡开关显示；本次不改这些生产模块。               |
| [#185](https://github.com/HX-Jan/MoodSky/pull/185) / qinghanz6           | `87ed5470d203a86f94703a37de95a23ba52a5e8b` | 校园本地报告；本次补实际任务→校园→返回，不增加地点核实门槛。 |
| [#186](https://github.com/HX-Jan/MoodSky/pull/186) / Fanny-126           | `eac260d519ae65fffbc86512f55bdcab819e0b37` | 心情记录本地验收；本次验证现有真实记录保存控制器与任务返回。 |
| [#187](https://github.com/HX-Jan/MoodSky/pull/187) / Phoenix-Yx          | `4f762a3312ae4ecfbe65aa2a5a0a835106903b19` | 导出维护测试，不在本次新增改动中。                           |
| [#188](https://github.com/HX-Jan/MoodSky/pull/188) / chenlinghan82-debug | `d130b9ce6c26cb60703f301070a195d82c289ef0` | 登录/分享/退出围栏测试；保留基线身份围栏。                   |
| [#189](https://github.com/HX-Jan/MoodSky/pull/189) / Zhifeng0419         | `3250cfd3bfb194983cd7fb589a12b3a3f12f43de` | 回顾与演示重读；不修改其对应页面。                           |

## 复现的新问题与最小修复

`enabled` 模式选择散心任务，延迟 `tasks.transition` 回执；用户先切到“今天”再回“小任务”。旧回执到达时，账号和当前可见状态都成立，基线会自动跳校园。新增回归在修复前失败：期望导航 0 次，实际 1 次。

在 `pages/tasks/index.js` 捕获已有 `_connectSequence`，只有响应仍属于本次页面访问时才执行自动活动跳转。离页、卸载或重新连接都会使旧访问失效。服务端已确认的选择仍可恢复，用户可手动点“选校园地点”。没有取消后台请求、伪造回滚或改变状态机。

修复后同一回归通过，原生模拟器真实切 tab/返回也保持在小任务页，见 [04-late-selection-stays.png](evidence/04-late-selection-stays.png)。原 WXML/WXSS 未变，`#182` 按钮布局和色彩保持。

## 模式 × 用户动作 × 实际状态

以下均为实际执行的本地结果。VM 表示实际 Page + 实际任务控制器 + 当前正式服务入口 + SDK 离线数据库；模拟器使用同一正式入口，通过本机桥接处理请求，不连接已部署服务。

| 模式 / 初始状态             | 用户动作                                                  | 预期与实测                                                                              | 证据层级                   |
| --------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------- |
| closed                      | 打开任务 tab；强制调用选择/完成/替换/跳过/历史/活动处理器 | 显示暂未开放，无任务请求、历史写入或跳转                                                | VM；模拟器关闭页           |
| readOnly                    | 打开建议；调用四种写动作/历史/活动                        | 只读提示，公共建议可读；无私人写按钮、历史请求、写入或跳转                              | VM；模拟器只读页           |
| enabled + available         | 选择散心                                                  | 回执前不跳转；确认后 selected，可进入校园                                               | VM；模拟器                 |
| enabled + selected          | 完成                                                      | 确认回执后 completed，终态操作按钮消失，历史一致                                        | VM；模拟器                 |
| enabled + selected          | 替换                                                      | 原任务 replaced，历史一致，原任务不再可操作；服务选择替代任务                           | VM；服务响应样例           |
| enabled + selected          | 跳过                                                      | skipped，历史一致，不产生完成态                                                         | VM；服务响应样例           |
| enabled + 任一终态          | 再调用完成                                                | 页面拒绝重复请求，不产生第二份历史                                                      | VM                         |
| enabled + selected          | 进入校园，选择地点，尝试打卡，返回                        | 打卡明确暂停、零 place_checkins；任务仍 selected；显式完成才 completed                  | VM；模拟器                 |
| enabled + selected          | 进入记录，选晴天并保存，返回                              | 真正调用本地 journal.upsert 并持久化一条合成记录；任务仍 selected；显式完成才 completed | VM；模拟器                 |
| enabled + available         | 选择连点，延迟响应                                        | 只发一个写请求，未确认前不跳转、不显示完成                                              | VM                         |
| enabled + available         | 服务已提交但响应丢失                                      | 显示“结果尚未确认/重试原操作”，留在原页，服务仅一行历史                                 | VM；模拟器                 |
| enabled + pending           | 隐藏/重开/返回                                            | 不自动重放；显式重试保留 requestId、payload、expectedDate，回放不重复写                 | VM；模拟器                 |
| enabled + pending           | 离页后返回，再收到旧选择确认                              | 保留 selected，旧访问不自动跳转；手动进入活动仍可用                                     | VM 先红后绿；模拟器        |
| enabled + 服务 readOnly     | 读取私人建议后点击选择                                    | 依服务回执显示只读，零写入；强制调用被拒绝                                              | VM；服务响应样例           |
| readOnly/enabled + 读取失败 | 重新读取                                                  | 明确“读取失败”和重试入口，不伪造成功空历史                                              | VM；模拟器                 |
| enabled + 已写历史          | 查看“我的历史”                                            | 模拟器两条 completed、一条 selected，与三条服务历史一致                                 | VM；模拟器                 |
| 服务合成 A/B                | A 选择/完成，B 读取同日历史                               | B 历史为空；会话和账号标识不进入响应证据                                                | 服务响应样例；既有隔离回归 |

完整响应在 [service-samples.json](evidence/service-samples.json)：四组独立数据库，分别执行 select→complete/replace/skip 和服务只读拒绝；每组最后以合成 B 查询历史。来自当前 `createProductionEntry`，没有手写成功回执。会话、ownerId 和内部 `_id` 已移除。三条模板由共享 DEFAULT_TASKS 灌入本地 task_templates，不能据此声称目标云正式模板已确认。

## 截图与复跑

| 截图                                                                                                | 核对内容                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------ |
| [01 关闭](evidence/01-closed.png)、[02 只读](evidence/02-readonly.png)                              | 入口、禁用边界                 |
| [03 读取失败](evidence/03-read-failure.png)、[08 原请求待确认](evidence/08-pending.png)             | 两种失败反馈和原操作重试提示   |
| [04 迟到选择](evidence/04-late-selection-stays.png)                                                 | 返回小任务后不被旧回执自动带走 |
| [04 校园暂停](evidence/04-campus-paused.png)、[05 校园返回](evidence/05-campus-return-selected.png) | 暂停回执和 selected            |
| [06 心情记录](evidence/06-task-record.png)、[07 保存返回](evidence/07-record-return-selected.png)   | 实际记录页与保存后的 selected  |
| [09 历史](evidence/09-history.png)                                                                  | 显式完成后的历史状态           |

模拟器截图采用开发者工具提供的模拟手机外观，不是真机。截图已逐张核对。最终运行的 11 个检查点、时间、源码哈希和 `restoredCloudDisabled: true` 见 [simulator.json](evidence/simulator.json)。模拟器每次结束恢复原禁云配置和 API，清除合成会话。辅助工具只在手动执行时桥接，不进入发布客户端。

Node.js 24，官方微信开发者工具，miniprogram-automator 0.13.0（仅本机工具，不新增项目依赖）。复跑：

```sh
npm run setup
npm run cloud:prepare
node --test tests/week6-qc-task-flows.test.js
node tools/week6-qc/export-samples.cjs "$PWD/docs/week6/qizhen-chen/evidence/service-samples.json"
# 先导入仓库，扫码登录开发者工具并开启 CLI 服务端口；保持本地 cloudEnabled:false。
# cli auto --project "$PWD" --auto-port 9420 --trust-project
MINIPROGRAM_AUTOMATOR_MODULE=/absolute/path/to/miniprogram-automator \
QC_SIMULATOR_OUTPUT="$PWD/docs/week6/qizhen-chen/evidence" \
node tools/week6-qc/wechat-task-flows.cjs
npm run check
npm run team:check:production
# 提交并确认工作区干净后，在仓库外生成本地候选；不上传微信。
npm run release:package -- /absolute/path/outside/repository/candidate closed
```

全量 1615 项测试、正式装配 8 组合成联调通过，见[检查摘要](evidence/validation.txt)；11 项新增测试包含在全量数中，不重复累计。macOS 首轮因临时目录别名触发既有路径保护，改用规范真实临时路径后通过，保护和断言未修改。最终候选摘要由关联 PR 列明。SDK 与业务替身没有放宽断言或吞异常，SDK 夹具阻止真实网络调用。

## 交接与边界

- Jiawei：核对本次真实入口响应与 W6-JF 样例、正式模板规则是否一致；收到新样例后按同一工具复跑。现有 W5 契约已采用，但 W6 本人确认仍待回传。
- Yuen：在本 PR 完整提交、相同候选上独立复核矩阵、截图及 manifest；结论保持待复核。
- 洪翔：最终合并、装配和本周放行由负责人签认。本次不合并 PR、不新增云资源、不操作真实账号或数据库、不上传体验版。
- 真实云、设备文件送达、微信后台隐私/UGC生效和送审按第六周计划进入后续交接；旧周未验项目保留原状态，不因这次本地通过标为完成。

信息影响：仅给任务选择的自动跳转增加页面访问围栏，无新字段、用途、权限、SDK、UGC传播或生命周期变化；没有读取真实正文或身份。记录保存只用空正文的合成天气记录。原有隐私/内容安全发布待办继续适用。
