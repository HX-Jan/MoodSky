# 团队协作规定

## 开发顺序

1. 先在 Issue 写清需求编号、主责人、涉及目录、依赖和验收条件，避免两人重复修改同一功能。
2. 从最新 main 创建任务分支。推荐 feature/f01-weather-record、fix/f04-delete-cache、docs/api-contract；一个分支完成一件事。
3. 只改本次任务相关模块。前端集成人为Linghan Chen，后端集成人为Xiang Hong，数据负责人为Xiang Yu；CI和测试部署由Yuen Lin负责。共享变量、API、数据库或导航变化先与前后端集成人和数据负责人确认，并在同一个 PR 中更新约定与调用方。
4. 提交前执行 npm run cloud:prepare 和 npm run check。新增真实行为要提供对应验收或边界测试，不用复制实现逻辑凑测试数量。
5. 推送自己的任务分支，创建 PR 到 main；填好模板并关联 Issue。普通成员等待检查通过及仓库拥有者 @HX-Jan 批准后 Squash merge。@HX-Jan 自己的更新无需其他成员批准，检查通过后可自行合并。删除已经合并的任务分支。
6. 开始下一件事前更新本地 main。不要把其他人的整个目录复制覆盖，也不要上传压缩包替代提交。

## 整合发布前先处理成员 PR

1. 整合或发布新版本前，先列出主仓库所有未关闭的成员拉取请求，核对作者、目标分支和最新提交。成员已经提交 PR 时，从该 PR 审查，避免只查看 Fork 后遗漏原请求。
2. 先审核成员 PR；符合要求且检查通过的，按拥有者审批规则合入。不符合要求的先记录待修改事项，不能直接视为已通过。
3. 如果成员 PR 的全部内容已由其他整合 PR 吸收，逐项确认没有遗漏新提交，再关闭被替代的原 PR，并在整合记录中关联两者。保留贡献和历史，不重复合入旧版本。
4. 相关成员 PR 处理完毕后，更新本地 main，再整合其余成果并创建新版本 PR。发布前再次核对成员 PR 列表和提交，避免漏掉期间追加的内容。
5. 拥有者自己的更新仍按原有规则通过 quality 后自行合并；成员的审批要求、主分支保护和云端部署审批保持原样。

## 提交与评审

提交格式：type(scope): description，例如 feat(journal): add weather selection、fix(account): reject disabled accounts、docs(api): clarify export status。

普通成员的更新必须由仓库拥有者 @HX-Jan 批准，其他成员的批准不能替代拥有者审批，作者不能批准自己的 PR。@HX-Jan 自己的更新无需其他成员批准，仍须通过 quality 检查。接口、导出/清理、权限及视觉变动按 docs/team.md 请相应负责人提供复核意见，最终合入由 @HX-Jan 决定；测试结论仍以实际证据为准。

main 必须通过 quality 检查、与最新主分支一致、解决评审讨论。新提交会使旧批准失效。保持线性历史，仅使用 Squash 合并。CODEOWNERS 将所有文件的审批人设为 @HX-Jan，成员可在各自任务分支开发，合入 main 前取得拥有者批准。

当前为个人仓库，仅拥有者 @HX-Jan 是管理员，其他成员保持 write 权限。主分支保护要求普通成员获得 1 次 CODEOWNER 批准，拥有者可使用管理员审核豁免。独立的 [main-quality-and-history 规则](https://github.com/HX-Jan/MoodSky/rules/25018647)不设豁免，对所有人强制执行 PR、quality 检查、主分支同步、解决讨论、线性历史及禁止强推/删除。不要授予普通成员管理员权限，以免扩大审核豁免范围。

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
