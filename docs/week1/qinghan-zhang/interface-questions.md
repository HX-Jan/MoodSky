# QZ02—QZ05 接口、地图字段与待确认问题

全部为本地实现建议/问题，待成员确认；不代表正式 API 已变更。

## 沿用的入口

| action | 当前权限 | 本周调用方式 |
| --- | --- | --- |
| campus.listPlaces / getPlace | public | service 内显式合成适配器，沿用请求信封；未调用真实云端 |
| campus.supportResources | public | 页面展示待核验空态与未接入说明 |
| campus.favorites / correctPlace | private | 正式请求构造器保留；本周收藏是内存模拟，纠错不发送 |

所有真实调用仍通过 services/api.js；不传 ownerId/openid/role，不增加直接数据库访问。真实接口尚未实现，禁止用本地演示成功冒充服务端成功。

## 给 Junhan 与 Xiang Yu 的字段确认

| 范围 | 本地样例/建议 | 待确认问题 |
| --- | --- | --- |
| 列表筛选 | campus、tag、page、pageSize；演示每页 2 条 | 生产用 campusId/tagIds 还是字符串？多标签 AND/OR？最大页长与稳定排序？ |
| 分页响应 | items、page、pageSize、total、hasMore | 正式分页用页码还是 cursor？资料更新后的重复/遗漏处理？ |
| 未核验/失效 | 当前正式空态；合成列表保留过期/关闭并禁推荐 | 服务端是否过滤未核验？过期/关闭是否只在已收藏详情可见？ |
| 详情 | placeId、name、campus、address、source、openHours、openState、accessibility、verifiedAt、validUntil | 是否增加区域子项、临时关闭、门禁、来源链接/时间及核验人字段？ |
| 有效期 | 本地业务日期 YYYY-MM-DD，validUntil 当日有效 | 正式 verifiedAt 是日期还是 UTC 时间戳？时段跨午夜、节假日规则、缓存失效如何表达？ |
| 环境标签 | 合成标签由夹具生成，不提交新公共标签字典 | 用户原始标签如何映射为生产受控标签，交 Xiang Yu 核对 |
| 来源 | 候选均 user-provided，逐条 URL 为 null | 不可根据总体“小红书”说明补造每条来源；需补原帖/访谈/现场依据 |
| 无障碍 | 原始说明 + status=unverified + 具体核验项 | 路线、门槛、坡度、路面、电梯与区域可达性如何结构化？ |

本地 validUntil 仅表示资料有效期；openState=open 也不自动证明此刻处于营业时段。正式可前往推荐还需服务端提供当前开放状态或明确开放规则。当前所有展示地点是合成数据，全部 recommendable=false。

## 地图技术小验证与字段需求

| 字段/能力 | 门禁或用途 | 当前结果 |
| --- | --- | --- |
| longitude / latitude | 有限数值，分别在 [-180,180] / [-90,90] | mock 测试通过；真实值只保留在候选表 |
| location.coordinateSystem | 必须明确为 gcj02，才能交 wx.openLocation | 候选全部 unknown，未转换，禁止真实导航 |
| coordinateStatus | 必须 verified | 候选 unverified |
| verificationStatus / verifiedAt | verified 且日期真实、不晚于当前北京时间日期 | mock 门禁验证通过 |
| enabled / openState / validUntil | 启用、open、资料未过期 | 过期/关闭/未知均禁导航 |
| isSynthetic | 必须明确 false | 合成数据 true；生产缺值也不放行 |
| name / address / scale | 给地图展示；当前 scale=16 | 地址与入口需核验；最终长度规则待确认 |
| wx.openLocation | 仅主动按钮调用；失败回退列表 | 用 mock 验证，未调用真实地图 |
| wx.getLocation(type:gcj02) | 用户主动点击的能力小验证；坐标回调立即丢弃 | 请求 GCJ-02 不等于用户候选坐标就是 GCJ-02 |
| requirePrivacyAuthorize | 平台提供时先调用；拒绝不进入 getLocation | mock 验证；实际基础库兼容性待测试 |

首次生命周期、开启演示、筛选、查看详情均不调用定位/地图。打开目的地地图不依赖先获取用户位置。本地小验证不排序附近地点、不记录坐标、不缓存、不上传。平台内部的数据处理与地图提供方行为需 Qizhen Cai/Xiang Hong 对照实际隐私声明核验。

## 收藏与纠错流程待确认

1. favorites 的正式 payload 建议 operation=list/add/remove；list 无 placeId，add/remove 有 placeId。此处仅草案，未扩展公共合同。按可信 accountId+placeId 去重；重复 add 和 remove 均应返回当前最终状态。
2. 读取收藏列表如何分页？已关闭/过期/下架资源如何显示及取消？取消不应因地点下架失败。账户切换/注销/清理后由 Linghan 清除相关缓存。
3. correctPlace 建议 placeId+text；拒绝全空白，原始输入按 Unicode 码点 1—200，超限不截断，保留输入。服务端需同样校验；emoji、组合字符的码点定义需对齐。
4. 写入失败显示错误并保留输入；超时重试复用原 requestId 和原输入；不能重新生成请求后重复写入。本周没有发送真实纠错，因此未实现云端重试 UI。
5. 审核状态建议 pending/approved/rejected；需要 correctionId、反馈时间、非敏感反馈说明和本人查询入口。当前注册表没有已确认的纠错查询 action，请 Junhan 确认如何读取审核反馈。
6. 通过审核不等于立即公开原文；运营核验后更新结构化资料，保留可追踪审核记录。学生端不能修改审核结果；页面“模拟通过/驳回”仅显式合成演示。
7. 支持资源需授权、来源和有效期；无已核验资源时保持空态，不生成机构/电话。无公共评论或投稿入口。
