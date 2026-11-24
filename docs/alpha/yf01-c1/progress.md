# AS-YF01 · C1 补交进度说明（progress.md）

- 任务编号：AS-YF01（第 2 次补交：原生自动化复验 + 边界用例补齐）
- 测试人：Yifan Ji (@Fanny-126)
- 日期：**2026-11-22**
- 关联 Issue：#199

## 一、构建与环境（按返修意见，双基线如实标注）

| 项                                | 内容                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 原生自动化 / 单元测试基线         | **36ff7f54476ff19cbacba7238b11ee34a5adcdf6**（分支 test/as-yf01-c1-native，基于最新 main）                                            |
| 手工页面证据构建                  | 6e91ead92dd8ecc143e38bff956ff239e4765296（feat/as-yf01-weather-record 真机预览，可追溯）                                              |
| 新增边界用例（NAME-00 / NAME-04） | 36ff7f5，开发者工具 journalDemo 演示模式（手工页面证据允许方式）                                                                      |
| 测试工具                          | 微信开发者工具 Stable 2.02.2608080；miniprogram-automator@0.13.0（仓库外 `D:\Projects\qc-tools`）；Node 24                            |
| 磁盘配置                          | 原生运行：cloudEnabled:false / cloudEnvId:'' / journalDemo:false；手工证据临时 journalDemo:true，用后已恢复 false（详见 source.json） |
| 真机                              | iPhone 15 Pro Max / iOS 26.6.1 / 微信 8.0.79                                                                                          |
| 21 日材料说明                     | 21 日三张图构建不可追溯，仅作辅助引用；结论以 22 日已知构建补测与 36ff7f5 原生复验为准                                                |

## 二、补做范围（按返修意见，不扩大）

- [x] 七天气全流程：新建 → 重开 → 编辑 → 删除，各至少一轮（W01–W07，28 例）
- [x] 自定义名称码点：**空值 / 1 / 20 / 21 / 22 码点五档全覆盖**（NAME-00、NAME-04 本轮新增于 36ff7f5；NAME-01/02/03 沿用 22 日手工证据并标注构建；22 码点保留为独立超限用例）
- [x] 当天记录不重复核对（DUP-01）
- [x] 任务入口（TASK-01/02）：**原生自动化已解阻塞**（新增 TASK-01R / TASK-02R，wechat.cjs --record-reopen，禁云磁盘配置 + miniprogram-automator，PASS；旧阻塞登记保留为历史）
- [x] 单元测试：node --test tests/journal-pages.test.js tests/journal-recovery-native.test.js tests/week6-qc-task-flows.test.js → **37/37 通过**（证据 E42）
- [x] 合成种子 synthetic-records.json 交 Zhifeng 实际读取确认（证据 C2-35）
- 不在本轮：失败草稿 / 超时 / 切号（AS-YF02，后续周期）

## 三、结果汇总

| 分类                 | 用例数 | 通过 | 失败 | 备注                                                 |
| -------------------- | ------ | ---- | ---- | ---------------------------------------------------- |
| 七天气全流程         | 28     | 28   | 0    |                                                      |
| 码点边界             | 5      | 5    | 0    | 空值 / 1 / 20 / 21 / 22 码点全覆盖                   |
| 当天重复             | 1      | 1    | 0    |                                                      |
| 任务入口（原生复验） | 2      | 2    | 0    | TASK-01R / TASK-02R，原生自动化 PASS                 |
| 任务入口（历史阻塞） | 2      | —    | —    | TASK-01 / TASK-02 旧登记保留为历史，已被原生复验覆盖 |
| 单元测试             | 37     | 37   | 0    | node --test 三文件，证据 E42                         |

详细逐条结果见 normal-results.csv（38 条）；证据对应见 evidence-index.md（E01–E43）；本地配置与文件指纹见 source.json。

### 全量检查说明（2026-11-22 本地 Windows，原始材料已入库 E43）

`npm run check`：lint / format:check / structure:check / docs:check / typecheck 全部通过；`node --test tests/*.test.js` 全量 1691 例中 **10 例失败**（tests/campus-week-two.test.js 9 例、tests/me-lifecycle.test.js 1 例），失败全部位于本分支未触碰的他人模块文件。原始失败名称 / 堆栈 / 环境见 evidence/local-check-output.txt。同基线对比：main CI 1691/1691 通过；Yuen 2026-11-23 同基线本机复跑 1691/1691，未复现本机 10 例失败。**原因待核**，不作归因结论。返修要求的 3 个测试文件 37/37 通过（E42）。

## 四、缺陷登记

| 编号   | 现象 | 最小复现 | 证据 | 处置 |
| ------ | ---- | -------- | ---- | ---- |
| （无） |      |          |      |      |

## 五、种子确认与复核

- [x] Zhifeng 确认 synthetic-records.json 可复用（2026-11-22，证据 C2-35）：合法 JSON、7 条全虚构、天气码与 constants.js 一致、日期在窗口内、validateJournalInput 7/7 PASS；复用注意：标签中文需映射为 id（EXERCISE/STUDY/ALONE_TIME/REST/TIREDNESS/SOCIAL/ANTICIPATION），换日期需整体平移；映射已写入种子文件
- [x] Yuen 独立复跑（2026-11-23，PR #236 复核意见，**独立验收记录，与本人执行分列**）：三文件 37/37 通过；同基线全量 1691/1691，未复现本人机器的 10 例失败
- [ ] 交 Yuen 按原约定复核 AS-YF01（返修材料补齐后）

## 六、通过条件对照

| 通过条件                | 状态                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 完整正常流程可复现      | 已验证（28 例手工全流程 + 原生自动化全链路 PASS）                                                                                     |
| 七天气与名称边界有结果  | 已验证（名称边界空值 / 1 / 20 / 21 / 22 码点五档全覆盖）                                                                              |
| 任务保存不误报完成      | **已验证**：原生自动化实测保存后任务状态为 selected，重开保持 selected，仅显式完成后为 completed（TASK-01R / TASK-02R，证据 E38–E41） |
| 种子由 Zhifeng 确认可用 | **已确认**（2026-11-22，证据 C2-35）                                                                                                  |
