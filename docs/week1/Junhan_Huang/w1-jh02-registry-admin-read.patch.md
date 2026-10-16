# 补丁（拟）—— 为 `admin` 域增加读取 action

> **状态：待接口 PR 评审。本文件只是提案，不代表已改动。**
> 唯一注册表：`miniprogram/shared/contracts.js`
> `scripts/prepare-cloud.js` 会把该目录下的 `*.js` / `*.d.ts` 复制到
> `cloudfunctions/moodsky/shared/`（生成目录，**不要手改**），所以只改这一处。

## 为什么必须加

`admin` 域现注册表**只有 4 个 action，全部 `mutates = true`**，没有任何读取入口：

```js
'admin.updatePlace':           action('admin', 'operator', [], true),
'admin.reviewCorrection':      action('admin', 'operator', [], true),
'admin.updateTaskTemplate':    action('admin', 'operator', [], true),
'admin.updateSupportResource': action('admin', 'operator', [], true),
```

而 `admin/README.md` 明写：

> 实现前补齐**读取**、编辑、审核、分页、错误与并发约定，**不以直接数据库访问绕过授权**。

`database/client-access-policy.json` 又规定客户端对**全部 15 个集合**（含 `places`）
`read: false, write: false`，"Public reads go through validated cloud actions"。

**结论：后台列表无法直连数据库，必须新增读取 action。这是硬约束，不是可选优化。**

## 提案 diff

```diff
   'account.cleanupStatus': action('account', 'receipt', ['UW3-F23']),
   'admin.updatePlace': action('admin', 'operator', [], true),
+  // Read side of the operator back office. Required before the admin UI can
+  // list places, the pending-correction queue, task templates or support
+  // resources: client-side collection reads are denied for all 15 collections,
+  // so these reads must go through validated cloud actions.
+  'admin.listPlaces': action('admin', 'operator', []),
+  'admin.listTaskTemplates': action('admin', 'operator', []),
+  'admin.listSupportResources': action('admin', 'operator', []),
+  'admin.listCorrections': action('admin', 'operator', []),
   'admin.reviewCorrection': action('admin', 'operator', [], true),
   'admin.updateTaskTemplate': action('admin', 'operator', [], true),
   'admin.updateSupportResource': action('admin', 'operator', [], true),
```

**要点**

- 全部 `access = 'operator'` → 复用 `router.js` 现有门禁，**不新写一套鉴权**
- `mutates` 缺省为 `false` → 读取语义正确
- `requirements` 留空数组，与现有 4 个 admin action 一致；需求号由评审补充
- 命名与既有 `admin.updateXxx` 对称，**不引入 `admin.list{collection}` 泛化入口**

## 必须同时改三处

|  #  | 文件                              | 改什么                           | owner       |
| :-: | --------------------------------- | -------------------------------- | ----------- |
|  1  | `miniprogram/shared/contracts.js` | 上表 4 个 action                 | `@HX-Jan`   |
|  2  | `docs/api.md`                     | 「预留接口与访问范围」表格加一行 | `@HX-Jan`   |
|  3  | 后台界面（Qizhen Chen）           | 消费者                           | Qizhen Chen |

> `contracts.js` 文件头：_"This is the only action registry. Shared changes require an interface review."_
> `docs/api.md`：「新增字段、action 或错误更新同一注册表和消费者」「不能单边改名」

## 配套的 `admin.js` 实现（同 PR 或紧随其后）

`cloudfunctions/moodsky/domains/admin.js` 目前是单行 `notImplemented()`。
新增读取入口后，该文件按 `action` 分派：4 个列表读取 + 4 个写入/审核。
**`admin.js` 内部不需要再判角色** —— `router.js` 在调用它之前已完成 operator 门禁。

## 待评审问题

1. 四个独立 action，还是统一 `admin.list{collection}`？（提案选后者为四个独立 action）
2. `listCorrections` 除了 `status` 还需要按什么筛选？排序固定为提交时间倒序？
3. 分页参数是否与 `campus.listPlaces` 收敛成同一约定（`page` / `pageSize`）？
4. 审核结论是否需要留痕字段（审核人、审核时间、理由）？
5. 这些 action 是否需要对应需求号（`UW3-F**`）？
