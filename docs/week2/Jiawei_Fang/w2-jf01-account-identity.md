# W2 JF01 可信身份正式入口、首次创建与并发回读

| 项目     | 内容                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| 任务编号 | W2 JF01                                                                                                                 |
| 承接 W1  | W1 JF01《可信微信账号解析验证》（`docs/week1/Jiawei_Fang/w1-jf01-account-identity.md`），采纳其规则 R1—R4               |
| 关联需求 | UW3-F21（隐私和显示偏好）、UW3-F23（账号停用、注销与进度回执）的私人门禁前提                                            |
| 负责人   | Jiawei Fang（832401110），本周身份 w2-account                                                                           |
| 协作人   | Xiang Yu（`accounts` 字段与 `uniq_openid`）、Junhan Huang（`adapters.js` 运营角色语义）、Xiang Hong（共享校验与注册表） |
| 复核人   | Xiang Hong（待复核）；独立检查：Qizhen Cai                                                                              |
| 版本     | 0.2.3（rebase 后；交付过程起始于 0.2.0）                                                                                |
| 环境     | 本地 Node.js v24.15.0；内存 store + 云形状 stub + 注入 clock；**真实云 / 数据库 / 回执签名密钥未执行**                  |
| 成果路径 | 见 §2                                                                                                                   |
| 验收状态 | **待复核**                                                                                                              |
| 实际耗时 | 待本人确认（不代填）                                                                                                    |
| 阻塞     | 真实云写入授权（Xiang Hong 协调）；`uniq_openid` 正式集合并发行为（Xiang Yu）                                           |

关于需求编号：仓库内没有 UW2 编号体系，`docs/requirements.md` 只定义 UW3-F01—F24；本目录沿用 W1 文档的口径引用 UW3 编号，不另造编号。

## 1. 结论先行

- 正式入口已接线：`index.js` 用 `cloud.getWXContext().OPENID` 解析内部账号，缺 OPENID 时由 router 直接 `UNAUTHENTICATED` 且**不触碰 store**；未命中则首次创建，命中则复用同一账号 id。
- 规则 R1—R4 已从 W1 的“本地提案”推进为 `identity.js` 中的实现；并发首次创建遇唯一键冲突时回查成功，最终只有 1 行账号。
- 运营角色仍由 Junhan 的 `adapters.js` 负责，`identity.js` 只转发 `createAdapters(cloud).resolveOperatorRoles`，不自行授予、也不静默放宽。
- 新增 9 项测试，本地全过（`node --test tests/week2-account-identity.test.js` → 9 pass）；入口装配的可恢复性另由 `tests/week2-entry-wiring.test.js`（3 项）覆盖。真实云写入、`uniq_openid` 正式集合并发与云数据库错误形状均**未执行**，因此本条**只能标待复核**，不能标已验收。
- 未修改任何 `shared/`、`miniprogram/`、`adapters.js`、`router.js`，也未改 journal/review/campus/admin 域。

## 2. 成果路径（本条改动的文件）

| 文件                                                 | 变更 | 说明                                                                            |
| ---------------------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| `cloudfunctions/moodsky/identity.js`                 | 新增 | 账号解析/首次创建/回执签发校验；转发运营角色                                    |
| `cloudfunctions/moodsky/stores/account-store.js`     | 新增 | accounts / preferences / cleanup_jobs / request_receipts 的内存与云 DB 两套实现 |
| `cloudfunctions/moodsky/domains/account.js`          | 修改 | 实现 preferences / close / cleanupStatus；`handle` 保留兜底                     |
| `cloudfunctions/moodsky/index.js`                    | 修改 | 正式接线 `createIdentityServices(cloud)` + `createAccountDomain`                |
| `tests/week2-account-identity.test.js`               | 新增 | W01—W09                                                                         |
| `tests/week2-entry-wiring.test.js`                   | 新增 | WIRING-01—03，装配失败路径（模块缺失 / 真实异常 / 不缓存）                      |
| `docs/week2/Jiawei_Fang/w2-jf01-account-identity.md` | 新增 | 本文档                                                                          |

## 3. 实现口径

### 3.1 门禁顺序（沿用 `router.js` 现状，未改一行）

1. 请求信封与保留身份字段由 `shared/validation.js` 校验；payload 出现 `ownerId / owner / openid / OPENID / role / roles / accountId` 任一 → `INVALID_REQUEST`（拒绝，不是忽略）。
2. 无 `trustedContext.OPENID` → `UNAUTHENTICATED`，未发起任何账号查询。
3. `resolveAccount(OPENID)`：返回空或无 `id` → `UNAUTHENTICATED`“账号尚未就绪。”。
4. `account.status !== 'active'` → `ACCOUNT_DISABLED`。
5. 通过后 router 只把 `{ accountId, roles }` 交给业务处理器；业务模块拿不到 OPENID。

