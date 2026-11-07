# JQ02 可访问性与理解检查

日期2026-11-05，固定 43a72337316e515391fd0e8b8af8f779f21c1948。本轮实际读取当前模板、CSS和状态代码，并测量本地问卷/素材预览；未执行当前微信原生、手机或屏幕阅读器。不能把本地工具检查扩写成整应用合规。

## W3待测问题的当前变化

| 问题           | 本轮当前源码观察                                                                         | 优先级/处理                                      | 真正复测结论与负责人                                     |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| W3日期热区小   | Today .nav-btn已加min-width/min-height:44px；date-chip也有44px最小高                     | P2：不再错误报告“只有65rpx”；源码已改善          | 真实命中区域、遮挡和小屏待测；Yifan/Linghan              |
| 关键提示22rpx  | Today demo-banner/operation-notice等已改14px                                             | P2：旧报告留历史，按新样式复核                   | 整页/系统字号放大与键盘待测；Linghan                     |
| 天气选中读屏   | Today/record天气aria-label含已选择/未选择；CUSTOM输入含长度/私人提示；标签有aria-pressed | P2：源码已补语义，不再称完全缺标签               | 原生读屏能否正确朗读、焦点/顺序仍待实际听测；Yifan       |
| 回顾日期语义   | 日期格有aria-label、aria-disabled、记录格role=button，月份按钮有名称                     | P2：待焦点/等价入口验证                          | 不能由模板证明读屏实机可操作；Zhifeng                    |
| 账号状态与控件 | role=status/aria-live，格式/重试/过期重申按钮有标签；部分44px热区已采用                  | P1：未知结果/注销状态理解优先                    | 真实失败、原生离开、停用/清理解释仍待设备与研究；Linghan |
| 私人/未开放    | Me有能力列表、未开放标签、隐私入口；保存模式依配置/可信会话                              | P1：区分未登录、未配置、未实现和失败             | 本轮无真实受访者理解结论；四页负责人                     |
| 静态颜色       | 重读14个当前颜色，有限8组重新计算见data                                                  | 正文>=4.5:1参考；边线作为非文字用途单列          | 不是W3旧20组，也不是全应用通过；Linghan                  |
| 字体放大       | rpx或px单位本身不能证明随系统字体放大                                                    | P1：核心表单、长CUSTOM、返回框、底栏、键盘一起测 | 当前原生/手机未测；本轮问卷网页200%根字号单列            |

当前来源：[Today样式](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/miniprogram/pages/today/index.wxss)、[天气与CUSTOM标签](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/miniprogram/pages/today/index.wxml)、[回顾模板](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/miniprogram/pages/universe/index.wxml)、[账号标签/状态](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/miniprogram/pages/account/index.wxml)、[共享变量](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/miniprogram/styles/tokens.wxss)。

## 分层结果记录

1. SOURCE：源码/色值/语义读取，不是运行结果。
2. BROWSER_ARTIFACT：本包问卷和素材预览实际Chrome运行；44px选项行、320/390/768/1440无横向整页溢出、200%根字号、键盘焦点/同意退出等见browser-validation.json。标签存在与焦点检查不等于真实读屏听测。
3. NATIVE：当前小程序逐页/账号/后台的模拟器及原生辅助功能未执行；本轮未尝试重启授权，不沿用W3工具失败作为新运行结果。
4. PHONE：本轮没有用户提供的新设备记录；机型/系统/微信/字体/读屏/键盘/真实弱网全部留待填写。

本项目优先44×44px可点击热区；WCAG2.2 AA最小目标为24×24 CSS像素且有间距/等价等例外，低于44不直接等于AA失败。正文对比及200%缩放有完整上下文，有限组合和单页压力检查不能认证整个应用。[目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)、[对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[文字缩放](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)。

## 实测表（待实际填写）

构建SHA/线上包____；模式及开放能力____；页面____；设备/系统/微信/基础库____；字体/读屏设置____；操作和合成输入____；真实观察____；截图/音频摘录位置（脱敏）****；优先级****；负责人____；修订/复测结果____。没有执行的项填未测，不填通过。
