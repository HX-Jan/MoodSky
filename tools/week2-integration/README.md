# W2记录与回顾接入候选

`backend.js` 组装账号、记录与最小回顾候选；调用方显式注入服务器数据库和回执策略。默认入口不引用此目录。新账号初始化选项不替代唯一索引确认，也不迁移既有账号。

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

程序退出0表示仅可供复核；退出2表示输入、文件或材料被阻断；退出1表示未预期的工具失败。错误报告只给固定代码及从0开始的行号，不回显原输入、文件路径或底层异常。默认最多1000行，可显式配置1—10000行；CLI仅接受不超过8MiB的文件。

额外成本是内存复制及逐行本地校验，不在产品请求路径执行，也不是SDK网络/性能测量。它不检查openid唯一索引、请求回执、删除账本、独立备份、跨域围栏或真实云隔离；这些条件仍由相应负责人验证。
