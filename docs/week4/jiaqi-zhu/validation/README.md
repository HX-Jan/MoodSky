# 本地检查复现

在完整团队仓库中完成npm ci、npm run setup与云函数依赖准备后，可运行：

```sh
node docs/week4/jiaqi-zhu/validation/asset-contract-check.cjs
```

它只对当前candidate-router、回执策略和合成内存仓库显式注入本目录ID，不连接云端或打开生产功能。最初检查器将错误码读成r.code，与shared/result.js实际error.code不符；修正检查器字段后保持同样业务期望，最终11项通过，不修改工程实现或削弱断言。原失败报告保留在evidence/first-candidate-check.json。

浏览器检查需要自己的Playwright/Chromium测试环境（不改团队依赖锁）：

```sh
node docs/week4/jiaqi-zhu/validation/browser-check.cjs
```

也可设置MOODSKY_PLAYWRIGHT为模块目录、MOODSKY_CHROME为Chrome可执行文件。该脚本重导出PNG、更新文件哈希、运行问卷/预览并截图；不发送答卷，输出到本目录evidence。它不是微信开发者工具、原生读屏或手机验证。

工程要求运行npm run cloud:prepare与npm run check。本包源码审计、颜色、浏览器、候选、全仓库测试分别记录，不相加充当覆盖数或真实参与者。
