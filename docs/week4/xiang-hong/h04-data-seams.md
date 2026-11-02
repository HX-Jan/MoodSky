# W4 H04 新增模块数据接缝

核对production/backend.js、services/account-data.js、domains/export.js、production/exports.js、tools/export-candidate/formatter.js和production/cleanup.js。调用方传可信内部ownerId，客户端payload不得授权或选择他人。

| 模块          | 源码写入/修订                                                | 导出投影                                                         | 清理与实际缺口                                                    |
| ------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| 记录          | 事务内journals修订，日期版本/原请求                          | journals含weatherName、正文、标签、版本及时间，隐藏/删除态不输出 | 生产清理含journals及回执/删除标记；本周修复旧账号草稿内存接缝     |
| 收藏          | 候选存在，生产写入口关闭；sources.favorites为来源计数        | favorites投影placeId等本人字段                                   | favorites在生产清理白名单；候选写入与生命周期围栏仍需Junhan对齐   |
| 纠错          | place_corrections候选存在，生产写入口关闭                    | 当前完整导出格式不含纠错正文；不能称所有模块完整覆盖             | 生产清理含place_corrections；若计划新增导出需共同契约及修订域方案 |
| 任务          | production已装配事务存储，sources.tasks推进                  | taskHistory字段按formatter，非模板内部/身份字段                  | task_history清理，task_templates保留；共同规则与正式模板仍待确认  |
| 偏好/头像昵称 | 事务内sources.preferences推进，资料嵌在preferences.profile   | cardTextPreview、decorationsEnabled、profile                     | preferences一并清理；Me/资料读取与手机验收另列                    |
| 装饰          | 显式候选推进sources.decorations和exportEpoch；生产目录未注入 | monthDecorations：合法目标转targetDate，已删/非本月目标过滤      | month_decorations清理，正式资源及存储交接未就绪                   |

导出有界快照使用journals/favorites/tasks/preferences/decorations五个来源域；缺少布局或计数时拒绝，不伪造0。当前生产内容存在受限export_jobs文档，最长24小时，由本人身份领取；不是公开临时URL或5分钟云文件。源修订变化使旧任务expired，领取返回CONFLICT。

## 新组合验证

tests/week4-hong-data-seams.test.js新增3项：

1. 生产收藏/纠错写入与装饰入口返回NOT_IMPLEMENTED且不修改合成库；候选存在不意味着自动开放。
2. 任务选择、偏好关闭、装饰候选保存分别使先前导出失效；重试不重复推进装饰修订。JSON中关闭偏好仍保留装饰配置，目标为日期而不是内部ID；B领取A被拒；删除目标后候选和新导出无悬空引用。
3. 混合模块写入后停用A，装饰候选也被拒。分批清理完成并重复执行幂等，B数据和places/support_resources/task_templates原样保留，A不能重新登录复活。

测试只用本地合成库，无生产写删。独立复核人Qizhen Cai，Junhan/Jiawei/Xiang Yu共同确认仍待回传；尤其纠错导出及候选写入围栏不能据本报告宣告完成。
