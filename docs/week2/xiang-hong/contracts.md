# W2 H01/H04 接口和接入清单

2026-10-20。承接 W1 H02/H04，整理现有 v1 action 和候选实现供消费者复核，不代表已共同定稿。可执行样例位于 `tests/week2-integration.test.js` 和 `tests/journal-backend.test.js`。

所有请求包含 apiVersion:"1"、8—80 位 requestId、action、payload。可信 OPENID 只由服务端上下文提供，payload 不接受 ownerId/openid/角色。

| action              | 输入                                             | 当前候选成功 data                                                             |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| journal.upsert      | date、weather、expectedVersion；tags/text 可省略 | `{entry:{id,date,weather,tags,text,version,createdAt,updatedAt}}`，无 ownerId |
| journal.get         | `{date}`                                         | `{entry}`，不存在或删除后为 null                                              |
| journal.delete      | `{date,expectedVersion}`，正安全整数             | `{date,deleted}`，空删除为 false                                              |
| review.calendar     | `{month:"2026-10"}`                              | `{month,entries,recordCount,sourceRevision}`，日期升序                        |
| review.monthArchive | 同上                                             | `{month,cards,recordCount,sourceRevision,cardTextPreview:false}`，降序        |
| review.distribution | `{windowDays:7}`，仅 7/30/90                     | 起止日期、来源版本、记录数、五类 bins                                         |
| review.timeline     | 同上                                             | 起止日期、来源版本、记录数、降序 items、trendEligible                         |

回顾标记只有 id/date/weather，正文标签由本人 get 读取。档案使用 **cards**；空月数组为空，不补演示记录。统计不足三条时趋势资格为 false。

## 正常和边界样例

固定业务日：北京时间 2026-10-20；存储时间为 UTC。公开合成请求：

```json
{
  "apiVersion": "1",
  "requestId": "req_w2_new_record",
  "action": "journal.upsert",
  "payload": { "date": "2026-10-20", "weather": "SUNNY", "expectedVersion": 0 }
}
```

| 情景             | 输入及预期                                                                              |
| ---------------- | --------------------------------------------------------------------------------------- |
| 新建与重试       | 上述请求返回 v1；省略正文/标签为空；同一原请求不重复变更                                |
| 编辑、删除、重建 | 新 ID 编辑 expectedVersion=1 得 v2；删除传 v2；再新建得 v4、新 entry ID；旧请求不能命中 |
| 30 日边界        | 2026-09-21 可新建，09-20 拒绝；已有更早记录可编辑                                       |
| 旧版本           | 当前 v2、输入 v1 返回 CONFLICT；保留草稿，不自动覆盖                                    |
| 跨午夜           | 23:59 新建次日被拒，00:00 在回执有效期内原请求仍重放 INVALID_INPUT                      |
| 改原输入         | 被拒 ID 改 date/weather/text，或省略字段改显式空值，均 CONFLICT                         |
| 非法输入         | 非法天气/日期、1001 码点、客户端归属字段，在业务回执前拒绝                              |
| 身份门禁         | 无可信身份 UNAUTHENTICATED；实际账号停用 ACCOUNT_DISABLED，不能绕过                     |

INTERNAL_ERROR/网络失败不能推定未提交，保留原请求重试；拒绝回执提交失败也不能报已确认拒绝。正常业务拒绝改为新操作时才使用新 ID。

## 接入顺序

2026-10-21补记：可先用[日记快照只读预检](journal-preflight-20261021.md)检查提供的完整候选材料，特别是布局标记已存在但旧随机键仍残留的情况。它不检查实际唯一索引、不执行迁移，也不替代下列确认步骤。

1. Jiawei/Xiang Yu 复核 openid 唯一约束、内部 ID、active/disabled 与布局迁移；既有随机 ID 数据不能当空库。
2. Xiang Yu 确认数据库 throwOnNotFound:false、事务、revision/fence/epoch 及服务端回执密钥/保留策略；不自动补字段。
3. 服务器显式构造 `tools/week2-integration/backend.js`，注入数据库/时钟/策略；请求不能携带这些配置。本轮只本地联调。
4. Yifan 复用 journal service/controller；只有确认成功才发 change，未知结果保留原请求，冲突保留草稿。
5. Zhifeng/Linghan 收到 change 重读月历/档案/详情；校验日期/当前 ID，防止删除重建后旧详情复活。现有页面异步隔离不变。
6. Yuen/Qizhen Cai 分别执行集成及独立复核，真实部署、云端并发、真机另记。

本地组装默认 decorations 返回 NOT_IMPLEMENTED，正式素材需另行注入；distribution/timeline 已有本地实现。生产路由及 tasks/preferences/export/cleanup 不因组装存在而开放。

续作补记：本地组装可选 `newAccountJournalLayout:'deterministic-days-v1'`，与明确的账号唯一索引准备开关一起使用时，仅在新账号首次插入中初始化记录计数器；既有账号不迁移。具体限制和试用反馈来源见[后续开发](post-trial-development.md)。
