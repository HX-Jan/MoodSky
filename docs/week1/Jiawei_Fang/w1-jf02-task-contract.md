# W1 JF02 任务接口与状态转换契约

- 负责人：Jiawei Fang（832401110）
- 协作：Qizhen Chen（F17—F19 前端）、Yifan Ji（F20 轻选择）；消费者：Yuen Lin（据此写用例）
- 状态：契约草案，**待接口评审**；本条不含实现（`domains/tasks.js` 仍为 `NOT_IMPLEMENTED`）

## 1. 动作与访问级别（以 `miniprogram/shared/contracts.js` 为唯一注册表）

| action              | 访问    | mutates | 需求编号     | 关键约束                                                          |
| ------------------- | ------- | ------- | ------------ | ----------------------------------------------------------------- |
| `tasks.suggestions` | public  | 否      | UW3-F17      | 最多 3 条（`LIMITS.taskSuggestions`）；未登录即可用；不读私人正文 |
| `tasks.quickChoice` | public  | 否      | UW3-F20      | 未保存日记也可用；只返回入口与建议                                |
| `tasks.transition`  | private | 是      | UW3-F17、F18 | 需 active 账号；幂等；不接受客户端身份                            |
| `tasks.history`     | private | 否      | UW3-F19      | 仅本人；客户端不能指定账号                                        |

**注意**：`suggestions` 与 `quickChoice` 是 **public**，不是 private——首次使用、未登录状态都必须可用。这与「私人记录未保存也能进入轻选择」的 F20 口径一致。

## 2. 数据模型（`docs/week1/XiangYu/data-dictionary.md` §10）

`task_history`：`ownerId`（系统写入）、`taskId`、`date`、`state`、`createdAt`；索引 `ownerId + date`（**非唯一**）。
状态枚举 `shared/constants.js` 已有 `TASK_STATUS`：`selected / completed / skipped / replaced`。

### 2.1 一个必须先解决的风险

索引非唯一 + 「一个日期一个模板只有一行」的业务要求，意味着**并发转换可能产生两行**。三种处理方式：

| 方案      | 做法                                                                                        | 代价                                           |
| --------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A（推荐） | 由 Xiang Yu 在 `database/collections.json` 增加 `uniqueKeys: [["ownerId","taskId","date"]]` | 需数据库主责变更；平台能力已有证据支持（见下） |
| B         | 写前先查后写，用 `request_receipts` 兜幂等                                                  | **非原子**，竞态窗口仍在，只能减少不能消除     |
| C         | 由回执先占位（`request_receipts` 唯一键）再写历史                                           | 多一次写；失败恢复语义要额外定义               |

**平台能力证据**：W1XY02 的约束验证与 PR #3 的记录显示 CloudBase 支持复合唯一索引（`uniq_ownerId_date`），相同键重复写入报 `E11000 duplicate key error`。该实验在**探针集合**完成，正式集合是否建索引仍需决定，也不能据此宣称云函数并发已验收。因此方案 A 技术上可行，缺的只是「是否在正式集合建索引」的决定。

未定之前，`tasks.transition` 的并发正确性**不能标为通过**。

## 3. 状态转换表

| 当前状态                           | 转换       | 目标状态                              | 重复提交                                  | 失败                              |
| ---------------------------------- | ---------- | ------------------------------------- | ----------------------------------------- | --------------------------------- |
| 无记录                             | `select`   | `selected`                            | 同 `requestId` 同 payload → 返回原结果    | 模板不存在/停用 → `INVALID_INPUT` |
| 无记录                             | `complete` | `completed`                           | 同上                                      | 同上                              |
| 无记录                             | `skip`     | `skipped`                             | 同上                                      | 同上                              |
| 无记录                             | `replace`  | 本模板 `replaced` + 新模板 `selected` | 同上                                      | 无可替换 → `CONFLICT`             |
| `selected`                         | `complete` | `completed`                           | 幂等返回 `completed`                      | —                                 |
| `selected`                         | `skip`     | `skipped`                             | 幂等返回 `skipped`                        | —                                 |
| `selected`                         | `replace`  | 本模板 `replaced` + 新模板 `selected` | 同 `requestId` 幂等                       | 无可替换 → `CONFLICT`             |
| 终态（completed/skipped/replaced） | 任意       | 不变                                  | 相同转换 → `ok: true` 且 `replayed: true` | 改投其他终态 → `CONFLICT`         |

**错误码只用既有枚举**（`shared/contracts.js`）：`INVALID_INPUT`、`CONFLICT`、`UNAUTHENTICATED`、`ACCOUNT_DISABLED`、`NOT_IMPLEMENTED`、`ACTION_NOT_FOUND`。
草稿里自拟的 `TASK_STATE_CONFLICT`、`NO_REPLACEMENT_AVAILABLE`、`IDEMPOTENCY_KEY_REUSED` **均不存在**；若要细粒度区分，须走注册表评审（Xiang Hong 协调，前后端共同复核）。

