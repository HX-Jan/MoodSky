# MoodSky Alpha Sprint Summary

| Item       | Details                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Course     | [2601_FZU-MU_SE](https://bbs.csdn.net/forums/2601_MU_SE_FZU)                                                                                      |
| Assignment | [Fifth Assignment — Alpha Sprint](https://bbs.csdn.net/topics/620611106)                                                                          |
| Objective  | Compare the planned sprint with verified delivery, contributions and remaining work                                                               |
| References | [Repository](https://github.com/HX-Jan/MoodSky), [24 acceptance units](acceptance-gaps.csv), [48 submission checkpoints](submission-audit-48.csv) |

Prepared on November 27. The November 28 final results and outstanding personal contributions must be incorporated before this becomes the final sprint summary.

## Planned scope and actual progress

The sprint runs from November 21 to November 28. The plan assigns twelve members two final acceptance units each, with a report every two days. This yields 24 acceptance units and 48 period-delivery checkpoints. The pre-sprint baseline is v0.5.2 / `5b2775393a4adbf5d9a77ff2a3c61b3c3bb3958c`.

The current product candidate is 0.5.3 / `00c59a1af7ccd27e9c2ae4bc77f6b65fc66b117c`. It retains seven weather choices, private record/review flows, right-side campus selection and explicit task completion. The candidate keeps task mode closed and new campus writes paused. After phone-number capability proved unavailable for this app, WeChat identity login with first-use registration became the selected route. Explicit empty-account re-registration preserves the deletion boundary.

At this cutoff, 29 of the 48 period deliverables have been submitted completely, leaving 19 incomplete or missing. This measures submitted artifacts, not independent acceptance or production availability. Early submissions are assigned to their actual dates. The separate acceptance ledger retains real reviewer decisions and external gaps.

![MoodSky Alpha burnup chart](images/01-burnup.png)

## Development, testing and integration

We integrated reviewed increments instead of replacing current source with old branches. Existing records, account lifecycle safeguards and selected-button positions remain intact. Local testing exercises original-request retry, pending work, stale responses, identity isolation and export/cleanup boundaries. The frozen product suite has 1730 tests; the C4 evidence-tool correction adds three negative tests, producing 1733 on the integration tree.

Two concrete lessons came from the handoff. First, a historical package must be rebuilt with the packaging script from its own source version: the original C3 manifest was reproduced exactly once that dependency was respected. Second, an evidence generator must assert the result before writing PASS; completion requires the terminal cleanup state and precise authorization outcome. The maintainer corrected those checks and preserved member outputs.

The independently assembled C4 manifest matches the owner's package. The client was uploaded as a development version. Neither that upload nor local checks establish platform approval, real-device file delivery or a matching deployment of both cloud functions.

## Individual contributions and collaboration

The table below records evidenced work and explicitly outstanding personal input. It does not assign invented hours or first-person reflections.

| Member            | Verified contribution source                             | Still needed                                     |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------ |
| 洪翔 Xiang Hong   | 本轮冻结、三PR净增量、指纹差异复现、工具修复、日志与汇总 | 本轮工作事实已列，实际工时和本人感想待填         |
| Yifan Ji          | 记录/切号证据、Yuen明确本地意见                          | 共同四入口C3、冻结后记录确认、本人总结工时       |
| Zhifeng Dai       | C1-C3四入口、提前C4演示/总结资料                         | 最终00c59a1确认及本人总结工时签认                |
| Linghan Chen      | 登录/分享/文件分支与提前C4材料                           | 替换微信主入口的最终确认、真实文件送达、总结工时 |
| Jiaqi Zhu         | C1视觉与原始媒体                                         | C2-C4问题处置/最终素材及本人总结工时             |
| Qinghan Zhang     | 23日右侧选点原生补件                                     | 后续校园/暂停/历史回传、最终原生、总结工时       |
| Junhan Huang      | PR257十四行及生命周期交叉核对                            | 复核工具修正、最终候选服务确认、总结工时         |
| Jiawei Fang       | C2/C3及PR254提前C4部分与本人总结草稿                     | 冻结后模式/页面对照、本人C2-C4工时和确认         |
| Qizhen Chen       | 共同链路、24日原生、C4预核与总结草稿                     | 冻结后的closed路径核对、本人总结工时             |
| Xiang Yu          | 两格式导出、64项与脱敏请求                               | C3清理及C4最终本人成果、总结工时                 |
| Yuen Lin          | PR264本人1730/AB16/XY64及同包预核                        | 本次冻结确认、测试文章最终稿、本人总结工时       |
| 蔡奇真 Qizhen Cai | PR260本人26日清理/AB及草案意见                           | 快照映射、00c59a1最终逐功能意见、本人总结工时    |

Existing individual summary drafts from Zhifeng, Linghan, Jiawei and Qizhen Chen remain attributed to their original authors and dates. Their final confirmations and actual hours are not inferred from the drafts. The remaining members' reflections will be inserted from actual submissions. The record of work distribution uses delivered development, testing, design and review artifacts; PR count alone is not a workload measure.

## Next iteration

The immediate priorities are final same-source reviewer confirmation, real WeChat login/registration checks, actual JSON/Markdown file delivery, real export expiry and cleanup maintenance, and platform privacy/UGC evidence. Each condition has a named owner in the release table. If product source changes after the freeze, affected checks and the package must be regenerated from the new full commit. The final report will record actual November 28 progress and retain any unresolved condition.
