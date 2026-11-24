# Alpha｜Qizhen Chen 任务页面验收

**11/24最新状态：**四周期按预定窗口归档，实际日期另列。C2共同输入/跨页已跑，C3异常与C4三模式候选已提前预验；Yuen已通过C1本地矩阵，本轮新head及Jiawei复核、最终冻结仍待。见[四周期总表](cycles.md)、[C2当期回传](c2-20261123/progress.md)、[C3预验](c3-20261125/progress.md)、[C4候选交接](c4-20261127/progress.md)及[更新总结供稿](c4-20261127/personal-summary.md)。下文原日期快照保留，不作为实时状态；16小时仍为计划预算。

**11/22 C1更新：**#210、#212均已合并；本次从main `11a34159ab4e606ae269c9e23f51acfdaf748ab2` 补跑24行模式表、15项定向、原生11项/布局与保存重开，归档9张新图。完整工具首次桥接超时与原工具复测通过分别保留；Yifan新种子结构7/7通过，尚未完成共同种子联调。见[C1回传与未完成项](c1-20261122/progress.md)、[阶段感想初稿](personal-summary.md)和[16小时工时计划](workload-plan.md)。16小时仅为预算，实际工时未知；两原单元仍待Jiawei/Yuen独立验收，C2—C4按各期真实成果补入。

