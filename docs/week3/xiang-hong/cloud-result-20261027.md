# W3 H03/H04：固定云批次结果与探针恢复

2026-10-27，测试源码 `d2b2afa36faeab2989c8473b9117bbfc662c992d`（PR #66），批次 `h03_20261027_w3_remaining_001`。用户明确同意[固定范围](cloud-remaining-20261027.md)，并分别确认候选部署和原探针恢复。**本批次能力检查通过，原探针已恢复并实际下载比对；整周和完整并发技术验收仍未完成。** [机器可读结果](cloud-result-20261027.json)保存实际报告、异常和恢复证据。

## 实际执行与结果

仅临时更新既有 `moodsky-h03-probe`，使用本人可信微信调用、三个服务端固定合成账号及 `h03_probe_accounts`、`h03_probe_journals`、`h03_probe_receipts` 中的新批次。内部合成账号不是真实双微信身份。90天历史为直接构造的夹具，不是90次用户保存或自然留存证明。没有修改正式业务集合、索引、权限、环境变量、正式函数或体验版，没有清理旧数据。

| 场景         | 实际结果                                                       | 结论范围                                                           |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| 同日首次创建 | worker 0返回CONFLICT，worker 1返回OK；最终版本1、来源修订1     | 固定账号同日只接受一次创建；不是唯一键符号错误映射证明             |
| 写入与停用   | worker 2写入OK，worker 3停用OK；最终账号disabled               | 本次允许的“先写入、后停用”分支成立；不代表另一种排序也已在云端覆盖 |
| 停用后访问   | 原请求重放、journal.get和review.calendar均返回ACCOUNT_DISABLED | 停用后不能借原成功回执继续访问                                     |
| 7天时间线    | 7条，sourceRevision=90，416ms                                  | 记录ID及窗口边界符合固定夹具，正文/私人标签/身份未进入投影         |
| 30天时间线   | 30条，sourceRevision=90，1297ms                                | 同上                                                               |
| 90天时间线   | 90条，sourceRevision=90，3787ms                                | 同上；只是一轮服务器操作墙钟时间，不是手机/弱网性能或通用性能基线  |

四个worker由客户端一次Promise.all派发为四次独立云调用；四个模块启动随机标记不同。每个业务事务回调均为1次，**没有观察到原生SDK事务重试**，不能将本次业务CONFLICT解释为已触发SDK写冲突重试。随机标记不等于云厂商实例身份，`providerInstanceIdentityVerified`、`crossInstanceValidationComplete`和`duplicateErrorMappingConfirmed`继续false。

最终报告为 `status=completed`、`capabilityChecksPassed=true`、`createPassed=true`、`stopPassed=true`、`windowChecksPassed=true`。其中completed只表示阶段结束，能力结论依赖另外几个布尔值。`technicalValidationComplete`继续false；没有独立复核人签认。

## 异常与请求账本

本轮实际发出 **10次候选云函数调用**：4次只读inspect、1次prepare、4次worker、1次read。这不是内部数据库SDK请求数，也不包含部署、元数据查询或下载。没有重发prepare、worker或read，没有换请求ID/批次，也没有恢复后再调用探针。

1. 最初通过PowerShell/.cmd传入多行函数时，工具返回`Uncaught Unexpected token ')'`，发生在运行时表达式解析阶段，未启动该次云调用。原失败保留。
2. 改用官方CLI的Electron bootstrap并以参数数组传入原函数文本，避免cmd二次解析；四份固定脚本的字节和校验值未改变。调用辅助保存在本地归档的`invoke-fixed-call.py`，限定阶段、验证脚本哈希并为每个写阶段建立一次性领取文件；没有更改CLI的确认流程。
3. 唯一一次prepare在工具侧返回`timeout waiting for automator response`。没有把超时当成未写入，也没有重发；随后只读inspect确认批次ready、四个worker均not-started，才继续后续固定调用。
4. worker全部完成、stopPassed=true后才执行一次read。最终inspect确认整个固定能力检查通过。原语法错误、prepare超时、每次返回和报告全部保留，不用成功报告覆盖失败。

本地归档位于工作区`test-results/2026-10-27-week3-cloud-preparation/`。原始工具返回、两个代码ZIP、解包文件、个人配置及依赖不提交Git；仓库仅保存脱敏结果和校验值。本批次授权已执行完毕，不沿用到后续实验。

## 原探针恢复核查

恢复的是测试前从云端实际下载的原探针，不是重新构造的近似包。恢复任务返回success，随后只读状态为Active、超时60秒、Nodejs16.13；控制台显示更新时间2026-10-27 19:54:32。再次从云端下载恢复后的ZIP，仅提取三个根文件作SHA-256对比，**三项全部一致**，未执行下载代码。

| 恢复后根文件      | 与测试前实际备份一致的SHA-256                                      |
| ----------------- | ------------------------------------------------------------------ |
| index.js          | `ded68a4093fbc39bf3970f4bf0b0e2c9c948efe611c0a4805357a9619d5c4d3a` |
| package.json      | `5af1f3a972d281c0edb44eb55b629c9082e7086a4743deaec4faad13c5ff038d` |
| package-lock.json | `c3ea3713fed59829ab67a7f42e11ef729f72c10bfe7e67f505679f50ead6e313` |

恢复后实际下载ZIP为7,442,001字节，SHA-256 `2877491e0791e4efde770175600f82cb51bd16481e6654eb63a897a833c42fd1`。它与测试前ZIP的归档字节不同，不能宣称整个ZIP完全相同；本轮核验的是上述三个根文件。测试数据全部保留，没有调用清理，也没有为了验证关闭而额外执行云写。

## 本周接续

- H03：固定独立调用、创建/停用分支已取得新真实云证据；仍缺可信双微信身份、云厂商实例身份/确定交错、精确唯一键错误、真实文件撤销/恢复执行及Qizhen Cai独立复核，不将V09—V12整体验收改为通过。
- H04：7/30/90窗口已获得本批次真实云数量/来源修订/投影和耗时证据；完整四页、删除重建、跨设备及独立成员回归仍按原缺口继续。
- H05：保存准备、原失败、实际结果和恢复证据，更新原60项台账；成员工时、估点和独立意见不代填。议题[#60](https://github.com/HX-Jan/MoodSky/issues/60)保持开放。
- 正式业务继续关闭，体验版仍为 `0.2.3.1026 / c590247`；没有新上传、正式发布或新版手机验收。此前809项本地检查属于准备包源码证据，与本轮真实云结果分别记录。
