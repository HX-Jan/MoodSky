# W4 YL03 新增模块完整链路验证

- 执行日期：2026-11-05（Asia/Shanghai）
- 源码基线：`09903ceb1e3b2ce38155484a2afd50297bab54a1`
- 范围：福大地点推荐、文字详情、登录返回、到达后手动打卡、服务器确认、本人当日状态/历史；普通任务、收藏纠错、资料后台、装饰候选
- 环境：本地 Node 合成数据 + 锁定 SDK 离线替身 + 实际 Page 模块（`wx` 替身）
- 未执行：真实微信登录、真实云、真实地点导入、真实 Web 身份、真机

## 结果总览

| 项目            | 实际结果                                                         |
| --------------- | ---------------------------------------------------------------- |
| 定向回归        | **425 项通过 / 0 失败 / 0 跳过**，覆盖 37 个测试文件             |
| 九组 team:check | 9/9 通过，包含校园筛选/详情、运营门禁、纠错审核、公开任务只读    |
| 生产装配核对    | 7/7 通过，包含无定位手动打卡、同日去重、跨日原请求、历史分页隔离 |
| 完整检查        | 1398 项通过（定向回归是子集，不重复相加）                        |
| 本地功能缺陷    | 未发现；真实环境缺口见 [w4-yl03-gaps.csv](w4-yl03-gaps.csv)      |
| 真实云/真实身份 | 未执行；未登录、未写库、未部署                                   |
| 真机/模拟器     | 未执行；设备缺失，开发者工具登录阻塞                             |

原始证据：[per-file-summary.csv](artifacts/yl03/per-file-summary.csv)、[per-file/](artifacts/yl03/per-file/)、[team-check.txt](artifacts/yl01/team-check.txt)、[team-check-production.txt](artifacts/yl01/team-check-production.txt)。

## 当前能力矩阵

| 能力               | 源码/本地证据                                                                    | 本轮可确认                                         | 仍不能声称                       |
| ------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------- |
| 推荐列表与文字详情 | `week4-campus-recommendation`、`campus-week-four`、`manual-campus-client`        | 五地点、文字方位、无定位/地图声明；本地 Page 通过  | 真实地点资料已核验、已导入       |
| 游客浏览与登录返回 | `manual-campus-client`、`campus-history-client`                                  | 游客可浏览；登录返回原地点；登录不自动完成         | 真实微信登录、真实回调域名       |
| 手动打卡           | `manual-campus-checkin`、`campus-checkin-candidate`、`campus-checkin-page`       | 服务端账号/日期、同日去重、跨午夜原请求、失败回滚  | 真实云 `place_checkins` 已部署   |
| 本人当日状态/历史  | `campus-history-client`、`manual-campus-client`、`campus-checkin-page`           | 重开读取、分页、切号清空、迟到响应丢弃             | 真实云端历史与分页               |
| 断网/未知结果恢复  | `checkin-outbox`、`campus-checkin-candidate`、`manual-campus-client`             | 原请求保留、重复点击锁、失败不伪造成功             | 真实弱网、真实客户端持久化       |
| 账号停用/隔离      | `manual-campus-checkin`、`manual-campus-client`、`checkin-outbox`                | 停用拒绝；A/B 隔离；公共地点保留                   | 第二位真实用户独立验收           |
| 导出与注销清理     | `checkin-export-compatibility`、`manual-campus-checkin`、`week4-hong-data-seams` | 打卡进入导出、旧导出失效、注销只删本人             | 真实文件领取、真实注销           |
| 收藏/纠错          | `campus-personal`、`campus-integration-guards`、`admin-*`、`qizhen-admin`        | 候选与门禁通过；生产写入口仍返回 `NOT_IMPLEMENTED` | 收藏/纠错生产开放                |
| 普通任务           | `tasks-*`、`week4-task-*`、`transactional-tasks`                                 | 建议/历史/换号恢复/合成状态机通过                  | 正式模板、共同规则、真实任务验收 |
| 资料后台           | `admin-*`、`qizhen-admin`、`week4-hong-data-seams`                               | 地点读取/保存/重读候选与普通用户拒绝通过           | 真实 Web 身份与运营授权          |
| 静态装饰           | `decorations-*`、`week4-hong-data-seams`                                         | 候选读取/保存/关闭/清理接缝通过                    | 正式素材目录、生产开放           |

## 用例与证据

