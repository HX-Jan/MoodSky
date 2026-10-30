# W3 JF05 任务/偏好数据能力（供导出与清理）

| 项目     | 内容                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| 任务编号 | W3 JF05                                                                                                             |
| 承接     | W2 JF05《任务与偏好数据能力交付及联合复核》([文档](../../week2/Jiawei_Fang/w2-jf05-data-capability.md))             |
| 关联需求 | UW3-F17/F19（任务建议与本人历史）、UW3-F21（偏好）、UW3-F22（导出字段投影）、UW3-F23（清理幂等）                    |
| 负责人   | Jiawei Fang                                                                                                         |
| 协作人   | Xiang Yu（导出/清理执行器）、Qizhen Chen（任务与偏好字段）、Yuen Lin（回归）                                        |
| 复核人   | Yuen、Qizhen Cai                                                                                                    |
| 版本     | 0.2.3                                                                                                               |
| 环境     | 本地 Node.js v24.15.0 + 合成数据库替身（`tests/helpers/w2-database`）；**真实云 / 真实数据库 / 清理执行器均未执行** |
| 成果路径 | 见 §2                                                                                                               |
| 实际耗时 | 待本人确认（不由代理代填）                                                                                          |
| 验收状态 | **待复核**                                                                                                          |
| 阻塞     | 账号未维护 `sourceRevisions` 写入方、任务/偏好写入不推进账号版本、清理任务/回执守卫未接线、真实云未执行             |

## 1. 结论先行

- 新增 [account-data.js](../../../cloudfunctions/moodsky/services/account-data.js)：为导出与清理提供四个**本人范围**数据能力——`readSourceState`（来源栅栏）、`listTaskHistory`、`listPreferences`、`cleanupOwnerBatch`。工厂只接注入的数据库或事务，**import 时不连库**，无句柄时按 `NOT_IMPLEMENTED` 失败而不是返回空成功。
- `readSourceState` 的成功形状与 `domains/storage-support.sourceState` 完全兼容（D01 用它复核过）。**但真实账号目前不满足**：`favorites/tasks/preferences/decorations` 没有任何写入方在推进版本，本模块因此返回 `NOT_IMPLEMENTED`，不把 `exportEpoch`/`operationFence` 冒充四域修订号。
- 本人读取只输出约定字段：任务历史不含 `ownerId`，偏好不含 `ownerId/openid`，且不合成未保存的默认值。
- 清理只允许 `task_history`、`preferences` 两个集合；`task_templates` 等公共资料不在白名单内，调用即 `INVALID_INPUT`，一行不删。

## 2. 成果路径（本任务只动这些文件）

| 文件                                                | 变更 | 说明                                         |
| --------------------------------------------------- | ---- | -------------------------------------------- |
| `cloudfunctions/moodsky/services/account-data.js`   | 新增 | 四个本人范围数据能力，含失败码与公共模板保护 |
| `tests/week3-account-data.test.js`                  | 新增 | D01—D20：形状、失败码、隔离、幂等、模板保留  |
| `docs/week3/Jiawei_Fang/w3-jf05-data-capability.md` | 新增 | 本文档                                       |

未修改：`domains/export.js`、`domains/cleanup.js`、`domains/storage-support.js`、`stores/account-transaction.js`、`database/collections.json`、`index.js`、`shared/`、`miniprogram/`。

## 3. `readSourceState(ownerId, tx)`

成功返回（在调用方事务内读取 `accounts` 行）：

```js
{
  ownerId,           // = 传入的 ownerId（与行 _id 一致）
  status: 'active',  // 停用不返回禁用值交给上层猜，直接 ACCOUNT_DISABLED
  epoch: exportEpoch,
  revisions: { journals, favorites, tasks, preferences, decorations }
}
```

