# W2 JF03 偏好正式处理器与跨账号隔离

| 项目     | 内容                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| 任务编号 | W2 JF03                                                                                                       |
| 承接 W1  | W1 JF03《偏好、停用与受限进度回执》（`docs/week1/Jiawei_Fang/w1-jf03-preference-close-receipt.md`）的偏好部分 |
| 关联需求 | UW3-F21 隐私和显示偏好                                                                                        |
| 负责人   | Jiawei Fang（832401110），本周身份 w2-account                                                                 |
| 协作人   | Linghan Chen（偏好字段与显示依据）、Xiang Hong（注册表与共享校验）、Xiang Yu（`preferences` 唯一键）          |
| 复核人   | Xiang Hong（待复核）；独立检查：Qizhen Cai                                                                    |
| 版本     | 0.2.0                                                                                                         |
| 环境     | 本地 Node.js v24.15.0；内存 store + 注入 clock；**真实云 / 数据库未执行**                                     |
| 成果路径 | 见 §2                                                                                                         |
| 验收状态 | **待复核**                                                                                                    |
| 实际耗时 | 待本人确认（不代填）                                                                                          |
| 阻塞     | `shared/validation.js` 补校验需接口评审；真实云读写未授权                                                     |

## 1. 结论先行

- `account.preferences` 按 W1 提案 **P1** 实现：单 action + `payload.operation = "get" | "set"`，不改注册表、不新增 action。
- get：无记录返回共享常量 `DEFAULT_PREFERENCES` + `updatedAt: null`；set：只接受 `cardTextPreview` / `decorationsEnabled` 两个布尔字段，保存后返回完整对象，再次 get 返回已存值与 `updatedAt`。
- 跨账号隔离：store 以 `actor.accountId` 为键，payload 不能指定账号；身份字段在 router 层 `INVALID_REQUEST`。
- 并发的部分 set 不再丢字段：store 改为字段级 `updatePreferences(ownerId, patch, updatedAt)`——**只写本次 patch 的字段**，首写才用 `DEFAULT_PREFERENCES` 合并；内存实现另加按 owner 的串行锁。响应回显实际落库的合并结果（P08）。
- 停用账号由 router 先拒绝 `ACCOUNT_DISABLED`，域模块不读偏好行。
- 新增 8 项测试，本地全过（`node --test tests/week2-account-preferences.test.js` → 8 pass）。真实云未执行，本条标**待复核**。
- 偏好是**纯展示开关**：域模块与门禁均不读取偏好做权限、可见性或清理判定（F21 口径）。

## 2. 成果路径（本条改动的文件）

| 文件                                                         | 变更 | 说明                                                 |
| ------------------------------------------------------------ | ---- | ---------------------------------------------------- |
| `cloudfunctions/moodsky/domains/account.js`                  | 修改 | `createAccountDomain` 内的 preferences 处理器与校验  |
| `cloudfunctions/moodsky/stores/account-store.js`             | 新增 | `preferences` 按 `ownerId` 读写（内存 + 云 DB 草案） |
| `tests/week2-account-preferences.test.js`                    | 新增 | P01—P07                                              |
| `docs/week2/Jiawei_Fang/w2-jf03-preference-close-receipt.md` | 新增 | 本文档                                               |

## 3. 接口口径

### 3.1 载荷白名单

| operation | 允许字段                             | 说明                         |
| --------- | ------------------------------------ | ---------------------------- |
| `get`     | `operation`                          | 携带写字段 → `INVALID_INPUT` |
| `set`     | `operation` + 两个布尔字段中至少一个 | 空 set → `INVALID_INPUT`     |

- 未约定字段（含 `theme`、`motionEnabled`、`version`）→ `INVALID_INPUT`；`ownerId / accountId` 等身份字段在 router 层已 → `INVALID_REQUEST`。
- 类型严格：必须 `typeof === "boolean"`；`"true"`、`0`、`null`、`[]` 全部拒绝。
- `operation` 缺失或不是 `get`/`set` → `INVALID_INPUT`。

### 3.2 结果形状

```json
{
  "operation": "get",
  "data": { "cardTextPreview": false, "decorationsEnabled": true, "updatedAt": null }
}
```

- 无记录：两个字段来自 `shared/constants.js` 的 `DEFAULT_PREFERENCES`（客户端不再各写一份），`updatedAt: null` 表示尚未落库。
- 有记录：返回已存值与 `updatedAt`（UTC ISO，来源为注入 clock）。
- set 只更新传入字段，未传字段保持“已存值优先，否则默认值”。
- set 的写入是**字段级**的：只把本次 patch 的字段写进 `preferences`，不重写未提供的字段，因此两个并发的部分 set 不会互相覆盖；响应由 store 返回的合并结果生成，不谎报未落库的值。跨实例的版本号/CAS 仍未实现（云实现只写 patch 字段，但没有分布式锁，见 §5）。

