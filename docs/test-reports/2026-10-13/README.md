# MoodSky 微信开发者工具测试报告

测试日期：2026-10-13（北京时间）。基础架构在微信开发者工具模拟器中通过四页加载、原生导航、内容和默认隐私状态检查；当前业务仍为占位骨架。

## 测试版本与环境

| 项目                    | 实际值                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| 仓库                    | HX-Jan/MoodSky                                                     |
| GitHub main 与本地 HEAD | ad1e4539f5000fc31e484b39e6209979a0da2022                           |
| 测试对象                | 本地工作目录，包含开始测试前已有的分工文档、账号领域与集合设计调整 |
| 小程序                  | 登录管理员可管理列表中的 MoodSky                                   |
| AppID                   | wxf602e991ff44e6c8                                                 |
| 微信开发者工具          | 2.02.2608080                                                       |
| 调试基础库              | 3.17.3                                                             |
| 模拟设备                | iPhone 12/13 (Pro)，390 × 844，页面窗口 390 × 671                  |
| Node.js                 | 24.21.0                                                            |
| 云配置                  | cloudEnabled: false，cloudEnvId 为空，运行时 cloudReady: false     |

本次将 project.config.json 的游客 AppID 替换为已确认的团队 AppID，使用现有管理员登录和 Codex 连接授权打开完整项目窗口。没有上传体验版或发布版本。

## 模拟器结果

通过工具自带的自动化接口依次执行 switchTab，读取当前路径、标题、页面文本和 data，并保存截图。最后返回 Today，页面栈保持一个页面。此处验证的是原生导航调用与实际渲染状态，未模拟手指点击底部导航。

| 页面             | 验证内容                                                 | 结果 | 截图                     |
| ---------------- | -------------------------------------------------------- | ---- | ------------------------ |
| Today            | 标题、5 种天气、8 个固定标签、记录尚未保存的占位说明     | 通过 | [Today](today.jpg)       |
| Campus           | 标题、校园地点空态、模拟示意标签、固定虚构内容与隐私说明 | 通过 | [Campus](campus.jpg)     |
| Weather Universe | 标题、月份档案空态、私人记录和无记录日期留白说明         | 通过 | [Universe](universe.jpg) |
| Me               | 标题、设置空态、版本 0.1.0、cardTextPreview 默认 false   | 通过 | [Me](me.jpg)             |
| 返回 Today       | 路径 pages/today/index，页面栈长度 1                     | 通过 | [结构化结果](smoke.json) |

四页截图已逐张查看：本次模拟设备尺寸下，标题、内容和底部导航显示完整，未发现明显截断或重叠。

控制台全部可见日志及 error 过滤结果保存在 [smoke.json](smoke.json) 和 [tool-results.json](tool-results.json)。error 过滤结果为空。存在一条 wx.getSystemInfoSync 弃用警告；项目 miniprogram 源码没有调用此 API，警告出现在自动化系统信息读取之后，推测由工具的系统信息接口触发。它没有阻止页面运行。

## 本地检查

| 检查                        | 结果                                                        |
| --------------------------- | ----------------------------------------------------------- |
| npm run setup               | 保留既有本地云配置，并生成部署用共享代码                    |
| npm run check               | 代码、格式、结构与 24 项需求映射检查通过；22 个测试全部通过 |
| node scripts/check-cloud.js | 云 SDK、查询构造与云函数入口加载通过；未发送真实数据库请求  |

本地测试覆盖请求快照、关闭云能力时的调用门禁、响应校验、可信身份与运营权限、未实现接口的失败结果、固定模拟数据、输入限制、合法日期和北京时间日期边界。

## 后续云端构建与部署

以已确认的 AppID 调用 cloud_env_list 两次，平台均返回 MCP_TOOL_ERROR，原始业务错误为 ret: 1000、errmsg: "system error."。因此没有取得可确认的云环境 ID；这不能证明云开发未开通，也不能证明当前账号缺少权限。

