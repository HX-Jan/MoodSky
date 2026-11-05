# 打卡合并审查交接

实现：校园详情点击打卡；登录后回原地点；服务端确认才显示完成；本人分页历史；关闭重开保留同账号未确认原请求；切号清空、不重放他人请求。仅自报完成，无位置权限或照片。

正式新增私有action：campus.checkin（payload仅placeId，原requestId）；campus.checkinHistory（page/pageSize）。共享注册表已更新，生成副本由cloud:prepare产生。production/backend.js从可信actor.accountId注入身份，调用services/checkins.js；不使用客户端scope作为owner。

事务边界：读取accounts active、places最新文档和账号散列键的campus_checkin_states；同日去重、请求重放；写回时移除_id。新到访同时更新账号operationFence、exportEpoch及sourceRevisions.tasks，借用已有tasks来源域以避免旧账号版本布局迁移；普通任务与地点打卡记录分开存放、分别导出。重复请求不推进来源修订，账号停用后原请求也拒绝。

容量：当前每账号上限500到访和500请求回执，达到上限明确拒绝；未实现无界增长。后续拆分集合时需保持请求去重与恢复协议，不能静默删除回执。该限制是本周实现的明确边界，需审查确认。

完整生命周期：domains/export.js收集本人状态文档并投影到campusCheckins；formatter.js输出JSON及Markdown；旧导出由既有epoch/tasks来源围栏失效。production/cleanup.js将新集合纳入现有停用清理工作器，删除本人状态及回执，保留公共地点和其他账号。不是只提供未接入的独立函数。

默认客户端仍不开放新入口。隔离候选可在本地environment.local.js显式campusCheckinEnabled:true；正式打包函数buildProduction的同名布尔选项默认false，可由负责人为确认范围的候选打开。没有自动切云环境、生产部署、集合创建或权限变更。新增集合与ownerId唯一索引是database/collections.json中的提案，必须客户端读写均拒绝；实际配置由负责人在具体环境执行。productionDatabase白名单、清理范围已同步代码。

本地验证包括实际Page、控制器、安装的原生SDK serializer与事务形态、真实正式入口/后端/导出/清理调用；传输均由离线合成替身替换。新增集合和placeId查询的替身约束明确检查过滤字段、分页与owner；没有放宽错误或吞掉SDK异常。不得将这些结论写成真实CloudBase隔离、真人到访或手机验收。

## 合并与部署前后

1. 从当时最新main建立新的打卡分支，应用本包，保留PR104的原交审来源；若104尚未合并，注明本PR依赖其修复，不能把它的旧审查当新功能批准。
2. 查看变更文件清单、契约、集合提案、容量边界和日志；在真实Git checkout执行npm ci、云函数目录npm ci、cloud:prepare、check及team:check，远端CI以PR head为准。
3. 合并代码不需要生产部署。但要发布可操作手机候选，负责人必须指定隔离环境、配置新集合/拒绝客户端规则，部署该候选后端，启用客户端flag，再按device-checklist执行。稳定身份密钥沿用原值，不共享密钥。
4. 五条地点导入映射为place-import-proposal.json，默认禁用且verifiedAt为空；保留现场日期与用户六个月政策。审核人核对后填写正式审核时间、开放状态并启用，不能把成员问询日期虚构成组长签认。

当前缺口：真实环境ID/授权范围、新集合实际配置、候选部署、手机操作、独立复核和本人课程工时。当前无证据支持将这些填“已验收”。
