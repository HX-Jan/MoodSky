# C3-XY 到期维护、分批清理与恢复边界（阶段稿）

- 交付周期：W8 C3（2026-11-25—26，实际执行 11-27）
- 账号：Xiang Yu / @Phoenix-Yx
- 原任务：AS-XY02
- 基线：`aff58624641fc970de611020d82fbfd580f952fe`
- 环境：本地内存库 + 生产业务入口（`local-simulated`），无真实云函数、无真机、无自然时间流逝

本目录只记录**本地受控环境**的实际输出，不代表云端已验收；结论中的“通过”均指本环境断言通过。

## 1. 执行命令

```bash
# 1) 刷新生成副本（cloudfunctions/moodsky/shared 是 gitignore 的生成目录）
node scripts/prepare-cloud.js

# 2) 用既有 14 场景工具在独立目录复跑，不覆盖默认证据路径
node tools/week6-xy/verify-export-cleanup.cjs \
  --out docs/alpha/xiang-yu/c3-20261127/evidence/week6-verify

# 3) 从原始证据派生本目录四张表（只读原始证据，可重复执行）
node tools/alpha-xy/c3-cleanup.cjs \
  --evidence docs/alpha/xiang-yu/c3-20261127/evidence/week6-verify \
  --out docs/alpha/xiang-yu/c3-20261127
```

原始证据在 `evidence/week6-verify/`（`run.json`、`coverage.csv`、`cleanup-progress.csv`、`cleanup-before-after.csv`），其中 14/14 场景通过（S0–S12，含 S7b）。

本目录产物：`cleanup-batches.csv`、`before-after.csv`、`expiry-residue.csv`、`receipt-trace.csv`、`c3-summary.json`，均由派生工具生成，连跑两次 SHA256 一致，不手改。

## 2. 结果总览

| 项目       | 结果                                                                                    | 证据                                                      |
| ---------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 到期维护   | 6 个 ready 任务转 expired；二次维护返回 0（幂等）                                       | `expiry-residue.csv`、`evidence/week6-verify/run.json` S8 |
| 到期后领取 | 正文移除，`fileId` 置 null，保留审计元数据                                              | `expiry-residue.csv`                                      |
| 分批清理   | 11 批完成，累计删除 30 行，等于清理前 A 业务行数                                        | `cleanup-batches.csv`                                     |
| 最终回执   | 注销回执长度 151，清理任务 `2a6fd7ea2862946efd0abc182aa7f685` 为 completed，进度总数 30 | `receipt-trace.csv`                                       |
| A 范围     | 9 个私有集合清空，保留账号墓碑与清理账本                                                | `before-after.csv`                                        |
| B 范围     | 业务行逐行不变，导出内容逐字节不变，export_jobs 由 2 增至 3（B 自己新增的导出）         | `before-after.csv`                                        |
| 公共数据   | `places`、`task_templates` 前后一致，未触碰                                             | `before-after.csv`                                        |

## 3. 分批进度

`cleanup-batches.csv` 的列是累计进度，`batch_deleted` 是本批增量。全部 11 批：

| 批次 | 状态       | 本批删除  | 累计 | 触发集合                                            |
| ---- | ---------- | --------- | ---- | --------------------------------------------------- |
| 1    | processing | 4         | 4    | journals                                            |
| 2–3  | processing | 10 + 1    | 15   | favorites（10 行上限 + 余 1）                       |
| 4–6  | processing | 2 + 1 + 2 | 20   | place_checkins、campus_checkin_states、task_history |
| 7–9  | processing | 1 + 1 + 3 | 25   | preferences、month_decorations、request_receipts    |
| 10   | processing | 5         | 30   | export_jobs                                         |
| 11   | completed  | 0         | 30   | 收尾确认                                            |

每批 10 行上限生效：favorites 11 行被拆成 10 + 1 两批，其余集合单批内即可清空。

## 4. 期后残留（expiry residue）

`expiry-residue.csv` 记录 6 个到期任务：`content`、`contentSha256` 已移除，`fileId` 为 null，保留 `_id/accountEpoch/createdAt/expiresAt/fileId/format/ownerId/readyAt/sourceRevisions/state/updatedAt`。

这是**有意保留**的审计残留：到期只清正文，不删任务行；任务行在账号注销后的分批清理中才随 `export_jobs` 一并删除。因此到期维护不能当作物理删除，这一点在 W6 补验单 M1–M9 中同样标注。

## 5. 回执可追溯链

1. `account.close` 返回 `cleanup.jobId` 与一次性回执（151 字符，本文件不记录原值）。
2. 清理任务初始 `pending`，`exportAccessRevoked=true`。
3. 11 批 `cleanup.step` 推进到 `completed`。
4. 凭回执调用 `account.cleanupStatus` 得到同一 jobId 与同一 progress（30），`createdAt = updatedAt = 2026-11-19T03:00:00.000Z`（受控时钟）。

`receipt-trace.csv` 把四步串成一行可对照的记录；回执本身是能力凭证，只登记长度与 jobId。

## 6. 隔离与恢复边界

- **A 不可复活**：清理后 A 登录、导出申请与领取均返回 `ACCOUNT_DISABLED`；墓碑保留 `openid` 与 `status=disabled`，用于拒绝而非恢复。
- **B 不受影响**：B 在 A 清理前后均可登录、申请、领取；导出正文逐字节一致。
- **公共数据只读**：`places`、`task_templates` 不参与清理。
- **不可逆**：已删除的正文、记录、收藏无法从业务入口恢复；只能依赖数据库备份恢复，而备份恢复会同时复活已注销数据，属于隐私事件，须按 `maintenance-handoff.md` 处置。
- **新代数账号**：本基线新增 `registrationGeneration` 路由，清理写墓碑时会保留该字段；本轮 A 为 generation 0，新代数账号的清理与恢复仍需真实注册链补验。

## 7. 未覆盖与待复核

- 真实云函数、真实定时触发器、自然到期、多实例并发清理、备份残留：均未验证，见 `maintenance-handoff.md`。
- `planClaim` / `authorizeRead` 的 300 秒领取凭证仍未接入生产领取路径，本目录不声称已生效。
- 复核人：蔡奇真、Yuen（本地无法代签，本阶段稿不写“已验收”）。