| 用例     | 覆盖要求                              | 代表测试文件                                                                     | 本轮结果 |
| -------- | ------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| YL03-C01 | 五地点推荐、文字方位、无定位/地图     | `week4-campus-recommendation`、`campus-week-four`、`manual-campus-client`        | 通过     |
| YL03-C02 | 游客浏览、登录返回原地点、不自动完成  | `manual-campus-client`、`campus-history-client`                                  | 通过     |
| YL03-C03 | 点击完成、服务器确认、失败不伪造      | `manual-campus-checkin`、`manual-campus-client`、`campus-checkin-candidate`      | 通过     |
| YL03-C04 | 同日去重、并发点击、跨午夜原请求      | `manual-campus-checkin`、`campus-checkin-candidate`                              | 通过     |
| YL03-C05 | 重开本人当日状态、历史分页            | `campus-history-client`、`manual-campus-client`、`campus-checkin-page`           | 通过     |
| YL03-C06 | 断网/未知结果/隐藏返回/原请求恢复     | `checkin-outbox`、`manual-campus-client`、`campus-checkin-candidate`             | 通过     |
| YL03-C07 | 切号、停用、迟到响应                  | `manual-campus-client`、`manual-campus-checkin`、`checkin-outbox`                | 通过     |
| YL03-C08 | 关闭/失效地点拒绝                     | `campus-checkin-candidate`、`week4-campus-recommendation`                        | 通过     |
| YL03-C09 | 导出失效、JSON/Markdown、注销清理     | `manual-campus-checkin`、`checkin-export-compatibility`、`week4-hong-data-seams` | 通过     |
| YL03-C10 | 收藏/纠错门禁与后台维护               | `campus-personal`、`campus-integration-guards`、`admin-*`、`qizhen-admin`        | 通过     |
| YL03-C11 | 任务建议/历史/换号恢复/只读边界       | `tasks-*`、`week4-task-*`、`transactional-tasks`                                 | 通过     |
| YL03-C12 | 装饰候选与清理接缝                    | `decorations-*`、`week4-hong-data-seams`                                         | 通过     |
| YL03-C13 | 实际 Page 到 service 的返回与失败反馈 | `manual-campus-client`、`campus-history-client`、`campus-checkin-page`           | 通过     |

更细的用例编号与证据见 [w4-yl03-cases.csv](w4-yl03-cases.csv)。

## 实际 Page 证据说明

`manual-campus-client.test.js` 有 37 项，其中多项直接加载 `miniprogram/pages/campus/index.js` 的实际 Page 方法，并用 `wx` 替身检查：

- 默认校园页显示五个推荐地点，游客点击后进入登录页；
- 用户再次手动点击才提交，登录返回不自动打卡；
- 连点锁定、未知结果保留原请求、隐藏/重开后恢复；
- 切号清空旧账号状态，迟到响应不回填；
- 服务不可用或返回格式异常时不显示完成；
- 历史入口、分页、失败重试与账号切换隔离。

这些是 Node 内的 Page 方法测试，不是微信开发者工具模拟器，也不是真机。原始 TAP 见 [per-file/manual-campus-client.tap](artifacts/yl03/per-file/manual-campus-client.tap)。

## 缺陷与缺口

本轮定向回归 **0 失败**，没有本地功能缺陷需要登记修复。未完成的是真实环境与外部输入，不是“已修复”：

| 缺口编号 | 内容                                      | 接收负责人                   | 状态   |
| -------- | ----------------------------------------- | ---------------------------- | ------ |
| G01      | 真实微信登录与云端打卡闭环                | 用户 / Xiang Hong            | 未测   |
| G02      | `place_checkins` 与云函数实际部署独立核实 | Qinghan Zhang / Junhan Huang | 未测   |
| G03      | 真实福大地点资料核验与导入                | Qinghan Zhang / Junhan Huang | 未测   |
| G04      | Android/iOS/华为 Pura 70 真机             | 用户 / Xiang Hong            | 阻塞   |
| G05      | 微信开发者工具模拟器（需重新登录）        | 用户                         | 阻塞   |
| G06      | 收藏/纠错生产写入                         | Junhan Huang                 | 阻塞   |
| G07      | 任务正式模板与共同规则                    | Jiawei Fang / Qizhen Chen    | 阻塞   |
| G08      | 装饰正式素材与生产目录                    | Jiaqi Zhu / Xiang Yu         | 阻塞   |
| G09      | 线上微信版本与候选包差异                  | Xiang Hong                   | 未测   |
| G10      | Qizhen Cai 独立权限/生命周期复核          | Qizhen Cai                   | 待复核 |

完整字段见 [w4-yl03-gaps.csv](w4-yl03-gaps.csv)。

## 边界

- 本地合成通过不能替代真实 Web 身份、资料导入、真实云或手机验证。
- 队友报告中“已部署/已导入/手机通过”的内容不作为本报告的直接证据；本轮没有云权限，也没有执行这些操作。
- 没有采集位置、轨迹、照片、真实身份或私人日记；测试全部使用合成数据。