**11/20 任务分册补交：**[#210](https://github.com/HX-Jan/MoodSky/pull/210) 已合并至 `562a099b6b8bf5ee37df83583b3a66f85914f607`，原16图和预跑结论按下文保留。现从最新 main `f6e60841478cb90ca1cf0b36dce1077e9bd85ba5` 接续，新增“保存后重开记录”原生实测和3图；记录只保存1行，两次返回任务仍 selected，显式完成后才 completed。详见[按模板填写的实际回传与四周期安排](progress.md)、[跨页入口/输入](cross-page-entry-map.md)、[baseline](task-page-baseline.csv)、[两链路结果](two-flow-results.csv)、[异常表](task-page-boundaries.csv)、[演示步骤](demo-tasks.md)和[个人总结事实初稿](personal-summary.md)。新验证构建 `dc228d16a5e49e20c40a3d83559c6af637b14757`；本人工时/签认、当期样例和两单元独立验收仍待实际回填。下面的“本轮”“待合并”等文字为 #210 原交审时点，不改写成四周期成果。

| 项目          | 来源                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------- |
| 课程          | [2601 FZU-MU 软件工程](https://bbs.csdn.net/forums/2601_MU_SE_FZU)                                 |
| 作业          | [Fifth Assignment — Alpha Sprint](https://bbs.csdn.net/topics/620611106)                           |
| 本人 / GitHub | Qizhen Chen / `grrrced`                                                                            |
| 议题 / 单元   | [#206](https://github.com/HX-Jan/MoodSky/issues/206)；AS-QC01、AS-QC02                             |
| 目标          | 任务三模式与跨页一致；异常结果可辨识、原请求不重复写、旧访问不导航                                 |
| 当前来源      | v0.5.2 / `5b2775393a4adbf5d9a77ff2a3c61b3c3bb3958c`                                                |
| 运行日期      | **2026-11-20，冲刺开始前预跑**；不是 11-21—11-28 已发生的四期回传                                  |
| 环境          | macOS arm64、Node.js 24.18.0、微信开发者工具 Stable 2.02.2609240、automator 0.13.0（本机已有工具） |

## 两个独立单元

| 单元    | 本轮实际成果                                                            | 本地执行                         | 依赖与独立验收                                             |
| ------- | ----------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| AS-QC01 | 24 行模式/动作/历史对照；校园和记录保存往返；任务与校园右侧按钮几何核对 | 通过，材料交审                   | AS-JF01/QH01/YF01 尚无 Alpha 回传；Jiawei、Yuen **待复核** |
| AS-QC02 | 四种动作各自连点、丢回执、返回、原请求重试；迟到导航反例与当前对照      | 通过，材料交审；本轮无需产品修复 | AS-QC01 的依赖确认及 Jiawei、Yuen **待复核**               |

不以一个 Issue 的关闭比例计算两单元进度。#206 保持开放；本地通过、资料交审与复核通过分列。工作由用户授权的 Codex 协助执行，未代填 Jiawei/Yuen 签字、个人工时或感想。

## 来源与依赖

- 从最新 main 建分支 `test/alpha-qc-task-acceptance`；下载完整归档超时后复用已核对的本机 Git 对象，仅从 GitHub 补齐 76 个新对象。完整远端树与签名 commit 均精确匹配上述 SHA，没有用旧周整包覆盖。
- [#190](https://github.com/HX-Jan/MoodSky/pull/190) 原 head `f0efa150491ca99b956b4a5f974ff55af0bf9a86` 已关闭，由 [#191](https://github.com/HX-Jan/MoodSky/pull/191) 在 `c0518e58cbdc2aee75d675b2260df8d45529bdd8` 整合采用。旧 W6 [报告](../../week6/qizhen-chen/README.md)、日期和图片保持原样。本轮新证据在本目录，旧修复不重复计为新修复。
- 保留 #182 任务按钮、#193 到访提示、#194 校园「选这里」右侧布局。七天气与全部产品源码均不修改。本轮只新增本机验证工具、4 项有行为意义的回归和交接资料。
- Jiawei 的 [#171 契约](../../week5/jiawei-fang/w5-jf-task-contract.md)已合并，当前正式入口按该契约实际运行。[AS-JF01 #205](https://github.com/HX-Jan/MoodSky/issues/205) 查询时无样例或回传；本地当前模板与服务状态不是 Jiawei 本轮签认的样例。收到其回传后须对同一完整构建复核。
- [AS-QH01 #203](https://github.com/HX-Jan/MoodSky/issues/203)、[AS-YF01 #199](https://github.com/HX-Jan/MoodSky/issues/199) 查询时无 Alpha 回传。已整合的 W6 校园/记录实现用于本轮实际跨页；尚未收到的当期材料不填已完成。
- 开始及交审前核对开放 PR：#196（Drose-2301）head `080950d3a28611f217eaa69bff389c9bb0e5f2ee`、#197（Yuminu）head `1035ce115e675e72176315a32d9dd6710a3a2b25`；均为 W6 材料、待审，未合入本轮分支。Yuen 的旧回归结论不当作本 PR 的独立复核。

## AS-QC01：模式、动作与实际状态

机器表：[mode-action-state.csv](evidence/mode-action-state.csv)，完整数据与实际服务行：[local-results.json](evidence/local-results.json)。24 行来自 3 模式 × 4 动作 × 动作/历史两项；不是 24 个独立任务或完成率。

| 模式     | 选择                 | 替换                                   | 跳过               | 完成                 | 历史                       |
| -------- | -------------------- | -------------------------------------- | ------------------ | -------------------- | -------------------------- |
| closed   | 处理器拒绝、零请求   | 同左                                   | 同左               | 同左                 | 不提供、不请求             |
| readOnly | 无写按钮、零写入     | 同左                                   | 同左               | 同左                 | 不提供、不请求私人历史     |
| enabled  | available → selected | selected → replaced；替代任务 selected | selected → skipped | selected → completed | 与各动作的正式服务结果一致 |

每组使用独立本地 SDK 数据库，非选择动作先确认 selected，再操作。替换后历史共两行；完成/跳过各一行。`serviceRows` 只保留合成 taskId/date/state，页面状态与服务数据库逐项对应，未输出 ownerId/会话。

| 可达路径、步骤                                        | 预期与实测                                                                               | 当期证据                                                                                                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务 tab → 选择散心 → 校园 → 返回                     | 回执确认后进校园；尝试打卡明确暂停且零新增；返回仍 selected，显式完成才 completed        | [校园暂停](evidence/round-trips/04-campus-paused.png)、[返回仍已选](evidence/round-trips/05-campus-return-selected.png)                                                |
| 任务 tab → 记录心情 → 晴天 → 保存 → 返回              | 实际调用本地 journal.upsert，形成一条空正文合成记录；返回 selected，显式完成才 completed | [记录页](evidence/round-trips/06-task-record.png)、[保存返回](evidence/round-trips/07-record-return-selected.png)                                                      |
| 选择 → 校园选这里 → 返回 → 替换 → 跳过替代任务 → 历史 | 原任务 replaced、替代任务 skipped；服务与页面各两条历史，零打卡写入                      | [替换](evidence/13-replaced.png)、[跳过](evidence/14-skipped.png)、[历史](evidence/15-replace-skip-history.png)                                                        |
| 核对两处按钮边界                                      | 任务 64×44、校园 65×44（模拟器逻辑像素）；相对父容器右边距均 **0**，保持紧凑右侧按钮     | [任务右侧](evidence/10-task-right-button.png)、[校园右侧与到访提示](evidence/11-campus-right-button.png)；几何值见 [native-results.json](evidence/native-results.json) |
| 三模式入口与读取失败                                  | 关闭态不发任务请求；只读有明确提示；失败显示重试，不伪装成空历史                         | [关闭](evidence/round-trips/01-closed.png)、[只读](evidence/round-trips/02-readonly.png)、[读取失败](evidence/round-trips/03-read-failure.png)                         |

模拟器图片中手机外观为工具模拟，不是真机。新 [wechat.cjs](../../../tools/alpha-qc/wechat.cjs)先在**当前 checkout**复跑既有 W6 导航工具，再补实际渲染控件的替换/跳过点击与几何测量。`round-trips/simulator.json` 保留其原工具任务标记 W6-QC，但时间、文件哈希及输出全部是本次新跑，Alpha 汇总明确注明复用关系。所有 API 请求经本机桥接进入实际生产入口与 SDK 离线夹具，未连接已部署云函数。

## AS-QC02：异常反例与重试

新增 [4 项回归](../../../tests/alpha-qc-unknown-results.test.js)，覆盖 select、complete、replace、skip 各自的未知结果。本轮扩展到完成/替换/跳过的丢回执，不重复抄录旧周 11 项测试作为新增数。

1. 实际任务 Page 使用当前控制器发起动作；挂起响应并再次点击，断言只发 1 个请求、页面保留动作前状态、零导航。
2. 正式入口先提交，再模拟传输丢回执；页面进入 retryPending，不能凭客户端推断成功。
3. 隐藏并返回后不自动重放；用户显式重试，比对**完整原请求**，含 requestId、payload 和 expectedDate。
4. 回执恢复后才呈现目标状态；历史行数不增加，替换仍为两行，其他动作一行；恢复选择不会自动进入活动。

| 动作     | 连点新增请求数 | 丢回执后提示 | 重试请求 | 提交后/重试后历史行数 |
| -------- | -------------- | ------------ | -------- | --------------------- |
| select   | 1              | 结果尚未确认 | 完整相同 | 1 / 1                 |
| complete | 1              | 结果尚未确认 | 完整相同 | 1 / 1                 |
| replace  | 1              | 结果尚未确认 | 完整相同 | 2 / 2                 |
| skip     | 1              | 结果尚未确认 | 完整相同 | 1 / 1                 |

原输入、行数和断言结果见 `local-results.json` 的 `abnormal`。原生未知结果提示见 [08-pending.png](evidence/round-trips/08-pending.png)。

迟到导航对照为**本轮重新执行的内存变异实验**，不是新线上缺陷：仅在 VM 内移除 `sequence === this._connectSequence` 守卫，选择→隐藏→返回→确认，自动跳转 **1 次**；实际源码同流程 **0 次**，仍 selected，手动打开活动有效。实际源码未改写。原生真实切 tab 也保持小任务页，见 [迟到回执](evidence/round-trips/04-late-selection-stays.png)。旧修复前的原始失败另按 W6 日期引用，不改称本轮生产代码修复前结果。

## 构建、运行与检查

被测产品是干净基线 `5b2775393a4adbf5d9a77ff2a3c61b3c3bb3958c` 加本 PR 的本地工具，产品 JS/WXML/WXSS 没有差异。测试时工具尚未提交，不能称整仓工作区干净；交审完整 head 以 PR 为准。`local-results.json` 与 `native-results.json` 的 sourceHashes 固定实际文件字节，交审前再次核对。

本地固定业务时钟 2026-11-20T04:00:00Z；模拟器使用执行时刻。模板由共享 DEFAULT_TASKS 注入合成 task_templates，不证明目标云正式模板数据。两处开发者配置均默认 `cloudEnabled:false`，仅自动化期间把 API 换成本机桥接，结束恢复原环境/API、清除合成会话；未沿用任何旧云写入授权。

```sh
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm run cloud:prepare
node --test tests/alpha-qc-unknown-results.test.js
node tools/alpha-qc/verify.cjs "$PWD/docs/alpha/qizhen-chen/evidence"
# 微信工具导入当前目录，扫码登录并打开 CLI 服务端口；保持真实云关闭。
# cli auto --project "$PWD" --auto-port 9420 --trust-project
MINIPROGRAM_AUTOMATOR_MODULE=/absolute/path/to/miniprogram-automator \
QC_SIMULATOR_OUTPUT="$PWD/docs/alpha/qizhen-chen/evidence" \
node tools/alpha-qc/wechat.cjs
npx prettier --write docs/alpha/qizhen-chen/evidence/*.json
npm run check
npm run team:check:production
```

macOS 本轮为测试指定仓库外、无 `/var` 别名的临时目录，保持打包路径保护不变。**全量 1638/1638、正式装配 8 组通过**；新增 4 项包含在全量中，不重复累计。实际输出摘要见[检查记录](evidence/validation.txt)。本轮不装配或冒称 Yuen 的最终同包候选，不上传微信、不部署或清理真实云。

## 回传、复核与作业材料

[预跑回传与四期登记](returns.md)提供动作、构建、环境、实测和接手人；[测试文章素材](testing-notes.md)说明工具与用例选择，供团队日志/测试文章引用。没有发布 CSDN 博客或提交课堂作业，团队总集、燃起图、总结和答辩按负责人汇总；本材料仅覆盖本人两个单元。

当前[进度数据](evidence/progress.csv)与[燃起图起始点](evidence/burn-up.svg)只表示本人两个单元已有可交审材料、独立验收 0；不提供假造的未来趋势或团队完成率。11-21—11-28 四期实际数据须到时补回。

| 待办               | 接手人与条件                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------ |
| 当期依赖核对       | Jiawei #205 提供 AS-JF01 样例；Qinghan #203/Yifan #199 提供本轮结果，再以同一完整提交对照  |
| 两单元独立复核     | Jiawei、Yuen 分别核对矩阵、异常原输入/行数、原生入口和构建，留下本人结论                   |
| 冲刺窗口内四期回传 | Qizhen Chen 按实际发生的 11-21—22、23—24、25—26、27—28 成果登记；不预填完成                |
| 最终整合/放行      | 洪翔审核 PR；Yuen 按最终完整 SHA 装配和复测。两个单元及复核全部通过后由负责人决定关闭 #206 |
| 云、手机、平台     | 本轮未执行，保持待验；部署/真实写入/清理/微信发布不在授权范围                              |

隐私影响：无新增产品字段、接口、权限、SDK、信息用途、保存/导出/清理或 UGC 变化。只在本机使用合成任务、空正文天气记录及合成账号；证据不含真实身份、日记、会话或导出凭证。原隐私与内容安全发布待办继续适用。
