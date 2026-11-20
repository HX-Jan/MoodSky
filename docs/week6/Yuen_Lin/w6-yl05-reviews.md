# W6-YL05 队友第六周材料复核记录

- 复核人：Yuen Lin（回归、候选装配与证据归档）
- 复核时间：2026-11-20 13:34—13:40（Asia/Shanghai）
- 复核对象：`origin/main` @ `5b27753` 的 `docs/week6/`、#184—#196、`docs/releases/v0.5.2.md`
- 边界：本页只记录源码/文档/本机可复跑的复核。**不代签真机、目标云、微信后台或独立隐私结论；不把成员自报转写为 Yuen 的独立验收。**

## 一、总览

| 任务  | 负责人        | 固定来源                                                                        | 状态             | Yuen 复核结论                                 |
| ----- | ------------- | ------------------------------------------------------------------------------- | ---------------- | --------------------------------------------- |
| W6-H  | 洪翔          | [#184](https://github.com/HX-Jan/MoodSky/pull/184) `9b48918`，经 #191/#192 整合 | 已收件           | 版本页/构建比较源码存在；目标云健康显示未实测 |
| W6-QH | Qinghan Zhang | [#185](https://github.com/HX-Jan/MoodSky/pull/185) `87ed547`，经 #191 整合      | 收件，待复核     | 本地 253/253 与流程表可引用；真机/云未测      |
| W6-YF | Yifan Ji      | [#186](https://github.com/HX-Jan/MoodSky/pull/186) `eac260d`，经 #191 整合      | 收件，待复核     | 6 项本地演示通过；A/B 未测；非最终构建        |
| W6-XY | Xiang Yu      | [#187](https://github.com/HX-Jan/MoodSky/pull/187) `4f762a3`，经 #191 整合      | 收件，待复核     | 14/14 本地合成；真实文件/维护未测             |
| W6-L  | Linghan Chen  | [#188](https://github.com/HX-Jan/MoodSky/pull/188) `d130b9c`，经 #191 整合      | 收件，待复核     | 9 focused + 157 related 可复跑；设备文件未测  |
| W6-Z  | Zhifeng Dai   | [#189](https://github.com/HX-Jan/MoodSky/pull/189) `3250cfd`，经 #191 整合      | 收件，待复核     | 7/7；修复进入最终提交；原生截图缺             |
| W6-QC | Qizhen Chen   | [#190](https://github.com/HX-Jan/MoodSky/pull/190) `f0efa15`，经 #191 整合      | 收件，待复核     | 三模式/修复进入最终提交；模拟器未复跑         |
| W6-JH | Junhan Huang  | [#196](https://github.com/HX-Jan/MoodSky/pull/196) `080950d`                    | **open，未合入** | 工具已独立复跑，23 组语义一致；不进入最终候选 |
| W6-JQ | Jiaqi Zhu     | 未找到第六周交付                                                                | **缺**           | 无法复核；列为 B01                            |
| W6-JF | Jiawei Fang   | 未找到第六周交付                                                                | **缺**           | 无法复核；列为 B02                            |
| W6-C  | 蔡奇真        | 未找到第六周交付                                                                | **缺**           | 无法复核；列为 B03                            |
| W6-YL | Yuen Lin      | 本目录                                                                          | 本轮交付         | 见 README、矩阵与候选清单                     |

说明：#184—#190 在 GitHub 上均为 closed，内容由 #191 逐文件整合；成员原报告与提交保持原样。收件不等于 Yuen 独立验收。

## 二、逐项复核

### W6-YF Yifan Ji — 记录保存与恢复

- 来源：`docs/week6/yifan/w6-yf-record.md`；基线 `987b19d`（11-16 预演于 `d90ad13` 链）；禁云本地演示 + iPhone 预览；5 张截图。
- 自报：已有记录回显、自定义名称 21 码点拒绝、任务→记录、失败恢复、连点锁定、七天气循环共 6 项通过；**A/B 切号未测**。
- Yuen 复核：最终提交 `5b27753` 的记录定向 177/177（[r01-journal.txt](artifacts/yl02/r01-journal.txt)）；`week6` 记录相关测试在全量 1634 内通过。
- 不能签认：真实微信登录、目标云回执、A/B 切号、真机同包。
- 结论：**本地来源可引用；W6-R01/R02 待复核，W6-R03 阻塞。**

### W6-Z Zhifeng Dai — 月历、档案与回顾

- 来源：`docs/week6/zhifeng-dai/README.md`、`w6-z01`—`w6-z05`；MoodSky-main 快照；禁云演示；`tests/week6-review-zhifeng.test.js` 7/7。
- 自报：Z01—Z07 覆盖跨页一致、修改删除同步、非当前月刷新、失败恢复、装饰降级、迟到响应、切号隔离；修复演示模式离页未释放读取；本机无开发者工具，无模拟器截图。
- Yuen 复核：最终提交回顾定向 155/155（[r02-review.txt](artifacts/yl02/r02-review.txt)）；`week6-review-zhifeng` 8 个用例通过；`universe-pull-refresh` 通过。
- 不能签认：原生页面截图、真机渲染、真实云、真实 A/B。
- 结论：**源码修复与本地断言可引用；W6-R04—R06 待复核。**

### W6-L Linghan Chen — 登录、分享、导出界面

- 来源：`docs/week6/linghan-chen/README.md`；基线 `13afb20`；禁云 DevTools；`tests/week6-linghan-login-share-export.test.js` 9 passed + related 157 passed。
- 自报：登录成功/取消/失败、游客公开入口、私人详情安全入口、跳过资料、退出清缓存/预览、迟到导出、B 不得恢复 A 导出状态；电脑保存/手机送达列为未测。
- Yuen 复核：最终提交账号/登录/分享/导出界面定向 272/272（[r03-account.txt](artifacts/yl02/r03-account.txt)）；`week6-linghan` 9 项、`page-sharing`、`native-export-file` 通过。
- 不能签认：真实微信登录、真实分享回调、真实文件送达、真实 A/B、目标云。
- 结论：**本地源码可引用；W6-R07/R08/R10 待复核，W6-R09 阻塞。**

### W6-QH Qinghan Zhang — 校园地点与打卡前端

- 来源：`docs/week6/qinghan-zhang/README.md`、`five-places.csv`、`executed-cases.csv`、TAP 与响应样例；基线 `13afb20`；本地 1604/1604、校园定向 253/253、生产装配 8/8；原生截图与剩余步骤另列。
- 自报：五地点、任务入口、选点→完成、游客、暂停、连点、失败、跨日、历史分页、切号、下架地点、非法日期；QH-W6-01 具体限制未在正式页展示，QH-W6-02 来源证据有限；用户已确认五地点资料无变化。
- Yuen 复核：最终提交校园定向 244/244（[r05-campus.txt](artifacts/yl02/r05-campus.txt)）；`manual-campus-client`、`manual-campus-checkin`、`checkin-outbox` 通过。
- 不能签认：目标云四 action、真实云暂停/历史、真机、Junhan 五地点独立确认。
- 结论：**本地前端可引用；W6-R16—R18 待复核。**

### W6-QC Qizhen Chen — 小任务页面与完成状态

- 来源：`docs/week6/qizhen-chen/README.md`、`service-samples.json`、`simulator.json`、9 张截图；基线 `13afb20`；VM + 禁云模拟器；全量 1615、正式装配 8 组；修复迟到选择回执自动跳转。
- 自报：closed/readOnly/enabled、选择/完成/替换/跳过/历史、校园/记录往返、连点、失败、离页、原请求待处理、A/B 合成隔离；模拟器截图非真机。
- Yuen 复核：最终提交任务定向 220/220（[r06-tasks.txt](artifacts/yl02/r06-tasks.txt)）；`week6-qc-task-flows` 11 项通过；修复已在 `5b27753` 中包含。
- 不能签认：真实云、真机、真实 A/B、Jiawei 正式模板确认。
- 结论：**本地源码与修复可引用；W6-R20—R22 待复核，W6-R23 阻塞。**

### W6-XY Xiang Yu — 导出、到期维护与注销清理

- 来源：`docs/week6/XiangYu/README.md`、`W6XY-导出与清理本地验收报告.md`、`W6XY-维护与补验单.md`、`evidence/`；基线 `987b19d`；Windows + Node 24 + 合成夹具；`tools/week6-xy/verify-export-cleanup.cjs` 14/14。
- 自报：A/B 导出内容与格式、领取/跨账号/来源失效/到期/停用、分批清理、B 与公共地点完整；真实定时器、自然到期、多实例、设备送达、备份残留未测。
- Yuen 复核：最终提交导出/生命周期定向 124/124（[r04-export.txt](artifacts/yl02/r04-export.txt)）；`export-*`、`production-lifecycle` 通过。
- 不能签认：真实文件后端、真实维护执行、真实注销清理、目标云。
- 结论：**本地合成证据可引用；W6-R13—R15 待复核，W6-R09/R12 阻塞。**

### W6-H 洪翔 — 版本页与候选范围

- 来源：#184 `9b48918`（版本页构建差异与云端打卡状态），经 #191 整合；#192 后续分开两项检查；`docs/releases/v0.5.2.md`。
- Yuen 复核：最终提交装配定向 66/66（[r07-package.txt](artifacts/yl02/r07-package.txt)）；`cloud-bundle-defaults`、`production-package`、`production-server-config` 通过；`v0.5.2` 标签指向 `5b27753`。
- 不能签认：目标云 `system.health` 实际响应、后台版本/隐私状态、发布人签认。
- 结论：**版本页源码可引用；W6-R24 待复核，平台/云阻塞。**

### W6-JH Junhan Huang — 校园接口与历史数据（开放 PR #196）

- 来源：[#196](https://github.com/HX-Jan/MoodSky/pull/196)，head `080950d`，base `5b27753`，`mergeStateStatus=BLOCKED`；仅新增 `docs/week6/Junhan_Huang/` 与 `tools/week6-jh/checkin-samples.cjs`。
- Yuen 独立复跑：创建临时 worktree 检出 `080950d`，复制 `cloud:prepare` 生成的共享契约，运行 `node tools/week6-jh/checkin-samples.cjs`，得到 23 组样例；`summary` 与提交件一致（`checkinRows=4`、`dates=2026-11-18/19`、`retiredWriteCode=INVALID_INPUT`、`pauseNewWriteCode=NOT_IMPLEMENTED`、`exportCheckinCount=4`）。原始文件哈希差异仅为 JSON 缩进，规范化后完全一致（[pr196-reproduction.txt](artifacts/yl05/pr196-reproduction.txt)、[pr196-regenerated-samples.json](artifacts/yl05/pr196-regenerated-samples.json)）。
- 边界：#196 **未合并**，其文件不在最终候选 `5b27753` 中；目标云、真实清理、真实 A/B 未测；Qinghan/蔡奇真独立复核未取得。
- 结论：**工具可复现；W6-R19 阻塞（未合入），合并后需重新出包复测。**

### W6-JQ / W6-JF / W6-C — 缺件

- `docs/week6/` 下无 jiaqi、jiawei、qizhen-cai 目录；GitHub 无对应开放 PR；#171（W5-JF）与 #178（W5-C）为历史材料，不能替代第六周。
- 影响：界面走查、偏好/停用/注销、独立隐私与生命周期结论无法在本轮复核；对应矩阵项保持阻塞。
- 结论：**不代签、不补造；要求本人补交。**

## 三、复核方法与原始证据

- 成员材料：`git ls-tree -r origin/main -- docs/week6` 与逐文件 `git show`；来源索引 [member-source-index.txt](artifacts/yl05/member-source-index.txt)。
- PR 状态：[pr-snapshot.json](artifacts/yl01/pr-snapshot.json)、[pr196-view.json](artifacts/yl05/pr196-view.json)。
- 最终提交复测：完整 1634/1634 与 7 组定向 1258 项（子集，不重复相加）；证据见 [artifacts/yl02/](artifacts/yl02/)。
- 未使用真实私人日记、身份、令牌、导出凭证或位置轨迹；#196 样例使用合成账号与合成地点。
