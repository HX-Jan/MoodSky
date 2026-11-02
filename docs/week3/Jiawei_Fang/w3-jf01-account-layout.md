# W3 JF01 可信账号接入与布局确认（Jiawei Fang / w3-account）

- 任务编号：W3 JF01，承接 W2 JF01（可信 openid → 内部账号、首次创建与唯一索引）
- 关联需求：UW3-F21（账号偏好入口）、UW3-F23（停用与受限进度）
- 协作人：Xiang Yu（账号库接入、导出清理接缝）、Linghan Chen（Me 页状态接线）
- 复核人：Xiang Hong（接口复核）、Qizhen Cai（独立验收）
- 版本：0.2.3；分支 `week3/jiawei-fang`；基线 `a2a671980a392df1db0e2ec63bd4ec7af4f6b86e`
- 环境：本地 Node v24.15.0 + 合成库（`tests/helpers/w2-database.js` 的 copy-on-write 替身）；**未调用真实云、无真实 openid、无签名密钥**
- 成果路径：[account-adapters.js](../../../cloudfunctions/moodsky/services/account-adapters.js)、[week3-account-adapters.test.js](../../../tests/week3-account-adapters.test.js)
- 实际耗时：待本人确认
- 验收状态：待复核（本地合成通过不等于云端账号验收，也不等于 H02 完整闭环）

## 1 交付内容

新增 `cloudfunctions/moodsky/services/account-adapters.js`，把 W2 的本地身份路径整理成可直接装配的解析器。生产入口 `index.js`、`domains/*.js` stub、`candidate-router` 与打包门禁均未改动，未接入即仍返回 `NOT_IMPLEMENTED`。

| 导出                       | 输入                  | 返回值                                                                          | 失败码                                                 |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `resolveAccount`           | 可信 OPENID（服务端） | `{ id, status }` 或 `null`                                                      | 唯一索引未就绪 `NOT_IMPLEMENTED`；多行/损坏 `CONFLICT` |
| `resolveAccountForJournal` | 同上                  | `{ accountId, status, journalReady, journalLayout, journalRevision }` 或 `null` | 同上                                                   |
| `resolveOperatorRoles`     | `accountId`           | 注入角色数组                                                                    | 未注入 `NOT_IMPLEMENTED`（不在本地授予角色）           |
| `resolveCleanupReceipt`    | 回执 token            | `{ permission: 'cleanup_status', jobId }` 或 `null`                             | 缺密钥/篡改/过期一律 `null`（router 转 `FORBIDDEN`）   |
| `issueCleanupReceipt`      | `{ jobId }`           | token 或 `null`（无 `CLOUD_RECEIPT_SECRET` 时）                                 | —                                                      |

另：请求/payload 含未约定字段或身份字段时，路由层返回 `INVALID_REQUEST`；域层对非法入参（如非法 openid）返回 `INVALID_INPUT`。两者都不触库。

创建统一委托 `domains/repository.getOrCreateAccount`：唯一索引未就绪时 fail closed（`NOT_IMPLEMENTED`），新账号字段由同一写入方产生（`journalLayout=deterministic-days-v1`、`journalRevision=0`、`operationFence=0`、`exportEpoch=0`）。本模块自身不调用 `add()`/`update()`，因此不存在"顺手迁移旧账号"的路径。

另导出 `createAccountReaders({ db })`：只读的 `readAccount` / `readCleanupJob`，供本模块给出布局结论、供 JF04 的 `cleanupStatus` 读取 guard 字段。无 `db` 时不隐式初始化 SDK。

## 2 布局确认结果

| 场景                   | 行为                                                   | 写库 | 测试 |
| ---------------------- | ------------------------------------------------------ | ---- | ---- |
| 重复进入               | 复用同一 `_id`，不重复建号                             | 0    | A01  |
| `Promise.all` 并发首建 | 5 次并发只落 1 行，返回值同一 `id`；唯一冲突按 R4 回读 | 1    | A02  |
| 新账号                 | 写入 layout 与三个零围栏，时间戳取服务端日期           | 1    | A03  |
| 停用旧身份             | 原样返回 `disabled`，不复活、不重建                    | 0    | A04  |
| 旧账号（无 layout）    | 只读解析，`journalReady:false`，行与原种子逐字段相同   | 0    | A05  |
| 唯一索引未就绪         | `NOT_IMPLEMENTED`，不写任何账号行                      | 0    | A06  |
| 空 / 非字符串 openid   | 直接返回 `null`，未触库                                | 0    | A07  |

