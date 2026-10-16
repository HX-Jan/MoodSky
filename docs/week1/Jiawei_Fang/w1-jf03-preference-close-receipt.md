# W1 JF03 偏好、停用与受限进度回执

- 负责人：Jiawei Fang（832401110）
- 协作：Linghan Chen（偏好字段与显示依据）、Xiang Yu（停用与清理任务衔接、回执签发）
- 状态：契约草案；回执门禁已在本地替身验证通过（B01—B04）

## 1. 责任边界（先写死，避免验收争议）

| 范围                                                                           | 主责            |
| ------------------------------------------------------------------------------ | --------------- |
| `account.preferences`、`account.close`、`account.cleanupStatus` 入口与回执校验 | **Jiawei Fang** |
| `account.requestExport`、`exportStatus`、`downloadExport`、清理执行器          | **Xiang Yu**    |
| 客户端缓存清理与页面显示                                                       | Linghan Chen    |
| 完整流程独立验收                                                               | Qizhen Cai      |

## 2. `account.preferences`（private，mutates）

### 2.1 形状问题

注册表里只有一个 action 且 `mutates: true`，而 `docs/api.md` 明确：复合入口「实现前明确读写 operation 或拆成独立 action，并同步客户端、注册表和文档」。两个提案：

| 提案                 | 形式                                                       | 影响                                                |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| P1（推荐，改动最小） | `payload.operation = "get" \| "set"`                       | 不改注册表；需在 `validation.js` 为该 action 加校验 |
| P2                   | 拆成 `account.preferences.get` / `account.preferences.set` | 注册表新增一个 action，前后端与文档同步改           |

### 2.2 字段（共享常量已定名）

`shared/constants.js` 的 `DEFAULT_PREFERENCES = { cardTextPreview: false, decorationsEnabled: true }`，数据字典 §3：`ownerId` + 两个布尔字段，唯一键 `ownerId`。

**注意**：数据字典**没有 `version` 字段**。若要多设备防覆盖，须新增 `version`（属数据库变更，Xiang Yu 主责）或依赖唯一 `ownerId` 做整行读改写。草稿里写的 `motionEnabled`、`version` 均无依据，已废弃。

```json
{
  "apiVersion": "1",
  "requestId": "req_pref_get_01",
  "action": "account.preferences",
  "payload": { "operation": "get" }
}
```

```json
{
  "apiVersion": "1",
  "requestId": "req_pref_get_01",
  "ok": true,
  "data": { "cardTextPreview": false, "decorationsEnabled": true, "updatedAt": null }
}
```

无记录时返回**默认值**（默认值来自共享常量，不在客户端各写一份），返回 `updatedAt: null` 表示尚未落库。

```json
{
  "apiVersion": "1",
  "requestId": "req_pref_set_01",
  "action": "account.preferences",
  "payload": { "operation": "set", "decorationsEnabled": false }
}
```

保存成功返回**保存后的完整对象**，供前端直接回显。

**验收口径（F21）**：设置保存与读取一致；关闭显示效果**不影响**记录、导出和删除——偏好是纯展示开关，任何业务判定不得读取它作为权限或可见性依据。

## 3. `account.close`（private，mutates）

### 3.1 入口顺序

| 步  | 位置                 | 行为                                                                         | 显示依据             |
| --- | -------------------- | ---------------------------------------------------------------------------- | -------------------- |
| 1   | 我的 → 隐私与数据    | 注销入口                                                                     | —                    |
| 2   | 影响说明             | 说明记录/任务历史/偏好将被清理、已发出的导出失效、不可撤销                   | 静态文案             |
| 3   | 重新确认会话         | 重新确认身份                                                                 | 会话校验结果         |
| 4   | 二次确认             | 用户显式确认                                                                 | —                    |
| 5   | 调用 `account.close` | 置 `status = disabled` → 撤销会话 → 创建 `cleanup_jobs`（`state = pending`） | 接口返回             |
| 6   | 处理中页             | 轮询 `account.cleanupStatus`                                                 | `cleanup_jobs.state` |
| 7   | 结束                 | 处理中 / 失败 / 完成                                                         | `cleanup_jobs.state` |

```json
{
  "apiVersion": "1",
  "requestId": "req_close_01",
  "action": "account.close",
  "payload": { "confirm": "CLOSE" }
}
```

