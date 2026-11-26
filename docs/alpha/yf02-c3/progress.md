# YF02-C3 进度汇报（AS-YF02 后半 · A/B 切号与待处理请求 · 2026-11-25 执行 / 11-26 回传）

## 基线与分支

| 项       | 值                                                                                           |
| -------- | -------------------------------------------------------------------------------------------- |
| 任务     | AS-YF02 后半：A/B 切号与待处理请求（失败草稿 / 原 requestId / 切号隔离）；并补齐 C2 两项缺件 |
| 基线     | 7feca53ff0ed461cac270b7da7e7c36f36b7973b（upstream/main，#245 整合后）                       |
| 分支     | test/as-yf02-c3                                                                              |
| 执行     | 纪一凡（本人执行记录，与 H 原始实现、Yuen 复跑分列）                                         |
| 复核     | Yuen（独立复核，意见待其登记）                                                               |
| 执行日期 | 2026-11-25（Asia/Shanghai）                                                                  |
| 环境     | Windows 本机 + Node 24（node --test 与 tools/alpha-h/ab-workbench.cjs）                      |

## 执行方式与范围

- 操作入口：实际记录控制器（journal controller + 内存重试夹具）、任务控制器、账户控制器（均经真实页面定义装载），以及团队 A/B 工作台（本地生产入口 + 内存库，合成双账号 SIMULATED_C2H_A/B，输出经工具脱敏）。
- A/B 工作台本人复跑（工作区干净时执行）：

  `node tools/alpha-h/ab-workbench.cjs --out D:\Projects\MoodSky-Alpha证据\1126\ab-run`

- 切号与待处理请求用例（三文件 18 项）：

  `node --test tests/logout-work-protection.test.js tests/ab-workbench.test.js tests/alpha-qc-unknown-results.test.js`

- 结果：工作台 16/16 通过；node --test 18/18 通过，exit 0。原始输出全部入库（见 evidence-index.md，逐文件 sha256 见 manifest.json）。
- 本轮为核对性复跑：按「有缺陷先给反例再修复」约定执行，未发现缺陷，故无修复代码，本提交仅文档与证据。

## 结果汇总

| 场景                                              | 用例数 | 通过 | 结果 |
| ------------------------------------------------- | ------ | ---- | ---- |
| 切号/登出与待处理请求（logout-work-protection）   | 12     | 12   | PASS |
| A/B 工作台（ab-workbench 测试断言）               | 2      | 2    | PASS |
| 丢回执+连点精确重试（AS-QC02）                    | 4      | 4    | PASS |
| A/B 工作台业务用例（H01–H04 / E01–E06 / L01–L06） | 16     | 16   | PASS |
| 合计                                              | 34     | 34   | PASS |

逐用例核对明细见 ab-cases.csv。

## 原请求对照（AS-YF02 验收条件核对）

| 验收点                       | 结论                                                                                                                                            | 依据用例（编号见 ab-cases.csv）                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A 的输入和迟到结果不会回填 B | 达成：旧登出确认跨切号无效；B 以 A 的 ownerId / 会话访问被拒；导出内容归属隔离；A 注销后 B 记录不受影响；重注册后前任数据不回填、前任会话不可用 | S-05、S-08、AB-03、AB-04、AB-05、AB-06、AB-12、AB-15、AB-16 |
| 同一操作只形成一次有效写入   | 达成：未知保存显式重试复用同一请求对象且版本仅递增一次；任务原重试逐字一致；QC02 四动作双击+丢回执精确重试                                      | S-02、S-09、S-10、QC-01–QC-04（另见 C2：A-03、B-05 等）     |
| 草稿保留                     | 达成：隐藏真实草稿取消登出即保留，仅显式确认才丢弃且全程无写入；对话框异常/失败同样保留                                                         | S-01、S-04                                                  |
| 原 requestId / 原载荷        | 达成：显式重试复用原请求对象（sent[1]===sent[0]）；工作台逐案记录 requestId（见 evidence/ab-results.json）                                      | S-02、S-09、E01                                             |
| 日期                         | 工作台固定业务日 2026-11-23（夹具时钟）；跨日专项已于 C2 覆盖（C-01–C-03）                                                                      | E01、docs/alpha/yf02-c2/                                    |
| 有可复跑证据                 | 达成：复跑命令、原始输出、逐文件 sha256 全部入库                                                                                                | E01–E04、manifest.json                                      |

## C2 缺件补齐

1. **最新全量失败原始日志**：本基线（7feca53）下 `npm run check` 原始输出入库为 evidence/latest-full-check-output.txt：静态检查（eslint / prettier / structure / docs / typecheck）全部通过；node --test 1693 项中 10 项失败（campus-week-one 4 + campus-week-two 5 + me-lifecycle 1），与 #236 登记为同一「原因待核」簇（报错特征一致：'idle' 断言不符、switchAccount TypeError），仅在本人本机环境出现，原因未明前不归因于环境或代码任一方，与本次改动（仅文档）无关。
2. **C1 入库证据指纹修正**：11-24 整合审计（docs/reviews/2026-11-24-c2-integration/original-file-audit.json）指出 docs/alpha/yf01-c1/evidence/manifest.json 中 local-check-output.txt、native-results.json 两条为本地原件指纹，与入库副本不符。本次按入库文件实际内容重算该两条（其余四条不变），并补 recomputedAt 与说明字段；docs/alpha/yf01-c1/manifest.json（入库时按入库文件现场生成）各条与审计一致，未改动。

## 缺陷与修复

未发现缺陷。依「先反例后修复」约定，本轮无修复代码。

## 分列说明

- A/B 工作台原始实现与首次运行：Xiang Hong（docs/alpha/xiang-hong/c2-20261123/）；独立复跑：Yuen（PR #243，AB16）。
- 本目录为本人（纪一凡）执行记录（工作台输出 independentAcceptance=false，为本人执行而非独立验收）；Yuen 的复核意见待其另行登记，不与本人记录混排。
