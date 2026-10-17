# 本地测试报告

负责人：Qizhen Cai。执行日期：2026-10-17，Asia/Shanghai。自动化检查按本人委托执行；人工验收仍待复核。基线为0.2.1，提交 `1be13f8287e177ae3f057a9298164eb631181778`；Windows x64、Node v24.19.0、wx-server-sdk 4.0.2，测试使用合成数据与离线替身。

| 检查               | 结果                                              | 原始证据                                                                                                                                                                       |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 全量检查           | 250通过、0失败；其中main原有234项、新增16项       | [全量TAP](artifacts/baseline/full-local-tests.tap)；[独立main批次](artifacts/source-checks/main-source-tests.tap)；[补充批次](artifacts/source-checks/supplementary-tests.tap) |
| 权限与生命周期复测 | 137通过、0失败，包含在上述覆盖内                  | [复测TAP](artifacts/privacy-retest/privacy-lifecycle-retest.tap)；[命令与时间](artifacts/privacy-retest/retest-metadata.json)                                                  |
| 本地任务准备       | 77通过、0失败，与全量覆盖重叠                     | [准备检查TAP](artifacts/readiness/local-usability-readiness.tap)                                                                                                               |
| 身份矩阵           | 126行：54拒绝、72未实现业务桩；不增加测试计数     | [矩阵](artifacts/baseline/permission-matrix.json)                                                                                                                              |
| 完整业务用例       | 32阻塞，0通过、0已证实失败                        | [逐条记录](MoodSky_权限与生命周期详细测试用例_精简修订版.md)；[台账](artifacts/baseline/case-ledger.json)                                                                      |
| 本地性能           | 20条页面样本、80批查询/计算，执行与后置校验均成功 | [原始数据](artifacts/local-performance/local-performance-results.json)；[测量方法与统计](MoodSky_性能与可用性测量方案_精简修订版.md)                                           |

新增测试涵盖伪造身份、角色撤销、停用与回执边界、异常响应脱敏、本地过期、迟到响应、注销中断、删除后派生视图及性能统计规则。406个伪造身份请求在替身数据库读取前被拒绝；这是本地断言覆盖量，不是406项独立测试。

真实业务仍返回NOT_IMPLEMENTED或缺少执行器，不能据此判定真实权限、导出或清理通过。本地Node页面逻辑耗时不等同手机TTI；没有真机首屏或操作型可用性实测。六人定性访谈单独见[访谈记录](MoodSky_六人访谈记录.md)。

完整方法、环境、命令和结果边界以两份主文档为准；本文件供证据索引引用。代码、格式及结构历史检查见[元数据](artifacts/source-checks/main-source-test-metadata.json)，本次提交校验另见[提交前检查](artifacts/publication-checks.json)。
