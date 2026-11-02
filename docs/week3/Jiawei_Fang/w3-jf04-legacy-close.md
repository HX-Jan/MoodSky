# W3 JF04 旧账号注销路径提案

- 任务编号：W3 JF04（阻塞项 D4）
- 提交对象：Xiang Hong（账号围栏/事务）、Xiang Yu（数据库迁移）
- 版本：0.2.3；分支 `week3/jiawei-fang`
- 状态：**阻塞，待决策**；本文件不自动迁移、不改账号行

## 1. 现象

`stores/account-transaction.withOwner` 要求账号行同时具备：

- `journalLayout === 'deterministic-days-v1'`
- `operationFence` / `exportEpoch` 为非负安全整数

W1/W2 时期创建的账号可能没有这些字段。对这类账号调用 `account.close` 会得到 `NOT_IMPLEMENTED`（C13：账号仍 active、0 job、无写入），用户因此**无法自助注销**。

## 2. 三个方案

| 方案      | 做法                                                                                                          | 优点                                    | 风险                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A         | 给 `withOwner` 增加 `requireLayout: false` 选项，仅账号生命周期（close）使用；缺围栏按 0 处理并在同一事务写入 | 旧账号可立即注销                        | 修改共享事务助手（Xiang Yu/Xiang Hong 主责）；旧账号首写围栏属于**隐式迁移**，需先明确允许                    |
| B（推荐） | 先由 Xiang Yu 的迁移批次补齐 `journalLayout/sourceRevisions/围栏`，再允许注销；close 保持严格                 | 不产生"半迁移"账号；与导出/清理口径一致 | 旧账号在迁移前仍不可注销，需要界面给出明确提示                                                                |
| C         | 旧账号回退到 W2 store 路径注销                                                                                | 不改事务助手                            | 生成的 job 缺 `exportAccessRevoked/progress`，清理 guard 直接 `FORBIDDEN`；**会产生无法执行的 job，不可接受** |

## 3. 推荐与配套

推荐 **B**，并在迁移批次完成前：

1. `account.close` 继续返回 `NOT_IMPLEMENTED`，但错误文案改为可操作的提示（例如"账号存储升级后才能注销"）；
2. Me 页（L04）在收到该码时显示"需先升级账号（联系运营）"，不得显示"注销成功"或无限 loading；
3. 迁移批次由 Xiang Yu 定义检查点与回滚，Jiawei 提供注销侧的验收用例（迁移前拒绝 / 迁移后可注销 / 迁移后导出可读）。

若团队选择 A，需要同时确认：

- 缺围栏旧账号在 close 事务里初始化为 0 是否算"自动迁移"（当前 W3 计划要求"不自动迁移旧账号或恢复停用账号"）；
- 该路径是否只允许 close、不允许 journal/export 复用，避免绕过布局要求。

## 4. 决策后要补的验收

| 场景       | 期望                                                              |
| ---------- | ----------------------------------------------------------------- |
| 迁移前     | close → `NOT_IMPLEMENTED`，账号 active、0 job                     |
| 迁移后     | close → disabled + pending job（guard 字段齐全）                  |
| 迁移后重复 | 第二次 close 被 router 以 `ACCOUNT_DISABLED` 拒，不产生第二个 job |
| 迁移后导出 | `readSourceState` 返回五域 revisions，不再 `NOT_IMPLEMENTED`      |

在决策前，JF04 的验收状态保持"待复核/阻塞"，不得按"可执行 close 链路"整体验收。