```json
{
  "apiVersion": "1",
  "requestId": "req_close_01",
  "ok": true,
  "data": {
    "accountStatus": "disabled",
    "sessionRevoked": true,
    "cleanup": { "jobId": "cleanup_synthetic_1", "state": "pending" },
    "receipt": "<服务端签发的受限回执，仅用于进度查询>"
  }
}
```

- **停用与建任务必须是可恢复的持久化边界**：不能只有 `disabled` 却没有可恢复任务（Xiang Yu W1XY04 §3）。
- `account.close` 幂等：重复调用返回同一 `jobId`，不重复建任务。

## 4. `account.cleanupStatus`（receipt）

### 4.1 必须先统一的字段名冲突

`router.js` 读取的是 **`request.payload.receipt`**（硬编码）；而 Xiang Yu 的清理设计写的是 `receiptCredential`。两者必须统一，否则回执永远解析不到：

| 选项       | 做法                       | 影响                                                      |
| ---------- | -------------------------- | --------------------------------------------------------- |
| O1（推荐） | 统一用 `receipt`           | 只改文档与设计；router 无需改动                           |
| O2         | 统一用 `receiptCredential` | 需改 `router.js` + `validation.js` + 文档，走共享接口评审 |

在定案前，`account.cleanupStatus` **不能标为已接通**。

### 4.2 回执语义

```json
{
  "apiVersion": "1",
  "requestId": "req_cleanup_status_01",
  "action": "account.cleanupStatus",
  "payload": { "jobId": "cleanup_synthetic_1", "receipt": "<受限回执>" }
}
```

```json
{
  "apiVersion": "1",
  "requestId": "req_cleanup_status_01",
  "ok": true,
  "data": {
    "jobId": "cleanup_synthetic_1",
    "state": "processing",
    "progress": { "task_history": 50, "preferences": 0 },
    "createdAt": "2026-10-15T10:00:00Z",
    "updatedAt": "2026-10-15T10:00:30Z"
  }
}
```

**只读约束**：

- `jobId` **不是凭证**；`resolveCleanupReceipt` 必须验证服务端签发、且回执**只绑定本任务**（不能只凭 jobId 查任意任务）。
- 回执只给 `cleanup_status` 权限 → 不能导出、不能恢复、不能读正文或其他账号。
- 不接受 `retry` / `cancel` / `force` 之类写语义入参。
- 不返回 `error` 的技术细节。
- 进度数字是**已处理记录数**，不是百分比（Xiang Yu W1XY04 §6）。

### 4.3 显示依据（防虚报）

- 未拿到 `jobId` 前不显示任何「已注销完成」；
- `state !== completed` 时不显示「已全部删除」；
- 「账号已停用」与「数据已清理」是两件事，文案必须分开；
- 清理执行器未接通时按钮置灰标注「待接入」，不显示假进度。

## 5. 本地验证结果（实际输出，全部本地替身）

| 用例 | 场景                                       | 期望                                  | 实际             | 结果 |
| ---- | ------------------------------------------ | ------------------------------------- | ---------------- | ---- |
| B01  | 无回执查询进度                             | `FORBIDDEN`，且**不触发账号查询**     | 一致             | 通过 |
| B02  | 有效 `cleanup_status` 回执                 | 无需登录即通过门禁                    | 到达 domain stub | 通过 |
| B03  | 权限不符的回执（`export_download`）        | `FORBIDDEN`                           | 一致             | 通过 |
| B04  | ① 回执当登录用；② disabled 账号 + 有效回执 | `UNAUTHENTICATED`；`ACCOUNT_DISABLED` | 一致             | 通过 |

真实云回执签发与过期行为**未执行**（属生产实现与真云授权范围）。

## 6. 待确认项

1. `account.preferences` 取 P1 还是 P2（含 `validation.js` 校验补写）。
2. 偏好是否需要 `version` 字段做多设备防覆盖（数据库变更，Xiang Yu）。
3. 回执字段名统一为 `receipt` 还是 `receiptCredential`（Xiang Yu + Xiang Hong）。
4. 回执的**有效期与一次性**语义（过期后如何重新获取；目前只能靠重新走入口）。
5. `cleanup_jobs.state` 只有 `pending/processing/completed/failed`，「失败后可重试」在界面上如何表达。
