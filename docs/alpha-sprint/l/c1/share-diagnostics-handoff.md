# 分享链路脱敏诊断日志 · 交接说明（供蔡奇真 PR #225 使用）

提供方：Linghan Chen（@chenlinghan82-debug）。分支：`feature/alpha-l-share-diagnostics`（基于 main `7feca53ff0ed461cac270b7da7e7c36f36b7973b`）。本文为移交材料，实际真机运行、截图与结论由测试人本人完成；文中样例日志为**SIMULATED（本地模拟器采集格式）**，不代表真机结果。

## 一、实现原理（对应源码核对结论）

- 发送端：每个页面通过 `createAppShare({ route })` 生成 `onShareAppMessage`／`onShareTimeline`；`shareTarget()` 只允许白名单键进入 path/query（`fromShare` 恒为 `page`，`date`/`month`/`days`/`view` 均先经格式校验），记录 ID、回执、正文、账号标识在生成阶段即被剥离。
- 接收端：所有页面 `onLoad(options)` 的第一跳是 `prepareSharedPage(page, platform, config, route, options)`，按「时间线单页预览 → 私人页登录重定向 → 按当前会话加载」三个分支处理，返回值与页面加载互不携带发送方数据。
- 日志仅在**测试构建**输出：`environment.local.js` 显式设置 `shareDiagnostics: true` 且 `releaseProfile !== 'production'` 时才生效；正式构建即使误配也不输出。
- 参数白名单：`fromShare`、`date`、`month`、`days`、`view`；其他键只记键名与数量（`unexpectedKeys`／`unexpectedKeyCount`），值一律不落日志。

## 二、修改文件清单

| 文件                                             | 变更                                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `miniprogram/modules/share/share-diagnostics.js` | 新增：脱敏日志模块（`logShareSend`／`logShareReceive`／`redactPath`），白名单与格式校验，禁字段的值永不输出                                                                                            |
| `miniprogram/modules/share/app-share.js`         | 接入：`createAppShare` 两个分享回调记录 `share_send`；`prepareSharedPage` 记录 `share_receive` 与 `sessionResolution` 枚举（`receiver_self`／`login_redirect`／`guest_public`／`single_page_preview`） |
| `tests/share-diagnostics.test.js`                | 新增：8 项用例，断言日志与 path/query 不含正文、jobId、账号标识、openid/token 等，且非测试构建完全静默                                                                                                 |

提交 SHA：以分支 head 为准（见推送记录）；测试人合并后以其 PR head 的完整 SHA 作为日志中 `buildSha` 的期望值来源（构建时写入 `environment.buildCommit`）。

## 三、测试人如何安装并运行 A→B 分享

1. 合并/拉取本分支到你的验证分支后，在**你自己的预览副本**（不动候选配置）把 `miniprogram/config/environment.local.js` 改为：
   ```js
   module.exports = {
     cloudEnabled: false,
     cloudEnvId: '',
     shareDiagnostics: true,
   };
   ```
   只在预览副本设置，不上传个人配置；候选包与正式构建保持 `shareDiagnostics` 缺省（关闭）。
2. 微信开发者工具打开该副本（AppID 用你的测试号），点「预览」生成二维码。
3. 手机 A 扫码打开构建，进入「我的」→ 右上角「···」→ 转发给手机 B 的微信；B 打开卡片。
4. A 端日志：开发者工具 Console 面板（或真机调试的 vConsole）过滤 `[share-diagnostics]`，取 `event=share_send` 一条。
5. B 端日志：B 手机打开后若在调试模式可从 vConsole 读取 `event=share_receive` 一条；注意 B 打开的是 B 自己的会话（`sessionResolution=receiver_self`）或未登录时的 `login_redirect`。
6. 把两条原始日志、两张卡片截图（脱敏）与你的独立结论放入你的 PR；本文件提供方不代填真机结果。

## 四、日志模板

发送端：

```json
{
  "event": "share_send",
  "route": "<页面路径>",
  "safePath": "<仅白名单键的脱敏路径>",
  "queryKeys": ["<键名数组>"],
  "buildSha": "<40位完整提交号或unknown>",
  "environmentLabel": "test",
  "timestamp": "<ISO-8601>"
}
```

接收端：

```json
{
  "event": "share_receive",
  "route": "<页面路径>",
  "optionKeys": ["<仅键名>"],
  "fromShare": true,
  "sessionResolution": "receiver_self|login_redirect|guest_public|single_page_preview",
  "buildSha": "<40位完整提交号或unknown>",
  "environmentLabel": "test",
  "timestamp": "<ISO-8601>"
}
```

出现白名单之外的键时追加 `"unexpectedKeyCount":N,"unexpectedKeys":["键名"]`；任何情况下不输出 openid、unionid、token、cookie、昵称、头像、日记正文、导出内容、完整账号标识或私有参数值。

## 五、样例日志（SIMULATED · 本地模拟器采集，非真机结果）

以下为在本地禁云模拟器（iPhone 12/13 Pro、基础库 3.17.4、touristappid）运行同源码采集的格式样例，仅证明字段结构与脱敏规则，**不是 A→B 真机日志**：

```json
{"event":"share_send","route":"pages/me/index","safePath":"/pages/me/index?fromShare=page","queryKeys":["fromShare"],"buildSha":"unknown","environmentLabel":"test","timestamp":"2026-11-24T10:57:40.000Z"}
{"event":"share_receive","route":"pages/review/detail/index","optionKeys":["fromShare","date","id","text"],"fromShare":true,"sessionResolution":"receiver_self","buildSha":"unknown","environmentLabel":"test","timestamp":"2026-11-24T10:57:40.000Z","unexpectedKeyCount":2,"unexpectedKeys":["id","text"]}
```

第二条模拟「有人把私有参数手工拼进链接」的接收场景：`id`／`text` 被计为意外键，值不出现在日志中。

## 六、验证与边界

- `node --test tests/share-diagnostics.test.js`：8 通过 0 失败；`tests/page-sharing.test.js`＋`tests/week5-linghan-login-share.test.js`＋`tests/week6-linghan-login-share-export.test.js` 相关回归 26 通过 0 失败；`npm run cloud:prepare`、`npm run check`、`git diff --check` 在本分支实跑通过。
- 自动化与模拟器日志只证明源码行为；A/B 两台真机的分享卡片、接收页数据归属与最终独立结论以蔡奇真本人执行为准。
