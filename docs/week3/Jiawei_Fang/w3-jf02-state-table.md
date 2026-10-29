# W3 JF02 任务状态转换分歧定稿与公开/私人文隔离

| 项目     | 内容                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 任务编号 | W3 JF02                                                                                                                      |
| 承接     | W2 JF02《任务状态机、建议与历史》([文档](../../week2/Jiawei_Fang/w2-jf02-task-state-machine.md))                             |
| 关联需求 | UW3-F17（任务建议）、UW3-F18（状态转换）、UW3-F19（任务历史）、UW3-F20（轻选择）；本周两文档合计 UW3-F17/F18/F19/F21/F22/F23 |
| 负责人   | Jiawei Fang                                                                                                                  |
| 协作人   | Qizhen Chen（任务前端状态与字段）、Yuen Lin（回归）、Xiang Yu（导出侧任务历史字段）                                          |
| 复核人   | Yuen、Qizhen Cai                                                                                                             |
| 版本     | 0.2.3                                                                                                                        |
| 环境     | 本地 Node.js v24.15.0 + 内存 store 替身 + 注入 clock；**真实云 / 数据库 / 回执签名均未执行**                                 |
| 成果路径 | 见 §2                                                                                                                        |
| 实际耗时 | 待本人确认（不由代理代填）                                                                                                   |
| 验收状态 | **待复核**                                                                                                                   |
| 阻塞     | 与 Qizhen Chen 的共同定稿未完成（QC02 仍标阻塞）、真实云未执行、生产入口未装配（打包门禁）                                   |

## 1. 结论先行

- 新增 [tasks-adapters.js](../../../cloudfunctions/moodsky/services/tasks-adapters.js)：把四个任务 action 拆成两条**可被正式调用**的接缝——公开只读走公开服务，私人写入与历史走候选域；接缝之外（含 `tasks.mine`）返回 `NOT_IMPLEMENTED`，未装配的依赖同样返回 `NOT_IMPLEMENTED`，不返回假数据。
- `tasks.history` 的服务端结果 `entries/nextCursor` 是唯一来源；适配器只映射成客户端当前使用的 `items/nextCursor`，不重排、不补字段、不重算游标。域结果缺字段或形状不符时返回 `INVALID_RESPONSE`，不静默丢弃。
- `services/tasks-candidate.js` **本次未修改**：状态机、回执、终态回放沿用 W2 实现，本任务只增加分流与输出适配（见 §2）。
- 状态表见 §4。其中 F1—F9 属**需 Qizhen Chen 前端确认**的开放项（§6）；本文没有把这些草案写成"已共同确认"。

## 2. 成果路径（本任务只动这些文件）

| 文件                                                | 变更 | 说明                                                  |
| --------------------------------------------------- | ---- | ----------------------------------------------------- |
| `cloudfunctions/moodsky/services/tasks-adapters.js` | 新增 | public/private 分流、history 客户端映射、未接能力兜底 |
| `tests/week3-tasks-adapters.test.js`                | 新增 | P01—P17，公开隔离、幂等、终态、跨日、历史分页与形状   |
| `docs/week3/Jiawei_Fang/w3-jf02-state-table.md`     | 新增 | 本文档                                                |

未修改：`services/tasks-candidate.js`、`domains/tasks.js`（保持 `NOT_IMPLEMENTED` stub）、`index.js`、`candidate-router.js`、`shared/`、`miniprogram/`、`stores/tasks-store.js`。

## 3. 分流口径

| 能力             | action              | 访问级别 | 交给谁                                                 | 账号要求                         | 未装配时        |
| ---------------- | ------------------- | -------- | ------------------------------------------------------ | -------------------------------- | --------------- |
| 任务建议         | `tasks.suggestions` | public   | `publicSuggestions`（task-suggestions 形状的只读服务） | 不需要；**不转发 actor**         | NOT_IMPLEMENTED |
| 轻选择           | `tasks.quickChoice` | public   | 同上                                                   | 同上                             | NOT_IMPLEMENTED |
| 状态转换         | `tasks.transition`  | private  | `tasksDomain`（tasks-candidate）                       | active 账号（路由 + 域双重校验） | NOT_IMPLEMENTED |
| 任务历史         | `tasks.history`     | private  | `tasksDomain` + `toClientHistory` 映射                 | 同上                             | NOT_IMPLEMENTED |
| 私人建议混合视图 | `tasks.mine`        | private  | **不在本接缝内**（与 W2 集成工具一致，保持未接线）     | —                                | NOT_IMPLEMENTED |
| 其他 action      | `account.*` 等      | —        | 不属于本模块                                           | —                                | NOT_IMPLEMENTED |

