# H03 真实定位与保留符号错误的修复候选

2026-10-23。第一轮诊断已部署并只运行一次 `h03_20261023_w2_validation_001`，报告及安全调用编号见 [云端结果](h03-cloud-20261023.json)。17 项中 12 项通过，原五项仍失败：V03-create/edit/edit-delete、V04-same-input、V05-different-input。五项均为 -501001，固定阶段均为 **account-fence**。新批次保留 60 条合成记录（账号 18、日记 15、回执 25、删除账本 2）。未清理或覆盖旧批次。

run 调用在自动化层超时，随后只读 inspect 取回完整持久化失败报告，未重跑。第一次部署任务的旧记录丢失后，已只读重新下载确认仍是旧代码，按用户继续请求重新显示确认；新任务成功后，实际下载的三文件 SHA 与已批准候选全部一致。

## 定位边界

云端已把失败收窄到账号共同写围栏，尚未直接取得原始后端符号码。锁定本地 SDK 的公开 API 可复现：wx-server-sdk 的文档包装层将未映射代码转为数字 -501001，而底层事务只对准确的 DATABASE_TRANSACTION_CONFLICT 重试。因此 SDK 丢失冲突类别与观测相符，**不能把五个数字码直接断言为冲突根因**。

## 本地修复

新增仅允许四个探针集合的 `tools/h03-probe/database.js`：使用 @cloudbase/node-sdk 的公开 database/runTransaction API，校对原有 WX data 包装；原生文档方法返回 code 时在提交前抛出同一类别，令 SDK 已有的有限重试可以识别准确符号。系统错误、未知符号和纯数字 -501001 不改写、不重试、不提交为成功。不解析错误消息，不访问私有 _db，不修改 node_modules，也不增加外层循环。

可信身份仍由原 WX 上下文及操作员登记核对。原 17 项业务断言、固定实验日期、回执摘要、运行时、超时及 retryCount=2 不变；没有接入正式 moodsky 业务。探针独立 package/lock 明确固定 @cloudbase/node-sdk 3.17.2，原有 wx-server-sdk 4.0.2、database 1.5.1 及全部 97 个依赖包记录保持一致，正式函数依赖不变。

新增 11 项锁定原生 SDK 离线检查：文档/提交冲突、重试预算、三类非冲突错误、数据包装、读取/插入/计数/删除错误、集合限制。完整 **584 项本地测试通过**，探针依赖审计 0 项漏洞。测试阻断 HTTP/HTTPS；不是云端修复结果。

## 追加真实复测的固定申请

第一轮单次授权已使用完。本修复包需要新的明确同意及工具内确认，然后仅更新同一环境的同一探针函数并运行一次新批次 **h03_20261023_w2_symbolic_001**。环境 mood-sky-d5gqy3spkff37566d，AppID wxf602e991ff44e6c8。部署前再次只读核对、备份；随后确认新批次不存在和操作员匹配，单次 run 后只读 inspect。

| 候选文件          | SHA-256                                                          |
| ----------------- | ---------------------------------------------------------------- |
| index.js          | ded68a4093fbc39bf3970f4bf0b0e2c9c948efe611c0a4805357a9619d5c4d3a |
| package.json      | 5af1f3a972d281c0edb44eb55b629c9082e7086a4743deaec4faad13c5ff038d |
| package-lock.json | c3ea3713fed59829ab67a7f42e11ef729f72c10bfe7e67f505679f50ead6e313 |

包位于本地 test-results/2026-10-23-week2-completion/h03-symbolic-candidate/moodsky-h03-probe。只在四个既有 h03_probe_* 集合写该新批次合成数据；不部署正式业务、不变更索引/权限/操作员配置、不清理任何批次。备份为本轮实际下载的 probe-deployed-verification。

## 获准后的真实结果

用户另行同意，并在工具内确认任务 confirmation_cloud_fn_deploy_fe36230e-0d78-4681-982b-6a0220b6d369。部署成功后实际下载三文件与上表 SHA 全部一致；新批次预检为 not-found、四集合计数均为 0。只执行一次 run；自动化调用超时后没有重发，只读 inspect 取回 completed 报告，**17/17 全部通过**，原五项失败场景均已通过。当前源码重新打包仍与实际已验证包的哈希一致。

[原始报告](h03-symbolic-cloud-20261023.json)的 inspect 请求号为 89fe935f-331c-4edf-93d0-165e82bc829b，事务回调 46 次；原诊断版同一 17 项共 36 次，不能把新增重试写成性能提升。新批次 62 条记录（18/15/28/1）均保留，原失败批次及更早材料不变。报告继续保留 productionJournalImplemented:false、technicalValidationComplete:false，以及 V09—V12 deferred；唯一键宽泛错误映射未确证，独立复核未收到。

本轮真实证据与本地 SDK 复现共同支持文档封装丢失类别导致有限重试未生效的解释；没有反推历史原始后端错误、修改旧失败报告或把单批次通过扩展为正式业务完成。随后已将公开原生接入补到 H02/H04 候选并本地验证，见[记录后端接入](native-journal-20261023.md)，没有写真实业务集合。
