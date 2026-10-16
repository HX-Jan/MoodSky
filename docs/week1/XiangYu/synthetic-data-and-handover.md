# W1XY05 合成样本与交接表

- 编写人：Xiang Yu（学号 832401124）
- 编写时间：2026-10-15
- 任务编号：W1XY05
- 版本：v0.2（本次集成修订；仍待原复核人验收）
- 依据：`database/collections.json` + 第一周任务计划

---

整合说明：表格均为虚构的设计样本，未导入云端，也不是接口能力通过证据。本轮未授权写入或清理。字段及能力状态按当前共享代码和设计基线修订。

## 1. 目标

准备可复用的合成数据，供 Yuen（测试）和 Qizhen Cai（生命周期验证）在后续测试中使用。汇总各业务模块的本人查询、导出及清理能力缺口。

**原则：**

- 真实学生身份与日记**不进入**公共样本
- 平台身份映射由受信环境建立
- 合成数据的 ID、日期、内容都是虚构的

---

## 2. 合成账号

| 账号   | internalId                       | status   | 用途                               |
| ------ | -------------------------------- | -------- | ---------------------------------- |
| 账号 A | `synthetic_aa3912f51ead79a56de1` | active   | 主测试账号                         |
| 账号 B | `synthetic_8b9e2f4cc98d72e57863` | active   | 隔离测试（验证 A 不能读 B 的数据） |
| 账号 C | `synthetic_cc4d7e8f9a0b1c2d3e4f` | disabled | 验证停用账号行为                   |

**说明：**

- `internalId` 是内部账号 ID，不对客户端公开
- 真实微信 `openid` 由受信环境在测试时建立映射，不写入文档

---

## 3. 合成天气记录（journals）

| ownerId | date       | weather       | tags                   | text             | version |
| ------- | ---------- | ------------- | ---------------------- | ---------------- | ------- |
| 账号 A  | 2026-10-01 | SUNNY         | ["STUDY"]              | "今天想慢一点。" | 1       |
| 账号 A  | 2026-10-02 | CLOUDY        | []                     | ""               | 1       |
| 账号 A  | 2026-10-03 | RAINY         | ["TIREDNESS"]          | "下雨了。"       | 1       |
| 账号 A  | 2026-09-15 | PARTLY_CLOUDY | []                     | ""               | 1       |
| 账号 A  | 2026-09-16 | STORMY        | ["STUDY", "TIREDNESS"] | "有点难熬。"     | 1       |
| 账号 B  | 2026-10-01 | SUNNY         | []                     | ""               | 1       |
| 账号 B  | 2026-10-02 | SUNNY         | []                     | ""               | 1       |

**覆盖场景：**

- 跨月记录（9月、10月）
- 有标签/无标签
- 有正文/无正文
- 五种天气类型全覆盖
- 以合成今天 2026-10-15 计算：2026-09-16 为可新建的第 29 天，2026-09-15 已超出窗口；已有旧记录仍可编辑。H03 旧夹具固定今天为 2026-10-14，两套时间不能混用

---

## 4. 合成偏好（preferences）

| ownerId | cardTextPreview | decorationsEnabled |
| ------- | --------------- | ------------------ |
| 账号 A  | true            | false              |
| 账号 B  | false           | true               |

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
- 账号 C 是停用样例；moderator 尚未成为当前运营入口认可的角色，现入口只认服务端解析的 data_operator

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

未来如需导入，应先提交固定环境、集合、批次、操作者和记录数量的审查清单；仅在获得批准后使用受限工具执行。本文不要求新增临时写入入口，也不授权操作既有 H03 批次。

### 11.2 使用限制

- **合成数据只用于测试环境**，不进入生产
- **不使用真实学生的 `openid`**（由受信环境建立映射）
- **不包含真实日记内容**
- 测试结束后保留记录，清理必须单独批准固定清单；既有 H03 两批次不自动清理

---

