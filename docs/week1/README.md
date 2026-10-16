# 第一周成果索引

本索引登记 2026-10-15 拥有者要求的 GitHub 成果整合。当前源码以整合提交为准；下方阶段审查文档中的“未应用、未上传”等状态描述的是各自记录时点，不代表本次整合后的状态。成员复核和业务验收仍保留原有未完成项。

团队共同依据为[第一周详细任务计划](first-week-detailed-plan.md)，由当前已确认的本机 Markdown 版本同步，不把任务清单当作已完成成绩。

## 当前源码与证据

- Today 第二版表单已整合到 miniprogram/pages/today 和 modules/journal。完整本地项目 124 项测试通过，内存演示 34 项模拟器检查通过；[操作与截图](../test-reports/2026-10-15/README.md)。
- 正式健康入口附带字段兼容修正已在源码中，未在本次同步中部署。真实账号及记录等业务仍为 NOT_IMPLEMENTED。
- H03 报告留存及第二版并发诊断代码已整合到 tools/h03-probe；诊断改动尚未部署或运行新批次。已保存真实报告仍为 12 项通过、5 项失败；旧批次缺少逐项报告，不回填。
- 公开文档导入了必要的截图和安全报告，原始字节及校验值见[证据清单](../test-reports/2026-10-15/publication-artifacts.json)。上传目录、ZIP、旧候选源码和原始机器配置保留在本机，没有作为部署包提交。

## Xiang Hong

| 任务                        | 内容                         | 当前边界                                                                                   |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| [H01](xiang-hong/w1-h01.md) | 环境、权限及部署交接         | 负责人审查通过；独立成员复核待完成                                                         |
| [H02](xiang-hong/w1-h02.md) | 记录输入输出、边界和类型草稿 | 已审查；真实业务及完整共享类型尚未实现                                                     |
| [H03](xiang-hong/w1-h03.md) | 可靠写入、重试及删除设计     | 真实隔离实验有失败；[实际报告](xiang-hong/w1-h03-report-retention-validation.md)保持原结论 |
| [H04](xiang-hong/w1-h04.md) | 回顾接口和样例               | 文档草稿；没有部署回顾业务                                                                 |
| [H05](xiang-hong/w1-h05.md) | 验收与估点收集               | 成员工时、成果、复核和签字由本人提供，不代填                                               |

Today [第二版审查](xiang-hong/w1-today-date-navigation-review.md)、H03 [诊断审查](xiang-hong/w1-h03-concurrency-diagnostic.md)的本地应用步骤已由本次整合完成。上述文档保留原始阶段说明，新增执行记录说明实际应用；云端部署和新批次仍需单独批准。

## Xiang Yu

已纳入 Phoenix-Yx/MoodSky 的 feature/database-export-cleanup 分支，来源提交为 49f46b0、04a5ad3、94832d8，比对到分支头 fcceae1。后续三份设计在本次同步期间追加，已一并纳入。作者及其手工实验陈述保留；本次对照共享代码和已有报告做整合修订，没有把文档建议直接部署。

- [W1XY01 数据字典](XiangYu/data-dictionary.md)：对齐 openid/status、偏好字段、版本语义、可信归属和导出/清理职责；新增索引与加密仍为提案。
- [W1XY02 约束验证](XiangYu/db-constraint-verification.md)：保留探针集合中的重复插入实验，正式错误码沿用 CONFLICT；不把控制台结果当作云函数并发或正式集合的完整验收。
- [W1XY03 导出设计](XiangYu/export-flow-design.md)：统一现有 account action 和 API 信封；按 H03 使删除记录关联的旧任务及未领取导出失效，领取时重新检查，执行器未实现。
- [W1XY04 清理恢复](XiangYu/cleanup-recovery-design.md)：将删除标记和删除的原子边界、备份后删除账本及受限进度回执纳入设计；清理和恢复未执行。
- [W1XY05 合成样本](XiangYu/synthetic-data-and-handover.md)：对齐标签码、偏好字段和固定日期窗口；本人查询、导出、清理及身份适配明确标为待实现，不自动导入或清理样本。
