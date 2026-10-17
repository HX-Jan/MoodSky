# 实际检查记录

检查时间：2026-10-16 开始，2026-10-17 续作（Asia/Shanghai）。环境：Windows、本地独立 ZIP 副本、Node v24.19.0。未连接云环境；所有新测试使用本地数据及 mock 平台。

## 工具与基线

文件读取成功；临时文件写入、回读、删除成功；Node 命令执行成功。已读 CONTRIBUTING.md、README、development、architecture、team、第一周计划及 Qinghan 交接说明。ZIP 逐文件 SHA-256 对照不解压、不覆盖：开始时 5 个原文件修改，新增 4 个 Campus 模块与 1 个测试文件，另有本地环境配置和自动生成共享副本。详见 initial-zip-comparison.json。外层 Git HEAD 不存在，未提交工作区。

中断前一次追加测试请求发生 automatic approval review stream disconnected，返回明确未执行；续作先核对文件后重试成功。这是工具审查连接失败，非安全性否决。

## 运行结果

| 检查 | 实际结果 | 原始证据 |
| --- | --- | --- |
| node scripts/prepare-cloud.js | exit 0，生成共享副本 | evidence/cloud-prepare.txt |
| node scripts/check-structure.js | exit 0，24 条需求映射/结构/共享副本/客户端访问规则通过 | evidence/structure.txt |
| node --test tests/campus-week-one.test.js | 18/18 通过，exit 0 | evidence/campus-tests.txt |
| node --test --test-isolation=none tests/campus-week-one.test.js | 18/18 通过，exit 0 | evidence/no-isolation-campus-tests.txt |
| node --test tests/*.test.js | 151 项被 runner 报告，149 通过、2 失败，exit 1 | evidence/full-tests.txt |
| node scripts/check-cloud.js | exit 1，缺少 wx-server-sdk | evidence/cloud-sdk-check.txt |
| node --check（Campus JS 与测试共 8 文件） | 全部 exit 0 | evidence/syntax-check.json |
| npm run check | 未启动检查流程，CommandNotFoundException | evidence/npm-check.txt |
| ESLint / Prettier | 未运行，不记通过 | npm 与依赖不可用 |

全量失败：h03-probe.test.js 因 MODULE_NOT_FOUND:esbuild 未能加载；h03-report-retention 的 SDK 测试缺少 wx-server-sdk。149 通过不表示原有完整测试集全部执行；加载失败可能使该文件内子测试没有注册。初始失败（含草稿错误）保存在 evidence/initial-tests.txt，不覆盖。

## 标准检查与替代方式的差异

本次 Node 默认隔离测试能够启动，历史 spawn EPERM 未复现。额外执行 --test-isolation=none 仅验证可行性：同进程运行不具备默认文件进程隔离，可能有全局变量/模块缓存污染；本次只跑 Campus 单文件，不将其替代完整标准检查。没有修改 package.json 测试命令或系统安全设置。

直接运行 prepare-cloud 和 check-structure 与 npm 脚本目标相同，但不能据此称 npm run check 通过：lint、format:check 未执行，完整 test 失败。node --check 仅检查语法，不能替代 ESLint、格式或 WXML 编译。

本机 PATH 和已检查工作区/运行时缓存未发现 npm 入口及所需依赖；官方 registry 请求实际为 fetch failed / connect EACCES :443，记录在 dependency-probe.txt。没有确认依赖安装成功；未更改 package-lock.json。

## 证据分层

| 层次 | 状态 | 能证明什么 |
| --- | --- | --- |
| 合成演示代码 | 完成、显式按钮启动 | 6 条虚构资料及页面状态逻辑；不代表真实地点核验 |
| Node/mock 行为测试 | 18 项通过 | 首次 0 定位调用、点击触发、隐私拒绝不定位、拒绝可浏览、地图失败回退、门禁、Unicode、收藏等 |
| 静态 WXML 绑定检查 | 通过 | 事件处理器存在、开始/退出/审核/失败按钮绑定；不证明渲染或原生控件兼容 |
| 微信开发者工具 | 未测 | 无本次截图/录像；不可引用仓库旧截图作为本次证据 |
| 真实云端 | 未测 | 没有真实收藏/纠错/地点读写或部署验收 |
| 真机 | 未测 | 权限弹窗、地图能力、键盘、布局和性能均待复核 |
| 地点现场与来源核验 | 未做 | 11 条仍为用户提供待核验线索 |

QZ04 的原验收要求包含开发者工具或真机录像/截图，本地 mock 只提供技术证据，不能宣告 QZ04 已验收。下一步按 interaction-and-cases.md 由具备环境的成员实际复核，并补设备/版本/日期/结果。

## 可复现命令

在本副本根目录：

~~~powershell
node scripts/prepare-cloud.js
node scripts/check-structure.js
node --test tests/campus-week-one.test.js
node --test --test-isolation=none tests/campus-week-one.test.js
node --test tests/*.test.js
~~~

具备 npm 和网络的检查环境再执行 npm ci、npm ci --prefix cloudfunctions/moodsky、npm run cloud:prepare、npm run check、node scripts/check-cloud.js。命令只安装锁定依赖及本地检查，不部署。格式修复应限本次变动文件，避免改写历史原始证据。