## 12. 各模块数据能力交接表

下表仅是预期接口职责：当前真实账号映射及这些领域业务仍为 NOT_IMPLEMENTED，不能把 where/doc 语法样例当作已提供的本人查询、导出或幂等清理能力。请求回执和角色属于内部元数据，不默认进入用户导出；最终导出字段另行审查。

| 模块     | 集合              | 本人查询                            | 导出字段                                      | 清理方式                         | 能力缺口       | 负责人       |
| -------- | ----------------- | ----------------------------------- | --------------------------------------------- | -------------------------------- | -------------- | ------------ |
| 记录     | journals          | 拟用（待实现） `where({ownerId})`   | date, weather, tags, text, version, createdAt | `where({ownerId}).remove()` 分页 | 待实现、待验收 | Xiang Hong   |
| 收藏     | favorites         | 拟用（待实现） `where({ownerId})`   | placeId, createdAt                            | `where({ownerId}).remove()`      | 待实现、待验收 | Junhan Huang |
| 任务历史 | task_history      | 拟用（待实现） `where({ownerId})`   | taskId, date, state, createdAt                | `where({ownerId}).remove()`      | 待实现、待验收 | Jiawei Fang  |
| 偏好     | preferences       | 拟用（待实现） `where({ownerId})`   | cardTextPreview, decorationsEnabled           | `where({ownerId}).remove()`      | 待实现、待验收 | Jiawei Fang  |
| 月份装饰 | month_decorations | 拟用（待实现） `where({ownerId})`   | month, stickerId, backgroundId                | `where({ownerId}).remove()`      | 待实现、待验收 | Xiang Hong   |
| 导出任务 | export_jobs       | 拟用（待实现） `where({ownerId})`   | jobId, format, state, fileId                  | 删除文件+记录                    | 待实现、待验收 | Xiang Yu     |
| 请求回执 | request_receipts  | 拟用（待实现） `where({ownerId})`   | action, requestId, result                     | `where({ownerId}).remove()`      | 待实现、待验收 | Xiang Hong   |
| 账号     | accounts          | 拟用（待实现） `doc(id)`            | status, campusId, createdAt                   | 保留为 disabled                  | 待实现、待验收 | Jiawei Fang  |
| 运营角色 | operator_roles    | 拟用（待实现） `where({accountId})` | role, enabled                                 | 撤销角色（非删除）               | 待实现、待验收 | Junhan Huang |

**保留数据（不清理）：**

- `places`、`task_templates`、`support_resources`：公共数据

---

## 13. 账号校验能力说明

validateAccount 仅表示待 Jiawei Fang 确认的服务端内部适配职责，不是已注册的公开 action，也尚未实现。客户端不能提交 internalId、openid、ownerId 或角色来选择本人。

预期流程是 SDK 可信上下文 → 服务端身份映射 → active/disabled 内部账号。服务端已解析的内部 ID 才可在受限模块之间传递；对客户端的结果不包含身份映射。账号停用必须阻止导出及普通私人访问，清理进度只能使用专门受限回执。

上述合成账号只供后续本地夹具和获批隔离测试使用，不构成登录或授权凭证。

## 14. 待确认项

- [ ] **合成数据的 internalId 命名规则**：是否需要统一前缀？
- [ ] **合成数据导入方式**：控制台手动 or 云函数？
- [x] 保留现有数据；清理必须单独提交固定范围并获得批准，不能依据本文自动执行
- [ ] **validateAccount 接口是否由 Jiawei 确认**？
- [ ] **运营角色的撤销逻辑**：从 operator_roles 删除记录还是置 enabled=false？

---

## 15. 交接

本文档需发给：

- **Yuen Lin**：测试用例中使用合成数据
- **Qizhen Cai**：生命周期验证使用合成数据
- **Jiawei Fang**：确认 validateAccount 接口
- **Xiang Hong**：确认合成数据的 internalId 命名
