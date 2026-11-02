# MoodSky 第一周 Yifan Ji 协作交接

提供人：Xiang Hong。接收人：Yifan Ji。任务：W1 YF01—YF05。整理日期：2026-10-16。代码基线：`a75e207ba565e17bae80e633d0a381a53e37202b`。

交接状态：材料已整理，待接收人复核；不代填本人确认或验收结论。

请按 H02 准备 Today 页面样例，重点交付 YF03 的五组日期与版本边界，并交接保存失败、重试及轻选择步骤。

## 我提供的接口与字段

journal.get({date}) 拟返回 data.entry 或 null；journal.upsert 保存完整表单并拟返回 data.entry；journal.delete({date,expectedVersion}) 拟返回 data.date 和 data.deleted。H02 草稿已获拥有者审查，协作成员复核仍待完成；真实记录后端尚未实现。

| 字段                    | 提供的规则                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| date 与 expectedVersion | 真实 YYYY-MM-DD，北京时间业务日。首次新建用 0；已有记录编辑和删除沿用最近读取的 version。expectedVersion 大小写固定。 |
| weather                 | 必选 SUNNY、PARTLY_CLOUDY、CLOUDY、RAINY、STORMY 之一。                                                               |
| tags 与 text            | 标签可空、最多 5 个固定标签；正文可空、最多 1000 个 Unicode 码点。编辑必须保留完整 tags/text，省略会按空值处理。      |

固定标签为 STUDY、REST、EXERCISE、SOCIAL、ALONE_TIME、ANTICIPATION、TIREDNESS、CALM。正文长度使用 Array.from(text).length；组合 emoji 的码点数可能多于可见图形数。

## 五组页面输入样例

统一使用合成时钟 2026-10-15T04:00:00.000Z，业务日为 2026-10-15；天气 SUNNY、标签 ["STUDY"]、正文“合成页面样例”。每组有独立前置数据，避免其他样例的记录污染空态。

| 样例       | 前置条件                            | 版本   | 预期页面行为                                                         |
| ---------- | ----------------------------------- | ------ | -------------------------------------------------------------------- |
| 今天       | 2026-10-15；该日无记录 / 已有版本 2 | 0 / 2  | 无记录可新建；已有记录回填并保存修改，版本 2 成功后变 3。            |
| 29 天前    | 2026-09-16；该日无记录              | 0      | 可新建；属于今天及此前 29 天的窗口。                                 |
| 30 天前    | 2026-09-15；该日无记录              | 不发送 | 禁用新建并提示日期限制；负向接口输入由服务端另行校验。               |
| 较早旧记录 | 2025-01-01；已有版本 3              | 3      | 可编辑；成功后为版本 4，id 与 createdAt 不变。该日无记录则不能新建。 |
| 冲突版本   | 页面持有版本 2；替身已更新为版本 3  | 2      | 返回 CONFLICT，保留草稿；确认放弃草稿后再读取当前记录，重新编辑。    |

今天一组包含新建和已有记录两个子状态。30 天前一组前端不应发写请求；服务端的负向拒绝另列测试。日期窗口以服务端时钟最终判断；使用本地固定时钟展示，不修改电脑系统时间。

## 请求样例与运行方法

```json
{
  "apiVersion": "1",
  "requestId": "req_yf03_today_001",
  "action": "journal.upsert",
  "payload": {
    "date": "2026-10-15",
    "weather": "SUNNY",
    "tags": ["STUDY"],
    "text": "合成页面样例",
    "expectedVersion": 0
  }
}
```

1. 先按 docs/development.md 初始化项目。只在 environment.local.js 中开启下面的显式内存演示，重新编译后操作 Today；数据不进入云数据库。
2. today-controller.test.js 已有 now 注入、seedEntries 和冲突测试。较早旧记录和冲突两组通过隔离测试夹具或标注原型展示；普通演示页面没有一键注入这些前置条件的按钮。
3. 每组保存截图或原型，附前置条件、输入、按钮状态、提示、预期与实际、证据链接。文件名建议 yf03-date-edit-boundaries.md，放 docs/week1/yifan-ji/。

