# W1XY05 合成样本与交接表

- 编写人：Xiang Yu（学号 832401124）
- 编写时间：2026-10-15
- 任务编号：W1XY05
- 版本：v0.1（初稿，Yuen、Qizhen Cai 可复用）
- 依据：`database/collections.json` + 第一周任务计划

---

## 1. 目标

准备可复用的合成数据，供 Yuen（测试）和 Qizhen Cai（生命周期验证）在后续测试中使用。汇总各业务模块的本人查询、导出及清理能力缺口。

**原则：**

- 真实学生身份与日记**不进入**公共样本
- 平台身份映射由受信环境建立
- 合成数据的 ID、日期、内容都是虚构的

---

## 2. 合成账号

| 账号   | internalId                       | state    | 用途                               |
| ------ | -------------------------------- | -------- | ---------------------------------- |
| 账号 A | `synthetic_aa3912f51ead79a56de1` | active   | 主测试账号                         |
| 账号 B | `synthetic_8b9e2f4cc98d72e57863` | active   | 隔离测试（验证 A 不能读 B 的数据） |
| 账号 C | `synthetic_cc4d7e8f9a0b1c2d3e4f` | disabled | 验证停用账号行为                   |

**说明：**

- `internalId` 是内部账号 ID，不对客户端公开
- 真实微信 `_openid` 由受信环境在测试时建立映射，不写入文档

---

## 3. 合成天气记录（journals）

| ownerId | date       | weather       | tags             | text             | version |
| ------- | ---------- | ------------- | ---------------- | ---------------- | ------- |
| 账号 A  | 2026-10-01 | SUNNY         | ["课业"]         | "今天想慢一点。" | 1       |
| 账号 A  | 2026-10-02 | CLOUDY        | []               | ""               | 1       |
| 账号 A  | 2026-10-03 | RAINY         | ["疲惫"]         | "下雨了。"       | 1       |
| 账号 A  | 2026-09-15 | PARTLY_CLOUDY | []               | ""               | 1       |
| 账号 A  | 2026-09-16 | STORMY        | ["课业", "疲惫"] | "有点难熬。"     | 1       |
| 账号 B  | 2026-10-01 | SUNNY         | []               | ""               | 1       |
| 账号 B  | 2026-10-02 | SUNNY         | []               | ""               | 1       |

**覆盖场景：**

- 跨月记录（9月、10月）
- 有标签/无标签
- 有正文/无正文
- 五种天气类型全覆盖
- 边界日期（2026-09-15 是 30 天补记窗口边界）

---

## 4. 合成偏好（preferences）

| ownerId | cardPreview | decorationEnabled |
| ------- | ----------- | ----------------- |
| 账号 A  | true        | false             |
| 账号 B  | false       | true              |

---

## 5. 合成月份装饰（month_decorations）

| ownerId | month   | stickerId     | backgroundId |
| ------- | ------- | ------------- | ------------ |
| 账号 A  | 2026-10 | sticker_sun   | bg_cream     |
| 账号 B  | 2026-10 | sticker_cloud | bg_blue      |

---

## 6. 合成收藏（favorites）

| ownerId | placeId        | placeName    |
| ------- | -------------- | ------------ |
| 账号 A  | place_demo_001 | 图书馆阅读角 |
| 账号 A  | place_demo_002 | 小花园       |
| 账号 B  | place_demo_001 | 图书馆阅读角 |

**覆盖场景：**

- 账号 A 收藏 2 个地点
- 账号 B 收藏 1 个地点
- 有一个共同收藏（验证隔离）

---

## 7. 合成任务历史（task_history）

| ownerId | taskId        | date       | state     |
| ------- | ------------- | ---------- | --------- |
| 账号 A  | task_demo_001 | 2026-10-04 | completed |
| 账号 A  | task_demo_002 | 2026-10-05 | skipped   |
| 账号 B  | task_demo_001 | 2026-10-04 | completed |

---

## 8. 合成运营角色（operator_roles）

| accountId | role          | enabled |
| --------- | ------------- | ------- |
| 账号 A    | data_operator | true    |
| 账号 C    | moderator     | false   |

**说明：**

- 账号 A 是运营员（用于测试运营权限）
- 账号 C 是停用的运营员（用于测试停用后权限失效）

---

## 9. 合成导出任务（export_jobs）

