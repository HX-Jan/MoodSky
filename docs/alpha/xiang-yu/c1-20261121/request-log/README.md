# C1 导出与账号操作脱敏请求日志（local-simulated）

给独立测试人蔡奇真补 C1 的接口级证据：[PR #225](https://github.com/HX-Jan/MoodSky/pull/225) 把“接口级越权回执、服务日志”列为待补项，本目录用合成 A／B 账号跑生产业务入口，记录可复核的请求与响应轨迹。产品源码、接口、数据字典均未改动。

## 先看结论

- A 申请、查询、领取自己的导出：`ready`、`ready`、`delivered`，响应体含 `jobId`／`format`／`content` 等键，正文不入日志。
- B 用 A 的合成 `jobId` 查询或领取：`FORBIDDEN`；不存在的 `jobId` 同样 `FORBIDDEN`，拒绝文案与失效任务一致，不提供“任务是否存在”的探测信号。
- A 注销后查询、领取、新建导出：均 `ACCOUNT_DISABLED`；B 自己的导出仍为 `ready`，停用范围限于本人账号。
- 记录改动后，A 的旧任务转 `expired`，再领取返回 `CONFLICT`。

以上 16 条断言全部一致（见 [expected-vs-actual.csv](expected-vs-actual.csv)）。

## 环境与真实性

| 项目             | 值                                                                 |
| ---------------- | ------------------------------------------------------------------ |
| environmentLabel | `local-simulated`                                                  |
| buildSha         | `011b3c80918c6acb13cb53cbd3b1b222bfdd899e`（完整 40 位，含本工具） |
| 运行时间         | `2026-11-24T10:56:36.044Z`（`run-summary.json.generatedAt`，墙钟） |
| 运行时           | Node `v24.21.0`／win32 x64                                         |
| 调用路径         | Node 进程 → `cloudfunctions/moodsky/production` → WX 形态内存库    |
| 未连接           | 微信云、云函数部署、真实触发器、真实设备、真实账号、真实数据库     |

**这是本地模拟，不是真实云结果。** 日志时间戳来自脚本注入的确定性时钟（`2026-11-24T02:00:00.000Z` 起，每条 +1s），便于逐字节复现；真实墙钟时间只在上表的 `generatedAt`。云函数部署、真实触发器、设备送达、备份残留与恢复仍未验证，引用时请保留 `local-simulated` 标签。

## 复现

```powershell
node tools/alpha-xy/c1-request-log.cjs --out <独立目录>
```

省略 `--out` 时写入本目录。脚本自带自检：字段越界、缺少结果字段、输出含禁止值（openid、账号 ID、原始 jobId、回执 token、正文、收藏名）都会直接失败并以非零码退出。默认读取当前仓库 `.git/HEAD` 作为 `buildSha`，也可用 `--build-sha <40 位 SHA>` 显式指定。

同一 HEAD 连跑两次，`request-log.ndjson` 逐字节一致；重跑时只有 `buildSha` 随当时 HEAD 变化，这是预期差异。本目录内文件的 SHA256 为 `CD8CE553609E6BEFE90E16F1462E20E025C91BB840C195B39F5283732AE589F2`，对应 `buildSha` `011b3c8`；`run-summary.json.generatedAt` 与 `buildSha` 也是每次运行会变的字段。

## 合成数据

| 账号 | journals             | favorites | 说明                                  |
| ---- | -------------------- | --------- | ------------------------------------- |
| A    | 2 条（11-19、11-20） | 1 条      | 记录正文为 `SIMULATED-C1LOG` 合成文本 |
| B    | 1 条（11-18）        | 0         | 与 A 内容不同，用于归属隔离           |

公共地点与任务模板未参与本轮；账号、记录、地点均为脚本内合成标识，真实标识不写入任何交付文件。

## 日志字段与脱敏

| 字段              | 说明                                                               |
| ----------------- | ------------------------------------------------------------------ |
| timestamp         | 注入时钟的 ISO 时间                                                |
| buildSha          | 完整 40 位提交                                                     |
| environmentLabel  | 固定 `local-simulated`                                             |
| action            | 服务端动作名                                                       |
| requestIdRedacted | `req_****` + `sha256(requestId)` 末 4 位                           |
| payloadKeys       | 仅键名，不含值                                                     |
| actorRole         | `A`／`B`                                                           |
| targetRelation    | `self`／`cross-account`                                            |
| ok                | 布尔                                                               |
| resultState       | 成功时的结果状态（`ready`／`delivered`／`expired`／`disabled` 等） |
| errorCode         | 失败时的错误码（`FORBIDDEN`／`CONFLICT`／`ACCOUNT_DISABLED`）      |
| responseKeyNames  | 成功时为 `data` 键名，失败时为信封键名，仅键名                     |

禁止出现：openid／unionid、token／cookie、真实账号 ID、原始 jobId、原始 receipt、文件引用、日记正文、昵称、完整导出内容、未验证的“通过”结论。`request-log.ndjson` 每行一个 JSON 对象，便于逐行审阅；`request-log.json` 是同一内容的数组版。

## 五个目标操作的对应行

1. A `account.requestExport`：第 3 行。
2. A `account.exportStatus` + `account.downloadExport`：第 4、5 行。
3. B 用 A 的 `jobId` 查询／领取：第 6、7 行；未知 `jobId` 对照为第 8 行。
4. A `account.close` 后再试导出：第 12 行注销，第 13–15 行三种拒绝。
5. 记录改动后的旧任务：第 9 行写入，第 10 行 `expired`，第 11 行 `CONFLICT`。

## 边界与未完成

- `planClaim`／`authorizeRead`（300 秒领取凭证）仍未接入生产领取路径，本轮未验证；日志里的领取是会话范围＋库内哈希校验。
- 只为触发来源版本前进而调用了一次 `journal.upsert`（第 9 行），它不是导出操作；收藏写入入口 `campus.favorites` 当前返回 `NOT_IMPLEMENTED`，所以没有用它制造失效。
- 单进程、单实例、无并发与重试；真实云的网络故障、超时与重放仍待补验。
- 本目录是阶段证据，不替代蔡奇真的独立复核，也不写成“已验收”。

## 给蔡奇真的提交建议

把本目录作为 PR #225 的补充证据引用即可；PR 描述保留 `local-simulated` 与 buildSha，说明“接口级回执已补、真实云与真机送达仍待补验”，不要把本地模拟写成云端通过。若需重跑，使用上面的命令并保留新目录，不要覆盖本目录。

## 11/26 接收边界

这16条只验证本人导出、越权拒绝、旧导出冲突与停用后拒绝；未执行清理进度回执绑定或分批清理，不能由本工具宣称通过。清理回执/物理清理另用已有生命周期测试和实际维护回执验证。维护者在工作树中复跑时显式指定真实HEAD；本工具默认读取linked worktree的Git方式另行修正，不把手填SHA当设备来源。
