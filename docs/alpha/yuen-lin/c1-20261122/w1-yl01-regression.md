# AS-YL01 共同回归矩阵与持续检查

- 执行人：Yuen Lin / @Yuminu
- 执行日期：2026-11-22 21:03—21:12（Asia/Shanghai）
- 基线：`36ff7f54476ff19cbacba7238b11ee34a5adcdf6`（最新 `main`，产品与我方资料同一基线）
- 环境：Windows 10.0.26200 x64、Node v24.16.0、npm 11.13.0；本地合成／SDK 离线
- 原始输出：[artifacts/yl01](../c1-20261122/artifacts/yl01)、[artifacts/yl02](../c1-20261122/artifacts/yl02)

## 一、完整质量门禁

| 命令                                                           | 退出码 | 实际结果                                                                                             | 证据                                       |
| -------------------------------------------------------------- | -----: | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `npm ci`                                                       |      0 | 81 包安装；root 3 个 moderate 提示，无 high/critical 结论                                            | `artifacts/yl01/npm-ci-root.txt`           |
| `npm run setup`                                                |      0 | 生成禁云本地配置；从 `miniprogram/shared` 生成云共享契约                                             | `artifacts/yl01/npm-run-setup.txt`         |
| `npm ci --prefix cloudfunctions/moodsky`                       |      0 | 97 包安装；0 vulnerabilities                                                                         | `artifacts/yl01/npm-ci-cloud.txt`          |
| `npm run cloud:prepare`                                        |      0 | 共享契约生成完成                                                                                     | `artifacts/yl01/cloud-prepare.txt`         |
| `npm run check`                                                |      0 | lint／format／structure／docs／typecheck 通过；**1691/1691**，fail 0、cancelled 0、skipped 0、todo 0 | `artifacts/yl01/npm-run-check-full.txt`    |
| `node scripts/check-cloud.js`                                  |      0 | 云 SDK、查询构造与入口通过；未发送网络查询                                                           | `artifacts/yl01/check-cloud.txt`           |
| `npm audit --audit-level=high --prefix cloudfunctions/moodsky` |      0 | 0 vulnerabilities                                                                                    | `artifacts/yl01/npm-audit-cloud.txt`       |
| `npm run team:check`                                           |      0 | 9 组本地合成联调通过                                                                                 | `artifacts/yl01/team-check.txt`            |
| `npm run team:check:production`                                |      0 | 8 组生产装配核对通过                                                                                 | `artifacts/yl01/team-check-production.txt` |
| `git diff --check`                                             |      0 | 无空白错误                                                                                           | `artifacts/yl01/git-diff-check.txt`        |

完整检查在加入本次证据文件后复跑，仍为 **1691/1691**；证据文件本身也通过 Prettier／docs 检查。

## 二、定向复跑（完整检查的子集，不重复加总）

| 组       | 覆盖                               |    结果 | 证据                             |
| -------- | ---------------------------------- | ------: | -------------------------------- |
| R01 记录 | 七天气、保存、重开、恢复、客户端   | 177/177 | `artifacts/yl02/r01-journal.txt` |
| R02 回顾 | 四入口、空月、迟到、装饰           | 155/155 | `artifacts/yl02/r02-review.txt`  |
| R03 账号 | 登录、游客、分享、停用、注销、偏好 | 272/272 | `artifacts/yl02/r03-account.txt` |
| R04 导出 | 两格式、越权、到期、清理           | 124/124 | `artifacts/yl02/r04-export.txt`  |
| R05 校园 | 五地点、选点、打卡、历史、分页     | 244/244 | `artifacts/yl02/r05-campus.txt`  |
| R06 任务 | 三模式、动作、历史、连点、迟到     | 220/220 | `artifacts/yl02/r06-tasks.txt`   |
| R07 装配 | 打包、服务配置、云默认值、管理端   |   66/66 | `artifacts/yl02/r07-package.txt` |

七组合计 **1258** 项，全部通过；它们是 1691 项的子集，不作为新增覆盖数。

## 三、持续检查与 CI

| 构建                           | 事件         | 结论    | 链接                                                       |
| ------------------------------ | ------------ | ------- | ---------------------------------------------------------- |
| `36ff7f5` 合入后 main          | push         | success | https://github.com/HX-Jan/MoodSky/actions/runs/45014169423 |
| `bfdab78`（#235 交审）         | pull_request | success | https://github.com/HX-Jan/MoodSky/actions/runs/45014087355 |
| `11e230d`（#233 合入后 main）  | push         | success | https://github.com/HX-Jan/MoodSky/actions/runs/45011435406 |
| `95669f7`（PR #236 当前 head） | pull_request | success | https://github.com/HX-Jan/MoodSky/actions/runs/45020747283 |
| #197 原交审 quality            | pull_request | success | https://github.com/HX-Jan/MoodSky/actions/runs/44741010268 |

#197 已合入，其原交审提交与当前 main 的关系按“旧提交、现产品另测”分别保留，不把 #197 的旧测试数写成当前结果。

## 四、矩阵与状态

逐项矩阵见 [w1-yl01-regression-matrix.csv](w1-yl01-regression-matrix.csv)。状态只使用 `待开始`、`进行中`、`待复核`、`已验收`、`阻塞`；Yuen 的本地复核意见另列，不代替洪翔的最终验收。

本机未出现失败；对成员报告中的差异单独登记：

- Yifan 在 PR #236 自报 Windows 本地全量 10 例失败（`campus-week-two` 9、`me-lifecycle` 1）。本机同一 `36ff7f5` 完整检查为 1691/1691，未复现；已要求提供 E43 原始失败日志以便定位环境差异，未据此判定任何一方通过或失败。
- Yifan 的 37/37 三文件定向已由本机独立复跑通过（`artifacts/yl04/yifan-pr236-37tests.txt`）。

## 五、边界

- 未连接目标云、未部署云函数、未写数据库、未执行清理／恢复、未上传微信体验版／正式版。
- 未使用真实微信身份、真实日记、导出凭证、令牌或位置轨迹。
- 真实云端、Android／iOS 真机、微信后台隐私与审核状态保持未测；矩阵中以 `阻塞` 登记，不填“通过”。
