# W2 YL01 第二周实际工作基线

- 负责人：Yuen Lin（832401211）
- 执行日期：2026-10-24，Asia/Shanghai
- 基线提交：`ed1d76fd97312dd2a4bee0db87aed4e49a14f7eb`（`origin/main`，0.2.3）
- 工作分支：`docs/yuen-lin-week2-delivery`（已推送；PR [#50](https://github.com/HX-Jan/MoodSky/pull/50)）
- 环境：Windows 10/11 x64；Node.js `v24.16.0`；npm `11.13.0`；微信开发者工具 Stable `2.01.2510290`（已登录）
- 状态：本地质量门禁与 CI 基线完成；真实云端私有业务、真机与上传不在本任务完成范围

## 1. 版本、差异与依赖锁定

本次先按规则从最新 `main` 建分支。开始核对时本地 `origin/main` 为 `839e646`，随后发现远端已推进到 `ed1d76f`，因此同步后重跑全部检查；`839e646` 的旧日志只保留在临时目录，不作为本次证据。

| 项目          | 值                                                                                     | 证据                                                          |
| ------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 代码基线      | `ed1d76f`（`docs(design): integrate Jiaqi week2 prototype ... #48`）                   | [git-head.txt](artifacts/yl01/git-head.txt)                   |
| 应用版本      | `0.2.3`                                                                                | `package.json`、`miniprogram/shared/constants.js`             |
| 根依赖        | esbuild `0.28.2`、eslint `10.12.0`、prettier `3.9.10`、typescript `5.9.3`；81 包       | [npm-ls-root.txt](artifacts/yl01/npm-ls-root.txt)             |
| 云函数依赖    | `wx-server-sdk 4.0.2`；97 包                                                           | [npm-ls-cloud.txt](artifacts/yl01/npm-ls-cloud.txt)           |
| 后台 SDK 依赖 | `@cloudbase/js-sdk 3.4.8`；11 包                                                       | [npm-ls-admin.txt](artifacts/yl01/npm-ls-admin.txt)           |
| 未提交差异    | 仅 `docs/week1/Yuen_Lin/artifacts/yl03/` 下 4 个第一周未跟踪本地文件；无已跟踪文件改动 | [git-status-before.txt](artifacts/yl01/git-status-before.txt) |
| 锁文件        | 以 `package-lock.json` 和 `cloudfunctions/moodsky/package-lock.json` 为准              | 仓库根目录与云函数目录                                        |

第一周遗留的 4 个未跟踪文件不属于第二周成果，本次不修改、不删除、不暂存；第二周提交只包含 `docs/week2/Yuen_Lin/`。

## 2. 实际执行的命令

在 `E:\MoodSky\MoodSky` 按当前 CI 定义执行；比第一周增加了后台依赖构建和三个依赖审计：

```powershell
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
npm ci --prefix admin --ignore-scripts
npm run build --prefix admin
npm run cloud:prepare
npm run check
node --test --test-reporter=tap tests/*.test.js
node scripts/check-cloud.js
npm run typecheck
npm audit --audit-level=high
npm audit --audit-level=high --prefix cloudfunctions/moodsky
npm audit --audit-level=high --prefix admin
npm audit --audit-level=high --prefix tools/h03-probe
```

原始输出全部在 [artifacts/yl01](artifacts/yl01/)，退出码单独保存为 `*.exit.txt`。

## 3. 实际结果

| 检查                      | 实际结果                                                     | 证据                                                                                                   |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 根依赖安装                | 成功；81 个包；0 个已知漏洞                                  | [npm-ci-root.txt](artifacts/yl01/npm-ci-root.txt)                                                      |
| 本地配置与共享代码生成    | 成功；保留已有个人配置；共享契约副本已生成                   | [npm-run-setup.txt](artifacts/yl01/npm-run-setup.txt)                                                  |
| 云函数依赖                | 成功；97 个包；0 个已知漏洞                                  | [npm-ci-cloud.txt](artifacts/yl01/npm-ci-cloud.txt)                                                    |
| 后台依赖与 SDK 构建       | 成功；11 个包；构建脚本退出码 0                              | [npm-ci-admin.txt](artifacts/yl01/npm-ci-admin.txt)、[admin-build.txt](artifacts/yl01/admin-build.txt) |
| 共享代码准备              | 成功                                                         | [cloud-prepare.txt](artifacts/yl01/cloud-prepare.txt)                                                  |
| lint / format / structure | 通过；24 项需求 ID、共享契约副本、客户端禁读写策略均通过     | [npm-run-check.txt](artifacts/yl01/npm-run-check.txt)                                                  |
| TypeScript 类型检查       | 通过；严格模式、编译期正反例                                 | [typecheck.txt](artifacts/yl01/typecheck.txt)                                                          |
| 完整单元与集成测试        | **593 通过 / 0 失败 / 0 跳过**；耗时约 2.30 s                | [tests.tap](artifacts/yl01/tests.tap)                                                                  |
| 云 SDK 加载与查询构造     | 通过；未发送真实数据库请求                                   | [cloud-sdk-check.txt](artifacts/yl01/cloud-sdk-check.txt)                                              |
| 根包依赖审计              | 0 个漏洞                                                     | [npm-audit-root.txt](artifacts/yl01/npm-audit-root.txt)                                                |
| 云函数依赖审计            | 0 个漏洞                                                     | [npm-audit-cloud.txt](artifacts/yl01/npm-audit-cloud.txt)                                              |
| 后台依赖审计              | 0 个漏洞                                                     | [npm-audit-admin.txt](artifacts/yl01/npm-audit-admin.txt)                                              |
| H03 探针依赖审计          | 0 个漏洞                                                     | [npm-audit-h03-probe.txt](artifacts/yl01/npm-audit-h03-probe.txt)                                      |
| CI 基线                   | main `ed1d76f` 的 `MoodSky CI` 成功，run `40074201757`，30 s | [ci-status.txt](artifacts/yl01/ci-status.txt)                                                          |
| 分支 PR CI                | PR #50 `quality` 通过，run `40106848494`，39 s               | [pr-50-status.txt](artifacts/yl01/pr-50-status.txt)                                                    |

`tests.tap` 汇总行：

```text
# tests 593
# pass 593
# fail 0
# skipped 0
```

计划中的“234 项通过”只是第一周参考值，本次没有以数量为目标，也没有删除、合并或复制测试来凑数。数量增加来自第二周已合入的成员成果和新增回归。

## 4. 失败归属与处理

| 观察                                     | 影响                               | 处理                                                        |
| ---------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| 初次基线使用了落后的 `839e646`           | 旧日志不能代表最新 main            | 同步到 `ed1d76f` 后完整重跑；旧日志移出交付目录，不混用     |
| 仓库本地 `git http.proxy` 指向不可用代理 | `git fetch` 一度失败               | 仅在命令级临时清空代理完成 fetch；未修改仓库或个人 Git 配置 |
| 第一周遗留 4 个未跟踪证据文件            | 工作区 `git status` 有噪声         | 保留原文件，不纳入第二周提交；归属第一周，不作本次成绩      |
| GitHub REST 匿名速率限制风险             | 不能用未认证 API 拉取 Actions 列表 | 使用已登录 `gh` 只读查询，并保存 run 编号与链接             |

## 5. 结论与边界

- 第二周基线已完成：最新 main、锁定依赖、当前 CI 全部门禁和 593 项测试通过。
- 本次没有新增或重写既有测试，没有修改业务源码、共享契约、数据库、云资源或 CI 配置。
- 本基线不证明真实云函数业务可用、数据库约束生效、真机兼容或独立验收完成；这些分别见 YL03、YL04、YL05。
- main 基线证据是 `ed1d76f` 的公开运行结果；本次分支 PR #50 的 `quality` 另行通过（run `40106848494`），两者分开记录。
