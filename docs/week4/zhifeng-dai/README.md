# 第四周交付：Zhifeng Dai（回顾与天气宇宙前端）

- 分支：`week4-review-zhifeng-dai`，已rebase到`origin/main`的`004a9b3081d6216c67aee0ccbdb079fa039677be`（0.3.0发布整合后）。
- 交付目录：`docs/week4/zhifeng-dai`；本目录只记录本人相对最新main的实际新增，不复用W3 PR #59的旧实现。
- 契约基线：七天气（`SUNNY/PARTLY_CLOUDY/CLOUDY/RAINY/STORMY/TYPHOON/CUSTOM`）、`weatherName`（1—20码点），无八天气、无`HEAVY_RAIN`、无健康评分。
- 状态填法：只有复核人实际确认后才写“已验收”；本轮全部为“待复核”，条件不足处写“阻塞”。

## 交付清单

| 任务                                                            | 承接       | 状态   | 复核人     | 证据                                                         |
| --------------------------------------------------------------- | ---------- | ------ | ---------- | ------------------------------------------------------------ |
| [W4 Z01 月历档案与详情复测](w4-z01-month-archive.md)            | W3 Z01/Z02 | 待复核 | Yuen       | `evidence/w4-review-tests-20261101.txt` 场景1/2              |
| [W4 Z02 统计与时间线一致性核对](w4-z02-insights-consistency.md) | W3 Z03     | 待复核 | Xiang Hong | `evidence/w4-review-tests-20261101.txt` 场景3/12；本文对照表 |
| [W4 Z03 跨页刷新与切号复测](w4-z03-cross-page-refresh.md)       | W3 Z04     | 待复核 | Qizhen Cai | `evidence/w4-review-tests-20261101.txt` 场景4/5              |
| [W4 Z04 静态装饰候选接入](w4-z04-static-decoration.md)          | W3 Z05     | 阻塞   | Yuen       | 场景6/7/8；正式素材目录缺失见下文阻塞表                      |
| [W4 Z05 卡片与移动端展示检查](w4-z05-mobile-display.md)         | —          | 阻塞   | Yuen       | 场景9/10/11；真机截图缺失见下文阻塞表                        |

本轮验证用例集中在[week4-review-zhifeng.test.js](../../../tests/week4-review-zhifeng.test.js)，共12项，全部通过。

## 工具与概念准备

| 项目             | 本轮实际使用                                                                                                | 证据                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 一致快照         | `reviewReader.insights(windowDays)`每次只调用一次`timeline`，分布bins与时间线同源派生，`sourceRevision`一致 | Z02 断言`timelineCalls`增量为1          |
| 跨页失效         | 页面`_seq`/`_requestSeq`令牌丢弃迟到响应；`onHide`清空正文；`subscribeReviewSession`监听账号绑定            | Z03 乱序响应、切号、停用用例            |
| 素材降级         | 装饰读取失败与素材加载失败均降级为文字提示，月历与记录保持可读                                              | Z04 读取失败/素材失败用例               |
| review service   | 复用`modules/review/service.js`与`reader.js`，测试通过内存后端`tests/helpers/backend-client.js`验证         | 场景4/5                                 |
| 浏览器开发者工具 | 无法自动化（服务端口关闭且会话过期），见阻塞表                                                              | `WeappLog/logs`中`access_token missing` |
| 真机调试         | 未连接设备（本机无`adb`），见阻塞表                                                                         | 阻塞表                                  |

## 统一验证记录

命令与产物按计划要求先`cloud:prepare`后`check`，完整输出见证据目录。

| 步骤                      | 结果                                                   |
| ------------------------- | ------------------------------------------------------ |
| `npm run cloud:prepare`   | 成功，重新生成`cloudfunctions/moodsky/shared/`契约副本 |
| `npm run lint`            | 通过                                                   |
| `npm run format:check`    | 通过                                                   |
| `npm run structure:check` | 通过（24个需求ID、共享契约与客户端访问策略）           |
| `npm run typecheck`       | 通过                                                   |
| `npm test`                | 1048项通过、0失败（含本周12项）                        |

## 已落地改动

| 文件                                    | 改动                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `tests/week4-review-zhifeng.test.js`    | 新增W4 Z01—Z05回归用例12项                                                          |
| `miniprogram/pages/universe/index.wxss` | `.demo-banner`字号由`14px`改为`28rpx`，与回顾页`rpx`字号约定一致（Z05字体放大适配） |
| `docs/week4/zhifeng-dai/`               | 本周交付文档与证据                                                                  |

除上述样式修正外，本轮未修改`miniprogram/`与`cloudfunctions/`业务实现：月历、详情、统计与装饰候选已在最新main中存在，W4的职责是复测与一致性核对，不为通过测试改坏共享实现；也未新增动画、贴纸玩法或健康评分。

## 提交与PR

- 分支已推送到`origin/week4-review-zhifeng-dai`，当前tip为`14632f8`。
- 本机无`gh` CLI，PR需在网页创建；提交信息已关联W4 Z01—Z05编号，PR编号与CI结果待回填。
- 提交前已在本机按顺序运行`cloud:prepare`与`check`，结果见上表与`evidence/`。

## 阻塞登记

| 编号 | 阻塞内容                          | 已核实的事实                                                                                                                                                              | 影响                                               |
| ---- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| B-01 | Z01/Z05实际入口截图               | `cli islogin`返回`IDE service port disabled`；用户数据中`security.enableServicePort`仍为`false`；开发者工具日志`需要重新登录,access_token missing`，打开项目后约1分钟退出 | Z01与Z05交付缺模拟器截图，改以用例与代码走查为证据 |
| B-02 | Z05 Android/iOS真机截图与原生覆盖 | 本机无`adb`，未连接任何设备                                                                                                                                               | 无法验证字体放大、深色模式与安全区在原生端的覆盖   |
| B-03 | Z04 JQ03正式静态装饰素材          | `miniprogram/assets`仅含天气与导航图标，不存在`STICKER_*`/`BACKGROUND_*`素材文件                                                                                          | 无法验证正式素材组合，仅验证现有合成候选与失效回退 |

解除B-01需人工在开发者工具内扫码登录并开启服务端口；解除B-02需连接真机并开启调试；解除B-03需JQ03/H03提供素材与目录规范。上述阻塞均不写入“通过”，且不影响回顾与记录功能本身可用。

## 剩余待解决

1. 补Z01/Z05模拟器截图与逐页访问记录（B-01解除后）。
2. 补Android/iOS真机截图，重点核对字体放大与长`CUSTOM`名称的换行（B-02解除后）。
3. 接入JQ03正式装饰素材后再跑一次素材组合与失效矩阵（B-03解除后）。

## 复核签署

| 任务 | 复核人     | 结论 | 时间 |
| ---- | ---------- | ---- | ---- |
| Z01  | Yuen       | 待填 | 待填 |
| Z02  | Xiang Hong | 待填 | 待填 |
| Z03  | Qizhen Cai | 待填 | 待填 |
| Z04  | Yuen       | 待填 | 待填 |
| Z05  | Yuen       | 待填 | 待填 |

本目录不代填复核结论、工时或设备结果。
