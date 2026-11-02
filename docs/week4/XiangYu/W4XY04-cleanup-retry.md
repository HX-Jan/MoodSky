# W4XY04 模块清理与失败恢复验证

## 范围清单

- 覆盖：journals, favorites, task_history, preferences, month_decorations, request_receipts, export_jobs
- **公共资料保护**：`places`、`task_templates`、`support_resources` 不受注销影响。

## 幂等与失败重试

- 清理任务基于事务执行。如果中途断网或发生资源冲突，`cleanup_jobs` 会记录当前进度。
- 再次触发时，系统会自动跳过已完成模块，继续处理剩余模块。
- **合成隔离测试结果**：通过。未对生产数据库执行删除测试（复用10月30日QA清理证据）。