| ownerId | format   | state      | fileId        | expiresAt            |
| ------- | -------- | ---------- | ------------- | -------------------- |
| 账号 A  | json     | ready      | file_demo_001 | 2026-10-16T10:00:00Z |
| 账号 A  | markdown | pending    | null          | null                 |
| 账号 A  | json     | expired    | file_demo_002 | 2026-10-14T10:00:00Z |
| 账号 B  | json     | processing | null          | null                 |

**覆盖场景：**

- ready / pending / expired / processing 四种状态

---

## 10. 合成清理任务（cleanup_jobs）

| ownerId | state      | progress                             |
| ------- | ---------- | ------------------------------------ |
| 账号 C  | completed  | {journals: 100, favorites: 100, ...} |
| 账号 B  | processing | {journals: 100, favorites: 50, ...}  |
| 账号 A  | pending    | {}                                   |

---

## 11. 测试数据使用说明

### 11.1 如何导入

**方法 A：云开发控制台手动导入**

1. 打开云开发控制台 → 数据库
2. 选择对应集合
3. 点「导入」
4. 上传 JSON 文件

**方法 B：云函数批量写入**

写一个临时云函数，循环写入上述数据。

### 11.2 使用限制

- **合成数据只用于测试环境**，不进入生产
- **不使用真实学生的 `_openid`**（由受信环境建立映射）
- **不包含真实日记内容**
- 测试完成后可清空合成数据

---

## 12. 各模块数据能力交接表

| 模块     | 集合              | 本人查询                | 导出字段                                      | 清理方式                         | 能力缺口 | 负责人       |
| -------- | ----------------- | ----------------------- | --------------------------------------------- | -------------------------------- | -------- | ------------ |
| 记录     | journals          | ✅ `where({ownerId})`   | date, weather, tags, text, version, createdAt | `where({ownerId}).remove()` 分页 | 无       | Xiang Hong   |
| 收藏     | favorites         | ✅ `where({ownerId})`   | placeId, createdAt                            | `where({ownerId}).remove()`      | 无       | Junhan Huang |
| 任务历史 | task_history      | ✅ `where({ownerId})`   | taskId, date, state, createdAt                | `where({ownerId}).remove()`      | 无       | Jiawei Fang  |
| 偏好     | preferences       | ✅ `where({ownerId})`   | cardPreview, decorationEnabled                | `where({ownerId}).remove()`      | 无       | Jiawei Fang  |
| 月份装饰 | month_decorations | ✅ `where({ownerId})`   | month, stickerId, backgroundId                | `where({ownerId}).remove()`      | 无       | Xiang Hong   |
| 导出任务 | export_jobs       | ✅ `where({ownerId})`   | jobId, format, state, fileId                  | 删除文件+记录                    | 无       | Xiang Yu     |
| 请求回执 | request_receipts  | ✅ `where({ownerId})`   | action, requestId, result                     | `where({ownerId}).remove()`      | 无       | Xiang Hong   |
| 账号     | accounts          | ✅ `doc(id)`            | state, campusId, createdAt                    | 保留为 disabled                  | 无       | Jiawei Fang  |
| 运营角色 | operator_roles    | ✅ `where({accountId})` | role, enabled                                 | 撤销角色（非删除）               | 无       | Junhan Huang |

**保留数据（不清理）：**

- `places`、`task_templates`、`support_resources`：公共数据

---

## 13. 账号校验能力说明

**供导出使用的共用账号校验能力（由 Jiawei Fang 提供）：**

### 接口：`validateAccount`

**输入：**

```json
{
  "internalId": "synthetic_aa3912f51ead79a56de1"
}
```

**输出：**

```json
{
  "valid": true,
  "state": "active",
  "campusId": "campus_demo"
}
```

**用途：**

- 导出前校验账号是否可导出
- 账号 `disabled` 时，导出任务标记为 `expired`
- 账号不存在时，返回 `valid: false`

---

## 14. 待确认项

- [ ] **合成数据的 internalId 命名规则**：是否需要统一前缀？
- [ ] **合成数据导入方式**：控制台手动 or 云函数？
- [ ] **测试完成后是否清理合成数据**？
- [ ] **validateAccount 接口是否由 Jiawei 确认**？
- [ ] **运营角色的撤销逻辑**：从 operator_roles 删除记录还是置 enabled=false？

---

## 15. 交接

本文档需发给：

- **Yuen Lin**：测试用例中使用合成数据
- **Qizhen Cai**：生命周期验证使用合成数据
- **Jiawei Fang**：确认 validateAccount 接口
- **Xiang Hong**：确认合成数据的 internalId 命名
