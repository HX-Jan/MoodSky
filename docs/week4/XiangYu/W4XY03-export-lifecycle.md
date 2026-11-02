# W4XY03 导出绑定与时间失效验证记录

基于真实生产实现 `cloudfunctions/moodsky/production/exports.js` 核对：

## 1. 实际存储与领取机制（组长反馈修正）

- **无公开云存储链接**：真正的实现里**没有**云存储临时 URL。
- **受限文档存储**：导出的内容被直接写入了数据库 `export_jobs` 文档的 `content` 字段。
- **本人校验**：用户领取时，依靠云函数事务中的 `inspect` 强校验 `ownerId`，然后直接返回 `content`。

## 2. 导出失效与时间边界

- **源版本变化导致失效**：代码调用了 `readSourceState` 读取 `source.epoch` 和 `source.revisions`。如果用户在导出期间修改了数据，`current.source.epoch !== prepared.accountEpoch` 触发校验失败，抛出 `CONFLICT`，旧导出直接作废。
- **最大限制**：最大 512KB (`MAX_BYTES = 512 * 1024`)，单次导出最大 2000 条记录 (`MAX_RECORDS = 2000`)。
- **时效限制**：存入 `export_jobs` 的 `expiresAt` 为 `readyAt` + 24小时。

## 3. 待补充的测试

- 需补充真实可执行测试，验证错号领取抛出 `FORBIDDEN` 及数据变化抛出 `CONFLICT` 的返回码。
