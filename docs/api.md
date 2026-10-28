# 接口约定 v1

接口版本仍为1。下文区分已固定的约定、显式候选与尚待共同评审的部分；当前功能/体验范围见[首页](../README.md)，源码接线见[架构](architecture.md)，后续提交状态见[增补记录](collaboration/updates.md)。职责或源码收录不代表正式入口已启用。

唯一注册表为 miniprogram/shared/contracts.js，类型提示为 shared/types.d.ts。调用统一使用 wx.cloud.callFunction，函数名 moodsky，data 为下面的请求对象；前端模块不得各自创建通信格式。

2026-10-25 本人受限测试新增私人动作 `account.session`（空 payload）和 `tasks.mine`（空 payload）；默认正式函数仍未接入。只有显式选择独立 `moodsky-private-pilot` 的预览包使用 `{request: 原v1请求, sessionScope?: 服务器账号范围}` 传输层，原 v1 信封保持严格。范围标记不代替本次平台身份，重试固定原函数/环境/账号范围。服务端测试账号使用明确标记的加密伪名，不复用或迁移正式账号；详见[受限测试接口与边界](deployment/private-pilot-20261025.md)。

```json
{
  "apiVersion": "1",
  "requestId": "req_example_001",
  "action": "journal.upsert",
  "payload": {
    "date": "2026-10-11",
    "weather": "SUNNY",
    "tags": ["REST"],
    "text": "",
    "expectedVersion": 0
  }
}
```

requestId 是8—80个字母、数字、下划线或短横线；每次新的逻辑操作一个 ID。同一次失败重试复用原对象，不能改变 payload 或生成新 ID。它是去重标识，不是访问凭证；不要放正文、身份或密钥。

成功示例：

```json
{
  "apiVersion": "1",
  "requestId": "req_example_001",
  "ok": true,
  "data": { "app": "MoodSky", "version": "0.2.3", "stage": "foundation" }
}
```

失败示例：

```json
{
  "apiVersion": "1",
  "requestId": "req_example_001",
  "ok": false,
  "error": { "code": "NOT_IMPLEMENTED", "message": "此功能正在开发，尚未保存或修改任何数据。" }
}
```

无有效 requestId 的非法请求返回 requestId:null。客户端校验版本和 requestId，拒绝串请求或不完整结果。错误不能暴露平台堆栈、原始账号、私人输入或下载凭证。失败由 AppError 传给页面，页面保留本次输入；当前未实现任何自动写入重试。

2026-10-23 声明同步：共享 `ApiResult` 的失败 requestId 为 `string|null`，成功仍为 string；`JournalEntry` 是不含 ownerId 的客户端投影，和输入、回顾标记一起复用自定义天气判别联合。`npm run typecheck` 检查正常及禁止样例，并纳入本地和 GitHub quality；它只验证声明，不取代运行时校验、云端实测或成员共同评审。

## 已固定的记录输入

journal.upsert 的 payload 只允许 date、weather、weatherName、tags、text、expectedVersion。日期必须真实；天气和标签按共享白名单校验；正文按码点计数，允许为空。新建 expectedVersion:0，编辑传当前版本；tags/text 缺省为空数组/空字符串。

2026-10-22天气扩展：晴天SUNNY、多云PARTLY_CLOUDY、阴天CLOUDY、雨天RAINY、雷雨STORMY、台风TYPHOON、自定义CUSTOM。风雨、雷雨和原暴雨占位合为STORMY，不增加HEAVY_RAIN编码，不修改既有STORMY记录。CUSTOM必须提供weatherName：去除首尾空白后1—20个Unicode码点、单行，不接受控制字符；其他天气不接受weatherName。标签/正文仍可留空。

