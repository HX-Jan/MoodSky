# 记录与回顾后端：本地实现及存储接入约定

日期：2026-10-18。此实现供第二周后端开发和接口评审使用。正式 `index.js` 仍调用无参数 `createRouter()`，没有启用业务写入。本次未部署、云写入或更改共享接口及身份适配。

优化复核后，本地组装入口独立为 `candidate-router.js` 的 `createCandidateRouter()`；正式入口不导入该文件或候选服务。只给正式 `createRouter()` 传 journalRepository 不会启用候选。打包检查同时验证候选实现不进入正式部署包，参见 [优化复核](reviews/2026-10-18-optimization-audit.md)。

## 已可执行的部分

`cloudfunctions/moodsky/services/journal.js` 实现保存、读取及删除；`services/review.js` 实现月历、分布、时间线和月份档案。通过服务器构造参数显式接入同一个事务存储：

```javascript
const { createCandidateRouter } = require('./cloudfunctions/moodsky/candidate-router');
const router = createCandidateRouter({
  resolveAccount: trustedAccountResolver,
  journalRepository: transactionalRepository,
  journalReceiptPolicy: configuredServerReceiptPolicy,
  now: () => new Date(),
});
```

上面的账号解析器和事务存储是待实现参数名，不能直接当作生产配置。可运行的离线例子见 `tests/helpers/backend-fixture.js`；它只识别合成身份。`tests/helpers/memory-journal-repository.js` 是进程内测试替身，不是云数据库适配器或可重启持久化存储。身份、停用账号、请求白名单和错误屏蔽门禁仍先执行。

保存使用共享天气白名单、固定标签、1000 码点正文和安全整数 `expectedVersion`。2026-10-22扩展为七类，CUSTOM必须提供1—20码点weatherName；其余天气不带此字段，风雨/暴雨统一为STORMY（雷雨）。新建只接受北京时间的今天及此前 29 天；已有较早记录可以编辑。编辑保持 ID 和创建时间，版本递增。

回执按已审查 H03 的原输入规则绑定：HMAC-SHA-256 涵盖规范化版本、API 版本、action 和原始 payload；对象键排序，数组顺序、正文空白和 Unicode 序列均保留，省略 text/tags 与显式空值不同。回执只保存摘要、规范化/密钥版本、调用时刻、到期时刻及结果元数据，不保存正文或 payload。摘要及密钥标识仍为私人内部数据。

`services/receipt-policy.js` 由服务器显式配置 activeKeyId、验证密钥 Buffer 和 maxAgeMs。缺少策略时私人读取仍可用，写入返回 `NOT_IMPLEMENTED`。密钥至少 32 字节，不从请求或仓库读取；本轮只有 tests/helpers 中公开标明的合成测试材料，不能用于实际服务。密钥轮换保留旧验证材料时可复核旧回执；材料丢失、规范化版本未知、到期或最小 expired 占用标记均拒绝重放，不把旧 ID 当新请求。测试的一小时有效期只属于夹具，正式保留期仍待确认。

保存重试只在记录 ID 和版本仍有效时重放；编辑、删除或重建后返回 `CONFLICT`，不恢复旧正文。删除移除内容，保留无正文的版本墓碑。重建使用新 ID 且继续递增版本，防止版本回到 1 后旧请求误命中新记录。删除重试可返回原结果，期间重建则冲突。删除不存在的记录返回 `deleted:false`，不推进源版本。

四个回顾入口使用同一个有界快照。月历升序，档案/时间线降序；7/30/90 天包含起止日。统计分母为有效记录数，保留七类零计数；不足三条时 `trendEligible:false`，不生成健康评分或趋势结论。输出只含 ID、日期、天气及统计元数据，CUSTOM另含私人weatherName，排除正文、标签和身份。损坏、重复或越界的快照失败，不静默丢弃异常。没有服务器素材配置时，装饰仍返回 `NOT_IMPLEMENTED`。

前端统计页只请求一次完整、有界且经过校验的 timeline，在同一结果内计数生成分布，不再为展示两块内容重复读取数据库。独立 distribution 接口仍保留；没有改共享 action 或结果约定。如果将来时间线改成分页，必须同时修订这个完整快照前提。

## 事务存储约定

`readDay(ownerId, date)` 返回 `{version, entry}` 或空值；有效记录的 entry 包含业务字段，删除后为 null。版本单调递增且不得溢出。

`transact(ownerId, async tx => result)` 提供以下方法，均可返回 Promise：

| 方法                                                                             | 作用                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------- |
| `tx.getDay(date)` / `tx.setDay(date, day)`                                       | 读取/替换本账号该日记录或墓碑            |
| `tx.getReceipt(action, requestId)` / `tx.setReceipt(action, requestId, receipt)` | 在本账号命名空间读取/写入回执            |
| `tx.advanceRevision()`                                                           | 每次实际保存或有效删除推进一次记录源版本 |

