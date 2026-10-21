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

2026-10-21 上游候选补记：domains/export 的新任务现在需要账号已有 operationFence，并在同一事务更新围栏与任务；旧账号缺字段则拒绝新建、不自动迁移。五领域来源及账号停用须共同遵守该写入协议，仅有只读快照检查不足以证明提交时未变化。格式器和本纯领取策略未接入真实文件或公开路由，详见[围栏验证](../../docs/week2/xiang-hong/export-fence-20261021.md)。

## 已有任务的本地生成准备

2026-10-21新增 `createExportPreparation`（preparation.js）：显式注入数据库、来源读取器、maxRecords/maxBytes/pageSize/now，调用prepare(ownerId, jobId)。内部账号必须来自可信解析，不能由前端自报。复用已有pending任务、领取状态检查、五来源分页和格式器，生成前后核对任务与来源版本；返回包含私人正文的worker内存产物，不是API响应或凭证。调用不会写数据库、文件或云存储，不改变ready状态。返回后未来发布器仍须用共同围栏原子复核，完整任务执行/持久文件/领取与撤销待实现。6项新增合成/SDK离线检查及完整463项通过，具体见[日间续作](../../docs/week2/xiang-hong/continued-development-20261021.md)。

## 私有产物的就绪确认候选

`publication.js` 提供 `createExportPublication({db, readSourceState, inspectArtifact, maxBytes, now})`，可信worker调用 `publish(ownerId, jobId, prepared, fileId)`。它不创建、上传、读取正文或删除文件；prepared应直接来自本生成准备器，不能接收客户端提交的内容。fileId必须来自可信存储操作，不是前端任意网址。默认缺少适配器时返回NOT_IMPLEMENTED，不初始化SDK。

先核对已有任务/账号/来源，再通过inspectArtifact读取同一账号、任务、文件的可信元数据；要求与准备内容的SHA256、UTF-8字节数、MIME一致，并声明私有且不可变。这个回调必须实际连接受控的服务器存储并保证相应属性，不能用客户端对象、固定true或仅比较这些字段来冒充权限验证。本地检查只用合成元数据，真实存储适配器、ACL及不可变保证仍未实现。

最终事务重新核对任务、停用和来源，写已有账号operationFence并将pending改为ready，保存内部fileId/哈希/字节数/MIME/readyAt及最长24小时到期时间。缺旧账号围栏不初始化。正常同一产物重放不再次写入、推进围栏或续期；不同文件/内容、撤回/过期或来源改变均拒绝。只返回jobId/state/format，不返回正文、文件引用、URL或领取凭证。写入/提交未知错误保持原异常，调用方应保留原产物重试，不推定未提交。

同一任务的内容由发布器在异步元数据检查前捕获。9项本地检查包含完整准备联调、16路竞争、SDK回滚/竞争和提交响应丢失；不证明真实云锁行为。内部新增的contentSha256/byteLength/mimeType/readyAt仍需Xiang Yu/Jiawei/Yuen等复核，数据库配置及公开接口没有变化。失败后的候选产物回收、真实上传、领取凭证、受控读取、到期清理与完整F22验收尚未完成；尤其不能把ready的合成任务写成用户现已可下载。
