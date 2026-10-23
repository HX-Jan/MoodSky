# MoodSky 第二周成果记录 —— Junhan Huang

|          |                                                        |
| -------- | ------------------------------------------------------ |
| 姓名     | Junhan Huang                                           |
| 岗位     | 校园与资料后台业务后端；运营角色查询与业务授权         |
| 周次     | 第二周（计划周期 2026-10-19—10-25）                    |
| 依据     | 《MoodSky_第二周详细任务计划_20261017》§4 W2 JH01—JH05 |
| 学习重点 | 分页筛选、资料有效期、运营角色查询、服务端授权         |
| 工具     | VS Code、Node.js 24、云开发控制台、接口样例            |
| 分支     | `Junhan_Huang-W2-campus-admin`                         |
| 基线     | `origin/main` `870b43a`（v0.2.3，569 项测试）          |

> 本目录以仓库实际源码和本地执行为依据。所有结论来自 `npm run check`（**598 项测试全通过**，日志见 [w2-check-20261023.txt](w2-check-20261023.txt)）。
> 本周成果已变基到最新 `origin/main`（v0.2.3）之后，因此与队友第二周成果在同一基线上。
> **真实云端部署、真实数据库写入、真实双账号联调均未执行**，对应状态保持「进行中／阻塞」，不以本地演示替代云端结果。

## 状态总览