### 3.2 首次创建（`identity.js` `resolveAccount`）

| 规则 | 实现                                                               | 测试    |
| ---- | ------------------------------------------------------------------ | ------- |
| R1   | 仅当 OPENID 为非空字符串才解析；否则返回 `null`，不查库、不建号    | W02/W06 |
| R2   | 命中已有账号 → 原样返回 `{ id, status }`，状态不修正、不复活       | W04     |
| R3   | 未命中 → `insertAccount`，`status = active`，`openid` 由服务端写入 | W01     |
| R4   | 唯一键冲突 → 回读既有行并返回，不报错、不产生第二行                | W03     |

账号行的 `createdAt / updatedAt` 使用注入 clock 的 UTC ISO 字符串。

### 3.3 运营角色

- `createIdentityServices(cloud)` 内部调用 `createAdapters(cloud)`，只取 `resolveOperatorRoles`；`resolveAccount` 由本模块实现（账号解析 + 首次创建），不复用 adapters 的只读版本。
- 未注入运营角色依赖时（测试/离线）默认 `notImplemented()`，operator 动作返回 `NOT_IMPLEMENTED`，**不会**默认放行；注入空数组则返回 `FORBIDDEN`。两者都有测试（W07）。

### 3.4 接线与离线回退

- `index.js` 仅在 `cloud.database()` 可用时装配身份服务与账号/任务域；**只有异常为 `MODULE_NOT_FOUND`（业务模块真的缺失）时才回退到未接线路由**（业务一律 `NOT_IMPLEMENTED`）。该回退不进进程缓存：每次调用重试，`require` 自带模块缓存，成本可忽略。
- 其他装配异常（构造器抛错、SDK 形状变更、store 建不起来）只记录 `error.name` 与 `error.code`——**不记录 payload、OPENID 或任何身份值**——然后重抛，由平台返回真实失败；不再伪装成 `NOT_IMPLEMENTED`。
- 该回退是必要的：`tests/foundation-transport.test.js` 用 vm 注入只含 `wx-server-sdk` 与 `./router` 的 require 替身，并断言未加载其他依赖。该替身对未列出的依赖抛出带 `code = 'MODULE_NOT_FOUND'` 的错误（语义即"本包没有业务模块"），因此仍走未接线路由；**除在该替身错误上补这个 code 外，未改该测试的任何断言**。
- 接线现状：`index.js` 已接线 **account 与 tasks 两域**；journal / review / campus / admin 仍未接线（业务一律 `NOT_IMPLEMENTED`）。

### 3.5 store 与唯一键

- `accounts` 唯一键 `openid`：内存实现镜像该行为（重复 insert 抛 `code = 'DUPLICATE_KEY'`）；云实现捕获平台错误后归一为同一码。
- 云 DB 的重复键错误形状未对真云验证，当前按 `/duplicate key|E11000/i` 判定（见 §7 待确认 2）。

## 4. 测试清单与真实计数

命令与**实际输出**（本地 Node v24.15.0，全部为本地替身）：

```
node --test tests/week2-account-identity.test.js
# tests 9 / pass 9 / fail 0

node --test tests/week2-entry-wiring.test.js
# tests 3 / pass 3 / fail 0
```

| 用例      | 场景                                              | 断言要点                                                                                      |
| --------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| W01       | 首次进入 + 重复进入                               | 建 1 个 active 账号；两次同一 id；账户行 openid 来自可信上下文                                |
| W02       | 无可信身份                                        | `UNAUTHENTICATED`，`store.calls` 为空、账号 0 行                                              |
| W03       | 3 次并发首次进入（云形状 stub，uniq_openid 生效） | 冲突回查；三条结果同一 id；服务端仅 1 行                                                      |
| W04       | 停用账号重新进入                                  | `ACCOUNT_DISABLED`；不新建、不复活；insert 调用为 0                                           |
| W05       | payload 伪造 7 个保留身份字段（含 close 载荷）    | 全部 `INVALID_REQUEST`，且未发起账号查询                                                      |
| W06       | 账号行缺内部 id                                   | `UNAUTHENTICATED`；空 OPENID 不查库                                                           |
| W07       | operator 角色                                     | 未注入 → `NOT_IMPLEMENTED`；无授权 → `FORBIDDEN`（不静默放行）                                |
| W08       | 正式入口（vm 加载 `index.js` + 云形状 DB）        | 私人请求成功走通到 account 域；重复进入不增行；缺 OPENID 0 行                                 |
| W09       | 唯一键冲突且回查仍为空                            | `UNAUTHENTICATED`「账号尚未就绪。」；插入仅 1 次、accounts 仍 0 行（fail closed，不崩不双行） |
| WIRING-01 | 业务模块真的缺失                                  | 回退未接线路由（`NOT_IMPLEMENTED`），不写日志                                                 |
| WIRING-02 | 装配抛普通异常                                    | `main` 抛出该异常；日志只含 `error.name`/`error.code`，不含 OPENID/payload                    |
| WIRING-03 | 模块缺失后恢复                                    | 首次回退、第二次成功装配（失败不缓存）                                                        |