- 公开路径只读公共模板目录：不接收、不转发 actor，因此不可能依赖本人任务行；空目录返回 `items: []` 空态，不补任务。
- 私人路径的停用账号在路由层先被 `ACCOUNT_DISABLED` 拒绝；域内再要求 `actor.accountId`（`UNAUTHENTICATED`），两层都不会写入任何 `task_history` 行。
- `tasks.mine` 是"公共目录 + 私人状态"的混合读；正式客户端当前用公开建议（`state: null`）加独立私有读取，是否把它接入属前端口径（F9）。

## 4. 状态判定矩阵（服务端已实现口径，按上海业务日）

状态来自 `task_history` 中 `ownerId + taskId + date(当日)` 的当天快照；没有行即"无记录"。终态 = `completed / skipped / replaced`。

| 当前状态 | select                           | complete                      | skip                          | replace                                                  |
| -------- | -------------------------------- | ----------------------------- | ----------------------------- | -------------------------------------------------------- |
| 无记录   | `selected`，新增 1 行            | `completed`，新增 1 行        | `skipped`，新增 1 行          | 本任务 `replaced` + 目标 `selected`，新增 2 行           |
| selected | 同目标回放 `replayed:true`，不写 | `completed`，更新本行         | `skipped`，更新本行           | 本行 `replaced` + 目标 `selected`，更新 1 行 + 新增 1 行 |
| 终态     | 同目标回放；否则 **CONFLICT**    | 同目标回放；否则 **CONFLICT** | 同目标回放；否则 **CONFLICT** | 同目标回放；否则 **CONFLICT**                            |

补充判定（均为实测行为，见 P09—P15 与 W2 T01—T22）：

1. **回放不等于重新执行**：同一终态用新 `requestId` 再投，返回 `replayed:true`，不再写行、不再触发一次替换选新。
2. **replace 回放的目标从当日行反推**：当日恰有 1 行 `selected` 时返回该 `taskId`；有 0 行或多行时返回 `replacementTaskId: null`、`replacementState: null`，不编造。
3. **同 requestId 幂等**：payload 摘要为 `[taskId, transition, replacementTaskId]`，不含服务端日期。
   - 同 `requestId` + 同 payload → 返回首次结果 + `replayed:true`（保留首次 `date`）；
   - 同 `requestId` + 异 payload → `CONFLICT`，不按新 payload 执行；
   - 失败（`INVALID_INPUT`/`CONFLICT`）不写回执，重试可重新计算；
   - 回执当前**无 TTL**（F7）。
4. **跨日重置**：状态按业务日隔离；跨日后同一 `taskId` 视为无记录，可重新 `select`，前一日行保留在历史中。同一 `requestId` 跨零点重试仍返回首次的商业日期。
5. **replace 目标缺失的四种情形**：
   - 未指定 `replacementTaskId` 且没有"今日无记录"的其它启用模板 → `CONFLICT`（不写）；
   - 显式目标不存在或已停用 → `INVALID_INPUT`；
   - 显式目标等于当前任务 → `INVALID_INPUT`；
   - 显式目标当日已有记录 → `CONFLICT`；
   - 非 replace 操作携带 `replacementTaskId` → `INVALID_INPUT`。
6. **日期与证据边界**：`date` 只能由服务端 `businessDate(clock())` 决定；payload 携带 `date`、照片、定位或证据字段 → `INVALID_INPUT`；身份字段在路由层 → `INVALID_REQUEST`。

## 5. 公开 / 私人隔离的实测点

| 验证点                                 | 断言位置 | 结果                                                                             |
| -------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| 公开建议不读私人 store                 | P01      | 私人 store 任一方法被调用即抛错，用例通过                                        |
| 轻选择不列目录、不含私人 state         | P02      | 只返回公开入口与提示                                                             |
| 空目录是空态，不合成任务               | P03      | `items: []`                                                                      |
| 公开路径不接收 actor、拒绝私人筛选字段 | P04      | 转发请求只有 `{action, payload}`；拒绝来自注入的公开服务（适配器本身不额外过滤） |
| 未装配公开服务                         | P05      | `NOT_IMPLEMENTED`                                                                |
| 未装配私人域                           | P06      | `NOT_IMPLEMENTED`                                                                |
| 接缝外 action（含 `tasks.mine`）       | P07      | `NOT_IMPLEMENTED`，私人 store 零调用                                             |
| private 需 active 账号                 | P08      | `UNAUTHENTICATED` / `ACCOUNT_DISABLED`，无行写入                                 |
| history 只返回本人、只含客户端四个字段 | P13      | 不含 `ownerId`，不含他人数据                                                     |
| history 游标可与服务端形状互操作       | P14      | 3 页、5 行各出现一次                                                             |
| 域结果不完整（缺字段/游标类型错）      | P16      | `INVALID_RESPONSE`，不重塑                                                       |