## 3 给 H02 的调用契约（`resolveAccountForJournal`）

H02 在装配 journal 后端时按下列顺序调用，不要再用`findAccountByOpenid`+`insertAccount`的本地两步路径：

```js
const readers = createAccountReaders({ db });
const adapters = createAccountAdapters({ repository, clock, readAccount: readers.readAccount });
const account = await adapters.resolveAccountForJournal(trustedOpenid); // openid 只取 wxContext.OPENID
if (!account) throw new AppError('UNAUTHENTICATED', '请先登录。');
if (account.status !== 'active') throw new AppError('ACCOUNT_DISABLED', '账号已停用。');
if (!account.journalReady) throw new AppError('NOT_IMPLEMENTED', '记录存储方案尚未启用。');
// 之后才允许把 account.accountId 交给 journal 事务仓库
```

返回字段：

| 字段              | 含义                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `accountId`       | 内部账号 `_id`，也是 journal 事务的 ownerId                                                                        |
| `status`          | `active`/`disabled`，原样透出；本模块从不改写                                                                      |
| `journalReady`    | 仅当 `status==='active'` 且 `journalLayout==='deterministic-days-v1'` 且 `journalRevision` 为非负安全整数时为 true |
| `journalLayout`   | 已存储布局；旧账号为 `null`                                                                                        |
| `journalRevision` | 已存储修订号；布局不符或非法时为 `null`                                                                            |

失败码约定：`NOT_IMPLEMENTED`（唯一索引未就绪 / 布局缺失，必须 fail closed，不能把无 layout 的旧集合当空日记）、`CONFLICT`（同一 openid 多行或账号行损坏）、`UNAUTHENTICATED`（空 openid；H02 自己抛）、`ACCOUNT_DISABLED`（H02 按 `status` 抛，本模块不抛）。`journalReady=false` 时 H02 只能返回 `NOT_IMPLEMENTED`，不得读写出任何 journal 文档。

## 4 真实命令输出

```text
$ node --test tests/week3-account-adapters.test.js tests/week3-account-close-chain.test.js
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

```text
$ npx eslint cloudfunctions/moodsky/services/account-adapters.js cloudfunctions/moodsky/services/account-candidate.js
（无输出，exit 0）

$ npx prettier --check cloudfunctions/moodsky/services/account-adapters.js cloudfunctions/moodsky/services/account-candidate.js tests/week3-account-adapters.test.js tests/week3-account-close-chain.test.js
Checking formatting...
All matched files use Prettier code style!
```

全量 `npm run check` 的真实结果见 [JF04 文档第 4 节](w3-jf04-close-chain.md#4-真实命令输出)（同一次运行，本任务 12 项）。

## 5 偏差与阻塞

1. **云端未执行**：`uniq_openid` 是否已建、平台重复键错误形状、真实 openid 首建/并发首建均未在云端验证，全部仍是本地合成结论。需 Xiang Yu 提供索引状态与隔离批次范围后才能推进 H02 真实闭环。
2. **`resolveAccountForJournal` 依赖只读行读取器**：未注入 `readAccount` 时只能返回 `journalReady:false`（A09 锁定该行为），不会猜布局。真实装配需要 `database({ throwOnNotFound:false })` 实例。
3. **旧账号不迁移**：W2 遗留的无 layout 账号仍可被解析，但不能写日记。迁移方案（回填 layout/围栏或以新账号重建）尚未定稿，需负责人与 Xiang Yu 共同确认，本任务不做隐式写入。
4. **角色与登录范围**：`operator_roles` 仍由注入 seam 决定（未注入即 `NOT_IMPLEMENTED`），pilot 的 `identityKind`/`sessionScope` 检查不在本模块，仍由 `tools/private-pilot/backend.js` 负责。
5. **验收分工**：Xiang Hong 复核接口字段与失败码，Qizhen Cai 独立验收；本人未代填复核结论，工时"待本人确认"。
