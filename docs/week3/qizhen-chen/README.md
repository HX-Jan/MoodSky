# Qizhen Chen 第三周交付候选与待验条件

2026-10-29，按 `MoodSky_第三周详细任务计划_20261025.docx` 及[计划快照](../detailed-plan.md)执行 W3 QC01—QC05，承接 W2 QC01—QC05 / [Issue #38](https://github.com/HX-Jan/MoodSky/issues/38)。本周跟踪 [Issue #75](https://github.com/HX-Jan/MoodSky/issues/75)，涉及 UW3-F17—F20 及后台资料维护/可信身份。本文是本地交审材料，未取得指定同学独立验收，不代填个人工时、难度点或签字。

源码基线 `main ca37471cf44846a7e6bbc60ee1601f10c8a3f7cc`（v0.2.3，含 #72），基线 tree `b89a8095599c5427fc5c6bcbb42e3986ff02444b`。分支 `feature/w3-qizhen-chen-tasks-admin`；本次原交审完整提交 SHA 记录在对应 PR 正文，后续修订以 PR 提交列表追踪。环境为 macOS arm64、Node.js 24.18.0；浏览器为隔离的 Microsoft Edge 156.0.4314.50。测试传输、身份和地点均为本地合成数据，没有云部署、真实写库、真实微信 OAuth 或真机操作。

## 五项交付与复核

| 任务 / 承接 W2 | 本次可核对成果                                                                                                                                                                      | 预期与实际                                                                                                                       | 状态 / 指定协作与待验                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| QC01 / QC01    | [任务页面](../../../miniprogram/pages/tasks/index.wxml)、[控制器](../../../miniprogram/modules/tasks/cloud.js)、[页面到真实 service 测试](../../../tests/tasks-integration.test.js) | 游客/有效合成会话均验证 0/3 条建议、空态与轻选择；`readOnly:true` 时隐藏四种写操作和历史入口，伪造事件也不发 transition/history  | 本地通过，待 Jiawei Fang、Yuen Lin 独立复核；公开读取不表示私人状态可用                                     |
| QC02 / QC02    | 下表逐项登记状态规则缺口；延续只读与原有异常保护                                                                                                                                    | JF02 尚无双方共同认可的最终状态表；本次不推断转换成功，不把已存在的受限私人 pilot 扩为正式能力                                   | 阻塞：Jiawei Fang、Qizhen Chen、Xiang Hong 共定状态/幂等/跨日历史，再接后端；Yuen 回归                      |
| QC03 / QC03    | 固定 SDK 3.4.8；[会话边界](../../../admin/session-boundary.js)、[身份适配](../../../admin/auth.js)、[专项回归](../../../tests/admin-places.test.js)                                 | SDK 过期/无效替身、普通账号、停用账号、缺失内部映射、伪造角色和迟到响应均拒绝；没有把浏览器 role/owner 放入业务授权              | 本地通过；真实 Web 身份验证阻塞，缺平台配置及 Web UID→内部账号适配；Jiawei/Junhan 联调，Qizhen Cai 独立复核 |
| QC04 / QC04    | [地点维护页](../../../admin/places.html) → [页面接线](../../../admin/places-app.js) → [控制器](../../../admin/places.js) → 既有 `admin.*` 服务                                      | 列表/详情/编辑/保存/再读；FORBIDDEN、NOT_IMPLEMENTED、网络、冲突、保存未核实均无成功提示且保留草稿；保存明确确认并重读一致才成功 | 完成本地首链路，真实接通受 QC03/JH03 阻塞；Junhan 复核；其余三表单按下表保持未接通                          |
| QC05 / QC05    | [验证结果](verification.json)、[浏览器重放工具](../../../tools/week3-qc/browser-smoke.cjs)、[本周台账](../task-intake.csv)和本页交接                                                | 完整仓库回归及本地浏览器验证；沿用 Today/Me/轻选择入口和四主标签；保留 W2 欠缺协作意见                                           | 本人交审候选；待 Linghan 核路由、Yuen 回归、Qizhen Cai 独立核权限。PR 合入不视为个人验收                    |

## 来源与取舍

- [#40](https://github.com/HX-Jan/MoodSky/pull/40) 的第二周交付经 [#42](https://github.com/HX-Jan/MoodSky/pull/42) 整合；原报告、520 项成绩和签认缺口原样保留。本次只在现行源码上做增量，未从第二周副本整包覆盖。
- 复用 [#44](https://github.com/HX-Jan/MoodSky/pull/44)、[#45](https://github.com/HX-Jan/MoodSky/pull/45) 的公开建议/轻选择候选和 `readOnly` 能力；补齐计划要求的“只读下不显示写操作”及历史事件保护。原有 demo、受限私人 pilot 和七天气（已含 CUSTOM）保持。
- 复用 [#72](https://github.com/HX-Jan/MoodSky/pull/72) 已整合的 Junhan 地点业务、服务端角色和事务版本检查。客户端不新增 action、数据集合或客户端身份字段。`auth.js` 只接纳注册表已有的五个后台读取 action。
- 2026-10-29 两次核对 main 均为上述基线；开放 [#74](https://github.com/HX-Jan/MoodSky/pull/74) 为 Phoenix-Yx 的导出/文件清理候选（head `796d47b675e5426f67a2ef55fe6489bb36016761`），本次未整合或改变其审查状态。发布前再次核对远端。

## QC01/QC02：公开读取与私人状态分开验收

实际调用链为 `pages/tasks/index.js → modules/tasks/cloud.js → modules/tasks/service.js → services/api.js → candidate-router → tools/week2-integration/services/task-suggestions.js`。只有服务端显式组装候选才提供公开读取，默认生产入口仍可能返回 NOT_IMPLEMENTED，页面不会补合成内容。公开请求 payload 为空，不携带日记或身份；建议上限 3，超量/重复/非法返回由既有候选整次拒绝。轻选择“浏览小任务”重读建议；没有声称能写私人任务。Today → tasks、Me → `tasks?view=history` 的路由沿用现有实现；未接通的私人历史给出不可用提示。

| 能力     | 当前正式公共路径 / 本次处置                            | 仍需共同确认                     |
| -------- | ------------------------------------------------------ | -------------------------------- |
| 选择     | 只读时隐藏且不派发；不在客户端提前标记 selected        | 可选源状态、业务日归属           |
| 完成     | 隐藏且不派发；没有先显示完成                           | 是否允许无选择直接完成、终态规则 |
| 替换     | 隐藏且不派发；不擅自选择下一模板                       | 是否自动选新模板、旧模板终态     |
| 跳过     | 隐藏且不派发；不丢弃选择                               | 跳过后能否重选、终态规则         |
| 重复请求 | 公共只读不产生写入；原有私人 pilot 的回执/重试保护保留 | 正式服务的回执保留期与一致性     |
| 跨日历史 | 公共只读能力不调用 history；受限 pilot 仍按原门禁      | 分页、窗口、时区、删除后不恢复   |

以上是 Qizhen Chen 的接线取舍，不是双方认可的最终状态表。JF02 草案与原界面在“直接完成、替换自动选新、终态重选”等处仍有差异。现行私人 pilot 已有事务状态和回执测试，不据此宣称通用正式任务处理器已接通，也不删除已有能力。

## QC03：真实 Web 路径阻塞条件

SDK 登录方式沿用 `signInWithOAuth({provider:'wechat'})`、手动 `verifyOAuth()`、`getSession()`、`signOut()`，SDK bundle 本地构建，不自行保存或解析令牌授权。新增会话边界只把 SDK user ID 用作内存中隔离旧界面的会话代次；其值、token、角色和 owner 不放入请求。SDK SIGNED_OUT/SIGNED_IN/USER_UPDATED 清除旧资料，每次操作前复查 SDK 会话；迟到读/写结果不得回填另一账号。页面隐藏时清空可见资料，原草稿和未确认写入只暂存当前身份内存，返回时重新核验。

当前 Junhan 后端依赖云函数可信上下文 OPENID → 内部 active 账号 → 服务端 `operator_roles`。Web SDK 会话 UID 不能由浏览器转写成这个可信 OPENID。仍缺：目标 CloudBase 环境/身份源、允许域名及 OAuth 回调、平台对 Web 调用凭证的校验方式和服务器可信 UID 映射、测试运营/普通/停用账号及独立复核。未尝试在客户端补 uid/role 来解锁，也未将本地 SDK 替身视为真实 token 验证。

`admin/config.example.js` 的 `placeMaintenanceEnabled:false` 默认关闭。此开关仅表示客户端接线准备程度，不能授予运营权限。真实环境需先满足上述条件；每次调用仍须由服务端核角色。配置说明见[真实环境准备](../../../admin/REAL-CLOUDBASE-SETUP.md)。

## QC04：地点链路和失败语义

入口 `admin/index.html` 的地点页链接到 `admin/places.html`。可按校区分页，详情显示资料分类、来源、有效期和 `updatedAt` 版本；只提交约定字段的 diff，加上 `placeId/expectedUpdatedAt/markVerified`。服务端写核验人、时间和更新人；界面不能填写这些字段。缺少版本只读，旧版本由服务端冲突保护。维护页未提供坐标/联系信息/合成标记的编辑，既有值不会被覆盖或自动核实。

成功要求 update 回应 `saved:true/verified:true`、返回目标地点及新版本/字段一致，然后再次 `getPlace` 核对同一版本和修改值。网络失败或不兼容回包可能发生在写入之后，此时保留草稿并锁定继续写；“重新读取核对”只读，不自动重发 update。未知结果即使新读到的值相同也不冒认本次保存成功；操作人可检查显示的当前存储值，并明确“放弃草稿并重新读取”后再修改。重新读取失败仍保留锁定。

FORBIDDEN、NOT_IMPLEMENTED、INVALID_INPUT、CONFLICT 保留草稿并显示错误；登录失效、账号停用、切换账号时出于会话隔离清除旧资料和草稿，重新登录后读取。退出失败仍关闭当前界面并提示重试 SDK 退出。后台不直接读数据库或学生私人集合。

| 资料     | 当前服务端读取（#72 候选）          | 当前服务端写入                                | 本次界面实际状态                                             |
| -------- | ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| 地点     | `admin.listPlaces/getPlace`         | `admin.updatePlace` 已实现并在服务端重读      | 新独立维护页可在显式接线下调用；默认开关关闭；旧表单仍仅模拟 |
| 任务模板 | `admin.listTaskTemplates` 已实现    | `admin.updateTaskTemplate` NOT_IMPLEMENTED    | 旧表单仅模拟，真实提交关闭                                   |
| 支持资源 | `admin.listSupportResources` 已实现 | `admin.updateSupportResource` NOT_IMPLEMENTED | 旧表单仅模拟，真实提交关闭                                   |
| 纠错队列 | `admin.listCorrections` 已实现      | `admin.reviewCorrection` NOT_IMPLEMENTED      | 旧表单仅模拟，真实提交关闭                                   |

这些处理器的生产入口尚未组装；“已实现”不等于已部署或可被 Web 调用。其余三类不使用地点成功结果代替验收。

## 本地验证与可复现入口

实际命令、数量和范围见[验证结果](verification.json)：896 项测试零失败；SDK 构建、云包检查和三个依赖的 high 阈值审计通过。后台 SDK 审计为 0，云函数与 h03 探针各有既有 qs 中等风险 GHSA-6pq8-jhm2-2vcw，锁文件未在本次改动。配置镜像不支持 audit API，因此显式使用 npm 官方接口。首轮有 5 项打包/基准测试因归档源码缺 Git 元数据失败，另有 1 项预发布路径检查受 macOS `/var` 别名影响。恢复与 GitHub 完全相同的 tree/commit，并用 `TMPDIR=/private/tmp` 的真实临时目录运行后，896 项全部通过；未修改断言或打包规则。浏览器首轮等待会话就绪时发生超时，重放工具改为等待 SDK 会话确认后开始操作，最终结果按 JSON 记录。

```sh
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm ci --prefix admin --ignore-scripts
npm run build --prefix admin
npm run cloud:prepare
TMPDIR=/private/tmp npm run check
node scripts/check-cloud.js
```

专项测试：`node --test tests/admin-places.test.js tests/tasks-integration.test.js tests/task-suggestions-candidate.test.js tests/admin-sdk.test.js tests/admin-campus.test.js`。覆盖实际页面/服务/路由和内存仓储；16 项新增后台测试及 1 项新增任务页面测试，并扩充原只读页面用例。原有测试均保留。

可选浏览器重放需自行安装 Playwright（仓库不新增生产依赖），使用已有 Chromium 或明确指定本地浏览器：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
BROWSER_EXECUTABLE_PATH=/absolute/path/to/chromium \
node tools/week3-qc/browser-smoke.cjs
```

工具仅监听 127.0.0.1；自动注入合成 SDK 会话与本地真实 router/内存仓储，阻断外部请求，不加载个人浏览器资料或调用真实云。实际 HTML/CSS/JS 验证 9 项，包含保存/重读、失败保留、角色拒绝、未知写入不重复、显式重读、会话失效、默认门禁和 390px 布局。微信 WXML 仅验证实际 Page 逻辑和模板可见性条件，未运行微信模拟器或真机；本地浏览器截图不是手机验收。

## W2 接续与协作意见

本轮本人确认：接受 #44/#45 的 `readOnly:true` 公共读取边界，前端补隐藏控件与历史事件保护；接受 #72 的读取、版本和保存重读结构，按实际字段接线；保留 W2 #38 的正式状态/身份/独立验收缺口。本人提供这些技术接线答复不等于人类成员个人签认。

| 需要回传的意见                         | 当前实际记录 / 下一步                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Jiawei：JF02 状态与历史                | 本轮未收到共同定稿或正式通用后端交接，按只读继续；需对上表六能力逐项答复         |
| Junhan：JH03/QC03                      | #72 已有后端候选和测试，客户端已复用；仍需本人复核新页面失败/成功和真实 Web 映射 |
| Linghan / Yifan / Yuen：任务入口与回归 | 已跑本地路由/轻选择及后台表单回归；未收到本轮独立设备或导航签认                  |
| Xiang Yu / Qizhen Cai：权限与生命周期  | 未收到本轮独立 Web 环境/权限审查，真实配置和停用/过期案例待环境可用后执行        |

工时、难度点、独立结论在台账中保持空白；不修改 W1/W2 的固定 44PR/120任务历史索引。源码交审、合入、部署与个人验收分别记录。

## 后续补充

2026-10-29在#76合入后，补交[QC01/QC05微信模拟器验证](simulator-20261029.md)。该独立增补使用新基线，以上原交审报告及未执行清单按原时点保留。
