# W4 JF04 偏好与 Me 页面联调

| 项目     | 内容                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| 任务编号 | W4 JF04                                                                                                              |
| 承接     | W3 JF03                                                                                                              |
| 负责人   | Jiawei Fang（832401110）                                                                                             |
| 复核人   | Qizhen Cai（隔离与失败保留）                                                                                         |
| 环境     | 本地 Node.js v24 + 合成数据库替身；**真实云、真实微信登录未执行**                                                    |
| 结论     | 默认值、白名单、保存后重读、重启后读取均通过合成测试；保存失败会保留用户选择且明确提示“未保存到云端”，不写成保存成功 |

## 1 结论先行

- 默认值来自共享常量 `DEFAULT_PREFERENCES = {cardTextPreview:false, decorationsEnabled:true}`（`miniprogram/shared/constants.js:33`）；未保存过偏好时服务端返回默认值加 `updatedAt:null`，不落库（`services/account-candidate.js:101-114`）。
- 字段白名单有两层：动作层 `account-candidate.js:92-98` 只接受 `operation/cardTextPreview/decorationsEnabled`；本次新增 store 层 `checkedPreferencePatch`（`PREFERENCE_FIELDS` 在 `production/accounts.js:10`，函数在 `:14-29`），未知键、非布尔值或空 patch 一律 `INVALID_INPUT`，不写任何行。
- 保存后重读：生产入口 `set` 返回服务端实际合并结果，随后 `get` 读回同一值；本次 `JF04-W4-01` 在同一个 store 上验证。
- 重启后读取：新入口实例只从 `preferences/pref_<ownerId>` 读回已保存值，不依赖进程内缓存；`JF04-W4-01` 用新入口复读验证。
- 失效会话：控制器把 `UNAUTHENTICATED/ACCOUNT_DISABLED/FORBIDDEN` 视为失效，清空 session 与页面私有状态并展示服务端提示（`miniprogram/modules/account/production.js:125-166`）；`JF04-W4-05` 验证。
- 失败保留选择：保存开始时先把开关切到用户选择并标记 `pendingKind:'preferences'`（`production.js:322-328`）；失败时保留该选择，提示“未保存到云端，已保留你的选择”（`:148-157`），只有经校验的完整服务端回包才提示“偏好已保存到云端”（`:225-229`）。

## 2 五项核对结果

| 项目         | 现状与结论                                                                                                                                                        | 证据                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 默认值       | 通过。无行时返回 `{cardTextPreview:false, decorationsEnabled:true, updatedAt:null}`；页面在 load 前显示 `preferences:{}`，load 后显示默认值                       | `JF04-W4-01`；`P01 a fresh trusted account reads the shared defaults through the client envelope`     |
| 字段白名单   | 通过。动作层拒绝 `nickname`、非布尔值、`get` 带写字段；store 层同样拒绝未知键，`INVALID_INPUT` 且不写行                                                           | `JF04-W4-01`、`JF04-W4-02`；`P04 invalid shapes are rejected before anything is stored`               |
| 保存后重读   | 通过。`set {cardTextPreview:true}` 后 `get` 返回 `cardTextPreview:true, decorationsEnabled:true` 和同一 `updatedAt`；`decorationsEnabled` 单独 set 时保留另一字段 | `JF04-W4-01`；`P02 a partial set persists and the next read echoes the stored value`                  |
| 重启后读取   | 通过。重建 `createProductionEntry` 后 `account.session` + `account.preferences get` 仍读到已保存值；客户端不存在把偏好写入 `wx` 本地缓存的路径                    | `JF04-W4-01`（restart）；`JF04-W4-03`（无本地保存成功路径）                                           |
| 失效会话反馈 | 通过。`ACCOUNT_DISABLED` 等失效错误会清 session、清 `preferences`/`exportJob`，并展示“账号状态已变化，请重新载入。”或服务端错误；不会把旧选择当已保存             | `JF04-W4-05`；`W4 L03 clears private account state and rejects an old response after identity switch` |

## 3 修复点与判据

### 3.1 生产偏好写入白名单（真实缺陷）

- **位置（修复前）**：`cloudfunctions/moodsky/production/accounts.js:78` 直接 `{...DEFAULT_PREFERENCES, ...previous, ...patch}`，`patch` 没有任何字段检查。
- **核对结论**：正常动作路径在 `services/account-candidate.js:94-98` 已先收窄，未知键会 `INVALID_INPUT`，所以通过 `account.preferences` **不可达**任意键写入；但 store 是可信内部接缝，任何未来调用方（或单个调用点被改）都能静默写入任意键，属于真实防御缺口而非纯理论问题。
- **修复**：新增 `PREFERENCE_FIELDS`（`:10`）与 `checkedPreferencePatch`（`:14-29`），在打开事务前校验；`updatePreferences` 只展开校验后的 `fields`（`:90-106`）。
- **错误码**：`INVALID_INPUT`，消息“偏好字段无效，未保存任何更改。”；非法请求不会打开事务，也不会推进 `sourceRevisions`。
- **验证**：`JF04-W4-02 the trusted preference writer rejects unknown keys before writing` 覆盖 `{nickname}`、字符串布尔、夹带 `profile`、空对象、`null`，并断言 `preferences` 行不存在。

### 3.2 客户端失败保留与“本地≠云端成功”（真实缺口）

