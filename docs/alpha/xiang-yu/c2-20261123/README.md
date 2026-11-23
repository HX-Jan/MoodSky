# C2-XY 导出内容、归属与旧回执验证（2026-11-23）

阶段稿。验证对象是**生产候选入口**（`cloudfunctions/moodsky/production`）+ 内存库 + 注入时钟，不涉及真实云环境；结论只覆盖本机可复现的部分。

- 基线：`78812fedeb90c5603e927fbda8050eab23b5338f`（`docs(integration): 接收YL与QH增量并保留新版账号行为 (#240)`）
- 分支：`docs/alpha-xy-c2`
- 工具：`tools/alpha-xy/c2-access.cjs`（每用例独立内存库；`--out` 指定输出目录）
- 复核：蔡奇真（清理/隐私边界）、Yuen（导出与整合）——本地无法代签，本篇只记**待复核**

## 本轮结论

| 检查项                   | 结果                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 本人内容完整、格式可解析 | 通过：JSON 2 条记录（2026-11-19、2026-11-23 升序）、3 个收藏、2 条任务历史、3 条打卡、1 个月份装饰         |
| 归属隔离                 | 通过：B 的正文/收藏/任务不进入 A 的导出；B 用 A 的 jobId 查状态或领取均 FORBIDDEN，文案与失效相同          |
| 身份字段拒收             | 通过：查询夹带 `ownerId` → INVALID_REQUEST「身份与权限由服务端确定。」（路由前拒绝）                       |
| 旧回执受限               | 通过：记录修改或偏好修改后旧任务转 expired，领取 CONFLICT；重新申请可领取且只含新内容                      |
| 到期边界                 | 通过：到期前 1 ms 仍 ready，到期时刻转 expired 并拒绝领取，过期后可重新申请                                |
| 停用后访问               | 通过：查询/申请/领取均 ACCOUNT_DISABLED「账号已停用。」，B 不受影响                                        |
| 注销回执与清理进度       | 通过：凭回执可读 pending/processing，伪造回执 FORBIDDEN「清理进度回执无效。」                              |
| 重新注册隔离             | 通过：新代数 scope 与旧不同；旧 scope 重放 UNAUTHENTICATED；新代数读旧任务 FORBIDDEN；新导出 journals 为空 |
| 领取凭证策略（未接入）   | 通过策略级断言：计划不含 token、他人/篡改/撤销/过期/源变化凭证均 FORBIDDEN、时间窗 ≤ min(文件到期, 300 秒) |

64 个用例全部通过，见 `export-access-results.csv`（C01–C64，按执行顺序编号）。

## 产物

| 文件                                | 内容                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `export-access-results.csv`         | 64 行矩阵：编号/类别/场景/服务端动作/预期/实际/结论/证据          |
| `samples/export-sample-json.json`   | 脱敏 JSON 样例（2875 字节，formatter 原样输出）                   |
| `samples/export-sample-markdown.md` | 脱敏 Markdown 样例（1834 字节）                                   |
| `samples/access-receipts.md`        | 回执行表格（正文替换为占位、注销回执替换为 `<redacted-receipt>`） |
| `samples/access-receipts.json`      | 同上，机器可读                                                    |

样例里的账号、地点、记录全部是 `SIMULATED-C2XY` 合成值；`content` 只出现在样例文件里，回执表中不落盘正文。

## 契约口径（本次实测，供界面与 C3 对照）

- `account.requestExport`：只接受 `format`（json/markdown），其他键 → INVALID_INPUT。
- `account.exportStatus` / `account.downloadExport`：只接受 `jobId`，且须匹配 `^[A-Za-z0-9_-]{1,128}$`；非法形状 → INVALID_INPUT，未知或他人任务 → FORBIDDEN，文案统一「导出尚未完成或已失效，请重新读取。」（与 CONFLICT 相同，不泄露任务存在性）。
- 私有动作缺 `sessionScope` 或形状不合法 → UNAUTHENTICATED「登录范围已变化，请重新登录。」；B 的身份携 A 的 scope 同样被拒（scope 不单独决定账号）。
- 停用账号的 `account.session` 返回 ACCOUNT_DISABLED；`account.registration`/`account.register` 只在「已停用 + 有注销清理任务」时可用，成功后 scope 换代。
- `account.cleanupStatus` 必须同时给出 `jobId` 与注销回执，且 `jobId` 与回执绑定。

## 首跑偏差与修复（记录用，非产品缺陷）

首跑 62 用例中 54 通过、8 项偏差，全部是本机环境或我的预期写错：

1. **生成副本过期**：`cloudfunctions/moodsky/shared/` 是 gitignore 的生成目录，未刷新时 `account.registration`/`account.register` 报 ACTION_NOT_FOUND。修复：`node scripts/prepare-cloud.js`（等同 `npm run cloud:prepare`），之后两项通过。复跑 new-main 前应先执行该步骤。
2. **月份装饰预期**：无目标贴纸（`STICKER_CAT`）会保留，只有悬空 `targetEntryId`（`STICKER_LEAF`）被丢弃；预期已按实现改正。
3. **多余字段的错误码**：夹带 `ownerId` 是 INVALID_REQUEST（路由前拒绝），不是 INVALID_INPUT。
4. **收藏写入入口关闭**：`campus.favorites` 在候选入口返回 NOT_IMPLEMENTED（`production/backend.js` 只放行 `campus.checkIn/checkins/checkin/checkinHistory` 与四个只读动作），因此“新增收藏使旧导出失效”无法经生产入口制造。已改为边界记录，并用「记录修改」「偏好修改」和策略级「收藏版本前进」覆盖同一契约。
5. **注册后 scope 未刷新**：注册返回新 scope 后，后续调用仍用旧 scope 导致 UNAUTHENTICATED；工具改为注册后更新当前 scope。
6. **回执签名 token 泄露**：注销回执是 `v1.*` 签名串，首版落盘未脱敏；已加掩码，CSV/回执表只剩 `<redacted-receipt>`。

修复后连跑两次，5 个产物 SHA256 全部相同（随机 UUID 与回执 token 已掩码）。

## 边界（不作为通过项）

- 只覆盖内存库与生产候选入口；真实云函数部署、真实触发器、真实设备送达、云文件删除与备份恢复未验证（见 W6 补验单 M1–M9）。
- `planClaim`/`authorizeRead` 仍是策略模块，未接入生产领取路径；300 秒领取凭证没有生产动作可测，本轮只在策略层断言。
- 收藏写入入口关闭是当前候选入口的已知边界，真实收藏变更后的导出失效仍需入口开放后复测。
- 未做真实账号与真实数据；样例全部为合成值，不代表线上行为。
- C2 未独立复核，不写“已验收”。

## 交接

- **Linghan**：两格式样例与回执摘录可直接用于 DD-07 界面对齐；`exportStatus` 的 expired/ready、`downloadExport` 的 CONFLICT、停用与清理进度的文案均在本篇与 `samples/access-receipts.md` 中。
- **蔡奇真**：时钟注入点（`clockNow` 起点 `2026-11-23T02:00:00.000Z`）、到期边界（`+24h` 与 `+24h-1ms`）、重置方式（每用例新建内存库）可直接复跑。
- **Junhan / Jiawei**：本轮未发现字段级缺陷；`place_checkins` 导出仍只有 `placeId` 无 `placeName`（与 C1 观察一致）。

复跑命令：

```sh
node scripts/prepare-cloud.js
node tools/alpha-xy/c2-access.cjs --out <独立目录>
```
