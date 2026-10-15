# W1XY02 数据库权限与唯一约束验证记录

- 验证人：Xiang Yu（学号 832401124）
- 验证时间：2026-10-15
- 环境：mood-sky
- 验证集合：h03_probe_journals
- 任务编号：W1XY02

---

## 1. 客户端禁读禁写

| 项               | 结果                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| 权限设置         | 「所有用户不可读写」                                                                                 |
| 与团队策略一致性 | ✅ 符合 `database/client-access-policy.json` 中的 `defaultClientRule: { read: false, write: false }` |
| 结论             | 客户端无法直接读写任何集合，所有访问必须走云函数                                                     |

**证据来源**：云开发控制台 → 数据库 → h03_probe_journals → 数据权限标签页

---

## 2. 复合唯一索引能力

| 项       | 值                                   |
| -------- | ------------------------------------ |
| 索引名称 | `uniq_ownerId_date`                  |
| 索引属性 | 唯一（Unique）                       |
| 索引字段 | `ownerId` 升序 + `date` 升序         |
| 命中次数 | 4                                    |
| 结论     | CloudBase 文档数据库支持复合唯一索引 |

**证据来源**：云开发控制台 → 数据库 → h03_probe_journals → 索引管理标签页

---

## 3. 唯一约束生效验证（亲自实验）

### 实验步骤

1. 写入记录 A：

```json
{
  "ownerId": "test_xiangyu_001",
  "date": "2026-10-15",
  "weather": "SUNNY"
}
```

结果：**成功**

2. 尝试写入记录 B（相同 ownerId + date）：

```json
{
  "ownerId": "test_xiangyu_001",
  "date": "2026-10-15",
  "weather": "CLOUDY"
}
```

结果：**失败**

### 报错信息

```
数据加载失败
加载 "tcbPutItem" 失败: Error: [tcb/PutItem]
[FailedOperation.Insert] multiple write errors:
[{write errors: [{E11000 duplicate key error collection: ...}]}]
```

### 报错码

`E11000 duplicate key error`

### 结论

**`journals` 的「同日唯一」由数据库层保证，不需要应用层先查后写。**

云函数捕获 `E11000` 后转为业务错误码（如 `MOOD_ALREADY_EXISTS`）即可。

---

## 4. Xiang Hong 的探针实验（参考）

| 项         | 值                                     |
| ---------- | -------------------------------------- |
| 探针集合   | `h03_probe_journals`                   |
| 探针标签   | `probeTag: "moodsky-h03-v1"`           |
| 运行记录 1 | `runId: "h03_20261014_validation_001"` |
| 运行记录 2 | `runId: "h03_20261015_validation_001"` |

### 从记录中观察到的实验内容

- `caseId: "commit"`：正常提交场景
- `caseId: "boundary"`：边界日期（如 `2026-09-15`，可能对应补记 30 天窗口边界）
- `ownerId` 使用合成账号格式：`synthetic_xxxxxxxx`
- `state: "active"`：记录状态字段
- `version: 1`：乐观锁版本字段

正式结论待 Xiang Hong 提供。

---

## 5. 对数据字典和接口设计的影响

### 5.1 对 `journals` 集合的影响

- `ownerId + date` 唯一性由索引保证
- 接口层可信任数据库返回的 `E11000`
- 建议 `journal.upsert` 接口捕获 `E11000`，转为业务错误码 `MOOD_ALREADY_EXISTS`
- 客户端收到该错误码时，应提示"今天已有记录，是否编辑？"

### 5.2 对其他集合的建议

以下集合在 `collections.json` 中声明了 `uniquekeys`，建议同样建立复合唯一索引：

| 集合                | 唯一字段组合                   | 建议索引名                  |
| ------------------- | ------------------------------ | --------------------------- |
| `accounts`          | `_openid`                      | `uniq_openid`               |
| `preferences`       | `ownerId`                      | `uniq_ownerId`              |
| `month_decorations` | `ownerId + month`              | `uniq_ownerId_month`        |
| `favorites`         | `ownerId + placeId`            | `uniq_ownerId_placeId`      |
| `request_receipts`  | `ownerId + action + requestId` | `uniq_owner_action_request` |
| `operator_roles`    | `accountId`                    | `uniq_accountId`            |

### 5.3 索引字段名约定

索引字段名与 `collections.json` 中的 `uniquekeys` 保持一致：

- 统一使用 `ownerId`（不用 `user_id`）
- 统一使用 `date`（不用 `local_date`）
- 统一使用 `_openid`（系统字段，不用手动创建）

---

## 6. 待确认项

- [ ] `mood-sky` 是否为团队共用环境？环境 ID 是什么？
- [ ] 正式集合 `journals` 是否要建 `uniq_ownerId_date` 索引？由谁负责？
- [ ] 其他集合的唯一索引是否也要建？建索引的时间节点是什么？
- [ ] Xiang Hong 的 `h03_probe_journals` 实验结论是否可复用？正式报告在哪？
- [ ] `E11000` 错误码在云函数中的统一处理方式是否要与 Xiang Hong 对齐？

---
