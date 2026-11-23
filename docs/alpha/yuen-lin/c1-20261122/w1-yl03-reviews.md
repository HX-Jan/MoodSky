# 共同复核意见（Yuen Lin）

- 复核人：Yuen Lin / @Yuminu
- 日期：2026-11-22（Asia/Shanghai）
- 本机基线：`36ff7f54476ff19cbacba7238b11ee34a5adcdf6`
- 原始日志：[artifacts/yl04](artifacts/yl04)
- 说明：只复核本机可复跑或仓库内可核对的部分；仓库外证据、真实云、真机、平台后台保持未验证。未替成员填写工时、本人确认或最终验收结论。

## 一、汇总

| 线程                                                                                                      | 被复核人         | 请求                    | Yuen 结论                                                         | 状态             |
| --------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------- | ----------------------------------------------------------------- | ---------------- |
| [#198](https://github.com/HX-Jan/MoodSky/issues/198) / [#235](https://github.com/HX-Jan/MoodSky/pull/235) | 洪翔             | AS-H01 版本、检查、统计 | **通过（本地材料范围）**；AS-H02 未放行                           | 待洪翔最终登记   |
| [#185](https://github.com/HX-Jan/MoodSky/pull/185) / [#203](https://github.com/HX-Jan/MoodSky/issues/203) | Qinghan          | W6-QH 与 C1 校园        | **部分通过**：数据与 59 项本地测试通过；本人原生右侧选点/返回待补 | 待复核           |
| [#186](https://github.com/HX-Jan/MoodSky/pull/186) / [#199](https://github.com/HX-Jan/MoodSky/issues/199) | Yifan            | W6-YF 与 AS-YF01        | **需修改／待补件**；本地代码路径通过                              | 待复核           |
| [#199](https://github.com/HX-Jan/MoodSky/issues/199) / [#236](https://github.com/HX-Jan/MoodSky/pull/236) | Yifan            | AS-YF01 补交            | **需修改**：删除种子文件、证据在仓库外                            | 进行中           |
| [#200](https://github.com/HX-Jan/MoodSky/issues/200)                                                      | Zhifeng          | AS-Z01/AS-Z02           | **通过（本地合成）**                                              | 待复核           |
| [#201](https://github.com/HX-Jan/MoodSky/issues/201) / [#216](https://github.com/HX-Jan/MoodSky/pull/216) | Linghan          | AS-L01/AS-L02           | **通过（A 层本地）**；真实登录与文件送达未验                      | 待复核           |
| [#202](https://github.com/HX-Jan/MoodSky/issues/202)                                                      | Jiaqi            | AS-JQ01/AS-JQ02         | **通过（普通视口原生模拟器）**；P2 待修                           | 待复核           |
| [#203](https://github.com/HX-Jan/MoodSky/issues/203)                                                      | Qinghan          | AS-QH01/AS-QH02         | **部分通过**；原生操作待补                                        | 待复核           |
| [#204](https://github.com/HX-Jan/MoodSky/issues/204)                                                      | Junhan           | AS-JH01/AS-JH02         | **来源与接口结果可用（本地）**                                    | 待复核           |
| [#205](https://github.com/HX-Jan/MoodSky/issues/205)                                                      | Jiawei           | AS-JF01/AS-JF02         | **通过（本地样例）**；云与真机未验                                | 待复核           |
| [#206](https://github.com/HX-Jan/MoodSky/issues/206)                                                      | Qizhen Chen      | AS-QC01/AS-QC02         | **通过（本地矩阵）**；C2—C4 未执行                                | 待复核           |
| [#207](https://github.com/HX-Jan/MoodSky/issues/207)                                                      | Xiang Yu         | AS-XY01/AS-XY02         | **通过（本地 C1）**；真实到期/清理未验                            | 待复核           |
| [#22](https://github.com/HX-Jan/MoodSky/issues/22)                                                        | 洪翔（历史线程） | 旧云部署授权            | **历史线程，不据此重开云操作**                                    | 阻塞（无新授权） |
| [#209](https://github.com/HX-Jan/MoodSky/issues/209)                                                      | 蔡奇真           | AS-C01/AS-C02           | 非 Yuen 指定复核；项目条件受 #232 阻塞                            | 阻塞             |

## 二、逐项说明

### 1. #198 / #235 洪翔 AS-H01

核对内容：

- `version-scope.csv`：产品基线 `11e230d`、GitHub 固定 Latest `v0.5.2/5b27753`、已上传云包 `0580e14` 分列；未把三者混成同一包。
- `checks.json`：`1691/1691`、8 组离线、`main quality 45011435406`；统计截止 18:25。
- `cycle-deliveries-48.csv`：48 行；`completed-events.csv` 7 条，21 日 3 条、22 日 4 条；C1 为 7/12；未来日期的 Completed 为空。
- 本机复跑 `36ff7f5`：完整 1691/1691、生产装配 8 组、团队联调 9 组、`check-cloud` 与云审计通过。

结论：**AS-H01 的本地材料范围通过**。检查数字与统计无重复加总，版本未混用，H 未自行签验收、未把 AS-H02 提前完成，符合要求。
剩余：Yuen 的 C1 回传（本 PR）已补齐；真实云、真机、平台后台仍阻塞；AS-H02 需等各模块与 #208 的最终候选后再放行。

AS-H02 当前输入状态：YL02 候选已就绪；但 AS-QC02、AS-Z02、AS-XY02 的最终冻结结果尚未全部回传，AS-C02 受 Bug #232 阻塞，因此 AS-H02 目前无法核对放行，保持 `待开始`。

### 2. #185 / #203 Qinghan W6-QH 与 C1

核对内容：

- 独立复跑 `node --test tests/manual-campus-client.test.js tests/campus-history-client.test.js`：**59/59** 通过（`artifacts/yl04/qinghan-tests.txt`）。
- `places-review.csv` 五个 `placeId` 与 `miniprogram/shared/campus-checkins.js` 一致：福友阁、大梦书屋、望舒湖、阳光园、光彩创咖；校区均为旗山校区；来源和“现场未复访”说明保留。
- `progress.md` 明确：模拟器自动化因服务端口关闭未运行，右侧按钮实点、任务返回状态、当期运行图待补；没有把 59 项本地测试写成原生通过。

结论：**数据与本地测试通过；AS-QH01 的原生右侧选点、AS-QH02 的原生返回/暂停反馈未完成，不能登记整项已验收。**
建议：补同 SHA 的任务入口→校园→选点→返回已选原生证据；或由洪翔明确以现有材料收件、不作为通过。

### 3. #186 / #199 Yifan W6-YF 与 AS-YF01

核对内容：

- `docs/week6/yifan/w6-yf-record.md` 与 6 张截图存在；内容覆盖七天气、失败恢复、任务→记录、连点、21 码点拒绝。
- 独立复跑三文件 `journal-pages`、`journal-recovery-native`、`week6-qc-task-flows`：**37/37** 通过（`artifacts/yl04/yifan-pr236-37tests.txt`）。
- 本机完整检查 **1691/1691**。
- PR #236（head `95669f7`）只改 `docs/alpha/yf01-c1/` 下文档；`source.json` 与 `normal-results.csv` 仍引用 `synthetic-records.json`，但该文件在本 PR 被删除。
- 原生自动化 E38—E43、录屏在仓库外 `D:\Projects\MoodSky-Alpha证据\1122\`，仓库内无原始结果文件。

结论：**本地代码路径通过；但材料需返修后才能作为 AS-YF01 完成依据。**
需修改：

1. 恢复 `synthetic-records.json`，或同步改写所有引用，避免“文内路径不存在”。
2. 将 E38—E43 关键原始 JSON/日志（至少 `native-results.json`、`node-test-output.txt`、`local-check-output.txt`）放入仓库可访问位置；截图可保留仓库外，但需给负责人可复现入口。
3. 对自报的 Windows 10 例失败，提供失败用例清单与 E43 原始日志；本机同基线未复现，暂不定责。
4. AS-YF02（失败草稿、超时、A/B 切号）**成员本人材料未回传**，保持阻塞。Yuen 仅做代码级定向 59/59（`artifacts/yl04/yf02-independent-tests.txt`），不能替代成员实测、真机与 A/B。

### 4. #200 Zhifeng AS-Z01/AS-Z02

核对内容：

- 运行 `node tools/week6-z/alpha-review-harness.cjs --cycle c1|c2|c3|c4`：分别 **40/25/41/60** 行 PASS（`artifacts/yl04/zh-rerun.txt`）。
- 与仓库 CSV 对比：差异仅 90 天窗口随业务日从 `2026-11-21` 后移到 `2026-11-22`，以及随机 UUID；无 PASS/FAIL 变化。
- 原生 PNG 为开发者工具模拟器；未冒充真机；SVG 为运行时渲染，文档中已注明。

结论：**通过（本地合成）**。AS-Z01 四入口同源、空月与跨月成立；AS-Z02 失败降级、旧响应与账号隔离成立。
剩余：Yifan 的新 11/16—22 共同种子尚未与该工具联调；真实云端乱序、真机、最终冻结 SHA 未测。

### 5. #201 / #216 Linghan AS-L01/AS-L02

核对内容：

- 独立复跑 `week5-linghan-login-share`、`week6-linghan-login-share-export`、`native-export-file`、`page-sharing`、`logout-work-protection`：**49/49** 通过（`artifacts/yl04/linghan-tests.txt`）。
- `login-profile-results.csv` 12 条（11 通过、1 外部待验）、`share-export-results.csv` 13 条、`account-export-regression.csv` 14 条（13 通过、1 待对齐），与 TAP 一致。
- 13 页分享参数表、7 张禁云截图存在；C2—C4 提前到 11/21 执行已在文档中如实标注，未虚记日期。

结论：**通过（A 层本地）**。AS-L01 游客/登录/分享边界与 AS-L02 导出界面分支在替身范围内成立。
剩余：真实微信登录、真实文件保存/发送、目标云、真机；37 项初始用例对照表仍待洪翔提供。

### 6. #202 Jiaqi AS-JQ01/AS-JQ02

核对内容：

- 29 张 11/22 原生图、媒体索引、操作记录存在；整合记录核对 72 个 UI 文件与图片指纹。
- `visual-issues.csv` 保留 JQ-C1-01 已修复；JQ-C1-02（只读卡仍提示“登录后可开始任务”）与 JQ-C1-03（夹具英文错误）仍未修复/未评审。
- 11/21 的 AUTH_TASK_ERROR 与 11/22 补证分列，未用旧失败覆盖新结果。

结论：**通过（普通视口原生模拟器）**；AS-JQ01 需 P2 文案修复后同条件复测；AS-JQ02 的 3—4 分钟最终分镜与手机/大字体/读屏仍未完成。
责任：JQ-C1-02 → Qizhen Chen / Linghan；JQ-C1-03 → Linghan / Xiang Yu。

### 7. #203 Qinghan AS-QH01/AS-QH02

见第 2 节。补充：C1 材料位于 `docs/alpha/c1/qinghan-zhang/`，与 W6 `docs/week6/qinghan-zhang/` 不重复计数。AS-QH02 的分页/暂停/切号原生结果仍缺。

### 8. #204 Junhan AS-JH01/AS-JH02

核对内容：

- 运行 `node tools/alpha-jh/build-c1-samples.cjs <w6-source> <temp>`：重新生成 12 组，`api-results.csv` 与仓库版本**逐字节一致**（`artifacts/yl04/jh-rerun.txt`）。
- 断言覆盖：未登录三 action `UNAUTHENTICATED`；A 当日两地点；B 为空；`pageSize:1` 两页 `total/hasMore`；同日重放 `replayed:true`；并发同地点一行。

结论：**来源与接口结果可用（本地 production entry + 模拟库）**，可作为 Qinghan 页面与 Xiang Yu 导出的输入。
剩余：目标云、真实 A/B、跨日与下架历史（AS-JH02）、动态停用实时传播未完成。

### 9. #205 Jiawei AS-JF01/AS-JF02

核对内容：

- `docs/week6/jiawei-fang/mode-template-results.csv`、`account-state-map.md`、`task-mode-samples.json` 存在；#233 已合入 `11e230d`。
- 独立定向 `week6-jf-*` 与 `week5-jf-*`：**22/22** 通过（`artifacts/yl04/jf-tests.txt`）；完整 1691/1691 包含其余 JF 用例。
- 记录明确真实云、模板合规、真机未测；本人确认与独立验收未代签。

结论：**通过（本地样例）**。AS-JF01 三模式/模板优先/失败空态、AS-JF02 日期/偏好/停用边界在本地成立。
剩余：目标云模板与写门禁、真实账号停用、真机；Qizhen Chen / 蔡奇真 的指定独立结论仍待回传。

### 10. #206 Qizhen Chen AS-QC01/AS-QC02

核对内容：

- 运行 `node tools/alpha-qc/verify.cjs`：`result=PASS`，矩阵 **24 行**，4 条未知结果路径；迟到导航当前源码 **0 次**、仅移除 VM 守卫的反例 **1 次**（`artifacts/yl04/qc-verify.txt`）。
- 历史行数 1/1、1/1、2/2、1/1；原请求重放一致；未确认不假成功。
- 原生 9 张图与 11 项复测为成员自报，仓库外/本机工具；本机未重跑原生。

结论：**通过（本地矩阵）**。AS-QC01 模式×动作×往返、AS-QC02 连点/未知结果/迟到守卫成立。
剩余：C2—C4、真实云、真机；Jiawei 与 Yuen 的逐项独立验收由本页登记，C2—C4 不提前完成。

### 11. #207 Xiang Yu AS-XY01/AS-XY02

核对内容：

- 运行 `node tools/alpha-xy/c1-baseline.cjs --out <temp>`：5 个产物中 `synthetic-data.json`、`data-coverage-baseline.csv`、JSON/Markdown 样例与仓库版本**逐字节一致**；`format-receipts.md` 仅 Node 版本行不同（本机 v24.16.0 vs 仓库 v24.21.0）。
- 运行 `node tools/week6-xy/verify-export-cleanup.cjs`：**14/14** 场景、137 检查通过（`artifacts/yl04/xy-week6-verify.txt`）。
- 文档明确真实云、真机、自然到期、备份恢复未测；任务书未定义的编号不臆造。

结论：**通过（本地 C1）**。AS-XY01 两格式/归属/失效、AS-XY02 分批清理与公共保留在内存库成立。
剩余：真实文件后端、自然到期、维护触发器、恢复与目标云。

### 12. #22 历史云部署线程

该线程是 2026-10-17 的一次性云上传授权，已被后续 W5/W6 构建替代。Yuen 不在 Alpha C1 重开该授权；本轮无云操作。当前 Alpha 的云与真机结论只在 #208 与各模块 Issue 登记，保持阻塞。

### 13. #209 蔡奇真

Yuen 不是 AS-C01/AS-C02 的指定复核人。当前 C1-C 受 [Bug #232](https://github.com/HX-Jan/MoodSky/issues/232) 阻塞，材料为受阻报告，不是越权验收通过；本页不代签。

## 三、复核边界

- 上述“通过”均限定为标注的本地/合成/模拟器范围；不等同于真实云、真机、平台后台或独立放行。
- 未修改成员源码、证据或签字；未替任何人填写工时、本人确认或最终验收。
- 真实设备、目标云、微信体验版/正式版的未测项统一保持 `阻塞`。
