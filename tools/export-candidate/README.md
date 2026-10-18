# 导出格式化器候选：JSON / Markdown

2026-10-18。实现依据 [Xiang Yu 的导出流程设计](../../docs/week1/XiangYu/export-flow-design.md)，仅完成不需要云权限的格式化部分。此工具不接入 account 路由，不查数据库、不写文件、不上传云存储、不签发链接，也不提供领取鉴权、即时撤销或定时清理。

## 使用及边界

`formatExport(snapshot, options)` 接收服务器在可信鉴权后取得的完整一致快照。`options.accountId` 必须来自可信账号解析；snapshot 中同名归属/active 字段只是交叉核对，不能代替登录。每个来源行都必须属于该账号，错配直接失败。完整分页、账号状态和来源版本必须由上游适配器保证，不能将前端提交的快照传给该函数。

options 明确传入 format（json/markdown）、accountId、exportedAt、maxRecords、maxBytes。maxRecords 是每个集合的候选输入上限，maxBytes 按最终文件 UTF-8 字节数检查。上限由调用方选择；演示中的 100 条/1 MiB 仅为合成夹具参数，正式频率、大小和任务并发策略仍待团队确认。

快照包括 ownerId、accountStatus、sourceRevision、可选 campusId，以及 journals、favorites、taskHistory、preferences、monthDecorations。没有保存偏好时明确传 null，不伪造持久化设置。回顾只读接口的 ID/天气标记不含正文，不能代替完整导出快照。

输出逐项投影，去掉内部账号、OPENID、凭证、回执、源版本和未约定字段。天气记录按日期升序，排除删除标记；有效行与删除行共同检查重复日期或 ID，矛盾快照直接拒绝。删除行可以没有业务 ID，但必须有有效日期和版本。时间戳支持真实 Date 或有效 UTC ISO 字符串，并统一输出毫秒精度，拒绝修改时间早于创建时间。正文保留 Unicode 和原始换行；Markdown 用长于正文所有反引号序列的文本围栏包裹，标题/地点/任务元数据转义，避免把正文当作页面脚本或链接语法。

本地多贴纸方案与原设计的单 stickerId 样例有差异，因此输出明确为 **`exportVersion:1.0-candidate`**，不是正式 1.0 协议。装饰只导出有效来源记录的关联，并将内部 targetEntryId 转为 targetDate；丢失、删除或跨月目标被过滤。采用此变化前须与 Xiang Yu、Linghan 等消费者评审，现有共享接口和数据字典未改动。

## 领取策略的纯函数候选

`access-policy.js` 只计算状态和拒绝条件。`exportStatus` 只返回 jobId/state/format；`planClaim` 计算不超过 300 秒且不超过文件到期的领取计划；`authorizeRead` 在未来受控读取前再核对当前账号、归属、状态、撤回标记、来源和到期时间。到期时间点本身即拒绝，不额外宽限。

这是待评审方案：来源版本向量明确覆盖 journals、favorites、tasks、preferences、decorations，任何源变化都保守失效；账号另需 exportEpoch，防止停用后重新启用时旧领取能力恢复。当前各模块尚无完整版本向量或 exportEpoch 适配，本次没有向账号集合写这些字段。

`planClaim` 返回的普通对象**不是凭证**。`authorizeRead` 的 credential 参数必须是服务器用不可猜测凭证解析/查得的可信记录，不能接收客户端自报的对象。模块不生成秘密、不签名、不持久化回执、不处理实际文件字节；fileId 只作为内部不透明引用，不能把该函数结果直接返回给前端。7 项纯策略检查不证明实际下载权限或即时撤销已经实现。

## 合成示例与复现

```sh
node tools/export-candidate/demo.js json
node tools/export-candidate/demo.js markdown
node --test tests/export-formatter-candidate.test.js
```

`fixture.js` 中所有文字、账号、地点、任务和素材均为 SIMULATED。示例程序只向标准输出写结果，生产入口不引用这些文件。9 项离线检查覆盖字段投影、归属/停用拒绝、删除代际矛盾、装饰关联、坏数据、Markdown 注入边界、UTF-8 大小、空态、Date 转换和输入不变性。

生成文件仍含本人私人正文。格式化成功不能证明有权领取，更不能使已发链接撤销、使云文件到期或收回用户已下载文件。完整 F22 仍需任务状态机、来源一致性、受控文件读取与领取失效的独立实现及云端验收。
