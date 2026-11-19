# Junhan Huang 第六周交付（W6-JH：校园接口与历史数据）

2026-11-19，按《第六周详细任务计划》W6-JH 执行。范围是本地验证：`campus.checkins`、`campus.checkIn`、`campus.checkinHistory` 的未登录结果、A/B 隔离、本人历史、`page/pageSize` 分页、暂停、去重/重放/跨日、下架地点与导出清理覆盖。**没有调用目标云、没有真机、没有真实账号。**

|      |                                                                                |
| ---- | ------------------------------------------------------------------------------ |
| 分支 | `Junhan_Huang-W6-campus-verify`                                                |
| 基线 | `origin/main` `5b27753`（v0.5.2 准备提交）                                     |
| 环境 | Windows / Node.js 24 / production entry + `tests/helpers/w2-database` 固定时钟 |
| 全量 | `npm run check` 1634 项通过，0 失败                                            |
| 结论 | 本地链路通过；目标云、真机与真实清理仍待外部验证                               |

## 一、请求/响应样例

[`w6-jh-checkin-samples.json`](w6-jh-checkin-samples.json) 由 [`tools/week6-jh/checkin-samples.cjs`](../../../tools/week6-jh/checkin-samples.cjs) 生成，使用真实生产入口、模拟数据库和固定北京时间：

- 首个时钟 `2026-11-18T15:59:59Z`（北京 11-18 23:59:59）；
- 跨日时钟 `2026-11-18T16:00:01Z`（北京 11-19 00:00:01）；
- A/B 为两个合成账号，地点来自当前五地点目录；下架地点使用独立合成 ID。

样例覆盖 23 组请求/响应，包含：

| 场景                  | 实际结果                                                      |
| --------------------- | ------------------------------------------------------------- |
| 未登录调用三个 action | 均 `UNAUTHENTICATED`                                          |
| A 在两个地点打卡      | 当日 `campus.checkins` 返回 2 条                              |
| B 读取当日/历史       | 均空，读不到 A                                                |
| 分页 `pageSize:1`     | 第 1 页 `total:2, hasMore:true`；第 2 页 1 条 `hasMore:false` |
| 同请求 ID 同日重放    | `replayed:true`，返回原时间和地点                             |
| 同日重复同地点        | 不新增；同地点并发只有一个写入结果                            |
| 同日不同地点          | 允许，各一条                                                  |
| 跨日后重放原请求      | 仍返回 11-18 的原记录                                         |
| 跨日新请求            | 新增 11-19 记录                                               |
| 暂停新增              | 历史与原回执仍可读；新写入 `NOT_IMPLEMENTED`                  |
| 下架地点              | 历史仍返回；新增 `INVALID_INPUT`                              |
| JSON 导出             | 4 条打卡，字段仅 `placeId/date/completedAt`                   |

分页与去重结果在 JSON 的 `summary` 中：`checkinRows: 4`、`dates: ["2026-11-18","2026-11-19"]`、`retiredWriteCode: INVALID_INPUT`、`pauseNewWriteCode: NOT_IMPLEMENTED`、`exportCheckinCount: 4`。

## 二、生命周期覆盖表

[`w6-jh-lifecycle-coverage.json`](w6-jh-lifecycle-coverage.json) 给 Xiang Yu 的导出/清理范围：

| 集合                            | 作用                     | 导出                       | 清理              | 公共保留 |
| ------------------------------- | ------------------------ | -------------------------- | ----------------- | -------- |
| `place_checkins`                | 本人自报打卡（规范集合） | `placeId/date/completedAt` | 按 owner 幂等删除 | 否       |
| `campus_checkin_states`         | 旧聚合访客/回执          | 合并为同一访客字段         | 按 owner 删除     | 否       |
| `request_receipts`              | 原请求重放与导出版本栅栏 | 不导出                     | 按 owner 删除     | 否       |
| `places`                        | 公共推荐目录             | 不导出                     | **保留**          | 是       |
| `favorites`/`place_corrections` | 其他校园私人数据         | 是                         | 按 owner 删除     | 否       |

导出不含经纬度、轨迹或照片；公共地点、支持资源、任务模板不随注销删除。真实文件生成、24 小时领取、注销清理执行器与目标云集合权限未执行。

## 三、与 W5 结论的关系

W5 记录目标云 `moodsky-release` 0.4.0 只识别小写 `campus.checkin` 与 `campus.checkinHistory`。本周计划记录目标云已到 `43550e` 且新增打卡处于暂停，但**本次没有调用目标云**，因此不能确认四个 action、集合与权限已经对齐。

本地暂停行为符合候选默认：历史、原回执、导出可读；新写入明确 `NOT_IMPLEMENTED`。如果发布人确认目标云已包含四 action 并保持暂停，可以按“只读历史 + 暂停新增”进入外部联调；否则仍按 W5 建议只放推荐只读。

## 四、边界

- 未调用 CloudBase、未部署、未改权限、未使用真实账号或真实私人记录。
- 未执行真机、弱网、真实 A/B、真实文件送达与注销清理。
- 本地夹具使用合成账号与合成地点；“下架地点”是独立 ID，不是真实下架操作。
- 引用目标云状态来自计划记录与队友诊断，不作为本人实测。
- 未取得 Qinghan、Qizhen Cai 的独立复核；工时和难度点待本人填写。

## 五、复现

```powershell
npm ci
npm run setup
npm run cloud:prepare
node tools/week6-jh/checkin-samples.cjs
node --test tests/manual-campus-checkin.test.js tests/campus-history-client.test.js
npm run check
```

生成的 JSON 位于本目录；`w6-jh-checkin-samples.json` 的请求 ID、时钟和响应均为固定值，可重复对照。

## 六、复核清单

| 复核人     | 需要确认                                                          |
| ---------- | ----------------------------------------------------------------- |
| Qinghan    | 响应样例中的地点、日期、暂停/下架文案是否与页面一致               |
| Qizhen Cai | A/B 隔离、未登录、下架历史与导出/清理范围                         |
| Xiang Yu   | `place_checkins`/`campus_checkin_states` 集合、导出字段与清理顺序 |
| Yuen       | 本地夹具与实际候选包的边界；真实云/真机补验项                     |

## 七、记录字段

| 字段              | 内容                                      |
| ----------------- | ----------------------------------------- |
| 任务编号          | W6-JH                                     |
| 协作人            | Qinghan Zhang、Xiang Yu                   |
| 复核人            | Qinghan Zhang、Qizhen Cai                 |
| 构建/基线         | `5b27753`（本地分支，未部署）             |
| 初始数据          | 两个合成账号、五地点目录、独立下架地点 ID |
| 实际耗时 / 难度点 | 待本人填写                                |
| 验收状态          | 本地通过；目标云/真机/真实生命周期阻塞    |