后续负责人开通并确认使用 mood-sky-d5gqy3spkff37566d 环境，cloud_env_list 已返回该 ID。初次检查返回 0 个函数和 0 个集合。工具第一次创建函数后立即更新代码，平台因函数仍处于 Creating 返回 FailedOperation.UpdateFunctionCode；创建完成后再次部署成功。源码子目录上传后出现 shared/constants 加载错误，因此增加 npm run cloud:package，将本地业务和共享模块打包进单一 index.js，SDK 按原锁文件在云端安装。实际部署包包含 3 个文件，工具返回 15.7 KB；函数状态 Active，运行时 Nodejs16.13。

本地个人配置现已设为 cloudEnabled:true 并指向新环境。刷新后 cloudReady:true；真实 system.health 返回 MoodSky、0.1.0、foundation，campus.weatherPreview 返回明确标注的固定虚构示意，journal.get 返回 NOT_IMPLEMENTED。原始结果摘要见 [cloud-runtime.json](cloud-runtime.json)。这些结果证明基础连接和路由可运行，不代表私人记录、微信账号映射或业务功能已实现。

启用云连接后重新检查四页的路由、标题、文本、页面数据和默认隐私状态，全部通过；控制台 error 过滤为空，最后回到 Today 且页面栈长度为 1。基础库为 3.17.4。新一轮证据保存在 [cloud-enabled/smoke.json](cloud-enabled/smoke.json)、[工具结果](cloud-enabled/tool-results.json)和该目录的四页截图；前文 3.17.3/关闭云能力的证据仍保留。

数据库 15 个集合均已创建，实际返回 Count:0；7 组唯一索引已创建，并逐项核对字段、顺序及 Unique:true。结构证据见 [database-live.json](database-live.json)。账号 openid、日记 ownerId/date、偏好 ownerId、月份装饰 ownerId/month、收藏 ownerId/placeId、请求回执 ownerId/action/requestId、运营角色 accountId 均具备预期唯一约束；本次未插入测试记录验证冲突拒绝。

查看 accounts 的数据权限，当前选择为“仅创建者可读写”；客户端 count 请求返回 0，未观察到权限拒绝。仍需管理员将全部集合改为“所有用户不可读写”，符合客户端 read:false、write:false 的设计，并核验实际读取被拒绝。该修改不限制云控制台和服务端访问。

实际客户端权限、真实记录保存、导出、账号清理和手机真机效果尚未验收。界面上的“准备中”是当前基础版本的预期状态，不代表业务验收通过。

2026-10-14 权限复核：负责人回复已设置全部集合后，再次请求 15 个空集合，均返回空列表，未观察到权限拒绝；云函数 system.health 仍正常。空列表本身不能证明权限已生效。重新载入控制台的 accounts 和 cleanup_jobs 数据权限页面，两者仍选择“仅创建者可读写”，与目标规则不符，因此权限收尾仍未完成。已将控制台停在 accounts 数据权限页，请负责人先选择第 4 项“所有用户不可读写”、按提示确认，并检查绿色圆点停在该项，再核验其他集合。结果见 [2026-10-14 权限复核](../2026-10-14/client-permissions.json)。

随后负责人保存 accounts 第 4 项规则，控制台显示该项已选中；客户端读取 accounts 已被拒绝，返回 -502003 / Permission denied。该集合的权限验证通过，其余 14 个集合仍待逐项保存并验证。本次没有写入测试记录。

最终负责人保存其余 14 个集合后，再次逐项请求全部 15 个集合，均返回 -502003 / Permission denied；同一次验证中 system.health 正常返回 MoodSky / 0.1.0 / foundation。基础部署权限收尾已完成，结果见 [2026-10-14 最终报告](../2026-10-14/README.md)。前文的权限待办及“尚未验收”描述是此前阶段的状态；真实业务保存、导出、清理和手机真机效果仍未验收。未执行主动写入拒绝测试。

## 本次留存

四页截图、结构化断言结果和工具调用结果保存在本目录。模拟器测试结束时项目保持在开发者工具中打开，当前页为 Today。团队 AppID 和报告随本次仓库更新提交；合入 main 按仓库的检查及审核流程处理。
