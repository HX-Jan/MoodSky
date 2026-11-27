# C3-XY 进展日志（日志 3）

## 2026-11-27

### 今日输入

- 任务书 C3-XY：到期维护、分批清理、隔离与恢复边界；要求用 `--out` 独立目录复跑，不覆盖默认证据路径。
- 既有工具：`tools/week6-xy/verify-export-cleanup.cjs`（14 场景）、生产入口 `createProductionEntry` / `createProductionCleanup` / `createExportMaintenance`。
- 当前主干 `aff58624641fc970de611020d82fbfd580f952fe`（C4 燃尽图更新）。

### 实际执行

1. `node scripts/prepare-cloud.js` 刷新 cloud 侧生成副本（`cloudfunctions/moodsky/shared` 为 gitignore 生成目录）。
2. `node tools/week6-xy/verify-export-cleanup.cjs --out docs/alpha/xiang-yu/c3-20261127/evidence/week6-verify` → 14/14 通过，原始证据落该目录。
3. 新写 `tools/alpha-xy/c3-cleanup.cjs`：只读原始证据，派生 `cleanup-batches.csv`、`before-after.csv`、`expiry-residue.csv`、`receipt-trace.csv`、`c3-summary.json`；派生时做三项自检（原始证据无失败检查、A/B/公共范围符合预期、到期正文确已移除），不通过即抛错。
4. 运行派生工具，得到 11 批、累计删除 30 行、终态 completed、清理任务 `2a6fd7ea2862946efd0abc182aa7f685`、到期残留 6 条。

### 结果

- 到期维护：6 个 ready → expired，二次维护 0（幂等）；正文与 `contentSha256` 移除、`fileId` 置 null、审计元数据保留。
- 分批清理：11 批完成；favorites 11 行拆成 10 + 1；progress 总数 30 与清理前 A 业务行一致。
- 范围：A 的 9 个私有集合清空，B 逐行不变且导出逐字节不变，公共 `places`/`task_templates` 未触碰。
- 回执：注销回执 151 字符，`exportAccessRevoked=true`，凭回执查询得到同一 jobId 与同一 progress。
- 恢复边界：A 清理后登录/申请/领取均为 `ACCOUNT_DISABLED`；墓碑保留，不可复活。

### 过程中的判断

- 每批 `cleanup.step` 只返回状态与累计进度，不返回每批独立回执；因此“每批可追溯”以 jobId + 批次序号 + 累计进度对齐，最终回执用注销回执绑定，不臆造每批回执。
- 到期残留是设计行为而非清理遗漏：到期只清正文，任务行留给账号注销后的分批清理；若要“到期即删行”，需产品另立契约。
- 主干新增 `registrationGeneration` 路由，清理写墓碑会保留该字段；本轮 A 为 generation 0，故把新代数清理列为待补验 G1。

### 待确认

- 真实云触发器、自然到期、多实例并发、备份恢复仍无法本地验证，已写入 `maintenance-handoff.md` M1–M8、G1。
- 300 秒领取凭证仍未接入生产路径，C3 不声称已生效。
- 复核人蔡奇真、Yuen 尚未签署，本阶段稿不写“已验收”。

### 下一步

- 交复核：`cleanup-batches.csv`、`before-after.csv`、`expiry-residue.csv`、`maintenance-handoff.md`。
- C4：最终候选复验，汇总四期证据与个人总结。

### 工时与签认

- 个人工时：待本人填写
- 独立签字：蔡奇真 / Yuen，待复核