## 4. 幂等与重复操作

1. 前端对**同一次用户操作**生成一个 `requestId`（8—80 位 `A-Za-z0-9_-`）；失败重试必须复用**同一个 requestId 和同一个 payload**（`docs/api.md` 明文要求，也不能在 payload 里放正文或身份）。
2. 服务端以 `request_receipts`（唯一键 `ownerId + action + requestId`）记录结果摘要，命中即返回原结果，不重复写 `task_history`。
3. 同一 `requestId` 携带不同 payload → `CONFLICT`（不能静默按新 payload 执行）。
4. 「重复操作结果一致」由 2+3 共同保证。

## 5. 跨日与窗口

- `date` 由服务端按 `BUSINESS_TIMEZONE = Asia/Shanghai` 计算；不接受客户端决定归属日。
- 任务状态**仅当日有效**，不开放跨日补记（与日记的 30 天补记窗口不同）——**待评审确认**。
- `tasks.history` 的窗口上限需新定；`REVIEW_WINDOWS = [7,30,90]` 是回顾模块的口径，不自动适用于任务历史。

## 6. 接口样例

以 `docs/api.md` 信封为准（`apiVersion / requestId / action / payload`）。

### 6.1 `tasks.suggestions`（public，未登录可用）

```json
{
  "apiVersion": "1",
  "requestId": "req_tasks_suggestions_01",
  "action": "tasks.suggestions",
  "payload": {}
}
```

```json
{
  "apiVersion": "1",
  "requestId": "req_tasks_suggestions_01",
  "ok": true,
  "data": {
    "items": [
      {
        "taskId": "tpl_walk_10min",
        "title": "在安全开放区域走 10 分钟",
        "durationMin": 10,
        "indoor": false,
        "alternatives": ["在室内慢走 5 分钟"],
        "state": null
      }
    ],
    "notice": "完成由你自行确认，不做打卡惩罚。"
  }
}
```

`task_templates` 实际字段以 Junhan 的 `w1-jh04-task-templates.json` 为准；本处字段名待评审对齐。

### 6.2 `tasks.transition`（private）

```json
{
  "apiVersion": "1",
  "requestId": "req_tasks_transition_01",
  "action": "tasks.transition",
  "payload": { "taskId": "tpl_walk_10min", "transition": "complete" }
}
```

```json
{
  "apiVersion": "1",
  "requestId": "req_tasks_transition_01",
  "ok": true,
  "data": {
    "taskId": "tpl_walk_10min",
    "date": "2026-10-16",
    "state": "completed",
    "replayed": false
  }
}
```

payload **不得**出现 `ownerId / accountId / openid / role / roles / owner`——`validation.js` 会直接 `INVALID_REQUEST`（本地 A06 已验证）。`date` 不由客户端传，服务端按上海时区取。

### 6.3 `tasks.history`（private）

```json
{
  "apiVersion": "1",
  "requestId": "req_tasks_history_01",
  "action": "tasks.history",
  "payload": { "from": "2026-09-17", "to": "2026-10-16", "cursor": null, "limit": 20 }
}
```

```json
{
  "apiVersion": "1",
  "requestId": "req_tasks_history_01",
  "ok": true,
  "data": {
    "items": [
      {
        "date": "2026-10-15",
        "taskId": "tpl_water",
        "state": "completed",
        "createdAt": "2026-10-15T01:20:00Z"
      }
    ],
    "nextCursor": null
  }
}
```

### 6.4 `tasks.quickChoice`（public）

```json
{
  "apiVersion": "1",
  "requestId": "req_tasks_quick_01",
  "action": "tasks.quickChoice",
  "payload": {}
}
```

```json
{
  "apiVersion": "1",
  "requestId": "req_tasks_quick_01",
  "ok": true,
  "data": {
    "entries": [
      { "kind": "places", "label": "找个安静角落", "enabled": true },
      { "kind": "tasks", "label": "做一件小事", "enabled": true }
    ],
    "notice": "不读取你的日记正文。"
  }
}
```

## 7. 待评审点

1. `task_history` 唯一键方案 A/B/C 的取舍（与 Xiang Yu、Xiang Hong）。
2. `tasks.*` 的 **payload 白名单校验**尚未实现（当前只有 `journal.upsert` 有校验器）；补校验需同步 `shared/validation.js`（共享文件，Xiang Hong 协调）。
3. `tasks.history` 的窗口上限与分页大小。
4. 任务状态是否允许跨日补记。
5. 是否记录「建议被展示但未操作」——当前设计为**不记录**，避免形成行为画像。
6. 错误码是否需要新增细粒度枚举（若新增，须注册表评审）。
