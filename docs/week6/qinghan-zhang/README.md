# W6-QH 校园地点与手动打卡前端验收

日期：2026-11-17，北京时间。任务负责人：Qinghan Zhang / qinghanz6。状态：**待复核**。本报告由 AI 协助本地执行、整理，不代填本人签认或独立验收。

## 结论与构建来源

基线为 `13afb20956f5b115cfd393487aee8bbe570ea8d3`，版本 0.5.1。来源是用户提供的 MoodSky-main (4).zip；ZIP 注释、公开 GitHub main、原始文件重建的 Git tree 和签名提交哈希相符。该提交是任务书基线 `987b19d675bfe7a8f4b14c0cb1b25d508483d329` 的后继文档提交。

本地自动验证通过：完整 check 为 **1604/1604**，校园及任务入口定向验证为 **253/253**，生产装配合成联调 **8 组通过**。253 项属于全量测试子集，不能相加。执行环境为 Windows、Node 24.22.1、本地 npm 12.2.2；业务数据均为替身或合成数据，没有连接真实业务云。

未发现本次执行范围内需要修改的业务断言失败，因此不改业务源码。地点限制展示缺口及来源缺口保留为待复核问题。功能通过的范围以以下逐项表和证据为准，不能据此宣布团队整周完成或生产放行。

## 交付文件

- [五地点逐条核对表](five-places.csv)：名称、校区、方位、理由、开放及进入限制、日期、有效期和待确认字段。
- [执行用例明细](executed-cases.csv)：253 条真实执行用例，对应 [TAP 日志](evidence/campus-tests.tap)。
- [完整检查](evidence/check.txt)、[生产装配合成联调](evidence/production.txt)、[共享模块准备](evidence/prepare.txt)。
- [请求与响应样例](evidence/response-samples.json)：9 次实际本地生产入口调用，排除会话与身份凭证。
- [可重跑的样例采集脚本](capture-responses.cjs)：运行后校验断言并重新生成样例。
- [来源与结果元数据](source-and-results.json)。
- [原生模拟器记录与剩余步骤](native-review.md)。
- [供审核的 PR 说明](pr-description.md)。

## 页面流程与回执对照

以下均在上述基线重新运行，不引用第五周截图作为本周结果。除另注的原生检查外，页面测试是 Node VM 中加载实际 Page/controller，平台 API 为替身，不能等同微信渲染或真实登录。

| 验收项         | 初始条件与步骤                                                      | 预期与实测                                                                              | 证据与层级                                                      |
| -------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 五地点资料     | 对照历史 catalogue、approved record 与 shared/campus-checkins       | 五个稳定 ID、名称和方位一致；校区由手动页统一展示；推荐文案概括匹配。具体限制未逐项呈现 | five-places.csv；源码核对，待 Junhan 复核                       |
| 任务入口       | enabled 合成会话选择散心/校园阅读类任务                             | 服务确认选择后导航到 campus?fromTask=1；closed 不开放入口，readOnly 不允许状态写入      | week5-qc-task-entry；全量及定向 TAP                             |
| 选点与完成     | 实际校园 Page 以 fromTask=1 加载，先点选这里，再点完成              | 选点仅改本地 chosenTaskPlaceId，不写打卡；只有显式完成目标地点才发 campus.checkIn       | manual-campus-client：task visitors choose a place locally…     |
| 游客           | 浏览后点完成或本人历史                                              | 保持公开地点，跳登录并保留返回意图；登录返回本身不自动打卡                              | manual-campus-client；campus-history-client                     |
| 开放与暂停     | 合成读响应切换 writesPaused；刷新后重试                             | 暂停文案明确，保留推荐及历史，禁止新写；开放刷新后恢复。旧服务接口缺失有明确提示        | manual-campus-client：old and paused campus backends…           |
| 服务确认与连点 | 写响应延迟，连续点击                                                | 确认前不标完成；同一处理中不发第二次写，完成态来自服务返回                              | manual-campus-client；manual-campus-checkin                     |
| 失败及未知结果 | 模拟断网、超时、回执丢失、隐藏/重开                                 | 保留 outbox 原请求与输入，用户显式重试复用 requestId；本机保存失败则阻止写入            | manual-campus-client；checkin-outbox；checkin-outbox-production |
| 跨日恢复       | A 于北京 11/17 23:59:59 成功，11/18 00:00:01 重放原请求，并暂停新写 | 返回 11/17 原完成时间与 replayed=true；当日为11/18空状态；记录总数仍1                   | response-samples.json；campus-daily-refresh；本地生产入口       |
| 暂停时原回执   | 同一请求已成功后暂停，重放原请求，再发新请求                        | 原请求仍返回保存回执；新请求 NOT_IMPLEMENTED；已有历史仍读得出                          | response-samples.json；manual-campus-checkin                    |
| 本人历史分页   | page/pageSize，多页、失败、总量改变与混合 UTC 精度                  | 顺序正确、重复读取共用在途请求；失败保留已确认行并重试原页；总量改变要求重读第一页      | campus-history-client；manual-campus-checkin                    |
| 切号及迟到响应 | 延迟 A 请求，切 B 再返回 A 结果                                     | 清空 A 私有状态，不回填 A 行，不释放 B 新请求的加载态；B 不重放 A 请求                  | campus-history-client；manual-campus-client；outbox 测试        |
| 下架地点       | 合成旧历史含已不在 PLACES 的 ID                                     | 本人旧历史仍可读，不提供该地点新打卡；新写拒绝且数据不变                                | campus-history-client；manual-campus-checkin                    |
| 非法日期与回执 | 无效日期、UTC 与北京时间日不匹配、返回地点不同                      | 拒绝错误响应，不伪造成功或错误完成态                                                    | manual-campus-client；campus-history-client                     |

