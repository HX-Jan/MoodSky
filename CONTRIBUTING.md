# 团队协作规定

## 开发顺序

1. 先在 Issue 写清需求编号、主责人、涉及目录、依赖和验收条件，避免两人重复修改同一功能。
2. 从最新 main 创建任务分支。推荐 feature/f01-weather-record、fix/f04-delete-cache、docs/api-contract；一个分支完成一件事。
3. 只改本次任务相关模块。前端集成人为Linghan Chen，后端集成人为Xiang Hong，数据负责人为Xiang Yu；CI和测试部署由Yuen Lin负责。共享变量、API、数据库或导航变化先与前后端集成人和数据负责人确认，并在同一个 PR 中更新约定与调用方。
4. 提交前执行 npm run cloud:prepare 和 npm run check。新增真实行为要提供对应验收或边界测试，不用复制实现逻辑凑测试数量。
5. 推送自己的任务分支，创建 PR 到 main；填好模板并关联 Issue。等待检查和审核，通过后 Squash merge，删除已经合并的任务分支。
6. 开始下一件事前更新本地 main。不要把其他人的整个目录复制覆盖，也不要上传压缩包替代提交。

## 提交与评审

提交格式：type(scope): description，例如 feat(journal): add weather selection、fix(account): reject disabled accounts、docs(api): clarify export status。

代码审核至少一名有写权限的成员批准，作者不能批准自己的 PR。Xiang Yu编写的导出/清理实现由相关开发及Qizhen Cai复核，测试结论不能由作者自行替代。接口变动请前后端共同复核；权限或数据生命周期请 Qizhen Cai 和 Xiang Yu 复核；视觉与公共组件请 Jiaqi Zhu 复核。人员姓名对应职责，实际 GitHub 账号由本人提供后添加。

main 必须通过 quality 检查、与最新主分支一致、解决评审讨论。新提交会使旧批准失效。保持线性历史，仅使用 Squash 合并。管理员也受保护规则约束；如需应急调整保护，由负责人记录原因并恢复规则。

## 基础代码规定

- JavaScript 使用 CommonJS、const/let、两空格缩进、UTF-8 和 LF；由 ESLint、Prettier 自动检查。
- 变量和函数用 camelCase，常量用 UPPER_SNAKE_CASE，文件与目录用小写英文；已有四页和功能模块目录保持统一。
- 天气代码、标签、窗口和文字限制只从 miniprogram/shared/constants.js 引用。
- 不新增直接数据库访问。所有前端调用使用 services/api.js 和模块 service.js。
- 业务日期为北京时间 YYYY-MM-DD；存储时间戳为 UTC；正文长度按 Unicode 码点计算。
- 前端不传 ownerId、openid 或角色来获取权限；服务端不相信客户端身份字段。
- 未实现或失败返回明确错误。不能用固定 true、空 catch 或虚假“保存成功”掩盖缺失。
- 写入重试复用原 requestId 和原输入。超时后保留输入，不生成新请求再次写入。
- 不在日志、Issue、截图、测试夹具或仓库中放真实私人记录、身份或导出凭证。
- 不提交 node_modules、个人环境配置、密钥、临时产物和旧方案。只提交当前功能所需的源码、锁文件、测试和文档。

## 冲突处理

先拉取最新 main，合并到自己的分支后在本地解决冲突，再重新运行检查。涉及共享文件时联系另一位作者共同确认，不能随意选择“全部用我的”。若重写自己分支历史，最多用 --force-with-lease；绝不强推 main。

Fork 用户的 PR 不获得仓库凭证或云密钥。CI 仅做检查，不自动部署。首次外部贡献可能需要仓库负责人在 Actions 中批准运行，见[GitHub 官方说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks)。
