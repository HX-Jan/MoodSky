# 接口约定 v1

执行职责更新于2026-10-12，接口版本仍为1。业务payload、结果及身份适配仍需按下文补齐，职责调整不代表功能实现。

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
  "data": { "app": "MoodSky", "version": "0.1.0", "stage": "foundation" }
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

## 预留接口与访问范围

| 模块    | action                                                                   | 访问                       |
| ------- | ------------------------------------------------------------------------ | -------------------------- |
| system  | health                                                                   | public，已实现健康响应     |
| journal | upsert、get、delete                                                      | private                    |
| review  | calendar、distribution、timeline、monthArchive、decorations              | private                    |
| campus  | listPlaces、getPlace、supportResources                                   | public                     |
| campus  | favorites、correctPlace                                                  | private                    |
| campus  | weatherPreview                                                           | public，已实现固定模拟说明 |
| tasks   | suggestions、quickChoice                                                 | public                     |
| tasks   | transition、history                                                      | private                    |
| account | preferences、requestExport、exportStatus、downloadExport、close          | private                    |
| account | cleanupStatus                                                            | receipt，只允许进度查询    |
| admin   | updatePlace、reviewCorrection、updateTaskTemplate、updateSupportResource | operator                   |

完整 action 为“模块.名称”，如 review.calendar。除 journal.upsert 和已实现响应之外，业务 payload 与结果是待确认约定，尚未提供完整实现。前端 service 中的 date/month/windowDays/placeId/jobId 等为联调起点；后端开工前由双方在同一个接口 PR 中明确字段、空态、分页、版本、幂等与错误并补校验，不能单边改名。

favorites、preferences、decorations 等复合入口目前仅预留；实现前明确读写 operation 或拆成独立 action，并同步客户端、注册表和文档。未实现接口不会返回假业务数据。

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
