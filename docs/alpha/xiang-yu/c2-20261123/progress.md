# 日志 2｜C2-XY 导出访问验证（2026-11-23）

## 今日输入

- 成员任务书 C2-XY（11/23–24）：验证导出内容、归属、旧回执、领取权限；提交 `export-access-results.csv`、脱敏样例、修复与复测。
- 源码基线 `78812fedeb90c5603e927fbda8050eab23b5338f`（#240 接收 YL/QH 增量后），比 C1 基线只动了账号与清理。
- 本地：Windows、Node v24.21.0、无网络、无真实云环境；全部数据为 `SIMULATED-C2XY` 合成值。

## 实际执行

1. 读新一轮 `production/exports.js`、`production/accounts.js`、`production/index.js`、`production/backend.js`、`miniprogram/shared/contracts.js`、`tools/export-candidate/access-policy.js`，确认三个导出动作的入口校验、scope 换代与注册动作。
2. 写 `tools/alpha-xy/c2-access.cjs`：6 组场景（内容与归属、访问边界、旧回执、到期边界、停用与重新注册、领取凭证策略），每用例独立内存库，注入时钟，`--out` 输出。
3. 首跑 54/62，逐项定位偏差：生成副本过期、我的三处预期写错、收藏入口关闭、注册后 scope 未刷新、注销回执 token 未脱敏。
4. 修正后连跑两次：64/64 通过，5 个产物 SHA256 一致；`git diff --check` 干净。
5. 门禁：prettier、eslint、check-structure、check-docs（本目录 README 与 c1/c2 文档）均通过。

## 结果

- 64 个用例全部通过；矩阵见 `export-access-results.csv`（C01–C64）。
- JSON 样例 2875 字节、Markdown 样例 1834 字节；回执表与 JSON 回执 64 行，正文与注销回执均替换为占位。
- 关键行为（与 C1/DD-07 一致并补足边界）：未知/他人 jobId 与失效同文案；到期时刻（`readyAt+24h`）转 expired，`-1ms` 仍 ready；停用后三个导出动作全部 ACCOUNT_DISABLED 且不影响 B；重新注册后旧 scope 重放被拒、新代读不到旧任务。
- 新发现：`account.session` 成功响应不含账号状态（只有 authenticated/scope/capabilities），界面判断停用必须看后续动作的错误码。

## 待确认（已列入交接）

- `campus.favorites` 在当前候选入口 NOT_IMPLEMENTED（既有校园写入口未接入生命周期围栏）。收藏变更导致的旧导出失效只能等入口开放后实测；本轮用记录修改、偏好修改与策略层收藏版本前进覆盖。
- 领取凭证（`planClaim`/`authorizeRead`）仍未接入生产领取路径，只有策略级断言，没有 300 秒凭证的生产动作。
- C2 未独立复核；`place_checkins` 仍只有 `placeId` 无 `placeName`。

## 下一步

- 蔡奇真：按 README「复跑命令」独立复跑（先 `node scripts/prepare-cloud.js`），核对到期边界与停用分支。
- Linghan：两格式样例与回执摘录可直接补 DD-07 对照；C3 CSV 的“待对齐”行可按 `export-access-results.csv` 逐条映射。
- C3-XY（11/25–26）：用 `tools/week6-xy/verify-export-cleanup.cjs --out` 独立目录复跑清理与到期维护，产出 `cleanup-batches.csv`、`before-after.csv`、`expiry-residue.csv`、`maintenance-handoff.md`。

## 未填

个人工时、投入时段与本人签认由负责人填写；本日志只记录工具与数据的实际结果，不代表 C2 已通过独立复核。