例如：`{"date":"2026-10-22","weather":"CUSTOM","weatherName":"雨后彩虹😀","expectedVersion":0}`。get及保存结果的entry保留名称；私人月历、档案和时间线标记在CUSTOM时增加weatherName，继续排除正文/标签/身份。分布固定返回七类，自定义名称归入CUSTOM计数，不为每个名字新增类别。删除墓碑、删除账本和回执不保留名称；导出JSON保留名称，Markdown按文本转义。详见[实现与兼容边界](week2/xiang-hong/weather-options-20261022.md)。

接口版本仍为1，旧五类请求字段和存储无需改写；旧客户端无法识别新增编码，实际启用前须统一前后端版本，不能先向旧客户端写入新类别。正式入口的身份/存储门禁仍保留，本次没有云端部署。

创建成功的最终类型仍需评审；ownerId 由服务器写入，不作为客户端输入或公共投影。服务端必须区分新建30天窗口与旧记录编辑，并用原子唯一/版本规则处理竞争。正式入口仍只执行校验并返回未实现；2026-10-18 的显式注入候选已实现本地版本、去重及删除闭环，尚未完成真实数据库验收，见 [候选说明](local-journal-backend.md)。

## 校园资料接口（第二周显式候选）

第二周把 `campus.*` 从占位推进到显式候选，并为运营后台补了五个只读 action；错误枚举同时新增 `NOT_FOUND`。这些兼容增加经[PR #72整合审查](reviews/2026-10-28-pr72-integration.md)，只可由服务端`createCampusBackend(cloud)`注入；默认`index.js`不连接仓库。真实云端、资料核验与Web身份未完成，不能宣称后台可真实运营。

### 公开接口

| action                    | payload                                           | 结果                                            |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `campus.listPlaces`       | `campus`、`tags`、`openState`、`page`、`pageSize` | `{items,page,pageSize,total,hasMore,truncated}` |
| `campus.getPlace`         | `placeId`                                         | 地点详情                                        |
| `campus.supportResources` | 无参数；传任何字段即 `INVALID_INPUT`              | `{items,total,emptyState,truncated}`            |
| `campus.weatherPreview`   | 无参数                                            | 固定模拟说明，未变                              |

- 分页：`page` 从 1 起，`pageSize` 为 1—20，默认 10；越界返回 `INVALID_INPUT`。
- `tags` 为「任一命中」筛选（最多5个，每个1—40个Unicode码点、不含控制字符）；缺省或空数组表示不筛选，兼容既有中文标签。`campus` 精确匹配；`openState` 取 `OPEN`、`CLOSED`、`LIMITED`、`UNKNOWN`。
- 排序固定为 `campus`、`name`、`placeId` 三级，保证翻页稳定。
- 空结果返回 `items: []`、`total: 0` 且 `ok: true`，不是错误。
- `truncated: true` 表示单次读取达到上限，结果可能不完整，客户端不得当作全量。

### 公开可见规则

只有同时满足以下条件的资料才进入公开列表：`enabled === true`、`isSynthetic === false`（必须显式标记为真实）、`source` 非空白、`verifiedAt` 可解析且不晚于服务器当前时间、`validUntil` 未过期。`verificationState` 取值为 `verified`、`expiring`（14 天内到期，仍可发布）、`expired`、`unverified`、`synthetic`、`disabled`。

- 合成、未核验或已停用的资料对公开接口一律按 `NOT_FOUND` 处理，不返回半条记录。
- 过期资料仍可 `getPlace`，但标记 `stale: true`，且不再返回 `contact` 与 `location`，避免把过期联系方式发给学生。
- 公开摘要只含 `placeId`、`name`、`campus`、`tags`、`openState`、`openHours`、`address`、`accessible`、`verificationState`及公开溯源字段`source`、`verifiedAt`、`validUntil`；`_id`、`verifiedBy`、`isSynthetic` 等维护字段不对外，摘要也不含联系方式。
- `supportResources` 无已核验资料时返回空态 `emptyState.code = NO_VERIFIED_RESOURCE`，不填占位联系方式。

学生service将地点详情包装为既有页面所需`{place}`，将`tags`、开放状态、核验状态和ISO时间适配为既有页面字段与北京时间业务日期。支持资源增加`description`、`verificationState`及`verifiedAt`公开投影，service从原描述或原分类/时间/联系方式构建展示，不编造资源。没有`verificationState`的既有页面形状保持兼容；经纬度不等于坐标系已核验，适配层不开放导航。任何`truncated:true`均作为不完整响应拒绝。

### 收藏（`campus.favorites`，private）

以下为显式候选协议，学生`privateActionsReady`仍为false；正式启用前还需接入请求回执、停用竞争、导出失效和完整注销清理，并验证真实唯一索引。仅构造该工厂不代表这些生命周期条件已完成。

| operation | payload            | 结果                                                                  |
| --------- | ------------------ | --------------------------------------------------------------------- |
| `list`    | `page`、`pageSize` | `{items,page,pageSize,total,hasMore,availableCount,unavailableCount}` |
| `add`     | `placeId`          | `{favorite:{placeId,createdAt},duplicated}`                           |
| `remove`  | `placeId`          | `{placeId,removed}`                                                   |

- 归属只取服务端 `accountId`；payload 带 `ownerId`、`role` 等身份字段在路由层即被拒（`INVALID_REQUEST`）。
- `add` 以 `favorites` 唯一键 `[ownerId, placeId]` 为保证，重复收藏返回 `duplicated: true` 而非错误；`remove` 幂等，重复取消返回 `removed: false`。
- 只能收藏公开可见的地点。地点之后被停用或过期时，收藏仍保留在列表里但为 `available: false`、`place: null`，并计入 `unavailableCount`，学生仍可取消。

### 纠错（`campus.correctPlace`，private）

- payload 为 `placeId` 与 `text`；`text` 按 Unicode 码点计 1—200，空串或超长返回 `INVALID_INPUT`。
- 写入 `place_corrections`，`status: 'pending'`，`ownerId` 取服务端账号；响应固定 `published: false`，纠错内容不进任何公开接口。

### 运营读取与地点维护（operator）

新增 `admin.listPlaces`、`admin.getPlace`、`admin.listCorrections`、`admin.listTaskTemplates`、`admin.listSupportResources`，全部只读。原因是 15 个集合对客户端全部关闭读写，缺少读取入口时后台保存后无法确认写入结果，也不能查看待审纠错。

- 运营列表可见未核验、合成与停用资料，并返回 `verificationState` 说明原因；筛选支持 `campus`、`enabled`、`verificationState`。
- `admin.updatePlace` 的 `changes` 只接受 `name`、`campus`、`tags`、`openState`、`openHours`、`address`、`contact`、`accessible`、`location`、`source`、`validUntil`、`enabled`、`isSynthetic`。`verifiedAt`、`verifiedBy`、`updatedAt`、`updatedBy` 由服务端按可信账号与服务器时间盖章，客户端传入即 `INVALID_INPUT`。
- `markVerified: true` 写入核验人与核验时间，但要求存在可追溯 `source`，否则 `INVALID_INPUT`。
- `expectedUpdatedAt`在事务内对当前行校验，每次SDK重试重新读取并生成变更；不一致返回`CONFLICT`且不写入。客户端应回传所读版本，省略时只有事务串行保护，不提供旧页面版本检查。`updatedAt`严格递增，同毫秒也产生新版本；写入要求恰好一行。提交后逐字段读回核对，`saved`表示已提交，`verified`表示读回与本次变更一致，读回未确认不能当作保存已验证。
- `admin.reviewCorrection`、`admin.updateTaskTemplate`、`admin.updateSupportResource` 仍为 `NOT_IMPLEMENTED`，不返回假保存。
- 角色门禁仍只在 `router.js` 执行：停用账号返回 `ACCOUNT_DISABLED`，无 `data_operator` 授权返回 `FORBIDDEN`，客户端传入的 `role` 不参与判定。

## 预留接口与访问范围

| 模块    | action                                                                         | 访问                              |
| ------- | ------------------------------------------------------------------------------ | --------------------------------- |
| system  | health                                                                         | public，已实现健康响应            |
| journal | upsert、get、delete                                                            | private                           |
| review  | calendar、distribution、timeline、monthArchive、decorations                    | private                           |
| campus  | listPlaces、getPlace、supportResources                                         | public，显式候选，默认未启用      |
| campus  | favorites、correctPlace                                                        | private，显式候选，客户端仍关闭   |
| campus  | weatherPreview                                                                 | public，已实现固定模拟说明        |
| tasks   | suggestions、quickChoice                                                       | public                            |
| tasks   | transition、history                                                            | private                           |
| account | preferences、requestExport、exportStatus、downloadExport、close                | private                           |
| account | cleanupStatus                                                                  | receipt，只允许进度查询           |
| admin   | listPlaces、getPlace、listCorrections、listTaskTemplates、listSupportResources | operator，第二周新增的只读入口    |
| admin   | updatePlace、reviewCorrection、updateTaskTemplate、updateSupportResource       | operator（仅 updatePlace 已实现） |

完整 action 为“模块.名称”，如 review.calendar。除 journal.upsert 和已实现响应之外，业务 payload 与结果是待确认约定，尚未提供完整实现。前端 service 中的 date/month/windowDays/placeId/jobId 等为联调起点；后端开工前由双方在同一个接口 PR 中明确字段、空态、分页、版本、幂等与错误并补校验，不能单边改名。

favorites、preferences、decorations 等复合入口的默认正式接线仍关闭；其显式候选按各自文档约定operation，不能因默认关闭而判作没有实现。后续启用时同步客户端、注册表、生命周期和文档。未实现接口不会返回假业务数据。

## 身份门禁与变更

- public 只可返回经核验公开资料或固定模拟说明。
- private 使用可信 OPENID 查询内部 active 账号，操作自己的数据；停用状态先拒绝。
- operator 除 active 账号外还需服务端 data_operator 角色，只可维护校园资料。
- receipt 只能从受限回执解析 cleanup_status 权限，不能导出、恢复或读取日记。

错误枚举统一使用 shared/contracts.js。新增字段、action 或错误更新同一注册表和消费者；兼容增加通常不改 API_VERSION，删除/改义需版本迁移计划，不能直接破坏已合并功能。访问策略只能在接口 PR 中评审变更，不能为了演示临时跳过身份门禁。

## 实现负责人和交接

| 范围                                                                             | 主责                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------- |
| journal、review及公共路由约定                                                    | Xiang Hong；业务字段由模块负责人实现      |
| campus、admin资料业务与运营角色查询                                              | Junhan Huang                              |
| tasks、account.preferences、account.close、account.cleanupStatus及小程序账号解析 | Jiawei Fang                               |
| account.requestExport、exportStatus、downloadExport与清理/到期执行               | Xiang Yu；Jiawei提供共用账号门禁          |
| Web可信身份接入                                                                  | Qizhen Chen；Xiang Hong和Junhan Huang复核 |
| 学生端调用与最终装配                                                             | Linghan Chen；各前端负责自己的模块service |

account.js后续按接口入口和执行模块拆分。Xiang Yu组织导出与清理，各业务负责人提供本人数据查询、导出失效和可重复清理能力；Jiawei先停用账号再发起清理，并校验受限进度回执；Linghan处理客户端缓存；Qizhen Cai验收完整流程。

现有入口仍只有微信身份路径。Web登录接入须先验证平台可信身份来源，再查询内部账号和运营角色，不能从payload接收uid或角色作为授权依据。后台仅开放规定资料业务，不能读取私人数据；Web适配的字段、SDK和入口在第一周接口PR中明确。
