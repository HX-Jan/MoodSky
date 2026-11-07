# week4/jiawei-fang 独立复审

## 对象与基线

分支 `week4/jiawei-fang` 上未提交的 Jiawei Fang 第四周改动，基线 `origin/main` = `66be660`。范围：JF01/JF04/JF05 的 3 个已跟踪文件改动 + 6 个新增文件（2 个候选模块、4 个测试文件、5 份文档与交付 README）。复审前 Lead 已确认基线 `npm test` 1410 通过、`npm run check` exit 0。

复审为只读：未修改仓库，探针脚本写在 `/tmp`。复审执行者与实现者为同一模型（DeepSeek V4.1 Flash），独立性仅来自独立上下文与独立探针，**相对实现者同模型，属降级复审**。

## 结论

**有条件通过**。旧协议零改动、文档自律良好；候选复合服务有两处接线前必修缺陷。第一轮共 8 条（high 2 / medium 3 / low 3），全部处置后复核：`npm test` 1446 通过 0 失败，`npm run check` exit 0。

## 缺陷与处置

| 编号 | 级别   | 问题                                                             | 处置                                                      |
| ---- | ------ | ---------------------------------------------------------------- | --------------------------------------------------------- |
| 1    | high   | 同日等价去重分支不落 requestId，同 id 换 taskId 会被当新操作执行 | 已修：等价分支写 committed 回执 + digest；换载荷 CONFLICT |
| 2    | high   | pending 意图行无 TTL 且计入终身 500 容量，可永久封死后续合法请求 | 已修：容量只计 committed，pending 独立 50 配额 + 24h 回收 |
| 3    | medium | 「事务内先校验 active」表述过强，实际是独立事务 + router 门      | 已改文档如实描述，未引入跨集合事务                        |
| 4    | medium | 新集合 `task_checkin_links` 缺席清理/导出/集合声明等登记清单     | 候选清理已纳入并补 ownerId 与测试；导出与集合声明仍缺口   |
| 5    | medium | 并发同 requestId 两个响应都报 `created:true`                     | 已修：后者转 `replayView`，数据仍只写 1 行                |
| 6    | low    | capacity 未与 `MAX_LINKS` 取小，>500 可写出被判定无效的文档      | 已修：`Math.min` 钳制                                     |
| 7    | low    | 一处恒真断言；T06 不断言被拒转换未写 task_history                | 已修                                                      |
| 8    | low    | JF04 文档行号漂移 ±3                                             | 已按实际文件校正                                          |

## 八项判定要点

- **协议不变性**：通过。`tasks-candidate.js` 的 `hasOnlyKeys(['taskId','transition','replacementTaskId'])` 与 `checkins.js` 的 payload 单键校验均未被触碰，复合层纯透传，T12 双向钉住载荷与返回结构。
- **幂等与部分失败**：修复后通过。committed 回放严格；等价路径与并发标志已修；pending 不再终身占用容量。
- **事务与一致性**：基本成立。关联文档单事务、无丢更新；停用校验存在跨事务窗口，已在文档写明。
- **同日/跨日去重**：实现自洽，`linkedDate:null` 文档与实现一致且被存储层硬校验。不同 requestId 的同日去重返回首次 `linkedAt` 且 `created:false`，客户端据此区分「刚完成」与「今天早完成」——这一点由 JF02 C2/C5 待共同确认。
- **账号与偏好**：通过。真实链路 `updatePreferences` 唯一调用方已收窄，`operation` 到不了 store，不误拒；客户端不会把失败显示成成功，也不自动重试。
- **清理与导出**：不删他人或公共数据（`ownerPage` + `prepare` 双重 ownerId 校验有测试）；`place_corrections` 与 `task_checkin_links` 的导出缺口已如实标注。
- **测试有效性**：抽查 T01/T05/T12/JF04-W4-03/04 均能真失败；等价路径、并发、被拒转换三类空洞已由 T02/T18/T19/T20 与 T06 补强。
- **文档诚实性**：良好。JF02 明确「提案/未定稿/待共同确认」并列 C1—C11；JF03 §5/§6 合成与真实分列并自曝限制；JF05 自曝纠错缺口。

