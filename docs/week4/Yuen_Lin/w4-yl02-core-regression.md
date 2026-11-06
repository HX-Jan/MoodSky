# W4 YL02 已上线核心主线回归

- 执行日期：2026-11-05（Asia/Shanghai）
- 承接：W3 YL02；对照 YF01—YF03、Z01—Z03、L02/L03
- 源码基线：`09903ceb1e3b2ce38155484a2afd50297bab54a1`
- 环境：本地合成数据 + 锁定 SDK 离线替身 + Node 内实际 Page 模块与 `wx` 替身
- 未执行：真实微信登录、真实云、真实数据库、真机、独立复核

## 结果总览

| 项目              | 实际结果                                                    |
| ----------------- | ----------------------------------------------------------- |
| 定向回归          | **405 项通过 / 0 失败 / 0 跳过**，覆盖 41 个测试文件        |
| 完整检查          | 1398 项通过 / 0 失败 / 0 跳过（定向回归是子集，不重复相加） |
| 失败项            | 0；没有修复后复测记录                                       |
| 真实云/真实账号   | 未执行；缺可登录账号、云范围与批准                          |
| 双账号 A/B 与切号 | 本地替身覆盖；真实 A/B 账号未执行                           |
| 手机/模拟器       | 未执行；无真机，开发者工具登录阻塞                          |

原始证据：[per-file-summary.csv](artifacts/yl02/per-file-summary.csv)、[per-file/](artifacts/yl02/per-file/)。

## 用例与证据

| 用例     | 覆盖要求                       | 代表测试文件                                                                       | 本轮结果 |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------- | -------- |
| YL02-C01 | 七天气与 CUSTOM 名称契约       | `weather-options`、`week3-validation`、`native-journal-integration`                | 通过     |
| YL02-C02 | 日期窗口、补记边界与跨月       | `validation`、`week3-validation`、`review-reader`                                  | 通过     |
| YL02-C03 | 保存、重开读取、修改与删除     | `journal-pages`、`native-journal-integration`                                      | 通过     |
| YL02-C04 | 原请求重试、版本冲突与未知结果 | `journal-pages`、`journal-recovery-plan`、`native-journal-integration`             | 通过     |
| YL02-C05 | 月历、档案、详情与正文隐藏     | `review-pages`、`review-cloud-pages`、`week4-review-zhifeng`                       | 通过     |
| YL02-C06 | 7/30/90 天统计与一致快照       | `week3-review-integration`、`review-reader`、`review-revision`                     | 通过     |
| YL02-C07 | 删除重建、旧 ID 与缓存失效     | `review-store-invalidation`、`review-session`、`native-journal-integration`        | 通过     |
| YL02-C08 | 偏好默认值、白名单与重读       | `week2-account-preferences`、`week3-preference-contract`、`me-lifecycle`           | 通过     |
| YL02-C09 | JSON/Markdown 导出与领取       | `export-formatter-candidate`、`export-publication-candidate`、`native-export-file` | 通过     |
| YL02-C10 | 导出绑定、过期与失效           | `export-account-fence`、`export-expiry-recovery`、`export-access-policy-candidate` | 通过     |
| YL02-C11 | 账号停用、切号与迟到响应       | `account-identity`、`week3-account-close-chain`、`logout-work-protection`          | 通过     |
| YL02-C12 | 注销范围与恢复隔离             | `week4-closure-scope`、`week3-account-data`、`production-lifecycle`                | 通过     |
| YL02-C13 | 有界读取与并发快照             | `journal-snapshot-concurrency`、`review-revision`、`review-session`                | 通过     |

更细的用例编号、前置、步骤和证据文件见 [w4-yl02-cases.csv](w4-yl02-cases.csv)。

## 逐文件结果

41 个测试文件全部退出码 `0`。主要文件结果：

| 文件                                   | 通过/总数 |
| -------------------------------------- | --------- |
| `journal-pages.test.js`                | 27/27     |
| `native-journal-integration.test.js`   | 9/9       |
| `journal-snapshot-concurrency.test.js` | 9/9       |
| `journal-recovery-plan.test.js`        | 13/13     |
| `review-pages.test.js`                 | 15/15     |
| `review-cloud-pages.test.js`           | 23/23     |
| `review-week3.test.js`                 | 7/7       |
| `week4-review-zhifeng.test.js`         | 12/12     |
| `week2-account-preferences.test.js`    | 8/8       |
| `week3-preference-contract.test.js`    | 8/8       |
| `week4-closure-scope.test.js`          | 16/16     |
| `production-lifecycle.test.js`         | 16/16     |

其余文件见 [per-file-summary.csv](artifacts/yl02/per-file-summary.csv)。

## 失败与复测

本轮定向回归没有失败项，因此没有“修复后复测”记录。首次完整检查的 6 个失败来自归档目录缺少 `.git`，与业务行为无关；建立本地快照后完整检查通过，详见 [YL01](w4-yl01-baseline.md)。

## 未执行范围与边界

| 未执行项                 | 原因                                   | 解锁条件                           |
| ------------------------ | -------------------------------------- | ---------------------------------- |
| 真实账号记录保存/重开    | 无可用的真实登录与云测试范围           | 用户扫码登录、负责人批准云测试范围 |
| 真实数据库唯一索引与事务 | 未读取或写入真实云库                   | Xiang Yu 的配置交接与独立核对      |
| 真实双账号 A/B、切号     | 缺第二位真实用户及 Qizhen Cai 独立复核 | 两个真实账号 + 独立复核人          |
| 真实导出文件领取         | 未调用云端文件服务                     | 明确导出测试范围与文件后端         |
| 真机记录、回顾与导出     | 无设备、无可用体验包                   | 设备 + 新版包 + 体验成员权限       |
| 微信模拟器页面           | 开发者工具需重新登录，未打开项目       | 用户手动扫码登录且项目权限可用     |

本地通过不等于真实云端通过；本地 SDK 离线、模拟器、真实云和手机结果继续分开记录。
