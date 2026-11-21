# 日志 1｜C1-XY 数据与工具成果（2026-11-21）

## 今日输入

- 成员任务书 C1-XY（11/21–22）：准备导出／清理数据清单及两种格式的初始样例。
- 源码基线 `6e91ead92dd8ecc143e38bff956ff239e4765296`；#187 工具已在主干。
- 本地：Windows、Node v24.21.0、无网络、无真实云环境；全部数据为 SIMULATED 合成值。

## 实际执行

1. 读 `cloudfunctions/moodsky/domains/export.js`、`production/exports.js`、`production/cleanup.js`、`tools/export-candidate/formatter.js`，确定导出白名单、领取校验与清理集合。
2. 写 `tools/alpha-xy/c1-baseline.cjs`：同一确定性夹具建两份独立内存库（导出一份、清理副本一份），经生产入口申请 JSON／Markdown、领取、跨账号查询、记录改动失效、24 小时到期、注销后拒绝。
3. 生成 `synthetic-data.json`、`data-coverage-baseline.csv`、`samples/export-sample-json.json`、`samples/export-sample-markdown.md`、`samples/format-receipts.md`。
4. 同一基线复跑 `tools/week6-xy/verify-export-cleanup.cjs`：14 场景／137 检查通过（沿用 W6 结论，未把旧证据改记为本期）。

## 结果

- 种子 22 行（A 12／B 5／公共 5）；A 再经真实写接口补 1 条记录与 1 份偏好。清理副本跑完仍 22 行且逐行与种子一致。
- JSON 样例 3255 字节、Markdown 样例 2022 字节；9 条回执（R1–R9）与 15 项自检全部通过。
- 关键行为：B 查 A 的任务返回 FORBIDDEN 且与 CONFLICT 同文案；记录改动后旧 job 变 expired、领取 CONFLICT；`+24h+1s` 后领取 CONFLICT；注销后申请导出 ACCOUNT_DISABLED「账号已停用。」。
- 数据清单：7 个本人集合导出；export_jobs／request_receipts／cleanup_jobs／accounts 不导出；清理覆盖 11 个集合，accounts 保留墓碑，公共 places／task_templates 不动。

## 待确认（已列入交接）

- `place_checkins` 导出只有 `placeId`，无 `placeName`：界面显示地点名需回查公共地点。请问 Junhan／Jiawei 当前字段是否就到这里。
- `weatherName` 在样例中缺席（只有 `weather` 枚举）：确认是写入时未落库，还是导出投影应补。
- 任务书 AS-T27–T30 在仓库 `docs/` 无定义，本表按行为列，编号映射待洪翔确认。

## 下一步

- 蔡奇真：按 `samples/format-receipts.md` 的时钟条件（起点、`+24h+1s`、重跑重建）独立复跑并给意见。
- Linghan：用两份样例和 R1–R9 对齐 DD-07 的状态／文案／动作，补 C3 `account-export-regression.csv` 的对齐行。
- C2-XY（11/23–24）：在同一夹具上补越权矩阵（他人 jobId、旧回执、停用与到期的组合），输出 `export-access-results.csv`。

## 未填

个人工时、投入时段与本人签认由负责人填写；本日志只记录工具与数据的实际结果，不代表 C1 已通过独立复核。
