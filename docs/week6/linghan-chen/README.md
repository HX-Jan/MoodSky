# Linghan Chen Week 6 Delivery

Date: 2026-11-17

Owner: Linghan Chen

Task: `W6-L` - login, account pages, sharing callbacks, and the export interface

Acceptance scope: `W6-L` items 1-3. Item 4 (delivery, alignment with Xiang Yu, review by Qizhen Cai and Yuen) is covered by this record plus the handoff section.

Branch: `week6/linghan-chen`

Baseline: GitHub `main` at `13afb20956f5b115cfd393487aee8bbe570ea8d3` (docs(release): remove the retired submission target, PR #183). This is the Week 6 plan baseline `987b19d675bfe7a8f4b14c0cb1b25d508483d329` plus one documentation-only commit.

Current submission commit: use the PR head. The final SHA is recorded in the PR description after the commit is created.

> This record only reports source review and automated checks actually performed on this branch. Week 6 only covers local verification with the cloud-disabled WeChat DevTools profile and synthetic data. Passing source tests does not mean that cloud functions were deployed, a device file was delivered, the WeChat backend was checked, or the mini program was submitted for review.

## Completed Scope

| Plan item                        | Checked behavior                                                        | Result                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W6-L 1 login                     | Active WeChat login local success, privacy-cancel, and failure branches | Success, privacy-cancel, and disabled-account paths were already covered by `tests/week5-linghan-login-share.test.js`; this branch adds the generic network-failure branch and the unavailable-channel branches (`NOT_IMPLEMENTED` / `CLOUD_NOT_CONFIGURED`). A failed attempt binds no session, writes no remembered-login flag, and reports a retryable notice. |
| W6-L 1 guest and public entries  | Guest browsing, public share landings, safe entry for private pages     | A guest without a session or remembered login opens public share landings (`tasks` suggestions) with no login redirect; a `campus` share keeps its static single-page preview; a private detail share only loads after the login safe entry, whose `returnTo` carries no record ID, body text, or account identifiers.                                            |
| W6-L 1 skip avatar and nickname  | Optional profile does not block unrelated functions                     | A signed-in account without profile data shows the default `微信用户` entry on My, the profile page loads empty with no unsaved-changes guard, and the account/export page requests exports without any profile call.                                                                                                                                             |
| W6-L 1 logout and account switch | Cache, export preview, and late responses                               | Signing out clears the remembered-login flag and the visible export preview together with its private data; a late export download after sign-out or after account B is accepted delivers no file, opens no share, and leaves no preview.                                                                                                                         |
| W6-L 2 share callbacks           | Native friend/timeline callbacks and landings                           | Reused `tests/page-sharing.test.js` and `tests/week5-linghan-login-share.test.js`; this branch re-verifies the landing split (public without login, campus static preview, private via the safe entry) and that the safe entry can be left for home.                                                                                                              |
| W6-L 3 export interface          | Computer save, phone send, cancel, failure, and compatible text         | Reused `tests/native-export-file.test.js` (desktop disk save, mobile chat send, accurate cancellation, Chinese failure feedback, `MoodSky.md.txt` compatible copy, preview cleared on hide). This branch adds the sign-out variant: the remembered flag and preview are cleared, and late responses after sign-out deliver nothing.                               |

Avatar and nickname remain optional. This submission does not expand personal-data collection, storage, or sharing fields, and it contains no real account, private body text, environment configuration, secret, or cloud identity data.

## Added Focused Tests

File: `tests/week6-linghan-login-share-export.test.js`

1. A failed login attempt reports a retryable notice without binding a session or remembering the login.
2. An unavailable login channel (`NOT_IMPLEMENTED`, `CLOUD_NOT_CONFIGURED`) keeps the guest state without a false success.
3. A guest opens public share landings without login while a private detail only loads through the safe entry.
4. The private landing safe entry can still be left for home without logging in.
5. Skipping avatar and nickname keeps the default profile and unrelated functions usable.
6. Signing out clears the remembered flag, the visible export preview, and private data.
7. A late export download after sign-out delivers no file and no preview.
8. An account B session cannot restore account A export state after a switch.

## Verification Performed

- Week 6 focused tests: `9 passed, 0 failed`.
- Related login, share, export, logout-race, profile, and account regression suites: `157 passed, 0 failed`.
- `npm run cloud:prepare`, `npm run check` (lint, format, structure, docs, typecheck, 1613 tests), and `git diff --check` were rerun on this branch before submission; their actual final results are recorded in the PR description.

The focused and related regression suites use synthetic account scopes and mocked platform interfaces. They prove source-level behavior only and do not replace real WeChat accounts, target-cloud verification, or device testing.

## Not Yet Verified

- Page-by-page manual verification in the cloud-disabled WeChat DevTools profile, including the entrance screenshots listed as a Week 6 deliverable.
- Actual computer file saving and actual chat file delivery on a real phone (`shareFileMessage` / `saveFileToDisk` are mocked locally).
- Sharing callbacks on real iOS/Android devices and a real timeline preview.
- Login, preference writes, export requests, and logout behavior in the target cloud environment.
- A/B switching with two real WeChat accounts and a real disabled account.
- Independent account, privacy, and lifecycle review by Qizhen Cai; independent path and result review by Yuen.

## Handoff

- Qizhen Cai should re-run the sign-out and account-switch paths with two real WeChat identities and confirm that no preview, cached flag, or late response survives a real logout.
- Yuen should enter through a public share landing, a private detail share, and the export preview, then confirm that parameters and network requests contain no private fields on the final candidate commit.
- Xiang Yu should confirm the export format labels and receipts so the client format notice stays aligned with the server-side export lifecycle covered by his `W6-XY` tasks.
- Device file delivery (computer save and phone chat receipt) remains a follow-up verification item for the release gate, per the Week 6 weekend release rules.
