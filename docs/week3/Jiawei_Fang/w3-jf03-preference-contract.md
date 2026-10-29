# W3 JF03 偏好持久化与服务侧联调

| 项目     | 内容                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| 任务编号 | W3 JF03                                                                                 |
| 承接     | W2 JF03（偏好 get/set、默认值与跨账号隔离）                                             |
| 关联需求 | UW3-F21（偏好）                                                                         |
| 协作人   | Linghan Chen（Me 页面偏好与生命周期）、Qizhen Chen（任务侧同账号口径）                  |
| 复核人   | Qizhen Cai（A/B 隔离）、Yuen Lin（客户端到服务端调用）、Xiang Hong（接口口径）          |
| 版本     | 0.2.3                                                                                   |
| 环境     | 本地 Node 24 + 内存 store + 真实客户端请求构造器；真实云、真机页面均**未执行**          |
| 成果路径 | `tests/week3-preference-contract.test.js`；服务实现沿用 `services/account-candidate.js` |
| 实际耗时 | 待本人确认                                                                              |
| 验收状态 | **待复核**；Linghan 页面联调与真实云保存 **阻塞**（见 §4）                              |

## 1. 本轮做了什么

W2 已实现 `account.preferences`（P1：`operation=get|set`、默认值来自 `DEFAULT_PREFERENCES`、字段白名单、按 `actor.accountId` 隔离）。本轮补的是**"客户端真实请求 → 服务端候选"的合同证据**，避免只有服务端单测、没有页面侧调用形状的证明：

- 用**仓库里真实发布的客户端构造函数** `miniprogram/modules/account/service.createPreferencesRequest` 生成请求（apiVersion、requestId、action、payload 全来自生产代码，不是手写仿造）；
- 把该请求直接交给 `createRouter(adapters)` + `services/account-candidate.js` 的 account 处理链；
- 断言响应与落库值一致，并覆盖默认值、部分写入、非法输入、停用、A/B 隔离、requestId 回显。

## 2. 测试结果（8/8，本地）

```
node --test tests/week3-preference-contract.test.js
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

| 用例 | 场景                                                                                                  | 结果 |
| ---- | ----------------------------------------------------------------------------------------------------- | ---- |
| P01  | 新账号 get 返回共享默认值（false / true / updatedAt null）                                            | 通过 |
| P02  | 部分 set 持久化，下一次 get 读回已存值                                                                | 通过 |
| P03  | 响应只反映实际落库字段（另一字段保持默认，不伪造）                                                    | 通过 |
| P04  | 空 payload、未知 operation、空 set、错类型、未知字段 → INVALID_INPUT，且不落库                        | 通过 |
| P05  | disabled 账号读写均被 router 先拒（ACCOUNT_DISABLED）                                                 | 通过 |
| P06  | 两个可信账号互不可见（A/B 隔离）                                                                      | 通过 |
| P07  | requestId 原样回显；客户端构造器拒绝携带 ownerId 等身份字段                                           | 通过 |
| P08  | 客户端 close 发送 `confirm:'CLOSE'` 并被接受；cleanupStatus 发送 `{jobId, receipt}`（复审 D3 修正后） | 通过 |

## 3. 结论

- 偏好读取/保存的**服务端链路与客户端请求形状已对齐**，默认值、白名单、停用门禁、A/B 隔离都有可执行证据。
- 本地"设置成功"只代表内存替身写入成功，**不代表云端保存成功**；两者在本文与 JF05 文档中分列。

## 4. 未执行与阻塞

| 项                       | 原因                                     | 归属           |
| ------------------------ | ---------------------------------------- | -------------- |
| Me 页面读取/保存联调     | 页面当前仍为本地演示状态，真实接线属 L04 | Linghan Chen   |
| 真实云保存与重新进入读取 | 无云环境授权/账号                        | Jiawei + Yuen  |
| 真机跨设备一致性         | 无真机包                                 | Yuen / Linghan |

**不得**用本地 `set` 成功推断云端已保存；页面未接线前，本任务只在服务合同层验收。