这些操作必须整体提交或整体回滚。接受的写入、合法回执重放和空删除都调用 `touchAccount()` 推进 operationFence，参与账号停用的共同竞争顺序；只有实际记录变更推进 journalRevision/exportEpoch。删除同时调用 `writeDeletionMarker()`，保存旧 entryId、删除版本、日期及时间，不含正文；不覆盖已有账本事件。原始输入摘要、候选 ID 和调用时间在事务回调外固定。

并发必须由数据库事务检测冲突。回调内不得发送消息、写文件或做无法回滚的副作用。普通查询后独立写入不满足约定；单进程锁不能保证多实例原子性。真实账号停用协议、清理执行和独立删除账本恢复仍需共同验证，本地方法存在不代表已验收。

`readSnapshot(ownerId, {startDate, endDate})` 返回 `{revision, entries}`，只含该账号该范围内全部未删除记录标记。版本和记录必须来自同一一致读取，不能先查版本再独立分页并假定一致。单月最多 31 条、窗口最多 90 条，适配器不能依赖 SDK 默认查询条数。服务输出仍执行显式白名单。

存储适配器负责账号归属过滤及事务内账号状态复核。路由先检查 active，但停用可能发生在门禁之后；上线适配器需与停用/清理共享原子边界，确保停用后不再提交写入或读取旧数据。测试替身只模拟事务、账号分区和快照，不模拟跨服务停用竞争。

## 可选装饰服务

2026-10-20 补充：记录业务拒绝已持久绑定原请求，拒绝回执提交后才抛业务错误；仅推进 operationFence，日记/导出源版本不变。到期和异输入仍拒绝重用。账号仓储到记录/回顾的显式组装及当前缺口见 [第二周交付](week2/xiang-hong/README.md)，真实云端仍未启用。

装饰另需服务器注入 `decorationCatalogue:{stickers:[...],backgrounds:[...]}`，最多 6 个已审核贴纸 ID 和 2 个背景 ID。素材 ID 不来自请求，也不导入演示素材。本轮只有 synthetic 目录测试，尚未选定正式素材或启用真实装饰界面。

服务实现 get/replace/reset、版本冲突及摘要重试。最多 6 个不同贴纸/目标组合，目标必须是同事务中本人当月有效记录。删除/重建后旧关联、目录撤回素材会在返回时过滤，不偷偷改变配置版本。空月 reset 不新建配置，已有配置 reset 推进版本；旧 reset 重试不能擦除较新配置。装饰不推进日记 sourceRevision，也不修改正文或全局显示偏好。

存储事务额外提供 `getDecorations(month)`、`setDecorations(month,doc)` 和 `listMonthMarks(month)`。装饰回执另带 month，复用相同 HMAC/到期策略；读取标记不含正文。实际装饰变更调用 `invalidateExports()` 推进 exportEpoch，但不推进日记源版本；重放/空 reset 只参与 operationFence。CloudBase 候选的绑定检查按当月最多 31 天查找，替换事务最多 38 次数据操作。真实时延仍待验证。

TypeScript 协议见 `cloudfunctions/moodsky/services/repository.d.ts`，类型正反例见 `tools/journal-storage/type-assertions.ts`。它们不修改正式共享类型。

2026-10-21：装饰也持久绑定事务内确认的版本冲突/目标无效，不让同一被拒请求在来源变化后迟到执行。内部拒绝回执带 month，不存贴纸或目标；提交后才返回原业务错误，仅推进 operationFence。到期、异输入及损坏回执失败，平台错误不记为业务拒绝。详情及新增写入代价见[重置后续作](week2/xiang-hong/reset-development-20261021.md)。

## 待接入事项

已新增 [CloudBase 存储候选](../tools/journal-storage/README.md)及锁定 SDK 的离线检查。候选未接入正式入口，使用待评审的确定 ID/布局标记/源版本方案；真实数据库适配尚未验收。

- 与 Jiawei/Xiang Yu/Zhifeng 等消费者复核 H02/H04 字段、墓碑版本和响应投影；正式共享类型未修改。
- 真实 CloudBase 存储、账号映射、唯一约束、事务错误及重试、回执保留和清理策略。
- 源版本的数据库落点、分页一致快照、停用/注销协作、导出及缓存失效。
- 真实并发、断连重试、跨实例、真机与独立复核。历史 H03 五个失败仍未关闭。
- 部署、云写入及发布仍需授权，本地检查通过不等于已获得这些权限。

## 本地复现

```sh
node --test tests/journal-backend.test.js tests/review-backend.test.js
npm run check
```

新增测试只使用合成账号、固定时钟和内存事务，无网络和真实云数据。见 [本轮执行报告](test-reports/2026-10-18-local-backend/README.md)。
