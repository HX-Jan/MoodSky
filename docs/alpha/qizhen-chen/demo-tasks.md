# 任务页合成演示与重置步骤

这是已跑通本地路径的演示交接，供 Jiaqi／洪翔准备素材；不是 C4 最终候选或云端演示通过记录。原16张图按 #210／11/20 引用，本次3张图来自 `dc228d16a5e49e20c40a3d83559c6af637b14757`／11/20；最终图必须对应当时冻结源码与实际模式。

## 环境与输入

Node 24，按仓库手册准备根依赖、个人配置及云函数 SDK，再运行 `npm run cloud:prepare`。默认个人配置保留 `cloudEnabled:false`。原生桥接另需本人微信开发资格、已登录开发者工具、CLI 服务端口、官方 miniprogram-automator 模块和本机 9420 会话。模块路径由本机实际安装提供，不放入 package.json 或提交个人配置。

合成种子来自当前 `DEFAULT_TASKS`：`moodsky_01_walk`（散心）、`moodsky_02_read`（校园阅读）、`moodsky_03_journal`（心情记录）。每次工具创建独立内存库、合成会话；记录为当天 SUNNY、空正文、空标签，不使用真实日记。校园新增写入保持暂停。纯禁云 demo 可展示基础页；完整服务回执流程需要下面的本机桥接，不能把 cloudEnabled 改成 true 直接连真实云。

## 可复跑命令

在本仓库根目录执行，每次设置新的绝对输出目录，保留旧证据：

```sh
npm run cloud:prepare
node --test tests/week6-qc-task-flows.test.js tests/alpha-qc-unknown-results.test.js
node tools/alpha-qc/verify.cjs /absolute/new-output/local
# 微信开发者工具 CLI：导入当前仓库、登录、启用服务端口
# cli auto --project "$PWD" --auto-port 9420 --trust-project
MINIPROGRAM_AUTOMATOR_MODULE=/absolute/path/to/miniprogram-automator \
QC_SIMULATOR_OUTPUT=/absolute/new-output/native \
node tools/alpha-qc/wechat.cjs
# 只补“保存后重开”链路，不覆盖之前三模式/校园截图
MINIPROGRAM_AUTOMATOR_MODULE=/absolute/path/to/miniprogram-automator \
QC_SIMULATOR_OUTPUT=/absolute/new-output/record-reopen \
node tools/alpha-qc/wechat.cjs --record-reopen
```

第一条原生命令覆盖三模式、校园/保存往返、替换跳过和布局；第二条单独验证保存后重开，两次返回 selected，再显式完成。复杂故障的延迟/丢回执由自动化夹具注入，页面没有人工故障开关。未知结果与迟到导航可展示 Node 报告和原生提示，不描述成手机弱网实测。

## 讲解与预期画面

| 顺序 | 演示动作                                                           | 预期/已验证点                                                                                        | 素材                                                             |
| ---- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | 对照 closed、readOnly、enabled                                     | 关闭无任务请求；只读无私人写按钮/历史；开放才可选择。依候选实际模式说明能力，closed 不强行演示写动作 | 原三模式图与 baseline 表                                         |
| 2    | enabled 点击右侧“选择”散心 → 校园“选这里” → 返回                   | 两处按钮保持右侧；选点时打卡暂停，零新增；返回仍已选，显式完成才完成                                 | 原10/11/12图与 round-trips/05                                    |
| 3    | 选择“记录一下心情” → 晴天 → 保存 → 返回 → 写心情记录 → 返回 → 完成 | 保存只一行；重开仍为晴天；两次返回保持已选；最后显式完成                                             | 本次01/02/03图和 native-results.json                             |
| 4    | 替换 → 跳过替代项 → 历史                                           | 原项 replaced、替代项 skipped，历史两行                                                              | 原13/14/15图                                                     |
| 5    | 展示未确认、重试、迟到回执报告                                     | 未确认不显示成功；重试 requestId/payload/业务日一致，行数不增加；旧访问零自动跳转                    | boundary.csv 与原 local-results.json，说明 VM 反例只移除内存守卫 |

成功或失败都执行工具的 finally，恢复原 API/配置、清除合成会话并回到今天页；内存进程退出即丢弃本次种子。不要删除真实集合、修改团队角色或沿用历史云写入授权来“重置演示”。

## 最终候选接手条件

洪翔先给完整冻结 SHA、服务范围和任务模式；Yuen 核对原样候选的 sourceCommit/sourceWorktreeDirty、模式、暂停值和客户端/两云包哈希。QC 只按差异补测，并在最终源码的**独立禁云预览**取运行图，登记与原样候选的配置差异；端云原样包、手机和平台状态仍需各自实际证据。上述工具跑通不自动证明原样包端云联调或微信版本发布。
