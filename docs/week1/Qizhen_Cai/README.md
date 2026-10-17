# Qizhen Cai 第一周成果

负责人：Qizhen Cai（蔡奇真），GitHub：Cai5133。任务：W1 QT01—QT05。结果日期：2026-10-17，Asia/Shanghai。被测源码版本为0.2.1，固定提交 `1be13f8287e177ae3f057a9298164eb631181778`。

## 文档与完成边界

| 任务        | 交付物                                                                         | 实际状态                                                                      |
| ----------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| QT01 / QT02 | [权限与生命周期详细测试用例](MoodSky_权限与生命周期详细测试用例_精简修订版.md) | 32条独立执行记录完整；本地子检查已执行，完整业务验收32条阻塞                  |
| QT03        | [六人访谈记录](MoodSky_六人访谈记录.md)                                        | P07—P12六次定性访谈，保留回答、时间、背景及建议；不计入操作型可用性样本       |
| QT04        | [性能与可用性方案及本地测量](MoodSky_性能与可用性测量方案_精简修订版.md)       | 20条页面逻辑样本、80批查询/计算实测；真机TTI及操作型可用性尚未执行            |
| QT05        | [测试报告](test-report.md)与[协作阻塞](issue-drafts.md)                        | main原有234项及新增16项本地测试通过；真实身份、云端业务和独立人工验收仍待完成 |

所有证据链接使用仓库相对路径。`artifacts`保留原始TAP与测量JSON，源码审计仅公开脱敏摘录；[证据清单](artifacts/publication-manifest.json)登记来源批次和SHA-256。137项复测和77项准备检查是既有测试的子集，不与250项相加。

## 本地复现

在仓库根目录使用Node 24，按项目README准备依赖：

```sh
npm ci
npm run setup
npm ci --prefix cloudfunctions/moodsky
node --test tests/qizhen-privacy-lifecycle.test.js tests/qizhen-performance-summary.test.js
node tools/qizhen/local-permission-matrix.js
node tools/qizhen/performance-summary.js docs/week1/Qizhen_Cai/performance-20-runs.json
node tools/qizhen/performance-summary.js docs/week1/Qizhen_Cai/performance-demo-only.json
node tools/qizhen/local-performance-bench.cjs . ./local-performance-new-run
npm run cloud:prepare
npm run check
```

`performance-20-runs.json`为后续真机采样输入，尚无有效样本；`performance-demo-only.json`仅为2300ms合成统计练习，均不替代已测的本地页面样本。重新测量使用新输出目录，保留原批次。

本次提交不修改业务实现、不部署云资源。合入及人工验收等待仓库拥有者 @HX-Jan 审核；实际工时与签名不代填。