- **位置（修复前）**：`miniprogram/modules/account/production.js` 保存时不更新 `state.preferences`，失败后 `checked` 仍指向旧值，用户刚选的值被回退；成功分支也不校验回包，任何 `ok:true` 都提示“偏好已保存到云端。”。
- **修复**：
  1. 保存开始时发布用户选择作为**临时预览**（`:322-328`），注释明确“never a local save”；
  2. 失败分支区分偏好与其他操作，提示“`<服务端消息> 偏好未保存到云端，已保留你的选择；请重试原操作。`”（`:148-157`）；
  3. 新增 `checkedPreferenceSave`（`:29-41`），要求回包含两个布尔字段，否则 `INVALID_RESPONSE`，不提示保存成功；校验发生在 `pending = null` 之前，保留原请求可重试（`:225-229`）；
  4. 失效会话仍清空 `preferences`，不保留私有选择（`:156`）。
- **判据**：失败后 `preferences.cardTextPreview === true`（用户选择保留）、`pendingKind === 'preferences'`（可重试）、notice 同时包含“未保存到云端”和“保留你的选择”，且不包含“已保存到云端”。
- **验证**：`JF04-W4-03`、`JF04-W4-04`、`JF04-W4-05`。
- **没有做的事**：没有新增本地缓存写入；`miniprogram/modules/account/week-one.js` 的本地演示缓存仍只服务本地演示账号，与生产控制器无关。

## 4 与 Linghan 页面的请求/返回一致性

页面入口有两条：Me 页在生产视图只提供“账号与数据”跳转，真正的偏好开关在 `pages/account`。逐项对照如下。

| 核对点        | 页面实际行为                                                                                                                          | 服务端接受/返回                                                                                   | 差异与结论                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 读取请求      | `pages/account/index.js:62`：`account.preferences {operation:'get'}`                                                                  | `account-candidate.js:101-114` 要求 `operation:'get'`，禁止带写字段；返回两个布尔值 + `updatedAt` | 一致                                                            |
| 写入请求      | `pages/account/index.js:123-124` → 控制器 `savePreference` → `service.createPreferences({operation:'set',[key]:value})`（`:318-321`） | `account-candidate.js:117-141` 只接受 `operation` 与两个布尔字段                                  | 一致；控制器另外只允许两个 key 且值必须布尔（`:310-317`）       |
| 页面发送字段  | 开关 `data-key` 只有 `cardTextPreview`、`decorationsEnabled`（`pages/account/index.wxml:20-21`）                                      | 白名单恰好是这两个键                                                                              | 无多余字段                                                      |
| 身份字段      | 页面不发送 `ownerId/accountId/openid`；请求构造器会先做共享校验                                                                       | `shared/validation.js:9-14` 保留字段命中即 `INVALID_REQUEST`                                      | 一致；身份只由服务端 `OPENID` 派生                              |
| 返回使用      | 控制器成功时用回包整体替换 `preferences`，失败时保留预览值；页面用 `checked="{{preferences.*}}"` 渲染开关                             | 返回 `{cardTextPreview, decorationsEnabled, updatedAt}`                                           | 一致；页面不展示 `updatedAt`，但保留在 data 中无副作用          |
| 默认值来源    | 页面 load 前 `preferences:{}`，不做本地默认推断                                                                                       | 服务端用共享 `DEFAULT_PREFERENCES` 补默认值                                                       | 一致；页面不再复制一份默认常量                                  |
| Me 页生产视图 | `pages/me/index.js` 生产分支只显示资料与“账号与数据”入口，不渲染偏好开关                                                              | 不适用                                                                                            | **有意分工**：偏好联调落在 `pages/account`；Me 页不重复实现开关 |
| Me 页本地演示 | `pages/me/index.wxml:62-68` 的开关写入 `week-one.js` 本机缓存，页面文案明确“不会同步到云端”                                           | 不调用云端                                                                                        | 一致；不会冒充云端保存                                          |
| 失效会话      | 控制器清 session、清偏好并提示                                                                                                        | 路由对 disabled 返回 `ACCOUNT_DISABLED`，对无账号返回 `UNAUTHENTICATED`                           | 一致                                                            |

**结论**：页面实际发送的字段与服务端接受字段完全一致；没有发现页面发送额外字段或服务端要求额外字段的情况。Me 页与账号页的分工是“Me 只做入口、账号页做偏好”，不是缺字段。

## 5 测试与命令

```sh
node --test tests/week4-jf04-preferences-me.test.js
```

```text
✔ JF04-W4-01 production entry serves defaults, narrows fields, persists and re-reads
✔ JF04-W4-02 the trusted preference writer rejects unknown keys before writing
✔ JF04-W4-03 a failed save keeps the user selection and never claims cloud success
✔ JF04-W4-04 a partial server echo is INVALID_RESPONSE, not a saved preference
✔ JF04-W4-05 an invalidated session clears private choices and reports the server code
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

## 6 未测项与阻塞

| 编号 | 事项                      | 所需输入/提供人            | 恢复条件                                          |
| ---- | ------------------------- | -------------------------- | ------------------------------------------------- |
| P1   | 真实云端保存与重启后读取  | 云环境授权 / Xiang Hong    | 部署候选入口后，用真实账号 set → 重启小程序 → get |
| P2   | 页面真机开关与读屏标签    | Linghan Chen（页面 owner） | 真机走查；本项只做源码与控制器一致性              |
| P3   | 双端并发 set 的最终一致性 | Xiang Yu（事务/存储）      | 真实事务下并发两个字段，确认后写 `updatedAt`      |

## 7 本次改动文件

| 文件                                            | 变更                                   |
| ----------------------------------------------- | -------------------------------------- |
| `cloudfunctions/moodsky/production/accounts.js` | store 层偏好白名单（与 JF01 文档共引） |
| `miniprogram/modules/account/production.js`     | 失败保留选择、回包校验、失败提示       |
| `tests/week4-jf04-preferences-me.test.js`       | 新增 5 项偏好契约与失败保留测试        |