| 条件                                                                       | 结果               | 说明                                                  |
| -------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| 未传事务句柄或句柄没有 `collection`                                        | `NOT_IMPLEMENTED`  | 来源版本必须在调用方事务内读取                        |
| `ownerId` 非法                                                             | `INVALID_INPUT`    | 沿用 `storage-support.identity`                       |
| 账号行缺失 / `_id` 不符 / status 非 active/disabled                        | `UNAUTHENTICATED`  | 沿用 `storage-support.account`                        |
| 账号 `disabled`                                                            | `ACCOUNT_DISABLED` | 不把停用账号当作可用来源                              |
| `journalLayout` / `taskLayout` 未确认                                      | `NOT_IMPLEMENTED`  | 旧账号不初始化、不迁移字段                            |
| `operationFence` / `exportEpoch` / `journalRevision` 缺失                  | `NOT_IMPLEMENTED`  | 字段早于围栏协议，fail closed                         |
| 上述计数器为负/小数/耗尽（`MAX_SAFE_INTEGER`）                             | `CONFLICT`         | 不四舍五入、不截断                                    |
| `sourceRevisions` 缺失                                                     | `NOT_IMPLEMENTED`  | 四域无写入方推进版本，拒绝伪造 0                      |
| `sourceRevisions` 键集不符、某域非法、`journals` 与 `journalRevision` 冲突 | `CONFLICT`         | 键必须恰为五域；`journals` 必须等于 `journalRevision` |

**为什么不拿 `exportEpoch`/`operationFence` 顶替四域修订号**：任务转换只写 `task_history`/`request_receipts`（`services/tasks-candidate.js`），偏好保存只写 `preferences`（`services/account-candidate.js`），二者都**不更新 `accounts` 行**。任何账号级计数器因此都不能证明这两域没有变化；把它当修订号会让 `domains/export.js` 的"生成前后版本一致"检查放过过期快照。按缺失处理（`NOT_IMPLEMENTED`）比给出貌似一致的 0 更安全，也是"不生成貌似一致的快照"的既有原则。

`sourceRevisions` 是本模块提出的账号行字段（形如 `{ journals, favorites, tasks, preferences, decorations }`），**尚未写入 `database/collections.json`，也未由任何写入方推进**（G1/G2，需 Xiang Yu 与 Xiang Hong 共同确认）。本任务不改数据库设计与公共 API。

## 4. 本人读取投影

| 读取                                       | 来源                                                      | 输出                                                                                | 不输出                                  |
| ------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| `listTaskHistory(ownerId, {limit, after})` | `task_history`，`where({ownerId})`，按存储 `_id` 升序分页 | `{ items, nextCursor }`；条目 `taskId/date/state/createdAt`，存在时附加 `taskTitle` | `ownerId`、`_id`、他人的任何行          |
| `listPreferences(ownerId)`                 | `preferences`，`where({ownerId})`，最多查 2 行            | 仅存字段：`cardTextPreview`、`decorationsEnabled`、`updatedAt`；无行返回 `null`     | `ownerId`、`openid`、未保存字段的默认值 |

- 参数：`limit` 默认 50、范围 1—100；`after` 必须是合法存储 id（`[A-Za-z0-9_-]{1,128}`）。非法参数 → `INVALID_INPUT`。
- 数据校验：`date` 必须是真实业务日期、`state` 必须属于 `TASK_STATUS`、`createdAt` 必须可解析；任一不符 → `CONFLICT`（不修补、不跳过成"更干净"的结果）。
- `nextCursor` 只在"删除/读取后确实还有本人行"时给出：短页不会被误报为还有下一页，满页也不会被误报为结束。
- 同一账号出现两条偏好文档 → `CONFLICT`；`preferences` 中非布尔字段或非日期 `updatedAt` → `CONFLICT`。
- 未保存过的偏好行返回 `null`，**不合成** `DEFAULT_PREFERENCES`：默认值语义仍由 `account.preferences`（`get`）负责，导出文件只写真实存在的数据。

## 5. `cleanupOwnerBatch(ownerId, {collection, limit})`

