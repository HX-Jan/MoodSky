# W3 H03/H04：回顾版本防回退与恢复材料预检

2026-10-26第二轮续作，源码基线`e635edb6da7595f89f88d3a32c374a175e964730`，Node.js 24.21.0。承接[首轮交付](README.md)、[W1 H04来源版本规则](../../week1/xiang-hong/w1-h04.md)和[H03剩余项](concurrency-remaining.md)。原755项报告保留为首轮结果，不覆盖历史云批次。

## H04：较旧快照不能覆盖已知的新修订

先加8项reader检查，原实现2项通过、6项失败，复现同一已验证账号读取修订2后仍接受修订1的情况。现在同一reader按服务端已建立的账号绑定记录最高`sourceRevision`，四种回顾共享下限：calendar、monthArchive、distribution、timeline。低于下限返回既有`CONFLICT`，页面清空旧视图并提示重新读取，不补演示记录，也不自动重试。

相同修订可读取不同月份/窗口；insights仍只读一次timeline派生分布，没有增加接口或请求。首次认证可正常建立下限。账号B的修订0不与账号A的修订2比较，旧账号的迟到响应先被会话检查拒绝，不能抬高新账号下限。下限只存在当前reader内存，按绑定对象隔离，不写缓存或凭据；未建立可信绑定的演示/旧候选不据不明身份比较版本。

新增3项实际页面JavaScript回归覆盖月历、月份卡片和统计：即使返回结构合法的旧快照，已删CUSTOM名称也不会重新出现；读取到当前快照后，手动重试恢复正常。详情仍通过`journal.get`与entry ID检查，不为它伪造接口未提供的`sourceRevision`。

## H03/V12：拒绝归属不匹配的恢复材料

恢复计划原先会接受三类不可靠材料，新加的3项回归在旧实现均失败：

| 材料问题                                         | 当前预检行为                                                 |
| ------------------------------------------------ | ------------------------------------------------------------ |
| 备份行提供的`_id`不对应本人/日期确定键           | `BACKUP_ROWS_INVALID`，不输出修改计划                        |
| 删除事件提供错误layout、collection、docId或month | `DELETION_LEDGER_INVALID`，不能拿其他集合/日期的标记删除记录 |
| 活动行updatedAt晚于声明的备份snapshotAt          | `BACKUP_ROWS_INVALID`，不把时间不一致的行标为可恢复          |

原有最小规范化材料仍可省略这些可选存储坐标；一旦提供必须一致。现有墓碑、代际、跨账号、重复ID与账本覆盖检查继续执行。无论计划通过或阻塞，`mayOpenPrivateServices`始终为false，预检本身不读写文件或数据库。

## 本轮可重复执行结果

```sh
npm run cloud:prepare
node --test tests/review-revision.test.js tests/review-cloud-pages.test.js tests/journal-recovery-plan.test.js tests/journal-recovery-native.test.js
npm run check
```

针对性46项通过；完整lint/格式/结构/类型及**771项测试通过，0失败、0跳过**。比首轮新增16项：9项reader版本/身份检查、3项页面检查、3项恢复预检和1项原生SDK离线整合。

原生SDK整合先用现有后端写入合成CUSTOM记录并删除，直接取候选产生的删除标记生成无正文计划；再在新的纯合成数据库模型中按计划补墓碑。模型读取详情为空、四类回顾计数为0，旧成功回执重放CONFLICT，重建从v3开始且ID更新；合法的删除后新代际保留。测试同时检查输入未被计划函数修改，计划不含正文和私人名称。

该模型通过锁定的公开SDK、替换传输并阻断HTTP/HTTPS运行。它不是通用恢复执行器，没有下载真实备份、认证独立账本、恢复云数据、撤销真实文件或测量恢复耗时。H03/V12仍待Xiang Yu/Qizhen Cai联合与独立验收；真实多实例、唯一键错误映射、V10文件撤销和新云授权仍保留。

## 版本及交接

七天气、weatherName、原请求重试、数据库布局、正式云函数和公开/私人开关未变。现有体验版`0.2.3.1026`仍固定`c590247`，本轮未上传，不含本次源码修复。没有新云调用、部署、清理、真实手机或独立人员测试，不能将771项本地结果归为这些环境已验收。

由Zhifeng/Yuen复核同版本正常读取、低版本失败提示与跨页表现，Linghan/Qizhen Cai复核账号切换。Xiang Yu复核新增恢复材料校验；实际工时、估点和签认继续留本人填写。整周H01—H05的[议题#60](https://github.com/HX-Jan/MoodSky/issues/60)保持开放。
