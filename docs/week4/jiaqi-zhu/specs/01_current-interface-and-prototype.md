# JQ01 当前界面与原型差异及采纳状态

核对日期2026-11-05；main 43a72337316e515391fd0e8b8af8f779f21c1948。源码已采用、部署/公开能力、墨刀原型及设计建议分开。本轮未获取墨刀链接或当前手机截图，不编造像素对照。

## 固定来源

[项目首页及版本边界](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/README.md)、[线上0.3.0确认](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/docs/releases/v0.3.0.md)、[版本能力表](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/docs/week4/xiang-hong/h01-version-capabilities.md)、[当前手动打卡](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/docs/week4/xiang-hong/manual-checkin-20261104.md)、[11/05打卡历史分页](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/docs/week4/xiang-hong/campus-history-pages-20261105.md)。原平台发布和手机反馈只引用其原日期，不称本轮独立复测。

| 页面/范围     | 已采用的当前源码事实                                                                 | 线上/部署证据边界                                                | 待采用或仅原型项                                                      | 复核人                                    |
| ------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| Today/记录    | 七天气、CUSTOM单行1—20码点、正文/标签可空、保存回执与原请求恢复、下拉刷新            | 公开0.3.0已有云记录；最新菜单/返回保护不能从合并推定已更新手机包 | 墨刀20状态固定响应、旧网页内存保存不可证明真云；逐页设备对照待补      | Yifan                                     |
| Universe/回顾 | 本人月份、日期、详情、七类别分布；正文默认隐藏；装饰失败不阻断核心                   | 原有7/30/90回顾历史验证保留，非本轮设备结果                      | 六贴纸/两背景为本包文件交付，当前生产装饰仍未注入；拖拽/动画不在范围  | Zhifeng                                   |
| Campus        | 五地点推荐、自行前往手动完成、不获取GPS；本人状态/去重/原请求及历史分页已入main      | 新集合/云服务未部署；旧公开版校园空列表等历史状态不能当最新源码  | 墨刀中地图、自动到场核验、照片上传不适用当前范围                      | Qinghan                                   |
| Me/登录/资料  | 新个人中心、微信登录、可选头像昵称、原生分享、隐私/反馈入口；能力门禁依真实配置/会话 | 新登录资料预览来源与公开版不同，手机闭环需指定构建               | W3纯演示角色/两入口Me是历史，不覆盖新版；不能把分享理解成公开本人日记 | Linghan                                   |
| 账号与数据    | 正式账号页、导出状态/过期重申、偏好、注销/清理、未知操作与原生离开保护               | 0.3.0已有导出注销历史证据；当前修复是否部署逐条核对              | 墨刀“点击即全部删除”“固定20状态成功”不能当真实业务回执                | Linghan/生命周期负责人                    |
| 后台          | admin/index合成表单；places候选有读取、编辑、冲突及保存后重读，需可信身份/角色       | 真实Web身份、角色与生产装配仍有缺口，不能称正式运营后台上线      | 原型固定列表、直接保存、普通用户看私人记录均不构成已采用能力          | Qizhen Chen/Junhan，四页视觉由Linghan协调 |

源码细节：[Today模板](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/miniprogram/pages/today/index.wxml)、[账号页模板](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/miniprogram/pages/account/index.wxml)、[Me模板](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/miniprogram/pages/me/index.wxml)、[后台说明](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/admin/README.md)。

## 墨刀核对登记

URL、固定版本、20状态画板ID、交互连线及导出均未提供，状态WAITING_FOR_SOURCE。下页的20项是人工对照清单，不是已读取墨刀文件；每项补实际画板ID和对应构建后才可称逐状态复核。

四位页面负责人接收/修改意见、真实环境及日期均在 [共同确认表](04_owner-review.md) 留待本人填写。PR批准不等于页面已采用或已验收。
