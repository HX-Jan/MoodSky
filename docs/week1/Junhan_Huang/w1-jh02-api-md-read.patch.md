# 补丁（拟）—— `docs/api.md` 增加后台读取入口

> **状态：待接口 PR 评审。** 与 `registry-admin-read.md` 必须**同一个 PR** 提交
> —— `docs/api.md` 要求「新增字段、action 或错误更新同一注册表和消费者」。

## 提案 diff

在「预留接口与访问范围」表格中，`admin` 那一行之后新增一行：

```diff
 | account | preferences、requestExport、exportStatus、downloadExport、close          | private                    |
 | account | cleanupStatus                                                            | receipt，只允许进度查询    |
 | admin   | updatePlace、reviewCorrection、updateTaskTemplate、updateSupportResource | operator                   |
+| admin   | listPlaces、listTaskTemplates、listSupportResources、listCorrections      | operator                   |
```

## 同时在「身份门禁与变更」小节确认一句

现有表述：

> - operator 除 active 账号外还需服务端 data_operator 角色，只可维护校园资料。

提案补充明确「读取也走同一门禁」：

```diff
- - operator 除 active 账号外还需服务端 data_operator 角色，只可维护校园资料。
+ - operator 除 active 账号外还需服务端 data_operator 角色，只可维护校园资料。
+   后台的列表与待审队列**读取同样属于 operator 级**，与写入共用同一门禁；
+   客户端对全部集合的直读已被拒绝（见 database/client-access-policy.json），
+   后台读取必须经由这些 action，不得以直接数据库访问绕过授权。
```

## 需要在 PR 里一并确认的字段约定

`docs/api.md` 说明：payload 与结果目前是「待确认约定」，须由双方在同一个接口 PR 中
明确**字段、空态、分页、版本、幂等与错误并补校验**。本次 4 个读取 action 需要定：

| 项             | 提案                                              | 待确认  |
| -------------- | ------------------------------------------------- | ------- |
| 分页参数       | `{ page, pageSize }`，与 `campus.listPlaces` 一致 | ❓ 上限 |
| 空结果         | `{ items: [], total: 0 }`，成功而非错误           | ❓      |
| 排序           | 稳定排序；待审队列按提交时间倒序                  | ❓      |
| 错误           | 沿用 `ERROR_CODES`；未实现返回 `NOT_IMPLEMENTED`  | ❓      |
| 操作员不得读取 | 私人天气、正文、微信身份映射、导出文件            | 已明确  |

## 引用依据（仓库原文）

| 来源                                      | 原文                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `admin/README.md`                         | 实现前补齐**读取**、编辑、审核、分页、错误与并发约定，不以直接数据库访问绕过授权    |
| `admin/README.md`                         | 运营员不得读取私人天气、正文、微信身份映射或导出文件                                |
| `database/client-access-policy.json`      | `defaultClientRule: { read: false, write: false }`，作用于每一个集合，包括 `places` |
| `database/client-access-policy.json`      | Public reads go through validated cloud actions                                     |
| `docs/api.md`                             | 访问策略只能在接口 PR 中评审变更，**不能为了演示临时跳过身份门禁**                  |
| `cloudfunctions/moodsky/domains/admin.js` | operator-only place/task/support maintenance. **No journal access.**                |
