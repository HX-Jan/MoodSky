# MoodSky Alpha Sprint Log 3: Candidate Scope and Lifecycle Verification

| Item             | Details                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Course           | [2601_FZU-MU_SE](https://bbs.csdn.net/forums/2601_MU_SE_FZU)                                                                            |
| Assignment       | [Fifth Assignment — Alpha Sprint](https://bbs.csdn.net/topics/620611106)                                                                |
| Reporting period | November 25–26, 2026                                                                                                                    |
| Objective        | Consolidate lifecycle evidence, review candidate scope and prepare the final regression handoff                                         |
| References       | [Repository](https://github.com/HX-Jan/MoodSky), [candidate scope](candidate-scope-draft.md), [24 acceptance gaps](acceptance-gaps.csv) |

## 1. Scope for the next candidate

We reviewed the current submissions against main `7feca53ff0ed461cac270b7da7e7c36f36b7973b`. Version **0.5.3** remains the product baseline. This period adds verification tools, two evidence-tool fixes and reports. Client pages, production services, database rules and release switches are unchanged.

The proposed candidate uses **task mode `closed`**, with new campus check-ins paused. The three task modes are tested in separate local fixtures; they are not simultaneously enabled in the candidate. The seven weather choices, right-side selection buttons, explicit task completion and empty-account re-registration remain intact.

The scope draft lists each feature's evidence and outstanding dependencies. Real cloud operation, device file delivery, privacy/UGC status and platform review remain separate checks. This draft does not declare the product ready for public release.

## 2. Integration and evidence fixes

| Source                                                               | Work reviewed and adopted                                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [#246 — Qizhen Chen](https://github.com/HX-Jan/MoodSky/pull/246)     | Three-mode page matrix, seven-weather shared-input flows, campus round trips, unknown-result checks and original November 24 native captures |
| [#248 — Junhan Huang](https://github.com/HX-Jan/MoodSky/pull/248)    | Thirteen steps for deduplication, original-request replay, date rollover, pause and retired-place history; six-collection lifecycle map      |
| [#249 — Xiang Yu](https://github.com/HX-Jan/MoodSky/pull/249)        | Sixteen redacted export/account request receipts; the unsupported cleanup-progress claim is excluded                                         |
| [#250 — Yuen Lin](https://github.com/HX-Jan/MoodSky/pull/250)        | C2 regression links, dated statistics snapshot and testing-method contribution                                                               |
| [#251/#252 — Qizhen Cai](https://github.com/HX-Jan/MoodSky/pull/252) | Client observations and an actual independent local A/B run, with source and cleanup limitations retained                                    |
| [#253 — Jiawei Fang](https://github.com/HX-Jan/MoodSky/pull/253)     | C2 carryover and C3 task/account regression, service samples and page/lifecycle comparison                                                   |
| [#255 — Yifan Ji](https://github.com/HX-Jan/MoodSky/pull/255)        | A/B workbench run, eighteen focused tests and the previously missing full-check failure log                                                  |

The maintainer fixed two reproducible reporting problems. The export request logger could not find the shared Git references in a linked worktree, so its normal command failed before generating evidence. It now resolves the shared Git directory. The service evidence generators used a fixed November 25 timestamp for later reruns; they now record the actual generation time. Two regression tests cover these failures.

Original screenshots and logs are retained. Jiawei's new regression logs use a dated directory so the older C1 logs remain available. Cai's formatting failures were corrected without rewriting the raw local receipts. Reports that describe the former “no re-login” behavior now carry a note distinguishing that historical observation from the current requirement for explicit registration of an empty new account.

Phone-login [#237](https://github.com/HX-Jan/MoodSky/pull/237) remains held because the enabled entry blocks the existing re-registration route. The paid AI scheduling proposal in [#247](https://github.com/HX-Jan/MoodSky/pull/247) stays separate and has not been enabled. [#254](https://github.com/HX-Jan/MoodSky/pull/254) remains a C4 draft; early material is not counted as a finished future-period task.

## 3. Lifecycle boundaries checked

The maintainer reran **14 lifecycle scenarios with 137 assertions** against disposable synthetic data. They distinguish export expiry from body removal, deactivation from cleanup completion, and a cleanup request from a completed batch. The checks also cover receipt binding, preservation of B and public data, and recovery without reviving the old account.

Cai has now supplied an actual **16/16 local A/B run**. It includes normal own-account access, B's targeted requests for A's generated export, stale-export rejection, deactivation and empty-account re-registration. We no longer describe that independent run as missing. Its archive-derived snapshot has not been mapped to the remote commit, and the sixteen checks do not execute the cleanup worker. Those gaps remain explicit.

Yifan's eighteen tests cover logout confirmation, protected pending work and task retries. For the precise late-save boundary, the maintainer separately ran the existing `session-races` case: A commits a record, the client switches to B, and A's response is released afterwards. B receives no A content or write; returning to A reads version 1, with one effective write. This is recorded as the maintainer's verification, rather than attributed to a member who did not run that case in their submitted command.

The client-only report that a file could be previewed but not sent still needs a traceable device build and actual delivery evidence. Current local file-API tests pass; that does not establish that a phone received the file.

## 4. Burnup chart

<!-- FIGURE 1: Insert images/01_burnup.png here. -->

![Figure 1. MoodSky Alpha burnup chart](images/01_burnup.png)

**Figure 1.** The scope is 48 period-delivery checkpoints. Completed deliveries total 3 on November 21, 7 on November 22, 10 on November 23, 11 on November 24–25 and 16 at this November 26 cutoff. Future actual values are blank.

Five reviewed deliveries are added on November 26: C2 carryover from Qizhen Chen, Junhan, Yuen and Jiawei, plus Jiawei's C3 delivery. Submission dates and review-completion dates remain separate. This yields C1 **10/12**, C2 **5/12** and C3 **1/12**. The twenty-four final acceptance units use a separate ledger. Xiang Hong's own checkpoint has not been self-approved.

The chart was made in 4080 Studio using the event ledger. Its native SVG was converted directly to PNG. Earlier chart snapshots remain unchanged.

## 5. Application evidence and today's simulator limitation

A fresh native run was attempted on November 26, but the official developer tool reported **simulator launch failed**, and automation timed out. No new native success or screenshot was claimed. The following are the latest reviewed working captures supplied by Qizhen Chen, taken on **November 24**, using the same unchanged client source and an offline SDK fixture. They are reused without cropping, resizing or annotations; they are not presented as November 26 captures.

<!-- FIGURE 2: Insert images/02_01-saved-return-selected.png here. -->

![Figure 2. Saving a record returns to a selected task](images/02_01-saved-return-selected.png)

**Figure 2.** Saving the synthetic record returns to the task page with the task still selected. Other task cards retain their right-side selection controls. Source: Qizhen Chen, November 24 native simulator capture.

<!-- FIGURE 3: Insert images/03_02-reopened-saved-record.png here. -->

![Figure 3. Reopening the saved record](images/03_02-reopened-saved-record.png)

**Figure 3.** Reopening retains the saved SUNNY weather and empty synthetic body. The page shows all seven weather choices. The displayed November 24 date is part of the original capture.

<!-- FIGURE 4: Insert images/04_03-explicit-complete.png here. -->

![Figure 4. Explicit task completion](images/04_03-explicit-complete.png)

**Figure 4.** The record task becomes completed only after the explicit completion action. Saving a record is not itself task completion. These local images do not prove target-cloud or real-device behavior.

## 6. Verification and remaining work

The full local check passed **1,695/1,695 tests**, with zero failures or skips. The increase from 1,693 is the two evidence-tool regressions. The **69 focused tests** and **20 source/session tests** are overlapping subsets, not additional tests to add to that total. The shared Page/SDK runner passed sixteen scenarios; the task matrix covers twenty-four rows and four unknown-result action paths. All nine team groups and eight production-assembly offline groups passed.

| Member        | Verifiable progress received                                                               | Next required handoff                                           |
| ------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Xiang Hong    | Reviews, tool fixes, 24-gap review, candidate draft, lifecycle comparison and this article | Yuen/Cai review; C4 freeze and final decision                   |
| Yifan Ji      | #255 A/B and pending-work evidence, executed November 25                                   | Common-seed four-entry comparison and Yuen's current opinion    |
| Zhifeng Dai   | Earlier same-source and delayed-response evidence retained                                 | Current shared-input result and peer review                     |
| Linghan Chen  | Earlier account/share/file reports retained                                                | Current interface results and traceable device file delivery    |
| Jiaqi Zhu     | Existing native media and visual issue index                                               | Read-only wording retest, current media and final storyboard    |
| Qinghan Zhang | Existing campus captures and shared-flow inputs                                            | Current pause/history/failure results and review                |
| Junhan Huang  | #248 C2 replay/date/history results received                                               | Current C3 return and caller review                             |
| Jiawei Fang   | #253 C2 carryover and C3 regression received                                               | Actual caller feedback and final frozen-source checks           |
| Qizhen Chen   | #246 C2 delivery received; C3/C4 checks remain November 24 pre-runs                        | Current-period continuation and named review                    |
| Xiang Yu      | #249 additional redacted requests received                                                 | Current lifecycle handoff and independent cleanup feedback      |
| Yuen Lin      | #250 C2 statistics/methods completed                                                       | Updated coverage, final candidate and testing essay             |
| Qizhen Cai    | Actual local sixteen-check run and client observations received                            | Source mapping, independent batch cleanup and candidate opinion |

Missing current-period reports are recorded as missing evidence, not as proof that someone has done no work. Actual hours and signatures remain for each member to provide. No cloud deployment, WeChat upload, CSDN publication or course-page submission was performed for this update.

For C4, freeze the actual source and mode, rerun affected cases, assemble and verify the same client and two cloud packages, obtain the named independent opinions, and record a feature-by-feature decision. The summary structure is prepared; final results and personal reflections will be filled from actual returns.
