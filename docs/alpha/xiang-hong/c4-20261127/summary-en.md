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

At this cutoff, 33 of the 48 period deliverables have been submitted completely, leaving 15 incomplete or missing (9 partial, 6 not yet received). This measures submitted artifacts, not independent acceptance or production availability. Early submissions are assigned to their actual dates. The separate acceptance ledger retains real reviewer decisions and external gaps.

![MoodSky Alpha burnup chart](images/01-burnup.png)

## Development, testing and integration

We integrated reviewed increments instead of replacing current source with old branches. Existing records, account lifecycle safeguards and selected-button positions remain intact. Local testing exercises original-request retry, pending work, stale responses, identity isolation and export/cleanup boundaries. The frozen product suite has 1730 tests; the C4 evidence-tool correction adds three negative tests, producing 1733 on the integration tree.

Two concrete lessons came from the handoff. First, a historical package must be rebuilt with the packaging script from its own source version: the original C3 manifest was reproduced exactly once that dependency was respected. Second, an evidence generator must assert the result before writing PASS; completion requires the terminal cleanup state and precise authorization outcome. The maintainer corrected those checks and preserved member outputs.

The independently assembled C4 manifest matches the owner's package. The client was uploaded as a development version. Neither that upload nor local checks establish platform approval, real-device file delivery or a matching deployment of both cloud functions.

## Individual contributions and collaboration

The table below records evidenced work and explicitly outstanding personal input. It does not assign invented hours or first-person reflections.

| Member        | Verified contribution source                                                                                                                                                                            | Still needed                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Xiang Hong    | Candidate freeze; four reviewed member increments; package reproduction; evidence-tool correction and handoff manuscripts                                                                               | Actual hours and owner-confirmed personal reflection                                                                 |
| Yifan Ji      | Record/recovery/account-switch evidence; Yuen's explicit local acceptance                                                                                                                               | Shared four-view C3 comparison, frozen-source confirmation and personal summary/hours                                |
| Zhifeng Dai   | Four-view C1–C3 results and early C4 demo/summary material                                                                                                                                              | Final 00c59a1 confirmation and member-confirmed reflection/hours                                                     |
| Linghan Chen  | Login/share/file branches and early C4 material                                                                                                                                                         | Final WeChat-only entry confirmation, actual file delivery and personal summary/hours                                |
| Jiaqi Zhu     | C1 visual work and original media                                                                                                                                                                       | C2–C4 issue disposition, final media and personal summary/hours                                                      |
| Qinghan Zhang | PR265: C2/C3 matrices, 94 tests, ten native images, two campus round trips and summary facts                                                                                                            | Closed-mode candidate confirmation, standard native suite, designated feedback and member-confirmed reflection/hours |
| Junhan Huang  | PR257: fourteen campus rows and export/cleanup cross-check                                                                                                                                              | Review of the tool correction, final service confirmation and personal summary/hours                                 |
| Jiawei Fang   | C2/C3 reports, PR254 (`ee86e6c4`, integrated via PR267) C4 40/1733 recheck on `00c59a1/closed`, external checklist, and PR270 (`712fc196`) confirming C1–C4 hours (10 hours total) and personal summary | Qizhen/Cai independent reviews and external cloud/device checks                                                      |
| Qizhen Chen   | Shared task flows, November 24 native media, C4 precheck and summary draft                                                                                                                              | Frozen closed-mode route checks and member-confirmed summary/hours                                                   |
| Xiang Yu      | Two export formats, 64 access checks, redacted requests, and PR269 (`2d18ca53`) C3-XY 14-scenario/11-batch 30-row cleanup, 6 expired-residue and M1–M8/G1 handoff evidence                              | Cai/Yuen independent reviews, final C4 delivery, and personal summary/hours                                          |
| Yuen Lin      | PR264: 1730 tests, A/B16, XY64 and independently assembled candidate                                                                                                                                    | Freeze confirmation, final testing article and personal summary/hours                                                |
| Qizhen Cai    | PR260: personally operated November 26 cleanup/A-B runs and scope-draft opinion                                                                                                                         | Snapshot mapping, final per-feature opinion and personal summary/hours                                               |

Existing individual summary drafts from Zhifeng, Linghan, Jiawei and Qizhen Chen remain attributed to their original authors and dates. Their final confirmations and actual hours are not inferred from the drafts. The remaining members' reflections will be inserted from actual submissions. The record of work distribution uses delivered development, testing, design and review artifacts; PR count alone is not a workload measure.

## Next iteration

The immediate priorities are final same-source reviewer confirmation, real WeChat login/registration checks, actual JSON/Markdown file delivery, real export expiry and cleanup maintenance, and platform privacy/UGC evidence. Each condition has a named owner in the release table. If product source changes after the freeze, affected checks and the package must be regenerated from the new full commit. The final report will record actual November 28 progress and retain any unresolved condition.

## November 28 engineering closeout

At **2026-11-28T09:19:37+08:00**, the remote intake found no additional effective member PR, independent acceptance, confirmed hours, native screenshots or external-test receipt. This is the final engineering snapshot for this handoff, not an observation of the entire still-ongoing calendar day. Later receipts need a dated supplement. The recorded totals remain **33 complete / 48**, **15 remaining**, **9 partial** and **6 not received**. November 28 adds **0**, so its actual chart point is now **33 completed / 15 remaining**. AS-YF01 and AS-YF02 retain Yuen's local acceptance; the other 22 units remain pending.

Linghan's approximately 9.5 hours and Jiawei's 10 confirmed hours give only a partial reported subtotal of approximately 19.5 hours. Qizhen Chen's 16 hours are a budget; the other ten actual-hour reports remain unavailable. There are no new first-person reflections to invent.

The CSV input includes the November 28 point. The existing 4080 Studio PNG images still show the November 27 export; Antigravity must export final native Editorial PNGs and finish the five outer manuscripts. Logs 1–3 remain byte-for-byte unchanged. No cloud deployment, real-device/platform approval, CSDN publication or course submission was performed. See [closeout facts](closeout-final.json) and [review](../../../reviews/2026-11-28-c4-final-closeout.md).
