# W3 JF05 sourceRevisions 口径提案（导出前置）

- 任务编号：W3 JF05（导出/清理接缝）
- 提交对象：Xiang Yu（数据库与导出）、Xiang Hong（账号围栏与接口）
- 版本：0.2.3；分支 `week3/jiawei-fang`
- 状态：**提案，待确认**；本文件不改 `database/`、不改公共 API。写入端已在本分支实现（`createSourceRevisionWriter` + 8 项测试），字段名仍待 S1 确认
- 关联：[数据能力](w3-jf05-data-capability.md) G1/G2

## 1. 问题

`domains/export.js` 在创建导出任务前读取 `sourceState`，要求账号行提供：

```js
{ epoch, revisions: { journals, favorites, tasks, preferences, decorations }, status: 'active' }
```

其中 `epoch` 用 `exportEpoch`，但**五个域的 revisions 目前没有任何写入方推进**。若返回全 0，导出会在一份已经变化的快照上继续，等于放过过期数据；因此 `services/account-data.js` 现在选择 `NOT_IMPLEMENTED`（诚实失败），而不是伪造 0。

## 2. 提案字段

账号行新增（或复用）：

```json
{
  "sourceRevisions": {
    "journals": 0,
    "favorites": 0,
    "tasks": 0,
    "preferences": 0,
    "decorations": 0
  }
}
```

约束：

1. 五个键必须齐全，值为非负安全整数；缺失/类型错误 → 读取端 `NOT_IMPLEMENTED`，不得补 0。
2. 每次**成功写入**对应域时 +1，且与业务写入同一事务/同一次提交（不新增独立写入路径）。
3. 计数器只能单调递增；非递增或越界 → `CONFLICT`。
4. `epoch`（`exportEpoch`）继续只由账号级事件推进（停用、导出撤销、清理），域内写入只动 revisions。

## 3. 写入点归属

| 域                      | 写入方                           | 说明                                                                   |
| ----------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| journals                | H02 / journal 服务（Xiang Hong） | 现有事务已递增 journalRevision，可与 sourceRevisions.journals 合并口径 |
| favorites / decorations | Junhan / Xiang Hong              | 收藏与装饰写入点                                                       |
| tasks                   | JF02（本分支）                   | 任务转换成功提交时 +1（与 task_history 同事务）                        |
| preferences             | JF03（本分支）                   | 偏好保存成功时 +1                                                      |

本分支**不替其他域写代码**；若要由本分支提供 helper，可加 `bumpSourceRevision(tx, ownerId, domain)`，但需先定字段。

## 4. 迁移与失败语义

- 旧账号缺 `sourceRevisions`：读取端 `NOT_IMPLEMENTED`；迁移由 Xiang Yu 的数据库方案统一执行，**close 与导出不得顺手补字段**。
- 读取端校验顺序：账号存在 → active → 五键齐全 → 非负整数 → 返回快照；任一步失败即失败，不返回部分结果。
- 导出侧收到 `NOT_IMPLEMENTED` 时的界面文案："数据版本尚未就绪，暂不能导出"，不得显示"正在准备"。

## 5. 需要确认的决策

| 编号 | 问题                                              | 建议                                       |
| ---- | ------------------------------------------------- | ------------------------------------------ |
| S1   | 字段名 `sourceRevisions` 与五个键名               | 保持不变，与 `SOURCE_DOMAINS` 对齐         |
| S2   | 是否复用 `journalRevision` 作为 journals revision | 不复用，避免两套语义；迁移时一次性对齐     |
| S3   | 写入方式（各域自增 vs 统一 helper）               | 各域在自己的事务内自增，签 helper 仅作工具 |
| S4   | 旧账号迁移时点                                    | 与账号布局迁移同批执行，单独批次与回滚方案 |

确认前，导出能力保持“本地可测、真实账号失败为 NOT_IMPLEMENTED”，不计为已接通。
