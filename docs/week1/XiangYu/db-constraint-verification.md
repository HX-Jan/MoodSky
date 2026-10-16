# W1XY02 数据库权限与唯一约束验证记录

- 验证人：Xiang Yu（学号 832401124）
- 验证时间：2026-10-15
- 环境：mood-sky
- 验证集合：h03_probe_journals
- 任务编号：W1XY02

本次整合保留原作者的手工实验陈述。该实验由 Xiang Yu 在探针集合和控制台路径执行，本轮没有重放，也没有据此补写旧 H03 批次的逐项报告。与正式接口及部署记录的对齐如下。

---

## 1. 客户端禁读禁写

| 项               | 结果                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| 权限设置         | 「所有用户不可读写」                                                                                 |
| 与团队策略一致性 | ✅ 符合 `database/client-access-policy.json` 中的 `defaultClientRule: { read: false, write: false }` |
| 结论             | 该集合的控制台规则为客户端禁读禁写；本条未逐项主动验证全部集合的读写拒绝                             |

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

**本次控制台实验在 h03_probe_journals 观察到同一 ownerId + date 的重复插入被索引拒绝。** 正式 journals 仍须通过自身索引、事务及版本条件实现约束；本实验不能代替正式函数路径的重复错误映射或并发验收。

正式 API 继续使用已注册的 CONFLICT，不新增 MOOD_ALREADY_EXISTS。控制台原始 E11000 与 wx-server-sdk 的包装错误不同；必须基于可信错误结构区分冲突，不能把所有包装错误都映射为 CONFLICT。

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
- 服务端需分别识别唯一冲突、版本冲突和其他数据库失败；实际 SDK 路径仍待验证
- journal.upsert 的冲突沿用 CONFLICT；不能静默转成覆盖写入
- 客户端保留草稿，重新读取当前记录后由用户决定编辑；不能将控制台手工插入当作服务端重试验收

### 5.2 对其他集合的建议

以下集合在 collections.json 中声明了 uniqueKeys；2026-10-13—14 的基础部署记录已核对相应 7 组唯一索引。本轮没有重复创建。下表保留字段建议，实际索引名称见部署记录：

| 集合                | 唯一字段组合                   | 建议索引名                  |
| ------------------- | ------------------------------ | --------------------------- |
| `accounts`          | `openid`                       | `uniq_openid`               |
| `preferences`       | `ownerId`                      | `uniq_ownerId`              |
| `month_decorations` | `ownerId + month`              | `uniq_ownerId_month`        |
| `favorites`         | `ownerId + placeId`            | `uniq_ownerId_placeId`      |
| `request_receipts`  | `ownerId + action + requestId` | `uniq_owner_action_request` |
| `operator_roles`    | `accountId`                    | `uniq_accountId`            |

### 5.3 索引字段名约定

索引字段名与 `collections.json` 中的 `uniqueKeys` 保持一致：

- 统一使用 `ownerId`（不用 `user_id`）
- 统一使用 `date`（不用 `local_date`）
- 统一使用 `openid`（云函数根据可信调用身份显式保存，不假设服务端自动插入）

---

## 6. 待确认项

- [x] 团队测试环境为 mood-sky，环境 ID 为 mood-sky-d5gqy3spkff37566d，见 H01 环境登记。
- [x] 既有部署记录已核对 journals 的 ownerId + date 唯一索引；数据设计由 Xiang Yu 负责，后续变更仍需审查。
- [x] 基础 7 组唯一索引已有部署证据；其他新索引仍是提案，未纳入本次部署。
- [x] 参考 [H03 实验记录](../xiang-hong/w1-h03-execution.md)和[结果留存验证](../xiang-hong/w1-h03-report-retention-validation.md)：旧批次报告缺失；新批次 12 项通过、5 项失败。不能从残留数据补造旧报告。
- [ ] 正式云函数的 SDK 错误映射及并发行为仍待验证；业务冲突码已统一为 CONFLICT。

---