W03 的云形状 stub 只模仿 `where().limit().get() / add / doc().get() / doc().update()` 的调用形态，**不等于**真云已接通。

## 5. 已实现 / 未实现

已实现：

- 正式入口接线（`index.js`）：可信 OPENID → 内部账号 → 门禁 → account 域。
- 首次创建与并发回读（R1—R4），停用账号不复活。
- 客户端身份字段拒绝的回归测试（门禁生效证明）。
- 运营角色沿用 `adapters.js` 语义的转发路径。

未实现 / 未执行：

- 真实云 `accounts` 写入与 `uniq_openid` 正式集合并发（无授权，未执行）。
- 云 DB 重复键错误码与字段类型核对（未对真云验证）。
- Web 身份接入（Qizhen Chen 范围，不属本条）。
- 账号创建审计字段（创建来源、首登时间）——未定义，见 §7。

## 6. 与 W1 提案的偏差

1. W1 §4 登记的“首次创建的生产实现与接线：未实现”现已实现并接线；本条不是“已验收”，真实云仍为空。
2. W1 A05 只验证只读候选；本条直接实现首次创建，因此若部署后仍然出现“账号尚未就绪。”，说明接线回退或 store 异常，而不是没有建号逻辑。
3. W1 未规定创建失败（非唯一键冲突）的语义；本条让它按通用错误收敛为 `INTERNAL_ERROR`，不泄露平台细节。

## 7. 待确认项

1. `accounts.uniqueKeys = [["openid"]]` 在**正式集合**上的并发冲突行为（Xiang Yu 的探针只在探针集合验证过）；本条只证明本地与云形状替身下的回读逻辑。
2. 云数据库重复键的真实 `errCode / errMsg`；确认后应收紧 `isDuplicateKeyError` 的正则，避免把权限或超时错误误判为“已存在”。
3. `index.js` 的最终接线形态：account 与 tasks 两域已接线，journal / review / campus / admin 未接线；是否由 Lead 统一装配其余域待定。
4. `createdAt / updatedAt` 在真云中存 ISO 字符串还是 Date，需与 Xiang Yu 的数据字典核对。
5. 是否需要在 `accounts` 增加首登审计字段（创建来源、首次登录时间）；当前不写，避免形成未评审的行为画像。

## 8. 阻塞

- 真实云账号读写验证：**阻塞**，缺测试环境写入授权（Xiang Hong 协调）。
- `uniq_openid` 正式集合并发验证：**阻塞**，同上。

## 与上游 repository 的对接（已实现、未在打包入口启用）

- `createIdentityServices({ repository })` 已支持把账号首建委托给上游 `domains/repository.js` 的 `getOrCreateAccount`：新账号会带上 `journalLayout/journalRevision/operationFence/exportEpoch`，唯一索引未就绪时 fail closed（`NOT_IMPLEMENTED`），并发冲突后回查赢家。8 项测试见 `tests/week2-account-repository.test.js`。
- **打包入口暂不装配**：`tests/cloud-bundle-defaults.test.js` 明确要求发布的云函数 bundle 不含 `createRepository` 等候选模块（"packaged cloud entry keeps private services disabled"）。因此 `index.js` 仍用本分支的 store 路径建号，不 require repository。
- 启用条件：Yuen Lin / Xiang Hong 更新该打包门禁（把 repository 列为允许的服务）后，在 `index.js` 构造 `createRepository({ db, accountUniqueIndexReady: process.env.ACCOUNT_UNIQUE_INDEX_READY === 'true', newAccountJournalLayout: 'deterministic-days-v1' })` 并传入 `createIdentityServices({ cloud, repository })`。在此之前，两套建号逻辑并存属于**已知待收敛项**，不是已完成状态。
