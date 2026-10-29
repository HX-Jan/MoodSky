# 组员首次使用手册：从拿到源码到完成联调

适用：刚接手MoodSky的组员。核对日期2026-10-29，起始源码`dce569cee3364499cacf9f50e9d151408f6e4d4f`。建议所有成员先完成第1—4节，再按自己的任务选择后续操作。步骤里的命令在你自己克隆的仓库中执行，不使用组长电脑的绝对路径。

## 先选你要做的事

| 目标                       | 跟着哪一节做 | 成功标志                         | 需要什么权限                       |
| -------------------------- | ------------ | -------------------------------- | ---------------------------------- |
| 验证模块能否一起工作       | 1—4          | 终端九行“通过”，命令正常结束     | GitHub读取；不需要云账号           |
| 看Today、记录、回顾等页面  | 5            | 微信模拟器出现本地演示页面       | 微信开发者工具及团队项目开发资格   |
| 在自己的代码里调用候选模块 | 6            | 保存、读取及账号隔离返回预期结果 | 本机Node；不需要云账号             |
| 做后台网页                 | 7            | SDK构建成功；了解网页当前门禁    | 本地构建不需要云权限，真实维护另验 |
| 完整检查、提交开发成果     | 8—9          | 全量检查通过、向团队main提交PR   | 推送自己的分支/Fork权限            |
| 排查团队云权限             | 10           | 组员本人能看到目标环境和函数     | 微信项目资格、云资源授权分开核验   |

`npm run team:check`是终端里的联调检查，执行完会退出。想看小程序界面，接着做第5节。项目没有由这个命令启动的localhost网页或常驻API服务。

## 1. 安装软件并确认版本

