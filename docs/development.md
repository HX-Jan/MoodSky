# 组员开发步骤

当前成员账号、历史PR去向与补交步骤见[统一协作入口](collaboration/README.md)。最新源码及体验包见[项目首页](../README.md)；本页较早的环境记录保留其日期，不能据旧“尚未实现/未部署”描述覆盖后续受限验证或推断正式业务已开放。

第三周按[原计划及60项台账](week3/README.md)提交，保留W3编号和W2接续来源。记录/回顾接入门槛及本地复核命令见[H01—H05交接](week3/xiang-hong/README.md)，没有新授权时不要恢复已关闭的私人云测试入口。

## 没有仓库写权限也可以开始

在 GitHub 打开 MoodSky，点击 Fork，克隆自己账号中的仓库：

```sh
git clone https://github.com/YOUR_GITHUB_NAME/MoodSky.git
cd MoodSky
git remote add upstream https://github.com/HX-Jan/MoodSky.git
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
git switch -c feature/f01-weather-record
```

YOUR_GITHUB_NAME 替换为自己的 GitHub 用户名。完成任务后：

```sh
npm run cloud:prepare
npm run check
git add miniprogram/modules/journal
git commit -m "feat(journal): add weather selection"
git push -u origin feature/f01-weather-record
```

示例目录和提交说明按实际任务替换；逐项检查暂存文件，提交所有相关调用方、测试和约定。随后在 GitHub 创建 PR，base 为 HX-Jan/MoodSky 的 main，head 为自己的任务分支。

同步团队主分支：

```sh
git fetch upstream
git switch main
git merge --ff-only upstream/main
git switch feature/f01-weather-record
git merge upstream/main
```

任务分支有未提交修改时先提交或暂存，再切换分支。若 main 的 fast-forward 失败，不要强推，先查清本地主分支上的额外提交。

## 已获写权限的成员

负责人在 Settings → Collaborators 中邀请实际 GitHub 账号，成员接受邀请后直接克隆团队仓库。在自己任务分支上开发并推送，通过 PR 合并，不直接提交到 main。普通成员的 PR 须由仓库拥有者 @HX-Jan 审批；@HX-Jan 自己的 PR 无需其他成员批准，quality 检查通过后可自行合并。操作中的 upstream/main 替换为 origin/main。

GitHub 写权限和微信小程序开发者权限是两件事；负责人分别配置。已观察到的PR账号见[来源清单](collaboration/README.md)，这不等于成员已获写权限；没有写权限继续走Fork + PR。

## 本地检查

团队开发工具使用 Node.js 24。npm ci 根据锁文件安装；更新依赖要同时提交 package.json 与 package-lock.json。

| 命令                                   | 用途                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| npm run setup                          | 首次创建个人配置并生成云函数共享代码；不会覆盖已有个人配置 |
| npm run cloud:prepare                  | 修改 shared 后生成部署用副本                               |
| npm run cloud:package                  | 生成包含业务模块和共享代码的独立云函数部署目录             |
| npm run cloud:database-plan            | 按集合设计生成创建清单和唯一索引参数；不执行云端写操作     |
| npm run format                         | 自动整理格式                                               |
| npm run check                          | 运行代码、格式、结构与关键边界测试                         |
| npm ci --prefix cloudfunctions/moodsky | 安装云函数 SDK                                             |
| node scripts/check-cloud.js            | 安装云 SDK 后检查加载与查询构造，不发送真实数据库请求      |

使用微信开发者工具导入仓库根目录。2026-10-13 已从登录管理员的可管理小程序列表确认 MoodSky，并将团队 AppID wxf602e991ff44e6c8 写入 project.config.json；团队配置随基础部署更新同步到仓库。四页模拟器测试已通过，见[测试报告](test-reports/2026-10-13/README.md)。个人配置模板仍默认关闭云能力，当前测试机器的本地配置已启用。

## Today 内存演示

需要独立体验记录表单时，将被忽略的本地配置设为 cloudEnabled:false、cloudEnvId:''、journalDemo:true 后重新编译。只有显式开启 journalDemo 且关闭云能力才使用内存适配器；真实接口失败不会触发演示。保存、修改、删除和重试仅操作合成内存数据，不写 Storage 或数据库。退出页面实例或重新编译后不保证保留。

关闭演示后仍走原私人服务与可信账号门禁。当前真实账号解析、记录存储和关联失效尚未实现；不要为联调绕过门禁，也不要把本地演示报告写成真实云端验收。完整范围与已知问题见[整合报告](test-reports/2026-10-15/README.md)。

成员需要负责人授予对应小程序开发权限。团队 AppID 通过 PR 统一配置，不能每个人提交自己的 AppID；没有团队权限时可在被忽略的 project.private.config.json 中用 touristappid 尝试本机结构预览，游客能力以当前工具支持为准。个人开发工具偏好也放在 project.private.config.json。

## 云端联调

执行职责：Xiang Hong负责平台账号、AppID及成员权限；Yuen Lin按确认清单负责日常测试部署和检查；Xiang Yu负责集合、索引、权限及备份配置；各业务负责人完成适配器与联调。

