# W1XY01 数据字典（15 集合字段初稿）

- 编写人：Xiang Yu（学号 832401124）
- 编写时间：2026-10-15
- 版本：v0.1（初稿，待三个业务后端复核）
- 依据：`database/collections.json` + 需求规格 F01–F24

## 0. 全局约定

| 项 | 约定 |
|---|---|
| 主键 | `_id`（系统自动生成） |
| 归属字段 | `ownerId`（内部账号 ID，不对客户端公开） |
| 日期字段 | `date`（YYYY-MM-DD 字符串，业务日期） |
| 时间戳 | `createdAt` / `updatedAt`（UTC，`db.serverDate()`） |
| 乐观锁 | `version`（Number，新建为 0 或 1） |
| 状态字段 | `state`（String，枚举按各集合定义） |
| 权限 | 所有集合「所有用户不可读写」，仅云函数访问 |
| 加密 | 敏感字段（正文、身份映射）应用层加密，密钥独立管理 |

---

## 1. accounts（账号）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| _openid | String | 是 | 系统 | 微信身份，系统自动插入 |
| state | String | 是 | 系统 | active / disabled |
| campusId | String | 是 | 用户 | 所属校区 |
| createdAt | Date | 是 | 系统 | 创建时间 |
| updatedAt | Date | 是 | 系统 | 更新时间 |

**索引**：`uniq_openid`（唯一，`_openid`）
**业务负责人**：Xiang Yu / Jiawei Fang

---

## 2. journals（天气记录）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| ownerId | String | 是 | 用户 | 内部账号 ID |
| date | String | 是 | 用户 | YYYY-MM-DD |
| weather | String | 是 | 用户 | SUNNY / PARTLY_CLOUDY / CLOUDY / RAINY / STORMY |
| tags | Array | 否 | 用户 | 最多 5 个 |
| text | String | 否 | 用户 | 最多 1000 码点，加密存储 |
| version | Number | 是 | 系统 | 乐观锁 |
| state | String | 是 | 系统 | active / deleted |
| createdAt | Date | 是 | 系统 | - |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`uniq_ownerId_date`（唯一，`ownerId` + `date`）
**业务负责人**：Xiang Yu / Xiang Hong

---

## 3. preferences（偏好）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| ownerId | String | 是 | 用户 | 内部账号 ID |
| cardPreview | Boolean | 否 | 用户 | 卡片是否预览正文 |
| decorationEnabled | Boolean | 否 | 用户 | 装饰是否启用 |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`uniq_ownerId`（唯一，`ownerId`）
**业务负责人**：Xiang Yu / Jiawei Fang

---

## 4. month_decorations（月份装饰）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| ownerId | String | 是 | 用户 | 内部账号 ID |
| month | String | 是 | 用户 | YYYY-MM |
| stickerId | String | 否 | 用户 | 贴纸 ID |
| backgroundId | String | 否 | 用户 | 背景 ID |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`uniq_ownerId_month`（唯一，`ownerId` + `month`）
**业务负责人**：Xiang Yu / Xiang Hong

---

## 5. places（校园地点）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| campusId | String | 是 | 运营 | 校区 |
| name | String | 是 | 运营 | 地点名 |
| address | String | 是 | 运营 | 地址 |
| lat | Number | 是 | 运营 | 纬度 |
| lng | Number | 是 | 运营 | 经度 |
| tags | Array | 否 | 运营 | 安静 / 室内 / 绿植 等 |
| hours | Object | 否 | 运营 | 开放时间 |
| accessibility | String | 否 | 运营 | 无障碍说明 |
| state | String | 是 | 运营 | active / closed / pending |
| verifiedAt | Date | 否 | 运营 | 核验日期 |
| verifiedBy | String | 否 | 运营 | 核验人 |
| source | String | 否 | 运营 | 资料来源 |
| createdAt | Date | 是 | 系统 | - |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`campusId + state`（非唯一，加速筛选）
**业务负责人**：Xiang Yu / Junhan Huang

---

## 6. favorites（收藏）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| ownerId | String | 是 | 用户 | 内部账号 ID |
| placeId | String | 是 | 用户 | 地点 ID |
| createdAt | Date | 是 | 系统 | - |

**索引**：`uniq_ownerId_placeId`（唯一，`ownerId` + `placeId`）
**业务负责人**：Xiang Yu / Junhan Huang

---

## 7. place_corrections（地点纠错）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| ownerId | String | 是 | 用户 | 提交人内部账号 ID |
| placeId | String | 是 | 用户 | 地点 ID |
| content | String | 是 | 用户 | 1–200 码点 |
| state | String | 是 | 系统 | pending / approved / rejected |
| reviewerId | String | 否 | 运营 | 审核人 |
| createdAt | Date | 是 | 系统 | - |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`state + createdAt`（非唯一，待审队列）
**业务负责人**：Xiang Yu / Junhan Huang

---

## 8. support_resources（支持资源）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| campusId | String | 是 | 运营 | 校区 |
| type | String | 是 | 运营 | consult / emergency |
| name | String | 是 | 运营 | 名称 |
| contact | String | 是 | 运营 | 联系方式 |
| hours | String | 否 | 运营 | 服务时间 |
| verifiedAt | Date | 否 | 运营 | 核验日期 |
| verifiedBy | String | 否 | 运营 | 核验人 |
| state | String | 是 | 运营 | active / expired / pending |
| createdAt | Date | 是 | 系统 | - |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`campusId + state`
**业务负责人**：Xiang Yu / Junhan Huang

---

