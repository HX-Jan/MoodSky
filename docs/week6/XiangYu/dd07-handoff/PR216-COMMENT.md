## DD-07 导出样例与回执（W6-XY → C2/C3）

@chenlinghan82-debug 你要的样例我补齐了，都在 `docs/week6/XiangYu/dd07-handoff/`：

- `export-sample-json.json`、`export-sample-markdown.md`：同一账号合成数据的两种导出文件，字段顺序即生产输出（`1.0-candidate`）。
- `receipts.json`：16 条服务端回执原文（`content` 与注销 `receipt` 已替换为占位串）。
- `receipt-matrix.csv`：同内容的表格，可直接并进 `account-export-regression.csv`。
- `README.md`：状态↔界面文案对照、16 条回执明细、与你 14 行 CSV 的逐行对照、边界说明。

几条会影响 DD-07 画法的事实：

1. **状态与文案**来自 `miniprogram/modules/account/production.js` 现实现：`ready`→「可领取」/「导出已就绪，可领取文件或查看内容。」；`expired`→「已过期」/「导出已过期，请保留所选格式并重新申请。」；`failed`→「失败」；`pending`/`processing`→「处理中」。
2. **领取冲突只有一句服务端文案**（`CONFLICT`／导出尚未完成或已失效，请重新读取。）。客户端不直接显示，而是回查状态：仍 ready →「领取未完成，服务状态仍为可领取。可重试保存或重新申请。」，否则显示过期/失败文案。所以同一错误码对应三种界面态，不要按错误码拆三个页面。
3. **跨账号与未知 jobId 都回同一句**（R9、R15），用来不泄露任务是否存在；界面按「不可见」处理，不要出现「无权限查看他人导出」这类提示。
4. **停用后**所有导出动作 → `ACCOUNT_DISABLED`「账号已停用。」；页面只剩「查询清理进度」，且进度只能凭注销回执读取（R16 无回执 →「清理进度回执无效。」）。
5. **清理进度**分 `processing`（部分集合计数）与 `completed`（含 `request_receipts`、`export_jobs`）两种回执，见 R13/R14。

边界：本构建导出为同步生成，本地未观察到 `pending`/`processing`，界面仍需按代码保留「处理中」；300 秒领取凭证（`planClaim`/`authorizeRead`）未接入领取路径，回执里没有 claim token，不要画「领取码」；样例为合成数据，真实云与真机送达仍按 M1—M9 待验。

你那边可以把 CSV 最后一行「待对齐」改成「通过（样例已到）」，证据列写 `docs/week6/XiangYu/dd07-handoff/receipts.json#R1–R16`；`导出与源版本一致性`、`记录改动使旧导出失效`、`任务到期` 三行可直接引用 R5–R8。

生成与复跑：`node tools/week6-xy/export-receipts.cjs`（构建 `6e91ead`）；同一构建上 `node tools/week6-xy/verify-export-cleanup.cjs` 仍 14/14、137 项检查通过。