1. Xiang Hong完成所需平台管理员操作并关联团队AppID，Yuen Lin记录测试环境配置并核对实际支持的云函数运行时与SDK。开发 Node.js 24 不代表云运行时必须使用同一版本。
2. 在本地 miniprogram/config/environment.local.js 写测试 cloudEnvId，需要调用云端时再将 cloudEnabled 设为 true；不提交该文件。
3. Yuen Lin按版本清单运行 npm run cloud:prepare，再安装云函数依赖。使用工具接口部署时，先运行 npm run cloud:package，把输出的 moodsky 目录作为部署目录，并选择云端安装依赖。该目录将业务模块和共享代码打包进 index.js，wx-server-sdk 仍由锁文件安装，避免上传过程遗漏子目录。不要直接部署缺少 shared 的源码目录。
4. Xiang Yu根据 database/collections.json 建集合、核验唯一索引能力；为全部集合设置客户端 read:false、write:false。数据库 SDK 的服务端访问仍需云函数逐项授权。
5. Yuen Lin先检查 system.health；Jiawei实现微信账号与受限回执查询，Junhan实现运营角色查询，测试成员验证。当前账号、运营角色和清理回执适配器均未实现，私人接口不会开放写入。
6. 每次 shared 变动后重新生成并部署同一版本的云函数；不要仅更新前端或手改生成副本。

2026-10-13 负责人已开通并确认使用小程序关联的 mood-sky-d5gqy3spkff37566d 测试环境。MoodSky 云函数已部署，system.health 和固定校园模拟接口的真实调用通过；私人读取接口仍返回 NOT_IMPLEMENTED。当前机器的个人配置已启用云连接。15 个空集合已创建；7 组唯一索引已创建，并核对字段、字段顺序及 Unique:true。运行 npm run cloud:database-plan 可生成结构参数文件；该命令不会写入云端。

权限收尾：在微信开发者工具“云开发”控制台选择数据库 → 集合管理 → 左侧集合 → 数据权限，将全部 15 个集合改为“所有用户不可读写”。控制台提示该规则仅限制小程序客户端，控制台和服务端仍具有数据读写权限。管理员手动保存后，重新载入并核验实际规则；空集合返回空列表不能证明权限拒绝。私人业务适配器完成前保持占位状态。

2026-10-14 负责人完成全部集合的“所有用户不可读写”设置。逐项请求全部 15 个集合，均返回 -502003 / Permission denied；system.health 同时继续通过，基础部署核验完成。未写入个人或测试记录，未执行写入拒绝或索引冲突的负向测试，真实业务适配器仍未实现。最终记录见[基础部署核验报告](test-reports/2026-10-14/README.md)及该目录的 client-permissions.json。

此前 hx-jan 的 PostgreSQL 环境未通过开发者工具的环境关联流程，保留原环境，本次部署使用新环境。个人环境设置和部署凭证不提交仓库。database 中的 JSON 是设计清单，不会自动生效；实际完成状态以[测试报告](test-reports/2026-10-13/README.md)为准。公开支持资源与地点在资料核验前保持空态。

云 SDK 锁定为 wx-server-sdk 4.0.2。其底层依赖的安全检查发现旧依赖问题，因此 package.json 将 @cloudbase/database 固定为1.5.1、axios 固定为0.34.0；当前依赖审计为0项已知漏洞，SDK加载及本地查询构造通过，云函数入口和基础请求也已在真实环境通过。真实业务数据库读写仍需联调验证；升级 SDK 时重新评估这两项 overrides，不随意删除锁文件或回退版本。

## 接入一个新功能

Issue 写 UW3-Fxx 和验收条件 → 前后端确认 docs/api.md 的输入输出 → 在分工目录实现 → 在 tests 添加关键行为或权限测试 → 更新需求实现状态 → npm run check → PR 审核。并发、幂等、实际权限和清理任务必须用测试环境验证后再标记完成。

## 第一周技术验证与后台接入

按[当前分工](team.md)准备接口、数据和测试小验证。Linghan负责前端最终装配，Xiang Hong负责后端集成；Qizhen Chen负责后台界面与Web可信身份接入，Junhan负责后台资料业务和运营角色授权。

后台建议采用HTML/CSS/JavaScript和CloudBase Web SDK，先验证实际环境支持的登录及云端身份传递。现有入口只解析可信微信上下文，浏览器身份不能直接套用OPENID门禁，也不能由客户端提交uid或role获取授权。验证后在接口PR中确认SDK版本、服务端身份适配、后台资料读取/写入约定及部署方式；当前未安装Web SDK或实现Web入口。

Xiang Yu从第1周设计导出/清理任务，第3—4周实现F22，第5周完成清理执行；Jiawei保留账号停用和进度入口。各模块提供可重复处理能力，Qizhen Cai独立验收。测试部署和CI由Yuen负责，正式交付版本由Xiang Hong确认。

2026-10-21 本地候选补记：API客户端默认用15秒本地计时器结束等待；个人环境可选requestTimeoutMs（1—60000整数毫秒）。这不取消服务端、不自动重发。NETWORK_ERROR意味着结果未确认，应保留原请求/输入重试或明确放弃后重读。配置错误不发出调用；真实云和手机效果仍待验收，见[续作证据](week2/xiang-hong/api-deadline-validation-20261021.json)。
