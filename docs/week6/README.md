# 第六周交付与验收

2026 年 11 月 16–22 日。本页按首批 `0.5.1` 候选记录成员来源，后续源码发行见 [v0.5.2](../releases/v0.5.2.md)。计划源码起点为 `987b19d`，本批整合基线为 `13afb20956f5b115cfd393487aee8bbe570ea8d3`。收件、源码合入与成员独立验收分别登记。

## 首批收件

| 任务                  | 固定交审来源                                                                                    | 本批采用范围及后续                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| W6-H · 洪翔           | [#184](https://github.com/HX-Jan/MoodSky/pull/184) · `9b489189278792935c4e86c0278cd8c8694b9fa8` | 版本页区分版本号与构建差异，展示健康响应中的新增打卡状态。目标云实测待补。                                        |
| W6-QH · Qinghan Zhang | [#185](https://github.com/HX-Jan/MoodSky/pull/185) · `87ed5470d203a86f94703a37de95a23ba52a5e8b` | [校园页面本地验收](qinghan-zhang/README.md)。地点限制在页面的展示与真实设备复验待确认。                           |
| W6-YF · Yifan Ji      | [#186](https://github.com/HX-Jan/MoodSky/pull/186) · `eac260d519ae65fffbc86512f55bdcab819e0b37` | [记录保存与恢复](yifan/w6-yf-record.md)。收录成员报告及禁云预览截图。成员端 A/B 切号待补。                        |
| W6-XY · Xiang Yu      | [#187](https://github.com/HX-Jan/MoodSky/pull/187) · `4f762a3312ae4ecfbe65aa2a5a0a835106903b19` | [导出、维护与注销](XiangYu/README.md)。收录合成报告及可复跑工具；真实维护运行、设备文件送达待补。                 |
| W6-L · Linghan Chen   | [#188](https://github.com/HX-Jan/MoodSky/pull/188) · `d130b9ce6c26cb60703f301070a195d82c289ef0` | [登录、分享与导出](linghan-chen/README.md)。收录登录失败、分享落点、退出及切号回归；原生页面入口和设备交付待补。  |
| W6-Z · Zhifeng Dai    | [#189](https://github.com/HX-Jan/MoodSky/pull/189) · `3250cfd3bfb194983cd7fb589a12b3a3f12f43de` | [月历、档案与回顾](zhifeng-dai/README.md)。采用演示模式返回重读修复及回归；原生页面证据待补。                     |
| W6-QC · Qizhen Chen   | [#190](https://github.com/HX-Jan/MoodSky/pull/190) · `f0efa150491ca99b956b4a5f974ff55af0bf9a86` | [小任务页面与完成状态](qizhen-chen/README.md)。采用迟到回执导航修复、三模式回归和禁云模拟器材料；独立复核待回传。 |

合并 `docs/README.md` 的两个同位入口，保留导出和小任务交付链接。其余原交审改动逐文件核对。成员日志及受指纹约束的文件按原样接收。成员截图与历史构建的关系以各报告为准。

## 候选放行边界

候选从最终干净主干生成，任务模式 `closed`，新增校园打卡默认暂停。用清单的完整 `sourceCommit` 核对客户端、业务云包和维护云包。完整检查、离线生产联调和候选哈希记录可用作本地验收证据。

本周仍需收取 W6-JQ、W6-JH、W6-JF、W6-YL、W6-C 的本人回传或复核。微信后台版本与隐私生效状态、目标云健康和维护执行、电脑及手机实际文件送达进入后续联调。周末放行由负责人依据最终实测签认。

## 11 月 20 日增补收件

Yuen Lin [#197](https://github.com/HX-Jan/MoodSky/pull/197) 已接收为第六周原始回归、候选及证据归档，保留原构建和未测项；不表示独立验收。Junhan Huang [#196](https://github.com/HX-Jan/MoodSky/pull/196) 两项证据说明错误已请求修改，尚未合入。上文“仍需收取 W6-YL”的历史快照由本段增补，不继续作为尚无材料的结论。Alpha #210 另按冲刺前预跑登记。完整来源、复跑及接手人见[洪翔接收记录](../alpha/xiang-hong/pr-intake.md)。

## #196返修接收增补

Junhan Huang #196已在修正导出来源和分页说明后，以同步交审f1fed1654cc3e031b9e642066cdcbb067197928e批准并Squash为60b12534425a84c38397cb3d9f08d7a8a4a89896。23样例复现、全部来源可定位，第二页1条且hasMore=false；1638项和固定head quality通过。原“待返修”是先前快照，当前已接收4份工具/资料；不表示本人C1确认或独立验收。后续见[第一期负责人记录](../alpha/xiang-hong/c1-20261121/README.md)。