业务日期使用北京时间；completedAt 为 UTC。原请求重放 replayed 与同日已有记录 duplicated 是不同语义，按各接口实测形状核对，不能强制补不存在字段。新写请求只传 placeId，不传 ownerId、经纬度或声称已到场。

## 五地点与待复核问题

1. **QH-W6-01：具体限制未呈现在正式手动页。** 大梦书屋二层餐吧需消费、光彩创咖店内需消费等已有记录，仅在历史资料中存在。当前手动页只显示统一“开放情况以现场为准，请留意校园公告”。用户已于2026-11-17明确确认五地点资料全部无变化并可持续沿用，后续变化由用户先行告知，不再把每周重复确认资料作为前置。Junhan、Yuen复核的是页面限制展示的处理及功能契约，不要求重新证明未变化资料。不得把历史营业时段改成实时开放保证。
2. **QH-W6-02：来源证据边界。** 历史记录来自成员观察和问询，无公告照片/官方链接，问询日期及岗位未单独提供。用户确认没有变化，本次据此沿用，未重新实地核验。没有替 Junhan 写“已确认”。
3. **下架定义边界。** 本次自动用例验证“历史地点不在当前推荐 PLACES”情形。正式手动推荐来自静态 PLACES，不以旧 places 审核集合 enabled 为门槛；不能将数据库随意设 enabled=false 宣称已验证完整下架传播。若需线上动态下架，交 Junhan/集成人另确认协议。

资料有效期按原现场日期起算六个月；它只表示资料记录的时间范围，不代表持续营业或独立验收。没有新增 GPS、地图、照片、公开到访记录或无障碍保证。

## 执行与复现

在项目根目录，Node 24 及 npm 可用时：

```powershell
npm.cmd ci
npm.cmd ci --prefix cloudfunctions/moodsky
npm.cmd run setup
npm.cmd run cloud:prepare
npm.cmd run check
npm.cmd run team:check:production
node docs/week6/qinghan-zhang/capture-responses.cjs
git diff --check
```

本机原无 npm，使用工作副本外下载的 npm CLI 和本地 shim，未改项目依赖或锁文件。首次缺 SDK 的加载失败记录、ZIP 无 Git 导致的打包失败、沙箱阻止 loopback 的失败保留在外层 week6 日志；补齐依赖、对应 Git 元数据并允许本机 127.0.0.1 后，完整检查重跑通过。没有删测试、修改断言或连接真实云来凑通过。

## 隐私与交接

仅新增本地验收资料和合成响应采集脚本，不改采集字段、用途、SDK、存储、授权、导出或清理逻辑。响应不含真实 OpenID、scope、凭据或用户正文；日志个人路径已替换。个人环境配置、Git 元数据恢复工具、依赖和云备份不进入交付目录。

Junhan：依据用户确认沿用的五地点资料，复核前端展示映射、9份接口样例及下架定义。Yuen：在最终集成提交复测受影响路径并确认模拟器证据。本人签认、实际工时、独立复核及洪翔放行均未代填。

本周不部署云函数、不修改真实集合或开关、不上传微信代码。正式候选装配仍由 W6-YL 从最终干净提交执行；本报告不冒充团队候选包。真实云校园读取、暂停和历史进入后续交接。
