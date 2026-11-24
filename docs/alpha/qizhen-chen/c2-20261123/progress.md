# C2-QC｜共同输入、任务动作与两条往返

预定周期：**2026-11-23—24**。实际执行：**2026-11-24**。主责 Qizhen Chen / grrrced，AI协助；Refs [#206](https://github.com/HX-Jan/MoodSky/issues/206)。完整基线 **7feca53ff0ed461cac270b7da7e7c36f36b7973b**，分支 test/alpha-qc-c2-followup，工具/资料提交完整SHA以本PR为准。

## 实际动作、步骤与结果

| 输入与操作                                                                                          | 预期与实测                                                                                                                   | 证据                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| closed/readOnly/enabled，对照JF样例；各四动作及动作后历史                                           | 24行通过。closed零任务请求；readOnly仅建议无私人写/历史；enabled确认后页面和服务历史一致                                     | [模式表](mode-action-state.csv)、[49项定向](evidence/targeted-tests.txt)                                                                                                                                                                      |
| 重新执行Jiawei collect-samples                                                                      | 三模式、8个状态步骤及回放/跨日/失败样例，与已接收JSON逐字段一致                                                              | [对比指纹](evidence/jf-comparison.json)，不是Jiawei对QC的验收                                                                                                                                                                                 |
| Yifan七条共享种子，逐条独立内存库：选择记录→填写天气/映射标签/合成正文→保存→返回→重开→返回→显式完成 | 7/7；保存及重开后均selected；天气、CUSTOM名、标签、合成正文完全一致；一次upsert、一条记录、一条任务历史；显式完成才completed | [机器结果](evidence/shared-flows.json)、[两链路表](two-flow-results.csv)                                                                                                                                                                      |
| 散心及校园阅读各走任务→校园→选第一地点→暂停反馈→返回→显式完成                                       | 2/2；五地点与共享目录一致；选点零服务请求，暂停零place_checkins；返回selected，点击完成才completed                           | 同上；QH已接收原生资料按原日期引用                                                                                                                                                                                                            |
| 当前原生三模式、失败/未知/重试、校园/记录往返、替换跳过历史                                         | 11项及两处布局通过；任务64×44、校园65×44、右边距均0；替换/跳过历史2行                                                        | [原生结果](evidence/native/native-results.json)、[跨页明细](evidence/native/round-trips/simulator.json)                                                                                                                                       |
| 新原生保存重开                                                                                      | SUNNY、空合成正文；journal.get确实再次读取，一次upsert/一行记录；两次返回selected，显式completed                             | [原生结果](evidence/record-reopen/native-results.json)、[保存返回](evidence/record-reopen/01-saved-return-selected.png)、[重开](evidence/record-reopen/02-reopened-saved-record.png)、[完成](evidence/record-reopen/03-explicit-complete.png) |

16个新工具场景包括3模式、7记录、4校园（两暂停/两可写离线）、2跨日；49项定向为既有全量子集，不与24行表/工具场景相加当单测数。七天气种子日期仍为11/16—22，夹具时钟逐条选相应业务日；执行日期独立记录11/24，未改原始种子或冒充手机实测。

环境：macOS arm64 / Node24.18.0 / 微信开发者工具Stable2.02.2609240、automator0.13.0；实际Page/控制器→production入口→SDK离线数据库，合成身份。磁盘配置始终cloudEnabled:false，桥接仅进程内临时替换API，finally恢复API/配置/会话、回今天页；云/手机/平台未执行。19张本次原生图在native和record-reopen目录，原11/20、11/22证据不覆盖。

新工具首跑因能力比较漏传可信云夹具配置而失败，[原日志](evidence/fixture-first-failure.txt)保留；补齐与真实Page相同的配置后，[复测16项](evidence/fixture-retest.txt)通过。没有修改产品或削弱断言。新增工具复用既有VM加载器，只扩展实际记录/校园Page，不复制业务实现；旧未知结果测试仍原样通过。verify.cjs本次修正来源记录为实际git HEAD及dirty值，固定11/20仅为原异常业务时钟；旧证据不改。

## 回传与接手

依赖输入已使用JF当前样例、YF恢复的七天气种子、QH五地点/暂停约定。[来源清单](evidence/source.json)与[文件核对](evidence/source-hash-check.json)说明工作树工具/资料有改动，产品字节与7feca53ff0ed461cac270b7da7e7c36f36b7973b一致。完整本地检查见[evidence/validation.txt](evidence/validation.txt)。

交Jiawei复核动作/日期/回执，Yuen复跑QC01/02新head，Yifan/Qinghan核对各自入口差异，Jiaqi/洪翔收当期图和日志2供稿。Yuen此前已独立通过C1本地矩阵，本轮新结果尚未取得指定独立意见；不写已验收或关闭议题。实际工时未提供；16h仍计划。C3/C4技术场景已于11/24预验，详见[总表](../cycles.md)。

## 日志2可引用段落

Qizhen Chen在11月24日按当前主干对齐Jiawei已接收样例，完成三模式24行页面/服务状态表和49项定向检查。七天气共享种子逐条走完任务记录的保存、返回与重开；散心及阅读两条校园路径验证选点不等于打卡，返回仍已选。原生11项、两处右侧布局和保存重开通过，归档19张当期图。未发现新产品缺陷，扩展验证工具并保留首跑配置失败及复测。当前成果待指定复核；团队燃起图沿用维护者11/24的11/48口径，不自行加点。

## 补齐可写离线对照

同一校园路径另在专用内存库显式解除夹具暂停，散心/阅读各1条：选择地点零请求，显式手动打卡1行，重复点击仍1行；服务记录打卡后任务仍selected，最后显式完成才completed。正式候选与原生预览的暂停配置保持不变。总工具场景现为16条，新增两条只在SDK离线库写入，没有真实云资源变化。

此扩展首次断言在异步打卡完成前检查行数而失败；onCheckinTap返回时内部send仍运行。已改为等待busy/loading结束再检查，不放宽断言。[夹具失败与处理](evidence/writable-fixture-failure.txt)保留脱敏原因，完整原日志留工作区外；最终16项同断言通过。
