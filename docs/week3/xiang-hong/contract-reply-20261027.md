# W3 H01：对YF01及Z01的后端契约答复

2026-10-27，答复人Xiang Hong/HX-Jan。运行时依据`83115ae87fe9333fb7c6712daf149f72c516966f`；PR #59与#64合入后的`e6b390b688954f24ab9a682cc3a6a2298b35bfaa`运行时相同。以下为后端负责人实际给出的当前约定答复，已随PR #64审批提供；**不代替Yifan、Zhifeng、Jiawei、Xiang Yu或独立复核人的签认**。

## 字段和投影

| 问题                   | 当前实现                                                                                                                              | 来源                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 七天气是否另加CUSTOM   | 七类总计已包含CUSTOM：SUNNY、PARTLY_CLOUDY、CLOUDY、RAINY、STORMY、TYPHOON、CUSTOM；STORMY显示雷雨，风雨/暴雨合并，无HEAVY_RAIN第八项 | miniprogram/shared/constants.js、shared/weather.js                              |
| weatherName是否新增    | 已有字段；CUSTOM必填1—20码点，非CUSTOM不能残留；原请求绑定中保留原输入                                                                | shared/weather.js、validation.js、modules/journal/controller.js                 |
| 本人回顾是否带名称     | calendar/monthArchive/timeline本人标记可带CUSTOM的weatherName；不带正文、私人标签或内部ownerId/openid；档案cardTextPreview固定false   | cloudfunctions/moodsky/services/review.js、miniprogram/modules/review/reader.js |
| 分布是否按私人名称分组 | 只按七天气类别计数，无私人名称分组；insights从同一timeline快照派生，缺日期留白，不生成健康评分                                        | services/review.js、modules/review/reader.js                                    |
| 公共接口是否可带名称   | 本人回顾不是公共接口；公共地点/任务接口不能包含私人记录正文、私人名称、记录私人标签或身份。公共任务本身的公开tags不是记录私人标签     | shared/contracts.js及各公共投影白名单                                           |
| 响应字段有无新约定     | get/upsert仍为`{entry}`，本人entry白名单；delete仍为`{date,deleted}`。本轮未新增服务端action或字段                                    | services/journal.js、shared/contracts.js                                        |
| 未登录/停用错误码      | UNAUTHENTICATED / ACCOUNT_DISABLED；无UNAUTHORIZED枚举。其余沿用CONFLICT、INVALID_INPUT等既有错误                                     | shared/contracts.js、modules/journal/controller.js                              |

## 重试、冲突和日期

未知结果（网络/返回不匹配/内部错误）期间，控制器锁定输入并保留原requestId和完整payload，包括CUSTOM名称；不能先改新输入覆盖未确认的旧操作。确认业务CONFLICT后保留草稿、要求重读，不再将该已确认拒绝当作未知结果；新操作使用新ID，不以旧ID改payload重放。

最近30个北京时间自然日可新建，今天和29天前包含在内；30天前的空日不能新建，已有更早记录仍可带当前版本编辑。删除确认/版本检查、删除后新ID/递增版本和旧详情ID拒绝继续保留。

当前API/reader会话和来源版本保护保持最新实现；异步旧响应不代表服务端未提交。切号不能将A的请求/正文或旧失败带入B，也不能借旧失败清除B的登录。

## 接入门槛仍有效

YF02所列cloudEnabled配置只是技术接线条件，不能替代账号/索引/布局核验及具体云操作授权。正式私人业务保持关闭，旧本人pilot单次授权已执行并关闭；本次资料整合没有重新启用或写库。

YF03/YF04提到的2026-10-26截图未随PR #64提交；现有10月25日历史图不得当作这些新附件。模拟器/演示自报、旧手机反馈、独立设备及真实云分别记录。本答复没有新增设备或云验收。

后续请相关消费者实际回传确认，Yuen/Qizhen Cai独立核对；保留原文勾选、实际工时和估点，不由整合者代填。[成员整合记录](../../reviews/2026-10-27-member-integration/README.md)列明来源、取舍和验证。