## 未修与降级

- 停用校验仍是「独立 assertActive + router 门」，未并入写事务；需接线评审决定是否加更强门。
- `capacity` 钳制无专门白盒断言（服务不暴露该写入结果），由 T14 覆盖拒绝路径。
- 等价 committed 回执无 TTL，`requests[]` 随请求累计；属单文档增长点，待确认保留期或拆表。
- `production/cleanup.js`、`database/collections.json`、`domains/export.js` 仍不覆盖 `task_checkin_links`：均在红线内不改，登记为跨人缺口。

## 跨模块提醒

新增持久化集合实际有**四张登记清单**：`database/collections.json`（集合/索引/客户端禁读禁写）、候选与生产两套 cleanup 清单、导出 `SOURCES`、以及清理器依赖的 `ownerId` 字段约定。`place_corrections` 已用同样方式漏在导出侧，`task_checkin_links` 又漏在导出与生产清理侧——建议把「新增集合必须同时登记四张清单」写成接线评审的显式检查项，而不是留给实现者记忆。

其次，`pending` 配额与回执保留期属产品决策（JF02 C9），需 Xiang Hong 拍板，不宜留到接线时补。

## 返修（同日第二轮）

上级评审提出五项，均已处置；本轮工作树 `npm test` 1459 通过 0 失败，`npm run check` exit 0。

| 要求                                                                  | 处置                                                                                                                                                                                                                                      | 证据                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 任务与地点打卡的部分提交（有效任务 + 不存在地点，任务已变「已完成」） | 写前预校验：`findPlace(tx, placeId)` 在请求映射事务内、写 pending 之前按 `classification` 与 `openState` 判定，失败即 `NOT_FOUND`，任务/到访/关联/回执零写入；未注入 `findPlace` 时 `tasks.checkin` 返回 `NOT_IMPLEMENTED`（fail-closed） | T21（复现用例）、T24                                        |
| 明确中途失败与账号停用的恢复                                          | 预校验后仍失败 → `CONFLICT`「任务已完成，打卡尚未确认，请用原请求标识重试」且 `linkStatus=pending`；同 `requestId` 重试补全且任务只完成一次；停用 → `ACCOUNT_DISABLED` 零写入、不自动恢复，关联由清理回收                                 | T22、T25、T23                                               |
| 回归同时检查任务状态、地点打卡、关联回执                              | T17/T21/T22/T23/T25 均对三处同时断言（`task_history` 行数与 state、`campus_checkin_states` visits、`task_checkin_links` 与回执）                                                                                                          | 同上                                                        |
| `task_checkin_links` 纳入清理须一起对齐                               | `database/collections.json`（SOURCE PLAN ONLY + `[ownerId]` 唯一键）、`domains/export.js` 条件键 `taskCheckins`（五个最小字段）、`production/cleanup.js` 与候选清单同步；`production/database.js` 白名单与离线替身允许清单一并登记        | JF05-W4-07、JF05-W4-08                                      |
| 偏好回执核对提交字段与值；异常提示「保存结果尚未确认」；同步主干 #158 | 采用主干 #158 的逐字段/值回执核对；客户端不再在失败时做本地乐观写入（与主干既有测试一致），未确认写入提示「偏好保存结果尚未确认，请重试原操作。」，`retry()` 复用同一请求                                                                 | `tests/production-account-client.test.js`、JF04-W4-03/04/06 |

仍未解决：预校验与打卡二次读取之间的 TOCTOU 窗口（按设计接受，必须失败而非成功）、候选 formatter 未渲染 `taskCheckins`、关联回执 500 条上限与等价回执无 TTL、`place_corrections` 导出缺口、真实云/清理执行器/设备/第二账号未测。
