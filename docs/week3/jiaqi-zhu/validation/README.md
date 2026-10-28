# 检查复现与范围

本轮原型用本机Chrome headless和Playwright运行。`browser-check.cjs`只打开本包的本地HTML，使用合成输入；不会连接云端、执行真实访谈或启用微信项目。报告记录逐项结果，不代表读屏或手机认证。

在已安装Playwright及其Chromium的Node环境可运行：

```sh
node docs/week3/jiaqi-zhu/validation/browser-check.cjs
```

也可通过`MOODSKY_PLAYWRIGHT`指定本机Playwright模块路径，通过`MOODSKY_CHROME`指定Chrome可执行文件。工具依赖安装到自己的测试环境，不改变团队依赖文件。报告输出至本包`evidence/`。

当前工程的天气字段检查直接调用`miniprogram/shared/weather.js`和`validation.js`，结果见`evidence/contract-checks.json`。这些是离线校验，不是服务端鉴权或数据库验证。

工程检查按团队规定执行`npm run cloud:prepare`和`npm run check`。结果分别登记lint、格式、结构、类型和实际测试数，不与历史或本轮浏览器子集相加。
