# W3 H01/H02 接入门槛与差异表

本表承接[W2 H01/H04](../../week2/xiang-hong/contracts.md)，描述现有候选，不表示已经取得成员共同确认。本轮不改变共享契约。

第三轮[认证/请求竞态修复](readiness-20261026.md)新增客户端内部只读getGeneration，并同步API、认证和任务页；请求信封、scope及七天气字段不变。Linghan/Jiawei/Qizhen Chen实际复核待回传，不代签。

第二轮[回顾版本检查](continuation-20261026.md)沿用现有sourceRevision和CONFLICT，没有增加字段或action；同一已验证绑定内不接受低于已知修订的快照，不跨账号比较。消费者签认仍待实际回传。

| 项目          | 当前实现与依据                                                                                                          | 接入门槛/待确认                                                      | 需要实际确认的人                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| 七天气        | SUNNY/PARTLY_CLOUDY/CLOUDY/RAINY/STORMY/TYPHOON/CUSTOM；CUSTOM名称1—20码点，风雨与暴雨归雷雨；shared/constants及weather | 不能将旧五天气原型覆盖工程；当前页面输入与响应逐项复核               | Yifan、Zhifeng、Jiawei、Xiang Yu；签认未收齐 |
| 可信身份      | 服务端OPENID解析内部账号；私人pilot为独立HMAC账号；客户端scope不是身份凭证                                              | 正式旧账号解析/重复映射和停用协议；不能把pilot账号自动迁移为正式账号 | Jiawei、Xiang Yu；待确认                     |
| 新账号与布局  | 显式唯一索引准备标记和deterministic-days-v1；新账号可一次初始化，旧账号不自动补字段                                     | 实际唯一索引、完整旧数据审计；JSON设计和传入true均不是平台配置证据   | Jiawei、Xiang Yu；待确认                     |
| 日期与代际    | 北京日期；30个自然日内可新建，已有旧日可编辑；版本/墓碑/重建新ID                                                        | 前端保留冲突草稿，旧ID不能打开重建详情                               | Yifan、Zhifeng；待本周确认                   |
| 回执          | 原requestId和输入绑定；成功/已确认拒绝回执均有寿命和密钥版本；未知结果不换ID                                            | 生产密钥轮换/保留策略、恢复与墓碑依据，不提交真实密钥                | Xiang Yu、Jiawei；待确认                     |
| 记录详情      | journal.get本人读取正文/标签；upsert/delete使用expectedVersion                                                          | 无ownerId/openid/角色等客户端权限字段                                | Yifan、Jiawei；待确认                        |
| 本人回顾      | calendar/monthArchive/timeline只返回标记，可含本人CUSTOM名称；卡片无正文标签                                            | CUSTOM名称是私人字段，不能进入公共接口；不是禁止本人回顾显示         | Zhifeng、Yifan；待确认                       |
| 分布/公共投影 | distribution按七天气类别计数，不按私人名称分组；公开任务目录白名单无私人内容                                            | 任何新公开投影不得带正文、自定义名称或内部身份                       | Zhifeng、Jiawei、Xiang Yu；待确认            |
| 完整有界快照  | 每个回顾从一次一致事务读取；insights从同一timeline派生分布；最多90日加1账号读取                                         | 真实90日时延/事务限制测量尚缺；跨请求修订可不同，不能拼接当同一快照  | Zhifeng、Xiang Yu；待确认                    |
| 会话边界      | 本轮回顾读取及四页监听已建立scope变化；清空旧内容并丢弃旧响应，A→B→A也失效                                              | 仅针对已建立的可信绑定；不是自行检测微信身份；独立双账号/手机仍待验  | Linghan、Zhifeng、Qizhen Cai；待确认         |

## 部署前只读准备

1. 固定源码SHA、锁文件和实际待部署包哈希，区分main、固定标签、正式函数、私人pilot和手机体验包。
2. 使用`tools/week2-integration/journal-preflight.js`检查完整离线快照；其结果不证明真实唯一索引，也不会迁移/写库。
3. 对照`database/collections.json`与`database/client-access-policy.json`收集实际平台配置依据；不从文件存在推断已应用。
4. 固定目标函数、集合、合成账号/日期/批次、预期、最长运行期限和回滚包。原10月26日单次pilot授权已执行并关闭，不能复用。
5. 在新的明确范围获准后才更新候选或写云端；失败/未知结果保留原调用和数据，不重发未知写入。结束恢复关闭包并实际读取验证。

本轮没有新部署、真实配置读取、云写入、清理或手机上传。已备份的历史包不能称为本轮刚下载的回滚备份。