### 3.3 归属与隔离

- 键为 `actor.accountId`（router 从可信 OPENID 解析）；payload 不参与归属判定。
- 两个账号各自一行 `preferences`（`ownerId` 唯一）；A 的写入不影响 B 的读取。

### 3.4 校验为什么写在域模块

`shared/validation.js` 与 `miniprogram/shared/validation.js` 由结构检查逐字节比对，本周冻结。因此 preferences / close / cleanupStatus 的载荷校验写在 `domains/account.js` 内，并把“应补到 `shared/validation.js` 的内容”作为待确认项提交（§7 第 1 条），不私自改共享文件。

## 4. 测试清单与真实计数

```
node --test tests/week2-account-preferences.test.js
# tests 8 / pass 8 / fail 0
```

| 用例 | 场景             | 断言要点                                                                                                                                          |
| ---- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01  | 无记录 get       | 等于共享默认值 + `updatedAt: null`；不写库、无 put 调用                                                                                           |
| P02  | set 两字段后 get | 返回完整对象；再 get 一致；store 落 1 行                                                                                                          |
| P03  | 部分 set         | 未传字段保持默认；二次部分 set 合并正确                                                                                                           |
| P04  | 10 组非法载荷    | 全部 `INVALID_INPUT`，且未写入任何偏好行                                                                                                          |
| P05  | 跨账号隔离       | B 读默认值；store 行 `ownerId` 等于服务端账号 id；payload 带账号 → `INVALID_REQUEST`                                                              |
| P06  | 停用账号         | `ACCOUNT_DISABLED`；未读偏好行                                                                                                                    |
| P07  | 注入 clock       | `updatedAt` 跟随注入时间，不取真实时钟                                                                                                            |
| P08  | 并发两个部分 set | `Promise.all` 后两字段都保留（库里 cardTextPreview=true、decorationsEnabled=false）；每个响应所写字段等于库内值，两响应按所写字段合并后等于库内行 |

## 5. 已实现 / 未实现

已实现：

- `account.preferences` 的 get / set、默认值来源、字段白名单与类型校验、跨账号隔离、停用门禁。
- store 的 `preferences` 内存与云 DB 两套读写（云实现未对真云验证）。
- 偏好不参与权限判定的实现口径（域内无任何读取偏好做门禁的分支）。

未实现 / 未执行：

- `shared/validation.js` 的正式校验器（冻结，待接口评审）。
- 真实云 `preferences` 读写与 `ownerId` 唯一键验证。
- 跨实例的并发写保护：数据字典没有 `version` 字段，云实现没有分布式锁/CAS；本条的防线是"只写 patch 字段 +（内存）按 owner 串行锁"，可避免互相覆盖，但不能提供多写方冲突检测。
- 前端回显与显示开关（Linghan Chen 范围）。

## 6. 与 W1 提案的偏差

1. W1 §6 待确认 1（P1 还是 P2）已按 **P1** 落地；仍需 Xiang Hong 复核后才算定案，本条不代替裁决。
2. get 携带写字段被**严格拒绝**（W1 未规定）。这是防止“静默忽略写入”的选择，若前端需要宽松语义需另行确认。
3. 校验位置从“计划补 `shared/validation.js`”改为“先写在域模块”，原因是共享文件本周冻结（§3.4）。
4. 未引入 `version` 字段，与 W1 “数据字典没有 version”的结论一致；因此未实现 CAS。

## 7. 待确认项

1. **应补到 `shared/validation.js`**（Xiang Hong 协调，接口 PR）：
   - `account.preferences`：`operation ∈ {get,set}`；`cardTextPreview`/`decorationsEnabled` 为布尔；`set` 至少一个字段；未约定字段拒绝。
   - `account.close`：仅 `confirm`，值必须为 `CLOSE`。
   - `account.cleanupStatus`：`jobId` 为非空字符串、`receipt` 为非空字符串、未约定字段拒绝。
2. get 是否应允许携带写字段（当前严格拒绝）。
3. 多设备防覆盖策略（`version` / CAS / 写前读校验）：已改为字段级写入（丢失更新窗口关闭，P08），但字段级写入不等于冲突检测；是否需要 `version` 由 Xiang Yu 主责。
4. `preferences.updatedAt` 在真云的字段类型（ISO 字符串 vs Date）与数据字典核对。
5. 前端“显示效果关闭”不影响记录、导出、删除的验收证据（Linghan Chen 与 Qizhen Cai 执行）。

## 8. 阻塞

- 真实云偏好读写：**阻塞**，缺测试环境写入授权。
- 共享校验器补写：**阻塞**，需接口评审后才能落 `shared/validation.js`。