## 9. task_templates（任务模板）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| title | String | 是 | 运营 | 任务标题 |
| steps | Array | 是 | 运营 | 步骤 |
| durationMin | Number | 否 | 运营 | 预计时长 |
| tags | Array | 否 | 运营 | indoor / outdoor |
| enabled | Boolean | 是 | 运营 | 是否启用 |
| createdAt | Date | 是 | 系统 | - |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`enabled`（非唯一）
**业务负责人**：Xiang Yu / Junhan Huang

---

## 10. task_history（任务历史）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| ownerId | String | 是 | 用户 | 内部账号 ID |
| taskId | String | 是 | 用户 | 任务模板 ID |
| date | String | 是 | 用户 | YYYY-MM-DD |
| state | String | 是 | 系统 | completed / skipped |
| createdAt | Date | 是 | 系统 | - |

**索引**：`ownerId + date`（非唯一，个人历史查询）
**业务负责人**：Xiang Yu / Jiawei Fang

---

## 11. export_jobs（导出任务）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键，即 jobId |
| ownerId | String | 是 | 用户 | 内部账号 ID |
| format | String | 是 | 用户 | json / markdown |
| state | String | 是 | 系统 | pending / processing / ready / expired / failed |
| fileId | String | 否 | 系统 | 云存储文件 ID |
| expiresAt | Date | 否 | 系统 | 文件到期时间 |
| createdAt | Date | 是 | 系统 | - |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`ownerId + createdAt`（非唯一，个人任务查询）
**业务负责人**：Xiang Yu / Jiawei Fang

---

## 12. cleanup_jobs（清理任务）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| ownerId | String | 是 | 用户 | 内部账号 ID |
| state | String | 是 | 系统 | pending / processing / completed / failed |
| progress | Object | 否 | 系统 | 各模块进度 |
| error | String | 否 | 系统 | 失败原因 |
| createdAt | Date | 是 | 系统 | - |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`ownerId + state`
**业务负责人**：Xiang Yu / Jiawei Fang

---

## 13. request_receipts（请求回执）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| ownerId | String | 是 | 用户 | 内部账号 ID |
| action | String | 是 | 系统 | 操作类型 |
| requestId | String | 是 | 客户端 | 幂等键 |
| result | Object | 否 | 系统 | 结果摘要 |
| createdAt | Date | 是 | 系统 | - |

**索引**：`uniq_owner_action_request`（唯一，`ownerId` + `action` + `requestId`）
**业务负责人**：Xiang Yu / Xiang Hong

---

## 14. deletion_markers（删除标记）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| collection | String | 是 | 系统 | 被删集合名 |
| docId | String | 是 | 系统 | 被删文档 ID |
| deletedAt | Date | 是 | 系统 | 删除时间 |

**索引**：`uniq_collection_doc`（唯一，`collection` + `docId`）
**业务负责人**：Xiang Yu / Jiawei Fang

---

## 15. operator_roles（运营角色）

| 字段 | 类型 | 必填 | 归属 | 说明 |
|---|---|---|---|---|
| _id | String | 是 | 系统 | 主键 |
| accountId | String | 是 | 运营 | 内部账号 ID |
| role | String | 是 | 运营 | data_operator / moderator |
| enabled | Boolean | 是 | 运营 | 是否启用 |
| createdAt | Date | 是 | 系统 | - |
| updatedAt | Date | 是 | 系统 | - |

**索引**：`uniq_accountId`（唯一，`accountId`）
**业务负责人**：Xiang Yu / Junhan Huang

---

## 16. 索引汇总

| 集合 | 索引名 | 属性 | 字段 |
|---|---|---|---|
| accounts | uniq_openid | 唯一 | _openid |
| journals | uniq_ownerId_date | 唯一 | ownerId + date |
| preferences | uniq_ownerId | 唯一 | ownerId |
| month_decorations | uniq_ownerId_month | 唯一 | ownerId + month |
| places | idx_campus_state | 非唯一 | campusId + state |
| favorites | uniq_ownerId_placeId | 唯一 | ownerId + placeId |
| place_corrections | idx_state_created | 非唯一 | state + createdAt |
| support_resources | idx_campus_state | 非唯一 | campusId + state |
| task_templates | idx_enabled | 非唯一 | enabled |
| task_history | idx_owner_date | 非唯一 | ownerId + date |
| export_jobs | idx_owner_created | 非唯一 | ownerId + createdAt |
| cleanup_jobs | idx_owner_state | 非唯一 | ownerId + state |
| request_receipts | uniq_owner_action_request | 唯一 | ownerId + action + requestId |
| deletion_markers | uniq_collection_doc | 唯一 | collection + docId |
| operator_roles | uniq_accountId | 唯一 | accountId |

---

## 17. 待确认项

- [ ] 字段命名是否与 Xiang Hong 的接口文档一致？（`ownerId` vs `userId`）
- [ ] `journals.text` 和 `accounts._openid` 的加密方式由谁负责实现？
- [ ] 正式集合的索引由谁在控制台创建？时间节点？
- [ ] `state` 字段的枚举值是否需要统一（如 `active` / `deleted`）？
- [ ] 是否需要为 `journals` 增加 `campusId` 用于将来多校扩展？

---

## 18. 交接

本文档需发给以下人员复核：

- **Xiang Hong**（记录与回顾后端）：journals、month_decorations、request_receipts
- **Junhan Huang**（校园与后台业务）：places、favorites、place_corrections、support_resources、task_templates、operator_roles
- **Jiawei Fang**（任务、偏好、账号）：accounts、preferences、task_history、export_jobs、cleanup_jobs、deletion_markers