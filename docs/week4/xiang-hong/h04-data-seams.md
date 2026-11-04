# W4 H04 新增模块数据接缝

后续[校园刷新与跨日状态](campus-daily-refresh-20261104.md)只调整客户端读取与生命周期保护，不新增存储或切换打卡协议；与已部署记录的接口兼容仍按PR130/132单独整合。

11月4日晚现行基线323c557：校园已接入[五地点推荐与手动打卡](manual-checkin-20261104.md)，完成后记本人当日状态，不获取或核查位置；不再等待资料核验作为基本流程前置。`place_checkins`在同账号事务中推进`sourceRevisions.tasks`与exportEpoch，独立于普通task_history，已加入完整导出和注销清理。新集合、索引、客户端拒绝规则与云函数均尚未部署；[统一待确认状态及异常链接恢复](missing-page-protection-20261104.md)补跨页保护。完整1287项及PR/主干quality通过，真机与独立验收另列。

11月4日早晨记录：客户端补齐[退出/更新的隐藏操作状态](logout-work-protection-20261104.md)与[账号/任务原生离开提醒](private-operation-leave-guard-20261104.md)。只读挂起、进行中写入与未知原请求分别处理，原对象重试保持；早晨未改变来源域或云端范围；晚间新增校园打卡以上文及下表为准，其他模块共同复核仍待负责人。

11月3日续作：[个人资料重新读取保护](h04-profile-reload-20261103.md)补齐未保存/结果未知时的放弃确认，取消保留相同原请求；换号、隐藏与卸载使旧确认失效。不改资料服务或来源修订。

11月3日续作：[任务历史日期与分页修复](h04-task-history-20261103.md)补齐客户端到既有后端的必需日期及游标读取，实际生产入口/合成库联调通过。该修复不改变地点打卡契约或本表各模块的生产开放状态。

核对production/backend.js、services/account-data.js、domains/export.js、production/exports.js、tools/export-candidate/formatter.js和production/cleanup.js。调用方传可信内部ownerId，客户端payload不得授权或选择他人。

| 模块          | 源码写入/修订                                                                  | 导出投影                                                         | 清理与实际缺口                                                    |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| 记录          | 事务内journals修订，日期版本/原请求                                            | journals含weatherName、正文、标签、版本及时间，隐藏/删除态不输出 | 生产清理含journals及回执/删除标记；本周修复旧账号草稿内存接缝     |
| 手动地点打卡  | place_checkins同账号事务，复用sources.tasks活动修订；服务端北京时间/原请求回执 | checkins含placeId/date/completedAt，不混入taskHistory            | 生产清理源码含place_checkins与回执；新集合未部署，不清理公共推荐  |
| 收藏          | 候选存在，生产写入口关闭；sources.favorites为来源计数                          | favorites投影placeId等本人字段                                   | favorites在生产清理白名单；候选写入与生命周期围栏仍需Junhan对齐   |
| 纠错          | place_corrections候选存在，生产写入口关闭                                      | 当前完整导出格式不含纠错正文；不能称所有模块完整覆盖             | 生产清理含place_corrections；若计划新增导出需共同契约及修订域方案 |
| 任务          | production已装配事务存储，sources.tasks推进                                    | taskHistory字段按formatter，非模板内部/身份字段                  | task_history清理，task_templates保留；共同规则与正式模板仍待确认  |
| 偏好/头像昵称 | 事务内sources.preferences推进，资料嵌在preferences.profile                     | cardTextPreview、decorationsEnabled、profile                     | preferences一并清理；Me/资料读取与手机验收另列                    |
| 装饰          | 显式候选推进sources.decorations和exportEpoch；生产目录未注入                   | monthDecorations：合法目标转targetDate，已删/非本月目标过滤      | month_decorations清理，正式资源及存储交接未就绪                   |

导出有界快照使用journals/favorites/tasks/preferences/decorations五个来源域；缺少布局或计数时拒绝，不伪造0。当前生产内容存在受限export_jobs文档，最长24小时，由本人身份领取；不是公开临时URL或5分钟云文件。源修订变化使旧任务expired，领取返回CONFLICT。

## 新组合验证

tests/week4-hong-data-seams.test.js新增3项：

1. 生产收藏/纠错写入与装饰入口返回NOT_IMPLEMENTED且不修改合成库；候选存在不意味着自动开放。
2. 任务选择、偏好关闭、装饰候选保存分别使先前导出失效；重试不重复推进装饰修订。JSON中关闭偏好仍保留装饰配置，目标为日期而不是内部ID；B领取A被拒；删除目标后候选和新导出无悬空引用。
3. 混合模块写入后停用A，装饰候选也被拒。分批清理完成并重复执行幂等，B数据和places/support_resources/task_templates原样保留，A不能重新登录复活。

测试只用本地合成库，无生产写删。独立复核人Qizhen Cai，Junhan/Jiawei/Xiang Yu共同确认仍待回传；尤其纠错导出及候选写入围栏不能据本报告宣告完成。

## H04-02 注销恢复与客户端身份竞争（11月2日续作）

基线main为43fea5c51f5c4941b924428d83bc9abae0d9dc4d（PR #99）。审查Linghan的PR #100时复现：A发出注销并主动清除登录绑定，B随后登录，A的迟到成功或权限错误会再次清除B；旧注销记录还会挡住B进入偏好与导出。该缺陷已在上述主干存在，不归为成员本次新增。首批8项回归在未修复基线全部失败。

修复在共享账号控制器和原生账号Page，不引入PR #100的任务能力关闭规则或界面修改：

- 订阅绑定变化；退出、换号及A→B→A清空页面中的偏好、导出、注销和待重试状态，并使旧请求结果失效。注销主动退出只执行一次，迟到完成不再清除空会话或取消后来启动的登录。
- 注销请求先持久化原requestId、payload和scope，再撤销原绑定。按scope保存恢复记录，保留旧v1末次记录入口；B正常连接自身数据，返回A后才恢复A的原操作。B后续注销不会覆盖A的未确认请求。scope不是认证凭证，服务端原身份围栏保持不变。
- 冷启动先尝试恢复登录，再选择该账号的记录；不能因内存绑定为空就先把旧A注销页面展示给恢复登录的B。停用账号无法登录时，保留原受限回执查询进度的路径。
- 隐藏页面使旧结果失效，返回时保留同账号原请求供显式重试；卸载取消订阅。旧注销确认框在切号、隐藏或卸载后失效，不能确认注销新账号。
- 清理回执过期仍用原注销请求/原scope刷新；查询绑定自身恢复记录，旧状态响应不能覆盖另一账号的回执。偏好迟到响应及尚未领取的导出内容同样受绑定围栏保护。

tests/week4-closure-scope.test.js新增16项，含4种注销结果、原请求恢复/双账号记录、冷启动、隐藏恢复、清理回执续期、偏好与导出隔离，以及实际Page生命周期/确认回调。既有production-account-client中的换号用例加强为：B下不再发送A，回到A后核对原请求对象和scope不变。定向21项通过；完整检查结果见本目录README。

待Yuen/Qizhen Cai在新构建复核：同账号断网注销→离开并返回→重试原操作；切换到另一合法账号后不显示旧进度；清理回执过期能恢复；旧确认框失效。没有发送真实注销、写入/删除生产数据或新增手机验收；不能用合成账号测试代签独立结论。