| 语义      | 实现口径                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 白名单    | 只允许 `task_history`、`preferences`；`task_templates`、`journals`、`accounts` 等 → `INVALID_INPUT`，一行不删                                                            |
| 分批      | 每次最多 `limit` 行（默认 50，1—100），返回 `{ collection, deleted, hasMore }`                                                                                           |
| `hasMore` | 删除后**再查 1 行**得出，不由"本批不足 limit"推断                                                                                                                        |
| 幂等      | 删除已被别人删掉的行（`stats.removed = 0`）计 0 次、不报错；重复执行后数据与第二次结果一致                                                                               |
| 归属      | 只按 `ownerId` 查询，并逐行复核 `ownerId`；非本人行 → `CONFLICT`，不删                                                                                                   |
| 不做的事  | 不做账号冻结、清理任务、导出撤销与回执校验——那是 `domains/cleanup.js` 的 worker 协议（账号必须 disabled、`cleanup_jobs` 与删除标记存在、`exportAccessRevoked === true`） |

本函数是**被验证后的批量删除原语**，不是公开 action，也不替代 `executeAccountCleanup`：调用方必须先通过既有 job/receipt 守卫，再按集合调用它。这样处理与 `domains/cleanup.js` 的 `COLLECTIONS` 顺序第 3、4 位（`task_history`、`preferences`）对齐，且公共 `task_templates` 永远不在删除范围内。

## 6. 与导出、清理服务的接缝结论

| 消费方           | 现有调用点                                                                                               | 本模块提供          | 结论                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| 导出（XY03）     | `domains/export.js` 在 `db.runTransaction` 内调用 `readSourceState(ownerId, tx)`，再交给 `sourceState()` | `readSourceState`   | 形状已对齐（D01 用 `sourceState` 复核）；`operationFence` 推进仍由 `createExportJob` 负责，不重复实现 |
| 清理（XY04）     | `domains/cleanup.js` 的 `cleanupByOwnerId` / `executeAccountCleanup`                                     | `cleanupOwnerBatch` | 作为两集合的删除实现可接入；job/receipt/标记仍由 cleanup.js 守卫（G3）                                |
| 任务历史（JF02） | `tasks.history` → 适配器映射 `items/nextCursor`                                                          | `listTaskHistory`   | 字段口径一致（`taskId/date/state/createdAt`）；排序口径不同，见 G4                                    |
| 偏好（JF03）     | `account.preferences`（operation=get）                                                                   | `listPreferences`   | 字段一致且都不含 `ownerId/openid`；默认值只在 get 侧出现（G5）                                        |

## 6.5 来源版本写入端（本轮新增，仍属提案实现）

`services/account-data.js` 新增 `createSourceRevisionWriter({ db })` 与纯函数 `nextRevisions(declared, domain, journalRevision)`：

- 只推进账号行**已声明**的五域 `sourceRevisions`，不创建字段；缺布局/缺字段 → `NOT_IMPLEMENTED`，计数损坏或 `journals !== journalRevision` → `CONFLICT`，未知域 → `INVALID_INPUT`，溢出/更新 0 行 → `CONFLICT`。
- 必须在调用方事务内推进（可传入 `tx`），业务写入与版本提交同源；不传事务时自开一个，仅适用于无并发写入的场景。
- 8 项测试见 `tests/week3-source-revisions.test.js`：五域自增、失败码、同事务可被 `readSourceState` 读到、disabled/旧账号拒绝、丢失更新冲突、溢出拒绝。
- **仍未定稿**：字段名与键名（S1）、journals 是否复用 `journalRevision`（S2）、写入方式（S3）待 Xiang Yu/Xiang Hong 确认；本模块不替其他域接线。JF02/JF03 的写入点在各自候选处理器中预留，未接入 `account` 事务。

## 7. 测试与真实命令输出

```sh
node --test tests/week3-account-data.test.js
```

