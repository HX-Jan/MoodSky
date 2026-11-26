# Xiang Yu 第一期交付｜2026-11-21 数据清单与两种格式样例

对应 C1-XY（11/21–22）、AS-XY01、[Issue #207](https://github.com/HX-Jan/MoodSky/issues/207)。本记录只覆盖内存库与生产业务入口，用于把“哪些数据导出、属于谁、排除什么、清理清什么”先写清楚，并把 JSON／Markdown 两种格式的初始样例交给 Linghan 对齐 DD-07。真实云端、真机、自然到期与备份恢复不在本期证明范围，C1 未经独立复核前不写“已验收”。

## 基线与来源

- 源码基线 `6e91ead92dd8ecc143e38bff956ff239e4765296`（#214 合入后的 main）；本期只新增工具与资料，不改产品源码、接口与数据字典。
- 复用 #187 已并入主干的工具：[verify-export-cleanup.cjs](../../../../tools/week6-xy/verify-export-cleanup.cjs) 在同一基线仍 14 场景／137 检查通过；结论出处见 [W6 验收报告](../../../week6/XiangYu/W6XY-导出与清理本地验收报告.md)。
- 本期新增 [c1-baseline.cjs](../../../../tools/alpha-xy/c1-baseline.cjs)：构造 A／B／公共合成数据，跑生产入口生成样例与回执，并保留一份**未写入的清理副本**给 C2／C3。用 `node tools/alpha-xy/c1-baseline.cjs --out <独立目录>` 可复跑，不覆盖已有证据。

## 合成数据与两份独立副本

种子共 22 行：A 12 行、B 5 行、公共 5 行；A 另经真实写接口补 1 条 2026-11-21 记录和 1 份偏好，因此导出样例里能看到“接口写入＋种子行”两种来源。

| 集合                  | A   | B   | 公共 | 用途                                          |
| --------------------- | --- | --- | ---- | --------------------------------------------- |
| journals              | 3   | 1   | 0    | 含 1 条删除记录，验证整行排除                 |
| favorites             | 3   | 1   | 0    | A 3 个不同 placeId，B 引用同一公共地点        |
| task_history          | 3   | 1   | 0    | completed／skipped／selected 三种状态         |
| place_checkins        | 2   | 1   | 0    | 同一业务日期内的打卡                          |
| campus_checkin_states | 2   | 1   | 0    | A 两次 selfReported 访问，requests 为内部字段 |
| month_decorations     | 1   | 0   | 0    | 含 1 个悬空 targetEntryId 贴纸                |
| places                | 0   | 0   | 3    | 公共地点，A／B 收藏共用                       |
| task_templates        | 0   | 0   | 2    | 公共任务模板                                  |

两份副本从同一夹具各建一次：`exportCopy` 用于本期申请与领取；`cleanupCopy` 在 C1 全程零写入，跑完逐行比对与种子一致（`synthetic-data.json` 的 `copies` 与 `counts` 记录）。重置方式为重跑脚本——同一 `_id`、同一注入时钟（起点 `2026-11-21T02:00:00.000Z`），不依赖真实账号与真实时间。完整行数据见 [synthetic-data.json](synthetic-data.json)。

## 数据清单结论

逐集合的“是否导出、归属、导出字段、排除字段、清理批次、代码依据”见 [data-coverage-baseline.csv](data-coverage-baseline.csv)。要点：

- 7 个本人集合进入导出：journals、favorites、task_history、preferences、month_decorations、place_checkins、campus_checkin_states（visits 平铺为 `checkins`）。字段白名单来自 `cloudfunctions/moodsky/domains/export.js:18-37`，投影规则来自 `tools/export-candidate/formatter.js`。
- 内部集合不导出：`export_jobs`（正文只存这里，领取时校验 sha256 与字节数）、`request_receipts`、`cleanup_jobs`、`accounts`（只用于鉴权与状态）；`task_checkin_links` 是候选来源，默认生产路径不读。
- 清理覆盖 `production/cleanup.js` 的 11 个集合；`accounts` 不删除，注销后保留 `openid,identityKind,status,journalLayout,closedAt` 墓碑；公共 `places`／`task_templates` 在清理后必须完整。
- 任务书提到的 AS-T27–T30 在仓库 `docs/` 中没有可引用的定义，本表按**行为**（导出内容／归属／领取时限／清理范围）列，未臆造编号含义；编号对应关系待洪翔确认。

## 格式样例与回执

- [JSON 样例](samples/export-sample-json.json)：`exportVersion=1.0-candidate`，2 条天气记录、3 个收藏、3 条任务历史、偏好、1 个月份装饰、4 条打卡；无 `ownerId`／`openid`／`_id`，删除记录正文不出现，悬空贴纸被丢弃并改为 `targetDate`。
- [Markdown 样例](samples/export-sample-markdown.md)：同一份数据的可读版本，二级标题按“天气记录／收藏地点／任务历史／地点打卡／偏好设置／月份装饰”分节，正文用围栏代码块保留换行。
- [format-receipts.md](samples/format-receipts.md)：R1–R9 共 9 条请求／领取／拒绝回执，含 15 项样例自检（全部通过）。回执里的 jobId 是合成请求的哈希值，注销回执已替换为 `<redacted:N-chars>`，样例不含任何真实身份或凭证。

三个需要界面与字段负责人注意的实测观察：

1. **地点打卡没有名称**：`place_checkins` 只存 `placeId`，导出里因此只有地点 ID；收藏有 `placeName`，校园打卡有 `placeName`。界面若要显示“图书馆”这类名称，需要按 `placeId` 回查公共地点——这点请 Junhan／Jiawei 确认是否属于当前字段范围。
2. **同步生成没有中间态**：生产入口一次调用即 ready，本机取不到 `pending`／`processing`；界面仍要兼容这两个值，不能假设永远 ready。
3. **拒绝文案不可区分**：他人 jobId（FORBIDDEN）与失效 jobId（CONFLICT）返回同一句话「导出尚未完成或已失效，请重新读取。」，这是有意的“不泄露任务是否存在”，界面不应据此提示“任务不存在”。

## 交接

| 对象           | 交什么                                                       | 还需要对方做什么                              |
| -------------- | ------------------------------------------------------------ | --------------------------------------------- |
| Linghan        | 两份样例、R1–R9 回执、上面 3 条观察                          | 按 DD-07 对齐界面文案与状态动作，补 C3 对齐行 |
| Junhan／Jiawei | 字段清单与两条疑问（打卡缺 placeName、weatherName 何时落库） | 确认当前字段，或说明是否需要补名称字段        |
| 蔡奇真         | 本地时钟与重置条件：起点、`+24h+1s` 到期、重跑即重建         | 独立复跑并给复核意见                          |

## 补充：脱敏请求日志（接口级证据）

[request-log/README.md](request-log/README.md) 用合成 A／B 账号跑 `cloudfunctions/moodsky/production`，记录 16 条请求／响应轨迹（requestId 已散列、payload 与响应只留键名、正文与回执不落盘），覆盖申请、查询、领取、跨账号拒绝、记录改动后旧任务失效、注销后拒绝。环境标签固定 `local-simulated`，真实云与真机送达仍待补验；该目录供蔡奇真补 [PR #225](https://github.com/HX-Jan/MoodSky/pull/225) 的“接口级越权回执”缺口。

## 未做与边界

- 未连接真实云端、未上真机、未等待自然到期（24 小时边界由注入时钟推进），也未验证备份残留与恢复。
- 未向 Junhan／Jiawei 私聊确认字段，问题已列入上表；仓库内没有可引用的回复记录，因此不写“已确认”。
- 领取凭证 `planClaim`／`authorizeRead`（300 秒）仍未接入生产领取路径，当前领取是会话范围＋库内哈希校验；本期样例不涉及该凭证。
- C1 只完成“数据清单＋两格式初始样例＋回执”，不代表 C2 的越权与到期验证、C3 的分批清理或 C4 的最终复验已完成；独立复核结论未到前，本记录按“阶段稿”引用。
