# W6-JQ · Jiaqi Zhu | 原生按钮按压与弹簧回弹

2026-11-21。交付目录按本人要求使用 `ZhuJiaqi`。代码以团队主分支 `6e91ead92dd8ecc143e38bff956ff239e4765296` 为基线，关联 [#217](https://github.com/HX-Jan/MoodSky/issues/217)。

按下按钮缩放至 0.94；实体主操作及选择按钮的轻阴影减弱。松手或取消触摸后，以刚度 260、阻尼 12、质量 1 的弹簧曲线回到 1，约 210ms 时轻微过冲到 1.017。使用按需启动的 WXSS 关键帧，覆盖 13 页和 3 个组件中的 147 个静态按钮定义，循环项分别记录状态。

- [交付报告与待复核项](W6_Jiaqi_Zhu_交付报告.md)
- [PR 正文](PR_BODY.md)
- [浏览器实测参数与八项结果](evidence/browser-motion.json)

代码在 `miniprogram/modules/presentation/button-press.js`、`miniprogram/styles/button-press.wxss` 及对应页面和组件中。截图为编译后的 WXML 在浏览器中的投影，保留实际 WXSS 和事件处理器；微信模拟器和手机体验待复核。页面主责及 Yuen 的独立结论待本人回传。
