# W2记录与回顾接入候选

`backend.js` 组装账号、记录与最小回顾候选；调用方显式注入服务器数据库和回执策略。默认入口不引用此目录。新账号初始化选项不替代唯一索引确认，也不迁移既有账号。

## 公开任务建议读取候选

2026-10-22 新增 `task-catalogue.js` 与 `services/task-suggestions.js`。完整组装只有在**服务器构造参数** `taskSuggestionsEnabled === true` 时接入；默认关闭，客户端 payload 不能打开。也可单独将 `createTaskCatalogueRepository(db)` 注入 `createCandidateRouter({ taskCatalogueRepository })`，无需组装私人记录服务。所有示例均为显式候选接线，不是部署步骤。

- `tasks.suggestions`：仅接受 `{}`，无需账号或日记；服务器查询 `task_templates.enabled === true`，按 `_id` 升序，数据库端限3条、只取6个字段。响应仅含 `taskId/title/description/durationMin/tags/state`，其中 description 来自 steps，state 固定 null，不读私人状态或记录展示行为。
- 2026-10-23兼容修正：建议响应另带 `readOnly:true`，页面在有有效会话时也保持操作关闭；该字段仅控制界面能力，不能作为服务端授权。旧候选响应缺少该字段仍沿用既有会话门禁，不能据此声称支持真实写入。详见[PR #44兼容审查](../../docs/reviews/2026-10-23-pr44-compatibility.md)。
- `tasks.quickChoice`：仅接受 `{}`，不查询数据库，提供“浏览小任务”入口；空目录同样可进入空态。未声称任务写入可用，也不代为启用地点服务。
- 数据来自字典的 `_id/title/steps/durationMin/tags/enabled`。候选要求非空标题≤120码点、1—10个非空步骤且每步≤500码点、整数时长1—1440分钟；tags可缺省或为最多8个不同非空标签、每个≤32码点。ID为1—128位字母/数字/下划线/连字符。这些是本地适配约束，**尚非共同批准的模板规范**。字典中可选但页面必需的时长缺失时明确失败，不编造默认时长。
- 不兼容、重复、超量或停用的仓储结果整次失败，不截断成部分成功；存储异常只给通用错误。成员模板草稿不会自动导入或发布；enabled字段的内容审核流程仍待主责确认。

实际服务、现有客户端与控制器及锁定SDK序列化均有离线合成测试；SDK传输被替换且真实网络被阻断。没有验证真实查询索引、云端内容、平台权限或性能。正式 `domains/tasks.js`、默认入口和数据库清单保持原状；transition/history、持久幂等、会话、JF02状态机/分页及独立验收仍待完成。详见[本轮记录](../../docs/reviews/2026-10-22-task-public-candidate.md)。

## 日记快照只读预检

在项目根目录运行已提交的合成样例：

```sh
npm run cloud:prepare
node tools/week2-integration/journal-preflight.js --input tools/week2-integration/fixtures/journal-preflight.synthetic.json
```

首次检出需先生成共享模块（也可通过npm run setup完成）；生成过程不连接云端。

结果应为`eligible_for_review`、2行已检查、1条有效日记和1条墓碑；`mayOpenPrivateServices`始终为false。它表示样例与候选读取规则兼容，不能据此启用业务或证明迁移成功。

检查调用方明确提供的本地JSON：

```sh
node tools/week2-integration/journal-preflight.js --input /path/to/local-snapshot.json --max-rows 1000
```

输入结构参见合成样例：内部`accountId`、对应`account`、`journals`数组和`complete:true`。`complete`只是来源声明，本工具不能核实实际数据库是否还存在未导出的记录；不完整输入拒绝，不猜测为空。实际快照不提交仓库，报告不含正文、标签、天气、日期、账号编号或原始文档编号。

它复用实际候选仓储的账号与行读取校验，另检查确定文档键、归属、重复日期/entryId和耗尽版本，避免只设置布局标记却遗留旧键时将旧记录误读为空。只向内存适配器提供get，没有SDK、连接、写入、迁移或部署能力。调用期间先复制输入，之后的调用方修改不影响本次结果。

| 结果/问题                                         | 含义                                                  |
| ------------------------------------------------- | ----------------------------------------------------- |
| eligible_for_review                               | 所提供材料未发现兼容性问题，仍待人工及真实环境复核    |
| LAYOUT_NOT_ENABLED                                | 既有账号未采用候选布局，不当空账号处理                |
| ROW_KEY_MISMATCH / ROW_SCOPE_INVALID              | 确定键、归属或日期不匹配；不得直接接入                |
| STORED_ROW_INVALID                                | 实际读取器拒绝该行，包括坏时间、坏正文/标签或墓碑残留 |
| DUPLICATE_DAY / DUPLICATE_ENTRY_ID                | 快照存在重复日期或跨日期复用业务ID                    |
| COMPLETE_SNAPSHOT_REQUIRED / ROW_LIMIT_EXCEEDED   | 材料不完整或超过限制，不给出部分通过                  |
| ACCOUNT_COUNTER_EXHAUSTED / DAY_VERSION_EXHAUSTED | 当前读取可兼容，但既有写入版本不能继续推进            |
| INPUT_ENCODING_INVALID / INPUT_JSON_INVALID       | 文件编码损坏或JSON无效；不自动替换内容后继续检查      |

程序退出0表示仅可供复核；退出2表示输入、文件或材料被阻断；退出1表示未预期的工具失败。错误报告只给固定代码及从0开始的行号，不回显原输入、文件路径或底层异常。默认最多1000行，可显式配置1—10000行；CLI仅接受不超过8MiB的文件。

文件必须为有效UTF-8，允许文件开头的单个UTF-8 BOM。遇到非法字节会以INPUT_ENCODING_INVALID阻断，不将其替换成“�”后再给出兼容结论。原本合法编码的“�”、中文和emoji仍作为正常正文处理。工具不修改文件；编码损坏需由材料提供方核对原始来源后重新提供。

额外成本是内存复制及逐行本地校验，不在产品请求路径执行，也不是SDK网络/性能测量。它不检查openid唯一索引、请求回执、删除账本、独立备份、跨域围栏或真实云隔离；这些条件仍由相应负责人验证。
