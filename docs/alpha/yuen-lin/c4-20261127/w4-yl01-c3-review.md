# C3 交接复核与 C4 回归入口

- 复核对象：`docs/alpha/xiang-hong/c3-20261126/`（候选范围草案、24 项验收缺口、README）。
- 交接快照：`dde127c`，1695/1695；候选 `29b31dd…`，191 指纹，closed + 打卡暂停。
- 当前 main：`00c59a1`（#263 微信登录修复合入），全量 **1730/1730**，产品树 `22be47…`。

## 一、数字与产品变化

| 项       | C3 交接           | 当前 main              | 判断                                                    |
| -------- | ----------------- | ---------------------- | ------------------------------------------------------- |
| 完整测试 | 1695              | **1730**               | #263 新增/更新登录适配测试；C3 的 1695 不能当 C4 最终数 |
| 产品树   | `62b91cfd…`       | **`22be47ad…`**        | 登录页/手机号适配已变；C3 静态候选不能直接冻结          |
| 候选模式 | closed + 打卡暂停 | 预核仍 closed + paused | 方向一致，但需按新 SHA 重装                             |
| C3 统计  | 16/48             | 16/48                  | 本次不新增完成点                                        |

## 二、C3 候选哈希

交接写“干净 closed 静态候选 manifest SHA256 `29b31dda…`、191 指纹”。本次用现有 `scripts/package-production.js` 在干净工作树复装：

- `7feca53`：manifest `62aba808…`，183 客户端；
- `dde127c`：manifest `a4b50efe…`，183 客户端；
- 当前 `00c59a1`：manifest `711deb7e…`，185 客户端（#263 后新增 2 个客户端文件）。

**未能复现 `29b31dd…`**。请洪翔提供该候选的目录/工具/源码 SHA，或确认它不是 `release:package` 的 manifest；在未确认前，不把 `29b31dd…` 作为 C4 冻结依据。

## 三、24 项验收缺口

`acceptance-gaps.csv` 的 24 行仍可作为清单，但需注意：

- 其中 AS-YF01 已按 #199 本地 C1 通过；AS-YF02 已按 #255 本地 C3 通过；其余仍待复核或外部。
- 1695 快照中的“已收/未收”不变，但 #263 改变了登录/手机号入口，受影响路径必须按 1730 与 `22be47…` 重跑。
- 蔡奇真独立清理、QH/JQ 原生、真实文件送达、目标云与平台均未因本次回归自动通过。

## 四、C4 回归建议

1. 洪翔冻结最终提交与任务模式后，Yuen 从该干净提交执行 **1730（或届时实际数）全量**、AB16、XY64 与受影响登录/账号定向。
2. 重新执行 `release:package closed`，核对 13 页/4 底栏、两支云包、185 客户端哈希与 manifest；本次 `711deb7e…` 仅作预核。
3. 蔡奇真按同一构建给独立范围；真实云/真机/平台另验。

## 五、证据

- 全量：`artifacts/full-check.txt`（1730/1730）
- AB：`artifacts/ab-results.json`（16/16，dirty=false）
- XY：`artifacts/xy-export-access-results.csv`（64/64）
- 候选：`artifacts/candidate-manifest.json`、`candidate-summary.txt`、`candidate-hashes.txt`、`entry-table.csv`
- 环境：`artifacts/environment.txt`
