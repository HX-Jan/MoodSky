# 云函数测试环境部署审批请求（给 @HX-Jan）

- 申请人：Yuen Lin（832401211）
- 日期：2026-10-17
- 关联：W1 YL03、第一周验收“实际云端 system.health 有版本和调用证据”
- 当前状态：**只读检查完成，未上传、未修改云资源、未改数据库**

## 申请内容

请批准将 0.2.1 云函数包上传到测试环境，用于 YL03 的 `system.health` 真实调用证据。

| 项目        | 值                                                          |
| ----------- | ----------------------------------------------------------- |
| 源码提交    | `1be13f8287e177ae3f057a9298164eb631181778`                  |
| 包版本      | `0.2.1`                                                     |
| 测试环境    | `mood-sky-d5gqy3spkff37566d`                                |
| 函数名      | `moodsky`                                                   |
| 部署目录    | `npm run cloud:package` 输出的 `moodsky` 目录               |
| 包内容      | `index.js`、`package.json`、`package-lock.json`             |
| SDK         | `wx-server-sdk 4.0.2`                                       |
| 运行时      | 历史记录为 Nodejs16.13；本次不修改运行时配置                |
| 数据库/权限 | **不修改**；由 Xiang Yu 负责                                |
| 回滚        | 保留上一版部署包和提交号；失败时重新部署上一版并复测 health |

## 只读检查结果

- `cloud env list` 返回 `mood-sky-d5gqy3spkff37566d` 和 `hx-jan-d6gbn0oj7e26e0d6e`。
- `cloud functions list --env mood-sky-d5gqy3spkff37566d` 返回 `moodsky`、`moodsky-h03-probe`。
- 证据：`artifacts/yl03/cloud-env-list.txt`、`artifacts/yl03/cloud-functions-list-before.txt`。
- 开发者工具已登录：`{"login":true}`，见 `artifacts/yl03/devtools-islogin-after.txt`。

## 上传后要做什么

1. 通过正常前端请求调用 `system.health`，记录 `ok:true`、版本、`requestId`。
2. 检查四页加载和云关闭/失败提示。
3. 私人接口应继续返回 `NOT_IMPLEMENTED`，不出现虚假保存成功。
4. 检查云函数日志无堆栈、身份、正文、令牌或环境变量泄露。
5. 保存脱敏日志/截图到 `docs/week1/Yuen_Lin/artifacts/yl03/`。

## 审批边界

- 本次只部署 `moodsky` 测试函数；**不部署 `moodsky-h03-probe`**，不运行 H03 写入/清理实验。
- 不上传微信体验版/正式版；真机测试另行排期。
- 不修改数据库集合、索引、权限或备份配置。
- 上传成功后仍需用户最后确认才可继续其他发布动作。

## 需要批准

请回复“批准部署到 mood-sky 测试环境”或指出需要补充的条件。未获批准前，文档保持“未部署/阻塞”，不伪造 health 证据。
