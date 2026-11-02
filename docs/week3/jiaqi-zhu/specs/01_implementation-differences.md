# JQ01 · PR48与当前工程差异

2026-10-28，固定基线 7237511a7e61b317a91a0b5ad2f6a987a67bacca。[PR48历史入口](https://github.com/HX-Jan/MoodSky/blob/7237511a7e61b317a91a0b5ad2f6a987a67bacca/docs/week2/Jiaqi%20Zhu/README.md) 与原preview文件保持原样。这里的“源码已存在”不是公开上线或真机通过。

| 项目       | PR48五天气研究网页                            | 当前工程 / 证据                                                                                             | 本轮处理                                                                 |
| ---------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 类别       | SUNNY/PARTLY_CLOUDY/CLOUDY/RAINY/STORMY       | shared/constants.js的七类总计含TYPHOON、CUSTOM                                                              | 新网页采用七类，旧网页冻结；不改工程枚举                                 |
| 显示名     | 小雨、风雨                                    | RAINY雨天；STORMY雷雨，风雨/暴雨合并                                                                        | 本轮网页与现有工程同名，不新增暴雨按钮                                   |
| CUSTOM字段 | 无可提交CUSTOM；W1旧提案另为1—10字/选图标底色 | shared/weather.js：weatherName首尾trim后1—20码点；禁控制字符/换行；非CUSTOM出现字段即拒绝                   | 补命名输入、Unicode计数、错误、编辑与原请求重试；不实现旧选色/换图标提案 |
| 必选与选填 | 天气必选、正文/标签可空                       | shared/validation.js保留1000码点正文、最多5固定标签                                                         | 同一规则；正文不要求解释天气                                             |
| 私人名称   | 无                                            | 本人日历/档案/时间线可含weatherName；不含正文、标签、ownerId；统计只按七类别                                | 网页记录/详情显示原名称，校园不读名称；不称名称属于日记正文              |
| 保存/失败  | 独立网页内存与未接入情境                      | journal/controller.js真实回执与本地文案分开；NETWORK_ERROR/INVALID_RESPONSE/INTERNAL_ERROR保留未知原请求    | 原型只说本地演示；不模拟“云端保存成功”为实际结果                         |
| 未知结果   | 锁输入，重试原操作                            | 保留完整payload含CUSTOM；重试前置失败不能清除既有未知请求；CONFLICT是已确认拒绝                             | 网页补CUSTOM快照回归；工程由现有测试与负责人复核，不用原型代替           |
| Me开发模式 | 本地合成角色、入口参考                        | pages/me/index.wxml：默认开发仍有合成账号及模拟流程                                                         | 单列来源，不称其为体验版功能                                             |
| Me体验模式 | PR48不是当前体验版                            | config/experience.js：presentationProfile=experience且journalDemo=true且cloudEnabled=false；页面仅隐私/帮助 | 新研究网页以简化入口展示，生命周期另做明确标注的说明卡                   |
| 本人pilot  | 无                                            | isPilot单独分支，只读已授权本人测试入口；来源报告说已关闭                                                   | 本包不启用云开关、不重新执行本人测试                                     |
| 任务/校园  | 自愿任务及合成地点                            | 体验任务离页清空、示例建议；地点资料待复核、天气示意固定模拟                                                | 保留自愿/非真实采集说明；不把任务前端交付当研究样本                      |

来源：[七天气与限制](https://github.com/HX-Jan/MoodSky/blob/7237511a7e61b317a91a0b5ad2f6a987a67bacca/miniprogram/shared/constants.js)；[命名校验](https://github.com/HX-Jan/MoodSky/blob/7237511a7e61b317a91a0b5ad2f6a987a67bacca/miniprogram/shared/weather.js)；[记录控制器](https://github.com/HX-Jan/MoodSky/blob/7237511a7e61b317a91a0b5ad2f6a987a67bacca/miniprogram/modules/journal/controller.js)；[回顾投影](https://github.com/HX-Jan/MoodSky/blob/7237511a7e61b317a91a0b5ad2f6a987a67bacca/cloudfunctions/moodsky/services/review.js)；[体验版说明](https://github.com/HX-Jan/MoodSky/blob/7237511a7e61b317a91a0b5ad2f6a987a67bacca/docs/releases/experience-20261026.md)；[后端负责人10/27答复](https://github.com/HX-Jan/MoodSky/blob/7237511a7e61b317a91a0b5ad2f6a987a67bacca/docs/week3/xiang-hong/contract-reply-20261027.md)。

## 实际确认表

| 页面负责人    | 本轮需确认                                   | 实际意见/日期 | 状态   |
| ------------- | -------------------------------------------- | ------------- | ------ |
| Yifan Ji      | 七天气/CUSTOM/保存/原请求/草稿与日期         | 未收到        | 待复核 |
| Zhifeng Dai   | 名称投影、七分类统计、卡片隐藏正文、版本失效 | 未收到        | 待复核 |
| Qinghan Zhang | 校园模拟标识、地点来源与私人字段隔离         | 未收到        | 待复核 |
| Linghan Chen  | tokens、模式入口、读屏/状态文案与生命周期    | 未收到        | 待复核 |

当前仓库已有Yifan和Zhifeng本人周报、Xiang Hong契约答复；它们作为有作者的历史来源，不替代四人对本包的实际确认。PR48、PR59、PR64审批也不代签。