本地开发使用**Node.js 24.x**，与仓库`package.json`及CI一致。准备Git；需要看小程序页面时再准备微信开发者工具。可从[Node.js官网](https://nodejs.org/en/download)和[Git官网](https://git-scm.com/downloads)取得安装程序。安装后重新打开终端。

Windows可以在保存项目的父文件夹中打开PowerShell。先运行：

```powershell
git --version
node --version
npm.cmd --version
```

预期：三条都显示版本，Node开头为`v24.`。本手册Windows示例用`npm.cmd`，可避开部分电脑的`npm.ps1`执行策略报错；无需因此修改系统策略。macOS/Linux把`npm.cmd`换成`npm`。

这里的Node版本用于**本机开发**，不是让组员修改已部署云函数的运行时。

## 2. 首次取得源码，找到正确的根目录

第一次使用、当前目录还没有MoodSky文件夹时执行：

```powershell
git clone https://github.com/HX-Jan/MoodSky.git
cd MoodSky
git branch --show-current
git rev-parse HEAD
```

预期：分支为`main`，最后一行是完整提交号。目录中能看到`package.json`、`project.config.json`、`miniprogram`、`cloudfunctions`和本手册，这里才是**仓库根目录**。之后本手册的shell命令都从这里运行。不要在`miniprogram`或`cloudfunctions/moodsky`里面执行根目录命令。

已有MoodSky目录时不要再往里面克隆一份；使用第9节同步。推荐Git克隆：下载ZIP可阅读源码，但缺少Git元数据会影响本项目部分完整检查，也不方便提交PR。

GitHub的main是最新源码；旧`v0.2.3`标签、个人旧副本和旧手机体验包都可能落后。两个人排查同一个问题时，先比较各自`git rev-parse HEAD`的结果。

## 3. 最短路径：安装并跑九组联调

在根目录依次执行，前一条成功后再执行下一条：

```powershell
npm.cmd ci
npm.cmd run team:check
```

第一条按锁文件安装根开发依赖。第二条自动生成`cloudfunctions/moodsky/shared`，然后执行现有真实处理器与内存替身之间的调用。此路径不要求安装云SDK、登录微信/腾讯云、配置环境ID或填密钥。

成功输出中应包含以下九项：

```text
通过 | 基础请求与响应
通过 | 七天气保存和读回
通过 | 原请求重试与版本冲突
通过 | 游客、停用与账号隔离
通过 | 回顾不返回正文、删除后读取一致
通过 | 校园公开筛选和详情
通过 | 运营门禁、资料保存和重读
通过 | 纠错审核不自动修改地点
通过 | 公开任务只读候选
```

前面还会有npm和shared准备日志，属于正常输出。末尾会说明真实云访问与手机未检查、内存数据退出清空。PowerShell紧接着运行`$LASTEXITCODE`应得到`0`。只要出现“失败”或非零退出码，就先排查，不写成全部通过。

## 4. 看懂结果，保存最小排错信息

需要详细结构时运行：

```powershell
npm.cmd run team:check -- --json
```

预期JSON中`mode`为`LOCAL_SYNTHETIC_ONLY`、`status`为`passed`，`checks`有九组，`realCloudAccess`及`realDevice`仍是`not_checked`。npm会同时打印命令日志；已经生成shared后，要得到纯JSON可用：

```powershell
node tools/team-integration/check.cjs --json
```

退出码：`0`为九组成功，`1`为联调失败，`2`为不支持的命令参数。命令仅支持可选`--json`；它不接受`--env`、真实身份或登录凭据，传入也不会获得云访问。

给组长/模块负责人反馈时，提供：系统、Node版本、完整提交号、执行目录、失败命令、失败的组名及脱敏错误文字。不要只说“跑不了”，也不要发密码、Token、AppSecret或完整私人配置。[统一回传模板](docs/collaboration/team-sharing.md#建议的组内协作安排)可直接复制。

## 5. 在微信开发者工具看本地页面

先在根目录运行：

```powershell
npm.cmd run setup
```

首次会生成`miniprogram/config/environment.local.js`，并准备shared。已经有这个文件时只会保留它，不会自动纠正旧的个人配置。打开该文件，做本地内存演示时确认：

```javascript
module.exports = {
  cloudEnabled: false,
  cloudEnvId: '',
  journalDemo: true,
};
```

这是新手本地演示的最小配置。若你已有团队专用测试配置，先保留原文件，再按当前任务修改对应字段；不要用示例整包覆盖其他已确认设置。这个文件被Git忽略，不提交。

然后：

1. 用自己的微信号登录微信开发者工具，选择导入项目。
2. 项目目录选择包含`project.config.json`的仓库根目录，而不是`miniprogram`子目录。
3. 团队AppID应为`wxf602e991ff44e6c8`；如果提示没有项目权限，由管理员核对开发者资格，按第10节处理。
4. 完成导入后编译，进入Today。保存一条示例记录，再去“天气宇宙”查看；修改、删除时核对各页刷新。
5. 需要校园示例时使用页面提供的预览入口；成员现场资料保持待复核，不据预览开启真实导航。看到演示/本地/合成说明属于预期。

成功标准是**你这台模拟器的页面和操作按预期运行**。数据在内存里，进程重启或关闭后不保证保留，其他组员不会看到你的示例记录。`setup`默认`journalDemo:false`，所以只运行setup不等于已经开启演示。

现有手机体验包`0.2.3.1026`仍固定源码`c590247`。拉取新代码只更新本地源码，不会自动更新手机体验包；云函数也不会因此部署。

## 6. 后端成员直接调用本地候选

先完成第3节。保持在仓库根目录，执行`node`，看到Node提示符`>`后，再粘贴下面JavaScript。不要把它直接粘到PowerShell或微信控制台中执行。

```javascript
const { createLocalTeamBackend } = require('./tools/team-integration/local-backend.cjs');
const local = createLocalTeamBackend();
await local.call('campus.listPlaces', { tags: [] });
const input = {
  date: '2026-10-29',
  weather: 'CUSTOM',
  weatherName: '合成彩虹😀',
  expectedVersion: 0,
};
const options = { actor: 'a', requestId: 'req_local_example_001' };
await local.call('journal.upsert', input, options);
await local.call('journal.get', { date: '2026-10-29' }, { actor: 'a' });
```

预期：每次响应`ok:true`；地点列表里有“合成联调地点”；保存及读取的entry为CUSTOM，weatherName为“合成彩虹😀”、版本为1。重新执行相同`local.call('journal.upsert', input, options)`会重放同一逻辑请求，不产生新版本。

接着验证隔离和门禁：

```javascript
await local.call('journal.get', { date: '2026-10-29' }, { actor: 'b' });
await local.call('journal.get', { date: '2026-10-29' });
await local.call('admin.listPlaces', {}, { actor: 'operator' });
await local.call('admin.listPlaces', {}, { actor: 'a' });
```

预期依次是：B的entry为null；默认游客返回UNAUTHENTICATED；operator可读后台列表；普通A返回FORBIDDEN。执行`.exit`可退出Node。

| actor值          | 本地含义                           |
| ---------------- | ---------------------------------- |
| guest或不传actor | 游客，只能使用开放的公开候选       |
| a、b             | 两个互相隔离的合成账号             |
| operator         | 合成运营员，用于验证服务端角色门禁 |
| disabled         | 合成停用账号，私人请求应被拒绝     |

每次`createLocalTeamBackend()`都新建独立内存；实例之间不共享记录。固定模拟时间为北京时间2026-10-29中午，请沿用上述日期，不能直接改成未来真实日期来推断线上新建窗口异常。a/operator不是你的微信身份或线上账号。

在CommonJS文件中使用上述代码时，请放进async函数；文件位置变化时相对require路径也要调整。[模块接线说明](tools/team-integration/README.md)及[当前API](docs/api.md)列出范围；不支持的操作返回NOT_IMPLEMENTED。接入真实存储时遵守[SDK/事务/仓库替身分层](docs/troubleshooting/storage-tests.md)，不能把整个db当options，或随意替换成fetch/insert接口。

## 7. 后台网页成员

在根目录运行：

```powershell
npm.cmd ci --prefix admin --ignore-scripts
npm.cmd run build --prefix admin
```

第二条成功后应生成`admin/vendor/cloudbase-3.4.8.js`，该文件被Git忽略。这里构建的是固定Web SDK，不会开通OAuth、授予运营角色或开启云业务。

`admin/index.html`保留四类合成表单；`admin/places.html`为地点维护候选。查看布局可使用你现有编辑器的本地静态预览，通过HTTP访问网页。真实Web登录不能通过双击file://文件验收。没有配置真实身份时，显示未配置/尚未启用属于预期，不用将开关改true来“修复”。

后台真实接入涉及身份源、允许域名/回调、可信Web身份到内部账号的映射，以及服务端运营角色；当前尚未完整验收。`admin/config.js`和真实凭据不提交。完整步骤见[后台说明](admin/README.md)与[Web准备](admin/REAL-CLOUDBASE-SETUP.md)。

## 8. 提交前跑完整检查

第3节只需根依赖；完整检查还会使用云SDK等依赖。首次完整准备按CI顺序在根目录执行：

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd ci --prefix cloudfunctions/moodsky
npm.cmd ci --prefix admin --ignore-scripts
npm.cmd run build --prefix admin
npm.cmd run cloud:prepare
npm.cmd run check
```

这些是安装、本地生成及检查，不会部署或连接真实数据库。成功输出包含代码/格式/结构/文档链接/类型检查，以及node:test的`fail 0`。本手册编写基线为920项全量测试；后续新增有效测试时数量可变化，不应为了凑固定数字删测试。

共享源码改动之后，先`cloud:prepare`再`check`。`cloudfunctions/moodsky/shared`是生成副本，不手改或提交。九组联调通过不能代替全量检查，CI通过也不能代替云端、手机或个人独立验收。

## 9. 已有代码如何同步和提交

先执行`git status --short`。如果列出了自己的修改，先保存到自己的任务分支并检查提交范围；不要直接reset、覆盖目录或清空文件。工作区干净后，有团队仓库写权限的成员：

```powershell
git fetch origin
git switch main
git merge --ff-only origin/main
git switch -c feature/your-task
```

`feature/your-task`是新分支名示例，请换成自己的任务。已有该分支就切换到它，合并最新main并处理冲突，不反复创建同名分支。

Fork成员先用`git remote -v`核对：origin是自己的Fork，upstream应为`https://github.com/HX-Jan/MoodSky.git`。仅在没有upstream时执行：

```powershell
git remote add upstream https://github.com/HX-Jan/MoodSky.git
```

已配置upstream的成员跳过上一条，接着执行：

```powershell
git fetch upstream
git switch main
git merge --ff-only upstream/main
```

如果无法快进，先找出本地额外提交，不强推main。保留队友源码、七天气、版本/回执和身份门禁，从当前分支做增量。

完成改动和第8节检查后，查看`git diff`与`git status --short`，只暂存自己的相关文件，再提交并推送任务分支，创建面向`HX-Jan/MoodSky:main`的PR。普通成员需拥有者审批。PR注明本人、任务号、来源SHA、验证结果及未完成项。[详细提交规范](docs/collaboration/submission-guide.md)提供完整模板。

个人配置、node_modules、vendor、生成shared、二维码、密钥和真实私人记录不提交。不要用压缩包替代PR，也不要把“已提交”写成“已验收”。

## 10. 团队云访问失败时

先继续使用第3/6节本地联调，不用等所有组员都取得部署权限。实际云环境按[双平台排障指南](docs/collaboration/team-sharing.md)处理：

- 微信开发者工具：确认自己的微信项目开发者资格、团队AppID、环境ID及具体资源操作权限。
- 腾讯云网页/CLI：确认团队归属账号或已授权子用户/协作者、真实地域和所需CAM操作权限。个人腾讯云账号不是团队环境的证明。
- 环境能打开但业务返回NOT_IMPLEMENTED，是默认业务接线未开放，不能靠加管理员解决。
- 云管理权限和内部业务身份分开；数据库客户端默认拒绝读写是项目策略，不把它改成全员公开来解决协作。

当前环境和功能清单见排障指南。本地通过不证明组员云授权成功；真实部署、试验写库、清理与权限变更按明确范围另做，不自动复用旧的单次云实验授权。

## 常见报错速查

| 报错或现象                           | 检查与处理                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| git/node/npm找不到                   | 完成软件安装后重新开终端，先验证第1节；Windows使用npm.cmd                                                                              |
| npm.ps1禁止执行                      | 用npm.cmd执行相同命令，不要求修改全局执行策略                                                                                          |
| 找不到package.json / ENOENT          | 执行目录错了；回到同时含package.json和project.config.json的根目录                                                                      |
| Missing script: team:check           | 源码过旧或进入错的同名副本；查完整HEAD及package.json，按第9节同步main                                                                  |
| Cannot find module shared或contracts | 根目录运行npm.cmd run cloud:prepare；不要新建假模块或手改生成副本                                                                      |
| Cannot find module wx-server-sdk     | 完整检查需要npm.cmd ci --prefix cloudfunctions/moodsky；纯team:check不应初始化SDK，若它也报错先核对源码版本                            |
| SDK/esbuild/构建依赖缺失             | 安装根依赖；后台再安装admin依赖并构建。不要只在云函数子目录装一份                                                                      |
| npm ci提示锁文件不一致               | 检查是否混入别的分支package.json/lock；先同步匹配文件，不先删除锁文件或改成不固定版本安装                                              |
| 安装时超时/网络/证书错误             | 保留具体错误，核对本机网络与实际registry；确需npm官方源时可仅给本次ci加--registry=https://registry.npmjs.org，不盲改全局或关闭证书验证 |
| 联调通过但没有页面弹出               | 正常；team:check是终端命令。看界面请执行第5节                                                                                          |
| 演示没有开启                         | setup保留已有个人配置，且模板journalDemo默认false；按第5节核对cloudEnabled/journalDemo                                                 |
| 日期、版本或请求冲突                 | 本地固定模拟日见第6节；编辑传读到的版本；原请求重试保持原ID/原payload，新操作用新ID                                                    |
| 新建local实例后记录不见              | 各实例内存独立，进程退出清空；它不是共享云数据库                                                                                       |
| JSON前有npm日志                      | 用已经准备好shared的node tools/team-integration/check.cjs --json获取纯JSON                                                             |
| 截图、手机包与本机界面不同           | 核对构建来源；已有体验包不会随git pull自动更新                                                                                         |

仍无法继续时，把第4节的最小排错信息发给组长/模块负责人；保留失败依据，不通过删断言、伪造成功、整包覆盖或共享管理员凭据来绕过问题。

## 本手册命令的实际复核

2026-10-29在Windows下以`dce569c`干净Git副本验证：初始没有node_modules、云SDK依赖及environment.local；按第3节安装根依赖后，九组全部通过，并未写入个人配置。随后按第8节安装/构建并完整检查，920项通过。第6节的保存、重放、读取、账号隔离和运营调用示例也在该副本实际执行。

日志保留在维护者工作区外`test-results/2026-10-29-member-onboarding/`。这些复核覆盖终端命令与本地合成调用；本轮没有新增微信模拟器/手机、真实Web登录或组员云账号验收。手册更新不上传体验包、不调整成员权限；项目后续变更时仍按各自真实结果判断。
