# week6-xy 本地验证工具

2026-11-17。导出、到期维护与注销清理的本机合成验证，不连 SDK、不连网络、不写真实库，也不生成真实用户数据。

## 用法

```sh
node tools/week6-xy/verify-export-cleanup.cjs [--out <目录>]
```

默认输出到 `docs/week6/XiangYu/evidence/`。全部场景通过时退出码为 0；任一检查失败时打印差异并返回 1。工具会覆盖同名证据文件，便于同一构建重跑。

## 覆盖范围

| 场景    | 内容                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| S0—S1   | 用真实 `account.session` 建立 A/B 合成账号；A/B 记录与偏好走真实 API 写入，其余来源按 `domains/export.js` 的字段表播种 |
| S2—S4   | A 与 B 各申请 JSON/Markdown 导出：字段投影、排除字段、删除记录排除、悬空贴纸过滤、字节数                               |
| S5      | 跨账号领取与跨账号状态查询被拒                                                                                         |
| S6      | 24 小时到期边界（到期前 1 秒可领、到期即拒绝）                                                                         |
| S7、S7b | 记录改动使旧导出失效并可重新申请；库内正文被篡改后拒领                                                                 |
| S8      | 到期维护：正文/哈希/文件元数据移除、任务元数据保留、重跑幂等                                                           |
| S9      | 停用后全部私人动作被拒，正文成为待清理残留                                                                             |
| S10     | 分批清理：逐批进度、总和与实际删除一致、B 与公共集合不受影响、B 导出逐字节不变                                         |
| S11     | 清理后恢复：A 不可复活、B 仍可用                                                                                       |
| S12     | 凭注销回执查询 `account.cleanupStatus`                                                                                 |

## 边界

- 数据库是 `memory-database.js` 的内存夹具：串行化写时复制事务，只实现生产代码用到的查询形态（`where` 等值/`$gt`/`$lte`/`$in`、`orderBy('_id','asc')`、`limit`、`field`、`doc` 读写删）。它**不证明**真实云事务、并发锁、索引或分页性能。
- 时钟由 `now` 注入推进，不做真实等待。
- 导出正文存放在 `export_jobs.content`，因此没有触发 `domains/cleanup.js` 的外部文件删除分支。
- 运行环境需先完成 `npm run setup`（生成 `miniprogram/config/environment.local.js`）与 `npm ci --prefix cloudfunctions/moodsky`，否则生产入口会因缺少本地配置或 `wx-server-sdk` 直接报错。
- 证据写入 `docs/week6/XiangYu/evidence/`，其中的正文、账号与地点全部是 `SIMULATED` 合成值；不要把这些文件替换成真实用户数据再提交。

## 重跑后应看到

- 14 个场景全部 `PASS`，`run.json.summary.failed = 0`。
- `cleanup-progress.csv` 末行状态为 `completed`，各集合计数与 `run.json` 中 S10 的进度一致。
- `cleanup-before-after.csv` 中 A 的业务集合清理后全为 0，`places`、`task_templates` 前后不变。
