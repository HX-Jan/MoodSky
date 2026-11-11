# Linghan Chen Week 5 Delivery

Date: 2026-11-09

Owner: Linghan Chen

Task: `W5-L` - login, account/profile, preferences, and sharing

Acceptance scope: `W5-R03` (preferences), `W5-R05` (account isolation), and W5-L login and sharing scenarios.

Branch: `week5/linghan-chen`

Baseline: GitHub `main` at `9f58ed8cdc04292fd0160236e39937aea7a75ebe` (Recover decoration receipts after asset withdrawal, PR #164)

Current submission commit: use the PR head. The final SHA is recorded in the PR description after the commit is created.

> This record only reports source review and automated checks actually performed on this branch. The current main branch already contains the core Week 5 behavior, so this branch adds focused regression coverage instead of rewriting working product code. Passing source tests does not mean that cloud functions were deployed, an experience build was updated, or the mini program was released.

## Completed Scope

| Acceptance   | Checked behavior                                                      | Result                                                                                                            |
| ------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| W5-L login   | Guest browsing, explicit login, privacy cancellation, and safe return | Cancelling privacy authorization preserves guest browsing. Login returns to a sanitized route.                    |
| `W5-R05`     | Disabled accounts, switching accounts, and late responses             | Disabled accounts cannot restore a session. A late private response from account A cannot refill account B state. |
| W5-L sharing | Friend sharing, timeline sharing, and scene `1154`                    | Share output excludes private content and identifiers. Scene `1154` starts no private data requests.              |
| `W5-R03`     | Preference receipt consistency                                        | A contradictory or incomplete receipt keeps the save pending confirmation.                                        |

Avatar and nickname remain optional. This submission does not expand personal-data collection, storage, or sharing fields, and it contains no real account, private body text, environment configuration, secret, or cloud identity data.

## Added Focused Tests

File: `tests/week5-linghan-login-share.test.js`

1. Cancelling privacy authorization sends no login request and keeps guest browsing available.
2. Successful login returns only to a sanitized original page.
3. A disabled account cannot restore a session or report false login success.
4. Friend and timeline sharing are enabled without private fields.
5. Scene `1154` performs no cloud, runtime, network refresh, or missing-page recovery request.
6. A contradictory preference receipt cannot report success.
7. An incomplete preference receipt cannot report success.
8. A late account A response cannot refill private state after account B signs in.

## Verification Performed

- Week 5 focused tests: `8 passed, 0 failed`.
- Related login, profile, privacy, logout-race, production-account, and sharing regression tests: `95 passed, 0 failed`.
- `npm run cloud:prepare`, `npm run check`, and `git diff --check` are rerun before submission; their actual final results are recorded in the PR description.

The focused and related regression suites use synthetic account scopes and mocked platform interfaces. They prove source-level behavior only and do not replace real WeChat accounts, target-cloud verification, or device testing.

## Not Yet Verified

- Page-by-page manual verification in WeChat DevTools.
- iOS and Android device testing, including real friend and timeline sharing.
- Login, preference writes, disabled-account behavior, and private requests in the target cloud environment.
- A/B switching with two real WeChat accounts, a real disabled account, and late-response behavior.
- Independent account, privacy, and lifecycle review by Qizhen Cai.
- Independent Week 5 path and result review by Yuen.
- Effective WeChat platform privacy-guide and UGC configuration.

## Handoff

- Qizhen Cai should use two real WeChat identities to cover consent, rejection, cancellation, disabled-account, account-switch, and late-response paths. Synthetic local identities are not final acceptance evidence.
- Yuen should enter from a normal page, a share path, and scene `1154`, then confirm that share parameters and network requests contain no private fields.
- Cloud verification for account preferences must match the request, receipt, and current account before success is recorded. A client message alone is not server-side completion evidence.
