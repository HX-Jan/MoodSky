# W6-YL08 提交记录

- 记录时间：2026-11-20 13:40（Asia/Shanghai）
- 状态：**本地完成，未推送、未创建 PR**；按规则等待用户最后确认后再上传
- 分支：`docs/yuen-lin-week6-delivery`（从 `origin/main` `5b27753` 新建）
- 工作树：`E:\MoodSky\w6-yuen-lin-work`
- 建议提交信息：`docs(week6): add Yuen Lin regression, candidates and evidence`

## 一、变更清单

| 路径                                                    | 类型 | 说明                         |
| ------------------------------------------------------- | ---- | ---------------------------- |
| `docs/week6/Yuen_Lin/README.md`                         | 新增 | 周交付总览                   |
| `docs/week6/Yuen_Lin/w6-yl01-baseline-and-lock.md`      | 新增 | 基线、环境、设备与版本锁定   |
| `docs/week6/Yuen_Lin/w6-yl02-regression-matrix.csv`     | 新增 | 28 项回归矩阵                |
| `docs/week6/Yuen_Lin/w6-yl03-candidate-and-manifest.md` | 新增 | 两个候选与 manifest/哈希     |
| `docs/week6/Yuen_Lin/w6-yl04-untested-and-blockers.md`  | 新增 | 未测项与 B01—B15             |
| `docs/week6/Yuen_Lin/w6-yl05-reviews.md`                | 新增 | 队友材料复核与 #196 复跑     |
| `docs/week6/Yuen_Lin/w6-yl06-release-opinion.md`        | 新增 | 周末放行与提审意见           |
| `docs/week6/Yuen_Lin/w6-yl07-pr-body.md`                | 新增 | PR 说明草稿                  |
| `docs/week6/Yuen_Lin/w6-yl08-submission-record.md`      | 新增 | 本记录                       |
| `docs/week6/Yuen_Lin/artifacts/`                        | 新增 | 原始命令输出、候选清单与哈希 |

未修改业务源码、云函数、数据库、导航、CI、共享契约或成员文件。

## 二、本地检查

| 命令                                                               | 结果                                                                | 证据                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm.cmd ci`                                                       | 退出 0；81 包；根依赖 3 moderate                                    | [npm-ci-root.txt](artifacts/yl01/npm-ci-root.txt)                                     |
| `npm.cmd run setup`                                                | 退出 0                                                              | [npm-run-setup.txt](artifacts/yl01/npm-run-setup.txt)                                 |
| `npm.cmd ci --prefix cloudfunctions/moodsky`                       | 退出 0；97 包；0 漏洞                                               | [npm-ci-cloud.txt](artifacts/yl01/npm-ci-cloud.txt)                                   |
| `npm.cmd run cloud:prepare`                                        | 退出 0                                                              | [cloud-prepare.txt](artifacts/yl01/cloud-prepare.txt)                                 |
| `npm.cmd run check`                                                | 退出 0；1634/1634                                                   | [npm-run-check.txt](artifacts/yl01/npm-run-check.txt)                                 |
| `npm.cmd run check`（加入本目录文档后）                            | 退出 0；1634/1634；Prettier、结构、文档链接（34 篇 / 557 链接）通过 | [npm-run-check-final.txt](artifacts/yl01/npm-run-check-final.txt)                     |
| `node scripts/check-cloud.js`                                      | 通过；未发送网络查询                                                | [check-cloud.txt](artifacts/yl01/check-cloud.txt)                                     |
| `npm.cmd audit --audit-level=high --prefix cloudfunctions/moodsky` | 0 漏洞                                                              | [npm-audit-cloud.txt](artifacts/yl01/npm-audit-cloud.txt)                             |
| `npm.cmd run team:check`                                           | 9/9                                                                 | [team-check.txt](artifacts/yl01/team-check.txt)                                       |
| `npm.cmd run team:check:production`                                | 8/8                                                                 | [team-check-production.txt](artifacts/yl01/team-check-production.txt)                 |
| `git diff --check`                                                 | 退出 0                                                              | [git-diff-check.txt](artifacts/yl01/git-diff-check.txt)                               |
| 7 组定向测试                                                       | 1258 项全部通过（子集）                                             | [targeted-summary.txt](artifacts/yl02/targeted-summary.txt)                           |
| 0.5.1 批次候选                                                     | 构建退出 0；191 文件 / 1,072,719 字节                               | [batch-0.5.1-candidate-summary.txt](artifacts/yl03/batch-0.5.1-candidate-summary.txt) |
| 0.5.2 最终候选                                                     | 构建退出 0；191 文件 / 1,074,637 字节                               | [candidate-summary.txt](artifacts/yl03/candidate-summary.txt)                         |

## 三、候选清单位置（工作区外，不入库）

- `E:\MoodSky\w6-yuen-lin-candidate-0.5.1-c0518e5`（批次候选，`closed`）
- `E:\MoodSky\w6-yuen-lin-candidate-5b27753`（最终候选，`closed`）

候选目录不入库；仓库只保留 manifest 副本与哈希。候选文件、`node_modules`、生成共享副本和个人环境配置均不提交。

## 四、明确未执行

- 未 `git push`、未创建 PR、未合并。
- 未部署云函数、未写数据库、未改索引/权限、未执行清理或恢复。
- 未上传微信体验版/正式版，未调用 `system.health` 或业务云接口。
- 未使用真实账号、真实日记、凭证、令牌或位置数据。
- 未取得洪翔签认、蔡奇真独立结论或成员个人签字。

## 五、待用户确认后的动作

1. 展示文件清单、变更摘要、测试结果、风险与回滚方式；
2. 用户确认后 `git add docs/week6/Yuen_Lin`、提交、推送 `docs/yuen-lin-week6-delivery`；
3. 创建 PR 并记录提交号、PR 链接、quality CI 结果；
4. 若 CI 失败，修复后重新提交，不伪造通过。

## 六、回滚方式

- 本目录只新增文档；回滚为删除 `docs/week6/Yuen_Lin/` 或关闭 PR。
- 候选目录位于工作区外，可整目录删除，不影响仓库。
- 未修改业务源码、云资源或数据库，无数据回滚需求。