```javascript
module.exports = {
  cloudEnabled: false,
  cloudEnvId: '',
  journalDemo: true,
};
```

## 失败重试和相邻成员交接

保存中禁用重复提交。不确定网络结果重试时复用原 requestId 和完整 payload；修改输入后属于新逻辑请求。CONFLICT 是已知拒绝，先处理草稿并读取新版本，再由用户重新编辑；不能只替换 expectedVersion 自动覆盖。controller 的 onChanged 回调在成功后提供 {date,kind}，可与 Linghan、Zhifeng 讨论统一刷新方案；当前页面尚未接入该回调，跨页集成仍待实现。

未保存日记也可使用轻选择；tasks.quickChoice 的具体 choice 值和入口由 Jiawei、Linghan 共同确认。接口存在并不代表任务建议已上线。

## 你需要交回什么

- YF03 日期交互说明和上述五组样例，附 Xiang Hong 的实际反馈；原型、本地替身、模拟器和云端结果分别标识。
- YF01—YF02 表单交互与输入边界；YF04 保存中、失败保留和原请求重试轨迹；YF05 轻选择入口及给 Yuen 的操作步骤。

完成判断：每组前置和页面反馈可以复现，版本冲突保留输入；服务端仍检查可信身份、记录归属、日期窗口、同日唯一和版本。

## 共同回传格式与提交方法

每项交付请带：任务编号、成果路径或 PR、实际使用的提交版本、环境类型、预期和实际、复核意见、实际耗时、后续任务点数、阻塞与下一步。状态采用待开始、进行中、待复核、已验收、阻塞。接收与验收意见由本人实际确认后填写。

成果放 docs/week1/本人目录；修改代码时同步相关 service、校验与测试，检查通过后提交本人分支的 PR。成员 PR 由 Xiang Hong 审批；负责人先处理成员 PR，再同步主分支、整合和发布。共享接口、数据库或导航变更交对应负责人共同复核。

本包仅整理已有资料和本地样例，未发消息、上传 GitHub、部署、修改云资源、执行新云端写入或清理。后续操作仍按已约定范围办理。管理员登录由本人手动完成，管理员密码、微信身份、指纹和凭证不进入公共文档。

## 材料入口和版本

以下均为仓库根目录内的现有材料。

- [第一周任务与验收要求](../../first-week-detailed-plan.md)：`docs/week1/first-week-detailed-plan.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/first-week-detailed-plan.md)。
- [H02 记录接口审查草稿](../w1-h02.md)：`docs/week1/xiang-hong/w1-h02.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h02.md)。
- [天气 标签 限制和偏好默认值](../../../../miniprogram/shared/constants.js)：`miniprogram/shared/constants.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/shared/constants.js)。
- [统一请求创建与响应检查](../../../../miniprogram/services/api.js)：`miniprogram/services/api.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/services/api.js)。
- [Today 记录 controller](../../../../miniprogram/modules/journal/controller.js)：`miniprogram/modules/journal/controller.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/modules/journal/controller.js)。
- [Today 内存测试替身](../../../../miniprogram/modules/journal/demo-service.js)：`miniprogram/modules/journal/demo-service.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/miniprogram/modules/journal/demo-service.js)。
- [Today 日期 冲突与重试本地测试](../../../../tests/today-controller.test.js)：`tests/today-controller.test.js`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/tests/today-controller.test.js)。
- [项目导入和本地演示方法](../../../development.md)：`docs/development.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/development.md)。
- [H03 可靠写入与删除设计](../w1-h03.md)：`docs/week1/xiang-hong/w1-h03.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/week1/xiang-hong/w1-h03.md)。
- [2026 年 10 月 15 日成果与证据边界](../../../test-reports/2026-10-15/README.md)：`docs/test-reports/2026-10-15/README.md`；[固定版本](https://github.com/HX-Jan/MoodSky/blob/a75e207ba565e17bae80e633d0a381a53e37202b/docs/test-reports/2026-10-15/README.md)。