```text
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

新增 20 项覆盖：来源形状与 `sourceState` 兼容（D01）、注入事务可用（D02）、布局/字段缺失（D03/D04/D07）、冲突与损坏计数器（D05/D06）、账号缺失/停用（D08）、非事务调用（D09）、历史投影与本人隔离（D10）、游标完整遍历（D11）、非法行与参数（D12）、偏好投影与默认值克制（D13/D14/D15）、分批与 `hasMore`（D16）、重复执行不变（D17）、删不存在不报错（D18）、公共模板与其它集合拒绝（D19）、无数据库句柄与错误装配（D20）。

完整仓库检查（含 lint、format、结构、文档、类型与全部测试）的真实结果见 `npm run check` 输出，记录在 §10。

## 8. 开放项与阻塞

| 编号 | 问题                                                                     | 影响                                   | 归属/下一步                                          |
| ---- | ------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------- |
| G1   | `sourceRevisions` 只是提案：未写入 `database/collections.json`，无写入方 | 真实账号导出得到 `NOT_IMPLEMENTED`     | Xiang Yu 与 Xiang Hong 确认字段与推进协议（阻塞）    |
| G2   | 任务转换、偏好保存不更新 `accounts` 行                                   | 四域版本无法证明未变，不能安全发布导出 | 与 JF02/JF03 接线时把版本推进并入账号围栏            |
| G3   | `cleanupOwnerBatch` 不含 job/receipt 守卫                                | 只能由已通过守卫的 worker 调用         | 接线时与 `domains/cleanup.js` 的 guard 组合          |
| G4   | 历史分页按存储 `_id` 升序，展示/导出可能需要时间倒序                     | 两种顺序并存，需明确导出顺序           | Xiang Yu 决定；必要时加索引后改 `createdAt` 游标     |
| G5   | 偏好未保存字段不补默认值                                                 | 导出文件可能缺字段                     | 若导出需要默认值，应在导出层显式声明而不是数据层编造 |
| G6   | 真实云未执行                                                             | 所有结论来自合成数据库                 | 云授权后复测；不据此宣称云端已可用                   |
| G7   | 实际耗时、难度点、独立验收意见                                           | 个人验收材料                           | 本人/复核人填写，代理不代填（阻塞）                  |

## 9. 协作与来源

- 本模块是 Xiang Yu 的导出（`domains/export.js`）与清理（`domains/cleanup.js`）候选的数据侧补充，不改变两者已合并的行为与失败语义。
- 账号行字段沿用 `stores/account-transaction.js` 对 `operationFence/exportEpoch` 的校验习惯（`< MAX_SAFE_INTEGER`），未新增数据库索引或迁移。
- 任务与偏好字段沿用 W2 JF02/JF03 口径；本人历史与 `tasks.history` 使用同一状态枚举。

## 10. 完整检查命令输出（追加记录）

```text
> moodsky@0.2.3 check
> npm run lint && npm run format:check && npm run structure:check && npm run docs:check && npm run typecheck && npm test

> moodsky@0.2.3 lint
> eslint .

> moodsky@0.2.3 format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!

> moodsky@0.2.3 structure:check
> node scripts/check-structure.js
Structure, 24 requirement IDs, shared contract copy and client access policy passed.

> moodsky@0.2.3 docs:check
> node scripts/check-docs.js
16 maintained documents / 293 local links passed.

> moodsky@0.2.3 typecheck
> tsc --noEmit --strict --skipLibCheck false --lib es2020 --module commonjs tools/week1-contracts/type-assertions.ts

> moodsky@0.2.3 test
> node --test tests/*.test.js

ℹ tests 1003
ℹ suites 0
ℹ pass 1003
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
EXIT:0
```

口径说明：最终运行共 995 项 = 基线 924 + 本分支 W3 新增 71 项（JF01 12、JF02 17、JF03 8、JF04 14、JF05 20）。JF05 只负责其中 20 项（D01—D20）；P01—P17 属 JF02，两者合计 37 项，不互相计入。未放宽任何既有断言。