| 编号    | 任务                           | 交付物                                                                                                                                                     |  状态  | 阻塞／待办                                         |
| ------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | -------------------------------------------------- |
| W2 JH01 | 实现校园公开列表与详情         | [下文](#w2-jh01--实现校园公开列表与详情) + `w2-jh01-campus-api-samples.json` + `domains/campus.js`、`domains/campus-rules.js`                              | 待复核 | 需 Qinghan 确认字段与筛选够用                      |
| W2 JH02 | 接入可信运营角色               | [下文](#w2-jh02--接入可信运营角色) + `w2-jh02-role-cases.json` + `wiring.js`（接线模块，生产入口按团队约定未启用）                                         | 待复核 | 需 Qizhen Cai 独立复测；Web 身份未通过             |
| W2 JH03 | 定稿后台读取并接通一条维护链路 | [下文](#w2-jh03--定稿后台读取并接通一条维护链路) + `w2-jh03-admin-interface-matrix.json` + `domains/admin.js`、`domains/admin-rules.js`、`repositories.js` | 待复核 | **注册表新增 5 个只读 action，需 Xiang Hong 评审** |
| W2 JH04 | 实现收藏与纠错最小能力         | [下文](#w2-jh04--实现收藏与纠错最小能力) + `w2-jh04-favorites-corrections-cases.json`                                                                      | 待联调 | 需 Qinghan 前端联调、Qizhen Cai 跨账号检查         |
| W2 JH05 | 交付校园数据处理与资料核验结果 | [下文](#w2-jh05--交付校园数据处理与资料核验结果) + `w2-jh05-data-review.csv`、`w2-jh05-handover.json`                                                      |  阻塞  | **需 Qinghan 的 W2 QH01 地点候选资料**             |

## 本周源码改动

| 文件                                             | 改动                                                                                    | 复核人                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------- |
| `cloudfunctions/moodsky/domains/campus.js`       | 由单一占位改为 5 个 action 的分发器（列表、详情、支持资源、收藏、纠错）                 | Xiang Hong、Qinghan     |
| `cloudfunctions/moodsky/domains/campus-rules.js` | 新增：可见性判定、投影、排序分页、请求校验（纯函数，无数据库与时钟依赖）                | Xiang Hong              |
| `cloudfunctions/moodsky/domains/admin.js`        | 由占位改为 6 个 action 的分发器；保留 3 个仍为 `NOT_IMPLEMENTED`                        | Xiang Hong、Qizhen Chen |
| `cloudfunctions/moodsky/domains/admin-rules.js`  | 新增：运营请求校验、维护字段白名单、核验盖章与冲突判定                                  | Xiang Hong、Xiang Yu    |
| `cloudfunctions/moodsky/repositories.js`         | 新增：校园资料的数据访问层（CloudBase 实现，未在真实环境执行）                          | Xiang Yu、Yuen          |
| `cloudfunctions/moodsky/wiring.js`               | 新增：`createCampusBackend(cloud)` 一行接线；**生产入口不引用**，等待接口 PR 启用       | Xiang Hong、Qizhen Cai  |
| `cloudfunctions/moodsky/router.js`               | 增加 `repositories` 接缝与 `now` 时钟接缝，并在与上游 `domainHandlers` 注入合并后保留   | Xiang Hong              |
| `miniprogram/shared/contracts.js`                | 新增 5 个只读 `admin.*` action 与错误码 `NOT_FOUND`（**共享文件，待评审**）             | **Xiang Hong**          |
| `miniprogram/modules/campus/service.js`          | 暴露 `listFavorites`/`addFavorite`/`removeFavorite`/`correctPlace`，固化 operation 用法 | Linghan Chen、Qinghan   |
| `tests/campus.test.js`                           | 新增 14 项：可见性、筛选、分页、详情降级、收藏幂等、纠错码点边界                        | Yuen Lin                |
| `tests/admin-campus.test.js`                     | 新增 15 项：角色门禁、运营读取、维护链路、冲突、字段越权                                | Yuen Lin、Qizhen Cai    |
| `tests/support/*`、`docs/api.md`                 | 内存仓储替身、固定测试数据；接口文档同步 campus/admin 约定                              | Yuen Lin、Xiang Hong    |

### 需要评审的共享改动

**注册表**：`miniprogram/shared/contracts.js` 新增 `admin.listPlaces`、`admin.getPlace`、`admin.listCorrections`、`admin.listTaskTemplates`、`admin.listSupportResources` 与错误码 `NOT_FOUND`。全部为**纯增加**，未改动既有 action 的 domain/access/requirements，`scripts/check-structure.js` 的 24 项需求覆盖仍通过。原因是 15 个集合对客户端读写全关，没有读取入口时后台保存后无法确认写入、也无法读待审纠错。按 `docs/team.md`，该文件由 Xiang Hong 协调评审；**评审不通过则应回退这 5 个 action，其余实现不受影响**。

## 与计划描述的差异

计划文档 §1 记录「package.json 版本 0.2.1、最新提交 1b8ef47、234 项本地测试」。开工时本机 checkout 落后于远端（版本 0.1.0、基线 124 项测试），本周已改为**以 `origin/main` 为准**：变基到 `870b43a`（v0.2.3）后，基线 569 项测试，加上本周新增 29 项，合计 **598 项全部通过**。因此上述「0.2.1／234 项」只是计划编制时点的快照，不是当前基线。

---

## W2 JH01 —— 实现校园公开列表与详情

**协作人** Qinghan Zhang、Xiang Yu　**复核人** Qinghan Zhang　**状态** 待复核

### 定稿的字段与规则

`listPlaces` / `getPlace` / `supportResources` 的 payload 与结果见 [`docs/api.md`](../../api.md#校园资料接口第二周实现)，机读样例见 [w2-jh01-campus-api-samples.json](w2-jh01-campus-api-samples.json)（12 组请求／响应，含错误样例）。

公开摘要字段固定为 `placeId`、`name`、`campus`、`tags`、`openState`、`openHours`、`address`、`accessible`、`verificationState`；`_id`、`verifiedBy`、`isSynthetic` 等维护字段不对外。

### 公开可见规则（本周核心判定）

同时满足才进入公开列表：`enabled === true`、`isSynthetic === false`（必须显式标记为真实）、`source` 非空、`verifiedAt` 可解析、`validUntil` 未过期。

| `verificationState` | 含义                 | 公开列表 | 公开详情                              |
| ------------------- | -------------------- | -------- | ------------------------------------- |
| `verified`          | 已核验且有效期充足   | 出现     | 完整（含联系方式与坐标）              |
| `expiring`          | 14 天内到期，仍有效  | 出现     | 完整                                  |
| `expired`           | 已过期               | 不出现   | 可读，`stale: true`，无联系方式与坐标 |
| `unverified`        | 缺来源或核验日期     | 不出现   | `NOT_FOUND`                           |
| `synthetic`         | 未显式标记为真实资料 | 不出现   | `NOT_FOUND`                           |
| `disabled`          | `enabled !== true`   | 不出现   | `NOT_FOUND`                           |

- 合成地址、联系方式与未核验资料**无法通过公开接口获取**，即使误导入集合也不会泄漏。
- 过期资料不删数据、不返回错误，而是降级：可读但 `stale: true`，且不返回 `contact`／`location`，避免把过期联系方式发给学生。
- `isSynthetic` 缺失按"未标记为真实"处理，宁可空态也不误发布。

### 分页与空态

`page` 从 1 起，`pageSize` 1—20（默认 10）；排序固定 `campus` → `name` → `placeId`，翻页稳定。空结果返回 `items: []`、`total: 0` 且 `ok: true`。单次读取达到上限时返回 `truncated: true`，客户端不得当作全量。

`supportResources` 无已核验资源时返回 `emptyState.code = NO_VERIFIED_RESOURCE`，**不填占位热线**——这正是 `support_resources` 备注要求的"no fictional contact details"。

### 验收证据

- 14 项自动化测试（`tests/campus.test.js`）覆盖：合成／停用／缺来源／缺日期不出现在列表、过期降级、筛选、分页稳定性、空态、内部字段不泄漏。
- 未在云端执行：真实集合、真实数据、真实调用均未跑，`repositories.js` 的 CloudBase 调用形状**未经真实环境验证**。

**阻塞**：需 Qinghan 确认（1）校区枚举是否够用、（2）`supportResources` 是否要按校区筛选（会牵动前端与注册表）。

---

## W2 JH02 —— 接入可信运营角色

**协作人** Jiawei Fang、Qizhen Chen　**复核人** Qizhen Cai　**状态** 待复核

### 接线内容：模块就绪，生产入口按团队约定仍未启用

`index.js` 一直是 `createRouter()` —— 一个适配器都不传，三个 adapter 全部停在 `notImplemented()`。本周新增 `cloudfunctions/moodsky/wiring.js`：

```js
// 由接口 PR 在 index.js 中一行启用
const router = createCampusBackend(cloud);
```

`createCampusBackend` 内部即 `createRouter({ ...createAdapters(cloud), repositories: createRepositories(cloud) })`。**但它没有被 `index.js` 引用**，原因不是遗漏：

- `tests/cloud-bundle-defaults.test.js` 与 `tests/foundation-transport.test.js` 都断言打包后的入口不加载仓储/服务模块，`tools/week2-integration/backend.js` 的注记也写明「Never imported by the production entry」。
- 也就是说，团队当前约定是：业务实现通过可注入的 router 交付，**是否在生产入口开启属于接口 PR 的决定**，不由功能分支单方面翻开关。

因此未接线环境下 campus/admin 仍返回 `NOT_IMPLEMENTED`（并在校验参数之前返回，避免把"没接线"误报成客户端参数错误）。`createAdapters`（第一周已实现、此前无人引用）现在有了真实调用方：`accounts` 按 `openid` 查内部账号，`operator_roles` 按 `accountId` 且 `enabled: true` 查角色。`resolveCleanupReceipt` 仍保留默认未实现——账号停用与清理回执属于 Jiawei 与 Xiang Yu 的范围。

### 门禁顺序（实测确认）

| 步  | 判定                                        | 返回                   |
| :-: | ------------------------------------------- | ---------------------- |
|  1  | 无可信 `OPENID`                             | `UNAUTHENTICATED`      |
|  2  | `resolveAccount` 无账号                     | `UNAUTHENTICATED`      |
|  3  | `account.status !== 'active'`               | **`ACCOUNT_DISABLED`** |
|  4  | `resolveOperatorRoles` 不含 `data_operator` | `FORBIDDEN`            |
|  5  | 通过 → `actor = { accountId, roles }`       | —                      |

> 停用运营在第 3 步被拦，返回 `ACCOUNT_DISABLED` 而不是 `FORBIDDEN`，与第一周的结论一致。

### 结果

[w2-jh02-role-cases.json](w2-jh02-role-cases.json) 的 6 个用例全部通过：无可信身份、普通 active 用户、授权运营、停用运营（有／无角色记录各一）、伪造客户端角色。伪造用例覆盖 `payload` 携带 `role`／`ownerId`：在路由层即 `INVALID_REQUEST`，`actor.roles` 只来自服务端查询。

**边界**：Web 可信身份尚未通过，因此只保留本地授权验证，**不宣称后台已可真实运营**。真实 `operator_roles` 集合仍需 Xiang Yu 在测试环境建三个合成账号后由 Qizhen Cai 复测。

---

## W2 JH03 —— 定稿后台读取并接通一条维护链路

**协作人** Qizhen Chen、Xiang Hong　**复核人** Xiang Hong　**状态** 待复核

### 为什么必须增加读取 action

三处硬证据：注册表 `admin` 域原本 4 个 action **全部 `mutates: true`、没有读取入口**；`client-access-policy.json` 规定 15 个集合 `read:false, write:false`；`docs/api.md` 禁止直连数据库绕过授权。结论：运营列表**不能**直连集合，必须新增读 action。

### 接口矩阵

[w2-jh03-admin-interface-matrix.json](w2-jh03-admin-interface-matrix.json) 列出 `campus.*` 与 `admin.*` 全部 15 个 action 的 domain／access／mutates／实现状态。

| 新增 action                  | 说明                                             |
| ---------------------------- | ------------------------------------------------ |
| `admin.listPlaces`           | 可见未核验／合成／停用，返回 `verificationState` |
| `admin.getPlace`             | 单条维护视图（含 `verifiedBy`、`isSynthetic`）   |
| `admin.listCorrections`      | 待审纠错队列，**不回传提交人账号**               |
| `admin.listTaskTemplates`    | 只读                                             |
| `admin.listSupportResources` | 只读，含 `verificationState`                     |

`admin.reviewCorrection`、`admin.updateTaskTemplate`、`admin.updateSupportResource` 仍为 `NOT_IMPLEMENTED`，不返回假保存——模板与支持资源的字段尚未与 Jiawei、Qizhen Chen 定稿。

### 接通的一条维护链路（实际执行记录）

`admin.updatePlace` 的写侧规则：

- `changes` 白名单：`name`、`campus`、`tags`、`openState`、`openHours`、`address`、`contact`、`accessible`、`location`、`source`、`validUntil`、`enabled`、`isSynthetic`。
- `verifiedAt`／`verifiedBy`／`updatedAt`／`updatedBy` **只能由服务端盖章**，客户端传入即 `INVALID_INPUT`（防止倒填核验时间）。
- `markVerified: true` 写入核验人与核验时间，但要求存在可追溯 `source`，否则 `INVALID_INPUT`。
- `expectedUpdatedAt` 不一致返回 `CONFLICT` 且**不写入**，防止旧控制台页面覆盖新核验。
- 保存后**重新读取**：`saved` 与 `verified` 分开返回，重新读取未确认时不显示保存成功（对应计划"前端验证失败不显示保存成功"）。

执行记录（同一条链路，逐条有请求与响应）：

| 步骤                                | 结果                                                |
| ----------------------------------- | --------------------------------------------------- |
| 运营读取待核验地点 `p_nosource`     | `verificationState: unverified`                     |
| 公开读取同一地点                    | `NOT_FOUND`（核验前不可见）                         |
| 运营更新来源并 `markVerified: true` | `saved: true, verified: true`                       |
| 运营重新读取                        | `verificationState: verified`，`verifiedBy: acc_op` |
| 公开读取                            | 成功，返回新来源                                    |

另有两个守卫用例：陈旧 `expectedUpdatedAt` → `CONFLICT`；客户端传 `verifiedAt` → `INVALID_INPUT`。

**阻塞**：注册表 5 个 action 待 Xiang Hong 评审；真实 CloudBase 的 `update`／`limit`／`skip` 行为未在云端验证。

---

## W2 JH04 —— 实现收藏与纠错最小能力

**协作人** Qinghan Zhang　**复核人** Qinghan Zhang（联调）、Qizhen Cai（跨账号与身份伪造）　**状态** 待联调

### 收藏：单 action + operation

`campus.favorites` 用 `operation: list | add | remove`，避免为同一集合再造三个 action（`docs/api.md` 要求"明确读写 operation 或拆成独立 action，并同步客户端、注册表和文档"）。客户端已收敛到 `modules/campus/service.js` 的 `listFavorites`／`addFavorite`／`removeFavorite`。

- 归属只取服务端 `accountId`；payload 带 `ownerId`／`role` 在路由层被拒。
- 去重依赖 `favorites` 唯一键 `[ownerId, placeId]`：重复收藏返回 `duplicated: true` 而非错误；重复取消返回 `removed: false`（幂等）。
- 只能收藏公开可见的地点；地点之后被停用或过期时，收藏保留但 `available: false`、`place: null`，计入 `unavailableCount`，学生仍可取消——不能因为资料失效就让学生无法清理自己的收藏。

### 纠错：1—200 码点，私人

`text` 按 **Unicode 码点**校验（200 个 emoji 通过，201 个拒绝，空串拒绝）；写入 `place_corrections`，`status: 'pending'`，`ownerId` 取服务端账号，响应固定 `published: false`。纠错内容不进任何公开接口；运营读取队列时不回传提交人。

### 验收证据

[w2-jh04-favorites-corrections-cases.json](w2-jh04-favorites-corrections-cases.json) 共 15 组记录：添加、重复添加、本人列表、他人账号列表、`ownerId` 伪造、地点停用后不可用、取消、重复取消、收藏合成地点被拒、纠错提交与落库、200/201 码点边界、空正文、运营读取待审队列。

**阻塞**：跨账号隔离用的是本地合成账号，**不是真实双账号联调**；`place_corrections` 的运营审核写入（`admin.reviewCorrection`）本周未实现。

---

## W2 JH05 —— 交付校园数据处理与资料核验结果

**协作人** Xiang Yu、Jiawei Fang　**复核人** Xiang Yu、Jiawei Fang　**状态** 阻塞

### 资料核验表

[w2-jh05-data-review.csv](w2-jh05-data-review.csv) 表头已建（15 列：来源、来源核对日、核验日、核验人、有效期、启用、合成标记、`verificationState`、结论、复审到期、备注），**数据行待 Qinghan 的 W2 QH01 地点候选资料**。

不预填任何行：测试用的固定数据是合成样例，一旦写进核验表就会被当作真实资料，这正是第一周 JH04 定下的红线。

### 数据处理与清理接口（交付 Xiang Yu）

[w2-jh05-handover.json](w2-jh05-handover.json) 给出收藏与纠错的本人查询口径、导出字段、幂等清理语义与共享资料保留规则：

| 集合                | 本人查询键         | 导出字段                                 | 注销清理     | 二次执行          |
| ------------------- | ------------------ | ---------------------------------------- | ------------ | ----------------- |
| `favorites`         | 服务端 `accountId` | `placeId`、`createdAt`                   | 删除本人收藏 | 删除 0 条，不报错 |
| `place_corrections` | 服务端 `accountId` | `placeId`、`text`、`status`、`createdAt` | 删除本人纠错 | 删除 0 条，不报错 |
| `places` 等共享资料 | —                  | —                                        | **不删除**   | —                 |

> 学生注销**不会**删除共享地点、模板或支持资料；只影响该学生本人的收藏与纠错。

**不做的事**：导出文件生成、临时凭证、清理执行器、删除标记与恢复流程属于 Xiang Yu 的范围，本文件只交付接口约定，不宣称清理已可执行。

---

## 复现方式

```powershell
npm run cloud:prepare   # shared/ 改动同步到 cloudfunctions/moodsky/shared
npm run check           # eslint + prettier + 结构 + 598 项测试
```

单独跑本周的测试：

```powershell
node --test tests/campus.test.js tests/admin-campus.test.js
```

## 复核清单

| 复核人      | 需要确认的点                                                                         |
| ----------- | ------------------------------------------------------------------------------------ |
| Qinghan     | 校区枚举、标签词表、`supportResources` 是否要筛选、公开字段是否够画卡片              |
| Xiang Hong  | 注册表 5 个只读 action 与 `NOT_FOUND`；`router.js` 的 `repositories`／`now` 接缝     |
| Qizhen Cai  | 停用运营返回 `ACCOUNT_DISABLED`；伪造 `role` 被拒；跨账号收藏隔离                    |
| Xiang Yu    | `repositories.js` 的集合与字段假设；清理口径与幂等语义                               |
| Yuen Lin    | 新增 29 项测试的归属与回归范围；`repositories.js` 的全量扫描上限是否要改数据库侧分页 |
| Qizhen Chen | 后台读取字段是否够用；模板与支持资源读取的后续字段                                   |

## 记录字段（计划 §16）

| 字段     | JH01              | JH02                | JH03                    | JH04                | JH05                  |
| -------- | ----------------- | ------------------- | ----------------------- | ------------------- | --------------------- |
| 任务编号 | W2 JH01           | W2 JH02             | W2 JH03                 | W2 JH04             | W2 JH05               |
| 协作人   | Qinghan、Xiang Yu | Jiawei、Qizhen Chen | Qizhen Chen、Xiang Hong | Qinghan             | Xiang Yu、Jiawei      |
| 复核人   | Qinghan           | Qizhen Cai          | Xiang Hong              | Qinghan、Qizhen Cai | Xiang Yu、Jiawei      |
| 难度点   | 待本人估          | 待本人估            | 待本人估                | 待本人估            | 待本人估              |
| 前置输入 | Qinghan 字段确认  | Xiang Yu 合成账号   | Xiang Hong 注册表评审   | Qinghan 前端联调    | **Qinghan QH01 资料** |
| 成果路径 | 本目录            | 本目录              | 本目录                  | 本目录              | 本目录                |
| 实际耗时 | 待本人填写        | 待本人填写          | 待本人填写              | 待本人填写          | 待本人填写            |
| 验收状态 | 待复核            | 待复核              | 待复核                  | 待联调              | 阻塞                  |
| 阻塞     | 字段确认          | 真实复测            | 注册表评审、真实云环境  | 前端联调            | QH01 资料             |

> 难度点取 1、2、3、5、8；实际工时与难度由本人填写，不由工具代估。

## 关键交接（计划 §15）

| 方向                             | 内容                                         | 状态                            |
| -------------------------------- | -------------------------------------------- | ------------------------------- |
| Junhan → Xiang Hong、Qizhen Chen | 后台读取接口矩阵、维护链路与写入白名单       | 本目录 JH03                     |
| Junhan → Qizhen Cai              | 运营角色 6 个用例结果                        | 待真实 `operator_roles` 复测    |
| Junhan → Qinghan                 | 公开字段、筛选语义、收藏 operation、纠错边界 | 本目录 JH01/JH04、`docs/api.md` |
| Junhan → Xiang Yu、Jiawei        | 收藏与纠错的查询、导出、幂等清理口径         | 本目录 JH05                     |
| Qinghan → Junhan                 | 地点候选资料（来源、日期、启用条件）         | **等待，JH05 阻塞**             |
| Xiang Yu → Junhan                | `places`/`favorites` 等集合最终字段与索引    | 等待                            |
