# C1-XY 导出请求与领取回执

本文件由 `tools/alpha-xy/c1-baseline.cjs` 在内存库上生成，注入时钟起点为 2026-11-21T02:00:00.000Z，Node v24.21.0／win32。样例正文见同目录 `samples/`，均只含 SIMULATED 合成数据，不含真实账号、openid 或凭证。

| 编号 | 事件 | 请求 | 服务返回 | 说明 |
| ---- | ---- | ---- | -------- | ---- |
| R1 | 申请 JSON 导出 | `account.requestExport {format:"json"}` | `jobId=64f5b921deb368efc046df249779610b；state=ready；format=json` | 同步完成，state=ready |
| R2 | 领取 JSON 文件 | `account.downloadExport {jobId}` | `jobId=64f5b921deb368efc046df249779610b；format=json；extension=json；byteLength=3255` | 返回正文、扩展名与字节数 |
| R3 | 申请并领取 Markdown 文件 | `account.requestExport {format:"markdown"} → account.downloadExport {jobId}` | `jobId=8d87bbb1b36ed5f77cd0be429350c910；format=markdown；extension=md；byteLength=2022` | 扩展名 md，内容同样只含本人业务字段 |
| R4 | B 查询 A 的导出 | `account.exportStatus {他人 jobId}` | `FORBIDDEN / 导出尚未完成或已失效，请重新读取。` | 按不可见处理，文案与 CONFLICT 相同 |
| R5 | 记录改动后查询旧导出 | `account.exportStatus {旧 jobId}` | `jobId=64f5b921deb368efc046df249779610b；state=expired；format=json` | state=expired，旧文件不可再领取 |
| R6 | 记录改动后领取旧导出 | `account.downloadExport {旧 jobId}` | `CONFLICT / 导出尚未完成或已失效，请重新读取。` | CONFLICT，服务端不返回正文 |
| R7 | 到期后领取 | `account.downloadExport {jobId}（+24h+1s）` | `CONFLICT / 导出尚未完成或已失效，请重新读取。` | CONFLICT，与来源失效同一文案 |
| R8 | 注销账号 | `account.close {confirm:"CLOSE"}` | `accountStatus=disabled；receipt=<redacted:151-chars>` | 返回清理任务与一次性回执（样例中不落盘） |
| R9 | 停用后申请导出 | `account.requestExport {format:"json"}` | `ACCOUNT_DISABLED / 账号已停用。` | ACCOUNT_DISABLED |

## 样例自检

| 检查 | 结果 |
| ---- | ---- |
| JSON 可解析 | 通过 |
| JSON 记录只含 active 行 | 通过 |
| 删除记录正文未出现 | 通过 |
| 导出不含 ownerId | 通过 |
| 导出不含 openid | 通过 |
| 收藏按 placeId 去重 | 通过 |
| 任务状态均在允许集合 | 通过 |
| 悬空贴纸被丢弃 | 通过 |
| 贴纸改为 targetDate | 通过 |
| 打卡含地点与日期 | 通过 |
| 校园打卡 selfReported | 通过 |
| Markdown 含标题 | 通过 |
| Markdown 含记录正文 | 通过 |
| Markdown 不含 B 的正文 | 通过 |
| Markdown 不含账号标识 | 通过 |

## 边界

- 生产入口是同步生成：本机取不到 pending/processing 中间态，界面需要按 state 兼容这两值。
- 领取凭证 `planClaim`/`authorizeRead`（300 秒）尚未接入生产领取路径，当前领取=会话范围＋库内哈希校验。
- 结论只覆盖内存库与生产业务入口；真实云端、真机、自然到期与备份恢复不在本期证明范围（见 `../progress.md`）。
