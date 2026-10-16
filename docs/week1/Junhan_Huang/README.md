# MoodSky 第一周成果记录 —— Junhan Huang

|          |                                                |
| -------- | ---------------------------------------------- |
| 姓名     | Junhan Huang                                   |
| 岗位     | 校园与资料后台业务后端；运营角色查询与业务授权 |
| 周次     | 第一周                                         |
| 学习重点 | 数据库筛选与分页、资料有效期、服务端角色授权   |
| 工具     | VS Code、云开发控制台、微信开发者工具、GitHub  |

> 本目录内容均以仓库 `main` 分支实际文件为依据（action 名、错误码、集合名、唯一键、路径）。
> 凡未实际执行的验证，状态保留为**待开始/进行中**，不填虚构成功。

## 状态总览

|  编号   | 任务                   | 交付物                                                                                                      |  状态  | 阻塞点                                 |
| :-----: | ---------------------- | ----------------------------------------------------------------------------------------------------------- | :----: | -------------------------------------- |
| W1 JH01 | 确认校园接口与筛选字段 | [w1-jh01.md](#w1-jh01--确认校园接口与筛选字段) + `w1-jh01-campus-api-samples.json`                          | 待复核 | 需 Qinghan 确认字段够用                |
| W1 JH02 | 确认后台业务和读取需求 | [w1-jh02.md](#w1-jh02--确认后台业务和读取需求) + 注册表补丁提案                                             | 待评审 | 需接口 PR                              |
| W1 JH03 | 提供运营角色验证       | [w1-jh03.md](#w1-jh03--提供运营角色验证) + `w1-jh03-role-cases.json` + `cloudfunctions/moodsky/adapters.js` | 进行中 | **需 Xiang Yu 提供合成账号**           |
| W1 JH04 | 建立资料核验规则       | [w1-jh04.md](#w1-jh04--建立资料核验规则) + `w1-jh04-task-templates.json`                                    |  阻塞  | **需 Qinghan 的 W1 QZ01 地点候选资料** |
| W1 JH05 | 列出校园数据处理能力   | [w1-jh05.md](#w1-jh05--列出校园数据处理能力)                                                                | 待确认 | 需 Xiang Yu、Jiawei 确认               |

---

## W1 JH01 —— 确认校园接口与筛选字段

**协作人** Qinghan、Xiang Yu　**复核人** Qinghan

### action 清单（取自 `miniprogram/shared/contracts.js`，不得单边改名）

| action                    |   access    |    需求号    | mutates | 当前实现           |
| ------------------------- | :---------: | :----------: | :-----: | ------------------ |
| `campus.listPlaces`       | **public**  | UW3-F11、F12 |   否    | `notImplemented()` |
| `campus.getPlace`         | **public**  |   UW3-F13    |   否    | `notImplemented()` |
| `campus.favorites`        | **private** |   UW3-F14    | **是**  | `notImplemented()` |
| `campus.correctPlace`     | **private** |   UW3-F15    | **是**  | `notImplemented()` |
| `campus.supportResources` | **public**  |   UW3-F16    |   否    | `notImplemented()` |
| `campus.weatherPreview`   |   public    |   UW3-F24    |   否    | **已实现（模拟）** |

前端调用点 `miniprogram/modules/campus/service.js`：

```js
listPlaces: (filters = {}) => api.call(api.createRequest('campus.listPlaces', filters)),
getPlace: (placeId) => api.call(api.createRequest('campus.getPlace', { placeId })),
supportResources: () => api.call(api.createRequest('campus.supportResources')),   // ← 无参数
```

> ⚠️ `supportResources()` **目前不接收任何参数**。若要按校区/类型筛选，**前端与注册表都要改**，
> 且 `docs/api.md` 明令「不能单边改名」。

完整请求/响应/错误样例见 `w1-jh01-campus-api-samples.json`。

### `places` 字段表（含筛选维度）

| 字段          | 类型            | 必填 | 用途           | 可筛选 | 备注                   |
| ------------- | --------------- | :--: | -------------- | :----: | ---------------------- |
| `placeId`     | string          |  是  | 主键           |   —    | 无额外业务唯一键，见下 |
| `name`        | string          |  是  | 地点名称       |  模糊  |                        |
| `campus`      | enum            |  是  | **校区**       |   ✓    | 筛选维度 1             |
| `tags`        | array\<string\> |  是  | **标签**       |   ✓    | 筛选维度 2             |
| `openState`   | enum            |  是  | **开放状态**   |   ✓    | 取值待定               |
| `openHours`   | string          |  否  | 开放时间       |   —    | 不确定时留"待核实"     |
| `accessible`  | object          |  否  | **无障碍信息** |   ✓    | 结构待定               |
| `address`     | string          |  否  | 地址           |   —    | 合成地址不得进正式列表 |
| `contact`     | string          |  否  | 联系方式       |   —    | 同上                   |
| `location`    | geopoint        |  否  | 坐标           |   —    | 不能确认则留"待核实"   |
| `source`      | string          |  是  | 资料来源       |   —    | JH04                   |
| `verifiedBy`  | string          |  是  | 核验人         |   —    | JH04                   |
| `verifiedAt`  | timestamp       |  是  | 核验日期       |   —    | JH04                   |
| `validUntil`  | timestamp       |  是  | **核验期限**   |   ✓    | 过期降级为待重新核验   |
| `enabled`     | boolean         |  是  | 启用状态       |   ✓    | false 不进可前往列表   |
| `isSynthetic` | boolean         |  是  | 是否合成数据   |   ✓    | 演示必须标识           |

字段依据：`database/collections.json` 中 `places` 的 notes ——
_"Verified campus, opening status, hours, accessibility and validity."_

### `places` 的唯一性边界

```
places  uniqueKeys: []
```

十五个集合里只有 7 个有唯一键（`accounts`、`journals`、`preferences`、
`month_decorations`、`favorites`、`request_receipts`、`operator_roles`）。
`places` 未声明额外业务唯一键，但文档 `_id` 仍唯一。重复地点的业务判定与规范化 ID/索引方案需与 Xiang Yu 另行确认。
这条必须写进接口约定。

### 分页与空结果

| 项        | 提案                                        | 状态       |
| --------- | ------------------------------------------- | ---------- |
| 分页参数  | `page`（从 1 起）、`pageSize`               | 待确认上限 |
| 返回      | `{ items, page, pageSize, total, hasMore }` | 待确认     |
| 空结果    | `items = []`、`total = 0`，**成功而非错误** | 待确认     |
| 排序      | 稳定排序                                    | 待确认     |
| 过期/关闭 | 默认不出现在"可前往推荐"                    | 待确认     |

### 收藏读写与去重（约束声明，业务幂等仍待实现验证）

| 项       | 约定                                    | 依据                                        |
| -------- | --------------------------------------- | ------------------------------------------- |
| 唯一约束 | `[ownerId, placeId]`                    | `collections.json` → `favorites.uniqueKeys` |
| 重复收藏 | 幂等，返回 `{ok:true, duplicated:true}` | 待确认                                      |
| 取消收藏 | 幂等                                    | 待确认                                      |
| 身份来源 | **不采用客户端传入的 ownerId**          | `docs/api.md`；`router.js`                  |

### 纠错（`campus.correctPlace`）

| 项       | 约定                                                                                        |
| -------- | ------------------------------------------------------------------------------------------- |
| 正文长度 | **1–200 码点**（Unicode code point）                                                        |
| 可见范围 | 仅本人与审核运营可见，**不进入公共列表**                                                    |
| 状态流转 | `pending` → `approved` / `rejected`                                                         |
| 频率限制 | 待确认                                                                                      |
| 依据     | `place_corrections` notes：_"Private submitter/operator review; no automatic publication."_ |

### ⚠️ 错误码缺口

`ERROR_CODES` 枚举（13 个）里**没有 `NOT_FOUND`**：

```
INVALID_REQUEST, INVALID_INPUT, API_VERSION_UNSUPPORTED, ACTION_NOT_FOUND,
UNAUTHENTICATED, ACCOUNT_DISABLED, FORBIDDEN, CONFLICT, NOT_IMPLEMENTED,
CLOUD_NOT_CONFIGURED, NETWORK_ERROR, INVALID_RESPONSE, INTERNAL_ERROR
```

`campus.getPlace` 查不到地点时返回什么？**需要在接口 PR 中定**
（`INVALID_INPUT`？还是 `ok:true` + `null`？）。

### 待 Qinghan 复核的问题

1. 校区枚举是否够用？需要"其他/跨校区"吗？
2. 标签是受控词表还是自由输入？
3. 无障碍信息：只需 boolean，还是"电梯/坡道/无障碍卫生间"分项？
4. 列表默认排序是否满足页面需要？
5. 列表卡片需要哪些字段（避免为了卡片再发一次请求）？
6. `supportResources` 是否需要筛选参数？（会牵动前端改动）

---

## W1 JH02 —— 确认后台业务和读取需求

**协作人** Qizhen Chen　**复核人** Xiang Hong、Qizhen Cai

### 后台业务矩阵（写侧）

|  #  | action（注册表实名）          |  access  | mutates | 集合                | 现状               |
| :-: | ----------------------------- | :------: | :-----: | ------------------- | ------------------ |
|  1  | `admin.updatePlace`           | operator |   是    | `places`            | `notImplemented()` |
|  2  | `admin.updateTaskTemplate`    | operator |   是    | `task_templates`    | `notImplemented()` |
|  3  | `admin.updateSupportResource` | operator |   是    | `support_resources` | `notImplemented()` |
|  4  | `admin.reviewCorrection`      | operator |   是    | `place_corrections` | `notImplemented()` |

入口文件 `cloudfunctions/moodsky/domains/admin.js`，源码注释：
_"operator-only place/task/support maintenance. **No journal access**."_

**角色门禁由 `router.js` 统一执行，`admin.js` 内部不需要再判角色。**

### 接口缺口清单（读取侧）—— 三处证据证实

| 证据 | 内容                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 1    | 注册表 `admin` 域只有 4 个 action，**全部 `mutates=true`，无读取入口**                                                  |
| 2    | `admin/README.md`：_实现前补齐**读取**、编辑、审核、分页、错误与并发约定，不以直接数据库访问绕过授权_                   |
| 3    | `client-access-policy.json`：15 个集合全部 `read:false, write:false`，_Public reads go through validated cloud actions_ |

**结论：后台列表不能直连数据库，必须新增读取 action。硬约束，非可选。**

|  #  | 缺失能力     | 集合                | 提案 action                  | 状态   |
| :-: | ------------ | ------------------- | ---------------------------- | ------ |
|  5  | 地点列表     | `places`            | `admin.listPlaces`           | 待评审 |
|  6  | 待审纠错队列 | `place_corrections` | `admin.listCorrections`      | 待评审 |
|  7  | 任务模板列表 | `task_templates`    | `admin.listTaskTemplates`    | 待评审 |
|  8  | 支持资源列表 | `support_resources` | `admin.listSupportResources` | 待评审 |

提案 diff 见 [注册表提案](w1-jh02-registry-admin-read.patch.md) 与 [接口文档提案](w1-jh02-api-md-read.patch.md)。两者尚未应用。

### 硬性约束（红线）

|  #  | 约束                                                 | 出处               |
| :-: | ---------------------------------------------------- | ------------------ |
|  1  | 不以直接数据库访问绕过授权                           | `admin/README.md`  |
|  2  | 运营员不得读取私人天气、正文、微信身份映射或导出文件 | `admin/README.md`  |
|  3  | 不能直接把浏览器提交的 uid、role 或 ownerId 当作身份 | `admin/README.md`  |
|  4  | operator 只可维护校园资料                            | `docs/api.md`      |
|  5  | `admin.js` 无日记访问                                | `domains/admin.js` |

### 待 Xiang Hong / Qizhen Cai 复核

1. 四个独立 action，还是统一 `admin.list{collection}`？
2. `listCorrections` 需要哪些筛选与排序？
3. 分页参数是否与 `campus.listPlaces` 收敛为同一约定？
4. 审核结论是否需要留痕（审核人/时间/理由）？
5. 是否需要对应需求号？

---

## W1 JH03 —— 提供运营角色验证

**协作人** Xiang Yu　**复核人** Qizhen Cai（独立复测）

### 实现点：`router.js` 的 adapter 接缝

`cloudfunctions/moodsky/index.js` 目前是 **`createRouter()` —— 一个适配器都没传**：

```js
return createRouter()(request, cloud.getWXContext());
```

因此三个 adapter 全部停在 `notImplemented()`。`router.js` 的声明：

```js
const defaultAdapters = {
  resolveAccount: async () => notImplemented(),
  resolveOperatorRoles: async () => notImplemented(), // ← JH03 实现点
  resolveCleanupReceipt: async () => notImplemented(),
};
```

已在 `cloudfunctions/moodsky/adapters.js` 实现 `resolveAccount` 与 `resolveOperatorRoles`。
**该文件暂未被 `index.js` 引用** —— 接线属于接口 PR，需与 Xiang Hong / Qizhen Cai 一起做。

### 门禁真实执行顺序（`router.js`）

| 步  | 判定                                                    | 失败返回                               |
| :-: | ------------------------------------------------------- | -------------------------------------- |
|  1  | `trustedContext.OPENID` 是否存在                        | `UNAUTHENTICATED`「请先登录。」        |
|  2  | `resolveAccount(OPENID)` 返回带 `id` 的账号             | `UNAUTHENTICATED`「账号尚未就绪。」    |
|  3  | `account.status === 'active'`                           | **`ACCOUNT_DISABLED`**「账号已停用。」 |
|  4  | `resolveOperatorRoles(account.id)` 含 `'data_operator'` | `FORBIDDEN`「需要资料维护权限。」      |
|  5  | 通过 → `actor = { accountId, roles: [...] }`            | —                                      |

> ⭐ **停用运营在第 3 步被拦，返回 `ACCOUNT_DISABLED`，不是 `FORBIDDEN`。**
> 验收时按 `FORBIDDEN` 写会被判错。

### 结果记录表

|  #  | 用例         | 输入身份                                                           | 期望错误码                            | 实测 | 证据链接 | 状态   |
| :-: | ------------ | ------------------------------------------------------------------ | ------------------------------------- | ---- | -------- | ------ |
|  1  | 普通用户     | active 账号，无 `operator_roles` 记录                              | `FORBIDDEN`                           | 待填 | 待填     | 待开始 |
|  2  | 授权运营     | active 账号，`operator_roles.role = data_operator` 且 enabled=true | **门禁通过；业务 NOT_IMPLEMENTED**    | 待填 | 待填     | 待开始 |
|  3  | 停用运营     | 账号 `status = 'disabled'`                                         | **`ACCOUNT_DISABLED`**                | 待填 | 待填     | 待开始 |
|  4  | **伪造角色** | active 普通账号，`payload` 带 `role:'data_operator'`               | `INVALID_REQUEST`（格式校验先于门禁） | 待填 | 待填     | 待开始 |

机读版本：`w1-jh03-role-cases.json`。

### 为什么"伪造角色必拒"是架构保证

`router.js` 中 `actor = { accountId, roles: [] }` 是**运行时注入**的结果，
`request.payload` 中的 role **不用于授予权限**；`validateRequest` 会先以 `INVALID_REQUEST` 拒绝客户端身份字段。另外 `index.js` 在进入 router 前会：

```js
delete request.userInfo;
delete request.tcbContext;
```

_"Transport metadata never supplies identity, controls or business input."_

### 与 Qizhen Chen 的对接项

- Web 登录得到的身份如何映射到内部 `accountId`
- 账号映射由 Jiawei 核对，**角色查询由 Junhan 核对**（计划 §10 W1 QC01）
- 停用账号重新进入仍应停用，**不得自动恢复旧数据**
- `operator_roles` owner：_Xiang Yu schema / **Junhan Huang roles** / Qizhen Chen Web identity adapter_

### 阻塞

**需要 Xiang Yu 在测试环境建立三个合成账号**（普通 / 授权运营 / 停用运营）
及其 `operator_roles` 记录。在此之前无法做云端端到端验证。本地可注入合成数据库验证门禁，见 `tests/identity-adapters.test.js`；这不替代 Qizhen Cai 的独立复测。

---

## W1 JH04 —— 建立资料核验规则

**上游** Qinghan（W1 QZ01）　**下游** Jiawei、Qizhen Chen

### 核验规则

| 字段     | 规则                                                               |
| -------- | ------------------------------------------------------------------ |
| 来源     | 必须有可追溯来源；**无来源 → 不进正式列表**                        |
| 核验人   | 必须具名；本周为 Junhan                                            |
| 核验日期 | 实际核验当天，不得预填                                             |
| 有效期   | 到期自动降级为"待重新核验"，不再作为可前往推荐                     |
| 启用状态 | `enabled = false` 不进可前往列表                                   |
| 坐标     | 不能确认则保留"待核实"，**不臆造**                                 |
| 合成数据 | **合成地址或联系方式一律不进正式可前往列表**，仅用于演示且必须标识 |
| 支持资源 | 没有可靠信息时保持**待核验空态**，不填占位内容                     |
| 状态用语 | 待开始 / 进行中 / 待复核 / 已验收 / 阻塞（计划 §16）               |

依据：`places` notes _"Verified campus, opening status, hours, accessibility and validity."_；
`support_resources` notes _"Verified resources with expiry; **no fictional contact details**."_；
`campus.js` 注释 _"All place/support data requires real verification."_

### 合成数据的官方标记惯例

`campus.weatherPreview` 的返回即模板：

```json
{ "simulated": true, "label": "固定虚构示意", "description": "..." }
```

合成地点数据照此打标，与真实可前往资料区分。

### 三个自愿小任务模板草稿

机读版本 `w1-jh04-task-templates.json`（人读版见其 `_comment` 字段）。

|  #  | 标题                 | 选项                           | 输入                      | 用途                            |
| :-: | -------------------- | ------------------------------ | ------------------------- | ------------------------------- |
|  1  | 去一个没去过的地方   | 已完成 / 今天不方便 / 换一个   | 无                        | 选择→完成/替换/跳过 状态转换    |
|  2  | 今天的天气像什么？   | 晴天/晴间多云/阴天/雨天/暴风雨 | 单选                      | `quickChoice` 与 Today 表单衔接 |
|  3  | 帮忙确认一条地点信息 | 信息正确 / 有变化 / 我不确定   | 选"有变化"可附 1–200 码点 | 资料核验与纠错入口衔接          |

> 5 类天气需与 Jiaqi（W1 JQ02）的图标配对保持一致；建议条数上限与
> `tasks.suggestions` 的"最多 3 条"对齐。

### 地点资料核验表

见 `w1-jh04-place-verification.csv`（表头已建，数据待 Qinghan 的 QZ01 提供后填写）。

### 阻塞

**依赖 Qinghan 的 W1 QZ01**（至少 5 条校园地点候选记录）。在此之前核验表无法填写。

---

## W1 JH05 —— 列出校园数据处理能力

**交接** Xiang Yu、Jiawei Fang（由两人确认接口所需输入）

### 收藏与纠错的数据处理清单

| 集合                | 本人数据查询方式                                      | 导出字段                                      | 注销清理范围           | 重复清理要求              |
| ------------------- | ----------------------------------------------------- | --------------------------------------------- | ---------------------- | ------------------------- |
| `favorites`         | 由可信 account.id 得到 ownerId，按集合 `ownerId` 过滤 | `placeId`、收藏时间                           | **删除本人全部收藏**   | 幂等：第二次返回删除 0 条 |
| `place_corrections` | 由可信 account.id 得到 ownerId，按集合 `ownerId` 过滤 | `placeId`、正文（1–200 码点）、状态、提交时间 | **删除本人提交的纠错** | 幂等                      |
| `places`            | —                                                     | —                                             | **不删除**             | 公共数据                  |
| `support_resources` | —                                                     | —                                             | **不删除**             | 公共数据                  |
| `task_templates`    | —                                                     | —                                             | **不删除**             | 公共数据                  |

### 明确说明（计划硬性要求）

> 正式地点与支持资料属于**公共数据**，**不会因某个学生注销而被整体删除**。
> 注销只影响该学生**本人**的收藏与纠错记录。

依据：`deletion_markers` notes _"domain owners provide deletion handling"_；
`docs/api.md` _"各业务负责人提供本人数据查询、导出失效和可重复清理能力"_。

### 导出相关约定（引 W1 XY03，非本人实现）

| 项             | 约定                                   |
| -------------- | -------------------------------------- |
| 导出内容       | 只导出本人数据                         |
| 临时凭证上限   | 5 分钟                                 |
| 服务端文件上限 | 24 小时                                |
| 账号停用       | 使旧导出失效                           |
| 清理进度回执   | 受限回执校验后只读；jobId 本身不是凭证 |

### 与 Xiang Yu / Jiawei 的确认项

1. 账号校验能力的调用方式（供导出使用）—— Jiawei
2. `account.close` 停用与任务交接 —— Jiawei；清理执行与重试 —— Xiang Yu
3. 本人数据查询走哪个服务端入口（避免客户端直连集合）

---

## 记录字段（计划 §16）

每项任务按下表填写。**所有链接与实测值待补。**

| 字段     | JH01              | JH02                   | JH03                  | JH04             | JH05              |
| -------- | ----------------- | ---------------------- | --------------------- | ---------------- | ----------------- |
| 任务编号 | W1 JH01           | W1 JH02                | W1 JH03               | W1 JH04          | W1 JH05           |
| 协作人   | Qinghan、Xiang Yu | Qizhen Chen            | Xiang Yu              | Qinghan          | Xiang Yu、Jiawei  |
| 复核人   | Qinghan           | Xiang Hong、Qizhen Cai | Qizhen Cai            | —                | Xiang Yu、Jiawei  |
| 难度点   | 待估              | 待估                   | 待估                  | 待估             | 待估              |
| 前置输入 | Xiang Yu 字段初稿 | Qizhen Chen 读取需求   | **Xiang Yu 合成账号** | **Qinghan QZ01** | Xiang Yu 数据字典 |
| 成果链接 | 待填              | 待填                   | 待填                  | 待填             | 待填              |
| 实际耗时 | 待填              | 待填                   | 待填                  | 待填             | 待填              |
| 状态     | 待复核            | 待评审                 | 进行中                | 阻塞             | 待确认            |

> 难度点建议取值 1、2、3、5、8；超过 8 点需拆分。个人计划比例按同一套项目任务点数归一化到 100%。

## 关键交接（计划 §15）

| 方向                             | 内容                               | 状态                   |
| -------------------------------- | ---------------------------------- | ---------------------- |
| Junhan → Qizhen Chen、Qizhen Cai | 后台业务矩阵、角色规则及读取需求   | 本目录 JH02/JH03       |
| Junhan → Xiang Hong、Qizhen Cai  | 运营角色验证结果                   | 待 Xiang Yu 的合成账号 |
| Xiang Yu → Junhan                | 账号及业务字段、索引与数据归属初稿 | 等待                   |
| Qinghan → Junhan                 | 地点候选资料                       | 等待                   |

## 2026-10-16 拥有者整合审查

角色字段已按已合入的 [Xiang Yu 数据字典](../XiangYu/data-dictionary.md) 对齐为单值 `role` 和布尔 `enabled`。新增 6 项本地合成数据库测试，覆盖可信身份、缺失/畸形/停用角色、授权门禁、停用账号先行拦截、客户端伪造和错误脱敏。适配器仍未接入正式入口；未创建云端合成账号、未部署、未实现后台业务。上表成员复核与实测状态保留原状，本地测试不替代其独立验收。
