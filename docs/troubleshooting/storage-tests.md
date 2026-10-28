# 存储服务与测试替身排错

先核对`git status --short`、完整HEAD、团队main与实际运行目录。经2026-10-28的[版本排查与修复](../reviews/2026-10-28-version-consistency.md)后，c212714已有正确调用和相关测试；本地报错文件若出现不同实现，应先比较源码，不从截图猜测接口。

## 当前构造与对象层级

三个工厂均接收一个配置对象：`createRepository({db,...})`、`createExportService({db,...})`、`createCleanupService({db,...})`。不支持`factory(db, options)`。`databaseFixture(seed)`返回`{db,calls,inspect,put}`，真正数据库是`.db`；后三者只是测试观察和布置工具。

| 层级           | 可调用接口                                                                                                                                    | 不可混用的对象                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 通用WX形状替身 | 根`collection/command/serverDate/runTransaction`；查询`where/orderBy/limit/field/get`；文档`doc(id).get/set/update/remove`，新增`add({data})` | 整个fixture包装、工厂函数、业务仓库对象                             |
| 事务回调       | `db.runTransaction(async tx => ...)`内的`tx.collection(name).doc(id)`                                                                         | 根db不是当前事务；`serverDate`在根db上，不在tx上                    |
| 记录业务仓库   | `readDay/transact/readSnapshot`；业务事务内`getDay/setDay`等                                                                                  | `memory-journal-repository`不能注入SDK的db位置                      |
| 原生CloudBase  | 裸data参数、部分数组响应；通过已审查适配器转换                                                                                                | 不能直接照搬WX的`{data}`写入；现有记录适配器不支持完整导出/清理范围 |
| SDK传输替身    | `database.getDocument/modifyDocument/insertDocument`是内部动作                                                                                | 不是业务代码的方法名，不能改成fetch/insert调用                      |

在`tests/`下接线的示例：

```javascript
const { databaseFixture } = require('./helpers/w2-database');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const f = databaseFixture(seed);
const service = createExportService({ ...exportOptions, db: f.db });
```

`seed/exportOptions`使用具体用例的合成数据、来源修订读取器和数量上限，不是可以省略的业务门禁。源码与例子分别见[通用替身](../../tests/helpers/w2-database.js)、[导出/清理测试](../../tests/repository.test.js)。

## 三类容易误判的失败

### collection或doc不是函数

先确认错误来自根db还是事务tx。[导出围栏测试](../../tests/export-account-fence.test.js)与[来源事务测试](../../tests/export-source-atomic.test.js)有意只在根包装上提供配置/事务入口，要求文档操作走tx。SDK清理用例的根collection仅支持分页扫描，文档删除同样走tx。

因此不能为这些特定替身补根doc/collection来迁就错误业务路径，也不能把事务内单条删除改成`where({_id}).remove()`。应修复实际调用层，保留账号/任务检查、幂等、来源版本和回滚。

### expaccorunt_jobs与resource system error

该混排文本可能来自Node彩色actual/expected差异，不是一个已确认的集合名。维护者用现有离线SDK替身已复现：非事务`export_jobs.add()`进入只允许accounts新增的分支，实际值export_jobs、期望值accounts，经彩色差异混排后出现`expaccorunt_jobs`，再被SDK包装为-501001。

先检查原始actual/expected及调用动作/transactionId。只有在源码搜索确实发现错误字面量后才修正拼写；不要按截图全局替换。当前导出任务应在同一事务中读取账号和来源、检查围栏、按确定ID写任务，并返回`{jobId,state,format}`。返回字符串或`{_id}`会导致prepare收到undefined并连锁失败。

### cleanupState不是completed

删除账本包含ownerId、collection、docId、jobId、deletedAt和cleanupState，不保存私人正文。普通记录的pending意图、删除、completed及进度在同一事务提交/回滚；带外部导出文件时先持久化pending意图，收到文件删除或已不存在的确认后，再完成最终事务。不能初建就一律标completed，也不能吞掉文件/提交失败。

## 本地检查

先运行`npm run cloud:prepare`，再按失败范围执行：

```sh
node --test tests/export-account-fence.test.js tests/export-source-atomic.test.js tests/repository.test.js tests/export-preparation-candidate.test.js tests/export-publication-candidate.test.js tests/weather-options.test.js
npm run check
```

报告实际提交、注入对象、修改位置、正常/失败结果和未执行项。SDK离线检查会替换传输并阻断真实网络，不能当作云端权限或事务能力已验收；本地修复不构成部署、写库、清理或启用业务的授权。