## 6. 需 Qizhen Chen 前端确认的开放项（不得视为已确认）

| 编号 | 分歧点                                           | 服务端当前口径                              | 需确认内容                                              | 状态   |
| ---- | ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------- | ------ |
| F1   | 未选择是否允许直接"完成"                         | 允许（无记录 + complete 合法）              | 前端是否显示"直接完成"，还是必须先选择                  | 未确认 |
| F2   | replace 未指定目标时由服务端自动选新模板         | 允许，并在响应返回 `replacementTaskId`      | 界面是否直接展示服务端选中的新任务（QC02 反对前端自选） | 未确认 |
| F3   | 终态后能否"重新选择"（当天再做一次）             | `CONFLICT`                                  | 与"当天可再做"的产品口径是否冲突                        | 未确认 |
| F4   | skip 后能否改主意再 select                       | `CONFLICT`                                  | 是否允许，或需要"撤销"这类新能力                        | 未确认 |
| F5   | 同日多次转换只保留 1 行（无中间审计）            | 一行/天，保留首次 `createdAt`               | 是否需要展示当日多次操作记录                            | 未确认 |
| F6   | history 排序、窗口（90 天）、`limit` 1—50        | 已实现（`createdAt` 降序 + `_id` 降序游标） | 前端分页/滚动加载与跨时区展示口径                       | 未确认 |
| F7   | 任务回执保留期                                   | 无 TTL                                      | 保留期与重复点击语义                                    | 未确认 |
| F8   | 状态值命名 `selected/completed/skipped/replaced` | 已实现                                      | 前端展示文案与禁用态映射                                | 未确认 |
| F9   | `tasks.mine` 是否进入正式客户端                  | 本接缝返回 `NOT_IMPLEMENTED`                | 用公开建议 + 独立私有读取，还是新增混合接口             | 未确认 |

## 7. 测试与真实命令输出

```sh
node --test tests/week3-tasks-adapters.test.js
```

```text
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

原有的 W2 任务用例（`tests/week2-tasks-suggestions.test.js`、`week2-tasks-transition.test.js`、`week2-tasks-history.test.js`）未修改断言，仍随完整检查通过；本任务未放宽任何断言。

完整仓库检查（含 lint、format、结构、文档、类型与全部测试）的真实结果见 `npm run check` 输出，记录在本文末尾 §9。

## 8. 未定稿差异与阻塞

- **未取得共同定稿**：QC02 仍把"任务状态规则共同定稿"标为阻塞；本文提交的是**服务端实现口径 + 待确认清单**，不是双方签字版。
- 真实云、真实数据库、回执签名密钥均不可用，全部结论来自本地替身；不据此宣称云端可用。
- 生产入口未装配：`index.js` 与 `domains/tasks.js` 保持原样，正式 `tasks` 仍返回 `NOT_IMPLEMENTED`；本模块只作为可被正式调用的候选接缝。
- `task_history` 仍无唯一键，并发双写风险沿用 W2（等待 Xiang Yu 的数据库决定）。
- 实际工时、难度点与独立验收意见属本人/复核人填写范围，代理不代填。

## 9. 完整检查命令输出（追加记录）

```text
> moodsky@0.2.3 check
> npm run lint && npm run format:check && npm run structure:check && npm run docs:check && npm run typecheck && npm test

> moodsky@0.2.3 lint
> eslint .

> moodsky@0.2.3 format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!

> moodsky@0.2.3 structure:check
> node scripts/check-structure.js
Structure, 24 requirement IDs, shared contract copy and client access policy passed.

> moodsky@0.2.3 docs:check
> node scripts/check-docs.js
16 maintained documents / 293 local links passed.

> moodsky@0.2.3 typecheck
> tsc --noEmit --strict --skipLibCheck false --lib es2020 --module commonjs tools/week1-contracts/type-assertions.ts

> moodsky@0.2.3 test
> node --test tests/*.test.js

ℹ tests 995
ℹ suites 0
ℹ pass 995
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
EXIT:0
```

口径说明：最终运行共 995 项 = 基线 924 + 本分支 W3 新增 71 项（JF01 12、JF02 17、JF03 8、JF04 14、JF05 20）。JF02 只负责其中 17 项（P01—P17）；JF05 文档中的 D01—D20 属另一任务，两者合计 37 项，不互相计入。未放宽任何既有断言。
