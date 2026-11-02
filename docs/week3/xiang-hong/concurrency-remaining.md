# W3 H03：V09—V12接续

10月27日更新：[固定云批次结果](cloud-result-20261027.md)已完成，四独立调用创建/停用分支及90天窗口通过，原探针已恢复并实际下载比对。四个随机标记不同、回调均1次，没有SDK重试证据；不作为厂商实例身份或完整并发验收。此前准备包809项本地检查及下文真实证据按原时点/批次保留。

以下为10月26日的缺口快照：[第二周真实修复17/17](../../week2/xiang-hong/h03-symbolic-fix-20261023.md)保留为原批次证据，历史失败不覆盖；当时没有重跑探针或增加云写入。V09—V12沿用[W1 H03编号](../../week1/xiang-hong/w1-h03.md)，不是另一个页面报告中的同名V09—V12。

10月26日第二轮[续作](continuation-20261026.md)补齐V09的可信绑定来源修订下限，并强化V12恢复材料坐标/时间检查。新增原生SDK离线恢复模型贯通实际候选删除标记、计划、墓碑和原成功回执拒绝；仍没有真实恢复执行器或独立账本证明。

| 原编号 | 现有可执行本地步骤与结果范围                                                                                                                                     | 待真实环境/独立验收                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| V09    | 本轮review-session/review-cloud-pages验证已显示及迟到数据在失效、A→B、A→B→A后清空；week3-review-integration验证跨月、7/30/90及删除重建；既有decorations用例保留  | 新版四页、装饰撤回及跨设备晚到响应；Zhifeng/Yuen/Qizhen Cai复核                               |
| V10    | export-account-fence、export-source-atomic、export-access-policy-candidate验证来源重读、共同写围栏及领取拒绝候选                                                 | 实际文件生成/下载、删除与领取交错、已发链接撤销及私有文件重复清理；Xiang Yu接线               |
| V11    | native-journal-integration、account-provisioning、transactional-tasks覆盖账号门禁、首次创建与事务围栏；本轮新增停用后七类记录/回顾调用均拒绝，包括原成功回执重放 | 正式真实双账号、多实例active/disabled竞争、客户端身份接线与独立复核；顺序停用拒绝不是竞争证明 |
| V12    | receipt-policy、journal-rejected-receipts覆盖过期、旧密钥保留/移除、原请求绑定及失败保留                                                                         | 生产保留策略、旧快照恢复、删除账本重放、清理重跑和耗时；本地HMAC测试不是备份恢复              |

## 复核命令

在最新版仓库根目录、准备依赖和共享文件后运行：

```sh
node --test tests/h03-native-database.test.js tests/receipt-policy.test.js tests/journal-rejected-receipts.test.js tests/export-account-fence.test.js tests/export-source-atomic.test.js tests/export-access-policy-candidate.test.js tests/transactional-tasks.test.js tests/account-provisioning.test.js
node --test tests/journal-recovery-plan.test.js tests/journal-recovery-native.test.js
```

只对准确`DATABASE_TRANSACTION_CONFLICT`使用原生SDK自带有限重试；纯数字`-501001`、未知符号和系统错误仍失败关闭，不解析文字猜测冲突。`DATABASE_DUPLICATE_KEY`的本地可识别情况不代表真实唯一键所有错误都已映射；`duplicateErrorMappingConfirmed`继续未完成。

## 获准后场景准备

1. Xiang Yu/Jiawei提供当前索引、可信账号和停用原子协议；固定两个真实测试身份及隔离记录范围。由Qizhen Cai独立核对，不能使用客户端ownerId模拟身份。
2. 两个独立调用实例竞争同日创建、旧版本编辑和删除；记录每次原requestId、符号错误、事务回调数及最终版本。未知结果只重试原请求，不将预算耗尽记作业务冲突。
3. 写入/重放与账号停用交错；停用提交后不得借旧回执访问。顺序与竞争分别记录，保留失败。
4. V10需要实际私有文件和领取撤销实现，V12需要可核验恢复依据；缺执行器时维持阻塞，不能填通过。分别固定备份/恢复/清理授权，不能沿用探针授权。
5. 保存源码/包/云配置、调用结果、合成数据清单和回滚验证，交Qizhen Cai实际复核。没有这些结果前`technicalValidationComplete`不改为true。
