# C2-XY 导出访问回执摘录

基线：`78812fe`；内存库 + 生产入口 + 注入时钟；正文与注销回执在落盘前替换为占位符。

| 编号 | 场景 | 动作 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- | --- | --- |
| C01 | A 通过真实写入接口新增一条当日记录与偏好 | journal.upsert / account.preferences | 两次写入成功 | ok entry={"id":"<generated-entry-id>","date":"2026-11-23","weather":"PARTLY_CLOUDY","tags":["REST","CALM"],"text":"SIMULATED-C2XY A 记录（version=2）：内容已修改，旧导出必须失效。","version":1,"createdAt":"2026-11-23T02:00:00.000Z","updatedAt":"2026-11-23T02:00:00.000Z"} | ok cardTextPreview=true decorationsEnabled=true updatedAt="2026-11-23T02:00:00.000Z" | 通过 |
| C02 | A 申请 JSON 导出 | account.requestExport {format:"json"} | ok，state=ready，format=json | ok jobId="0e5343608a2ee739f438275a19010336" state="ready" format="json" | 通过 |
| C03 | A 领取 JSON 正文 | account.downloadExport {jobId} | ok，extension=json，byteLength 与正文一致 | ok jobId="0e5343608a2ee739f438275a19010336" format="json" extension="json" byteLength=2875 bytes=2875 | 通过 |
| C04 | 本人记录完整且只含 active 行 | 解析 JSON 正文 | 记录 2 条，日期 2026-11-19 与 2026-11-23 升序，删除行正文不出现 | journals=2026-11-19,2026-11-23 deletedText=false | 通过 |
| C05 | B 的内容不进入 A 的导出 | 检查正文 | 不含 B 记录正文、B 收藏地点、B 任务标题 | BText=false BPlace=false BTask=false | 通过 |
| C06 | 导出不携带归属与内部标识 | 检查正文 | 不含 ownerId 字段、accountId、openid、campus revision/requests | ownerId=false account=false openid=false revision=false | 通过 |
| C07 | 收藏去重并按 createdAt 排序 | 检查 data.favorites | 3 条，placeId 顺序为 library、lake、canteen | favorites=place_c2xy_library,place_c2xy_lake,place_c2xy_canteen | 通过 |
| C08 | 任务历史只导出契约允许的状态 | 检查 data.taskHistory | 2 条，状态属于 selected/completed/replaced/skipped | tasks=completed,skipped | 通过 |
| C09 | 月份装饰只丢弃悬空贴纸，无目标贴纸保留 | 检查 data.monthDecorations | 1 个装饰、2 个贴纸：MOON 带 targetDate=2026-11-19，CAT 无 targetDate，LEAF 被丢弃 | stickers=[{"stickerId":"STICKER_MOON","targetDate":"2026-11-19"},{"stickerId":"STICKER_CAT"}] | 通过 |
| C10 | 打卡导出区分手工打卡与校园自报 | 检查 data.checkins | 3 条：1 条手工（仅 placeId，无 placeName）、2 条校园自报（含 placeName） | total=3 manual=1 self=2 manualNames=0 | 通过 |
| C11 | 顶层结构与格式版本 | 检查 JSON 顶层键 | 键为 exportVersion/exportedAt/data，exportVersion='1.0-candidate' | exportVersion,exportedAt,data 1.0-candidate | 通过 |
| C12 | 导出时间取服务端时钟 | 检查 exportedAt | exportedAt=2026-11-23T02:00:00.000Z | 2026-11-23T02:00:00.000Z | 通过 |
| C13 | Markdown 格式领取 | account.requestExport {format:"markdown"} → downloadExport | ok，extension=md，含标题与私密提示，含 A 正文，不含 B 正文 | ok ext=md title=true notice=true | 通过 |
| C14 | 导出不改动 B 数据与公共地点 | 导出前后逐行比对 | B 记录/收藏/任务/打卡与 places 行逐字节不变 | bJournal=true bFav=true place=true | 通过 |
| C15 | B 用 A 的 jobId 查状态 | account.exportStatus | FORBIDDEN，且与失效文案相同（不泄露任务存在性） | FORBIDDEN 导出尚未完成或已失效，请重新读取。 | 通过 |
| C16 | B 用 A 的 jobId 领取正文 | account.downloadExport | FORBIDDEN，无正文 | FORBIDDEN content=false | 通过 |
| C17 | A 查询不存在的任务 | account.exportStatus | FORBIDDEN，与失效文案相同 | FORBIDDEN 导出尚未完成或已失效，请重新读取。 | 通过 |
| C18 | A 传入非法 jobId 形状 | account.exportStatus | INVALID_INPUT | INVALID_INPUT 导出尚未完成或已失效，请重新读取。 | 通过 |
| C19 | A 在查询里夹带 ownerId | account.exportStatus | INVALID_REQUEST「身份与权限由服务端确定。」（身份字段在路由前被拒） | INVALID_REQUEST 身份与权限由服务端确定。 | 通过 |
| C20 | A 申请不支持的格式 | account.requestExport {format:"pdf"} | INVALID_INPUT，不创建任务 | INVALID_INPUT 存储操作条件不满足。 | 通过 |
| C21 | A 不带登录范围调用 | account.exportStatus（无 sessionScope） | UNAUTHENTICATED「登录范围已变化，请重新登录。」 | UNAUTHENTICATED 登录范围已变化，请重新登录。 | 通过 |
| C22 | A 带畸形登录范围 | account.exportStatus（scope 形状不合法） | UNAUTHENTICATED「登录范围已变化，请重新登录。」 | UNAUTHENTICATED 登录范围已变化，请重新登录。 | 通过 |
| C23 | B 的身份携 A 的登录范围 | account.exportStatus（scope 与身份不匹配） | UNAUTHENTICATED「登录范围已变化，请重新登录。」 | UNAUTHENTICATED 登录范围已变化，请重新登录。 | 通过 |
| C24 | A 申请后状态为可领取 | account.exportStatus | ready | ok jobId="455182502ecf37f9ba3a757b19f07790" state="ready" format="json" | 通过 |
| C25 | A 在导出后修改记录 | journal.upsert（新日期） | 写入成功，来源版本前进 | ok entry={"id":"<generated-entry-id>","date":"2026-11-23","weather":"CLOUDY","tags":["REST"],"text":"SIMULATED-C2XY A 记录（version=2）：内容已修改，旧导出必须失效。","version":1,"createdAt":"2026-11-23T02:00:00.000Z","updatedAt":"2026-11-23T02:00:00.000Z"} | 通过 |
| C26 | 旧任务在来源变化后失效 | account.exportStatus | ok，state=expired | ok jobId="455182502ecf37f9ba3a757b19f07790" state="expired" format="json" | 通过 |
| C27 | 旧任务领取被拒绝 | account.downloadExport | CONFLICT「导出尚未完成或已失效，请重新读取。」，无正文 | CONFLICT 导出尚未完成或已失效，请重新读取。 | 通过 |
| C28 | 来源变化后重新申请可领取 | account.requestExport → downloadExport | ok，正文含新记录且不含旧导出的日期集合 | ok dates=2026-11-19,2026-11-23 | 通过 |
| C29 | 收藏写入入口在生产候选入口关闭（边界记录） | campus.favorites add → account.exportStatus | NOT_IMPLEMENTED「此功能正在开发，尚未保存或修改任何数据。」；收藏来源未前进，任务仍 ready | NOT_IMPLEMENTED 此功能正在开发，尚未保存或修改任何数据。 | ok jobId="a46ae661642f3e6ac158d1cc0d50afa8" state="ready" format="json" | 通过 |
| C30 | 偏好变更使上一份导出失效 | account.preferences set → account.exportStatus | 偏好写入成功，任务 state=expired | ok cardTextPreview=false decorationsEnabled=true updatedAt="2026-11-23T02:00:00.000Z" | ok jobId="1fc071b7751ef860631c60bce1ad7d3b" state="expired" format="json" | 通过 |
| C31 | 连续变化后仍可申请并领取 | account.requestExport → downloadExport | ok，正文含最新偏好与收藏 | ok bytes=1825 | 通过 |
| C32 | 刚生成的导出为可领取 | account.exportStatus | ready | ok jobId="e95baf788d619643c9c6447a5baf7e16" state="ready" format="json" | 通过 |
| C33 | 到期前可领取 | account.downloadExport | ok，正文非空 | ok bytes=2392 | 通过 |
| C34 | 到期前 1 毫秒仍为可领取 | account.exportStatus（now=readyAt+24h-1ms） | ready | ok jobId="e95baf788d619643c9c6447a5baf7e16" state="ready" format="json" | 通过 |
| C35 | 到期时刻转为已过期 | account.exportStatus（now=readyAt+24h） | ok，state=expired | ok jobId="e95baf788d619643c9c6447a5baf7e16" state="expired" format="json" | 通过 |
| C36 | 到期后领取被拒绝 | account.downloadExport（now=readyAt+24h） | CONFLICT「导出尚未完成或已失效，请重新读取。」 | CONFLICT 导出尚未完成或已失效，请重新读取。 | 通过 |
| C37 | 到期一小时后仍为已过期 | account.exportStatus（now=readyAt+25h） | expired | ok jobId="e95baf788d619643c9c6447a5baf7e16" state="expired" format="json" | 通过 |
| C38 | 过期后可重新申请 | account.requestExport | ok，新任务 ready | ok jobId="8b908aab0daf63019cd34464897c555a" state="ready" format="json" | 通过 |
| C39 | A 与 B 各自生成导出 | account.requestExport × 2 | 两个任务均 ready 且 jobId 不同 | ok jobId="3091afe0f87461c0672808b70a096802" state="ready" format="json" | ok jobId="5034ca66a456be49be816782623bb1d1" state="ready" format="json" | 通过 |
| C40 | A 注销账号 | account.close {confirm:"CLOSE"} | accountStatus=disabled、privateActionsDenied=true、sessionRevocation=not_implemented、cleanup 与 receipt 返回 | ok accountStatus="disabled" sessionRevoked=false sessionRevocation="not_implemented" privateActionsDenied=true cleanup={"jobId":"7a3c133692bee8151b3b922e8a011d83","state":"pending"} receipt="<redacted-receipt>" | 通过 |
| C41 | 停用后查询旧导出状态 | account.exportStatus | ACCOUNT_DISABLED「账号已停用。」 | ACCOUNT_DISABLED 账号已停用。 | 通过 |
| C42 | 停用后申请新导出 | account.requestExport | ACCOUNT_DISABLED「账号已停用。」 | ACCOUNT_DISABLED 账号已停用。 | 通过 |
| C43 | 停用后领取旧导出 | account.downloadExport | ACCOUNT_DISABLED，无正文 | ACCOUNT_DISABLED content=false | 通过 |
| C44 | A 停用不影响 B | account.exportStatus（B） | ok，state=ready | ok jobId="5034ca66a456be49be816782623bb1d1" state="ready" format="json" | 通过 |
| C45 | 凭注销回执读取清理进度 | account.cleanupStatus {jobId, receipt} | ok，state 属于 pending/processing/completed | ok jobId="7a3c133692bee8151b3b922e8a011d83" state="processing" progress={"journals":2} createdAt="2026-11-23T02:00:00.000Z" updatedAt="2026-11-23T02:00:00.000Z" | 通过 |
| C46 | 伪造清理回执被拒绝 | account.cleanupStatus（错误 receipt） | FORBIDDEN「清理进度回执无效。」 | FORBIDDEN 清理进度回执无效。 | 通过 |
| C47 | 停用后查询可重新注册 | account.registration | canRegister=true，previousScope 为旧账号 scope | ok canRegister=true previousScope="scope_a2c39001b6894cb8b7bc1a00ed9b48851988cd8f5e4546a3cdbe953d58c43397" | 通过 |
| C48 | A 重新注册为新代数 | account.register {confirm:"REGISTER", previousScope} | ok，authenticated=true，scope 与旧 scope 不同 | ok authenticated=true scope="scope_d55413faf36f63552b65e143b31b84b6fb9e4e402bf3c970214409ed6f79ac66" capabilities=["journal","review","tasks","preferences","export","close"] | 通过 |
| C49 | 重新注册后旧 scope 不能再用 | account.exportStatus（旧 scope） | UNAUTHENTICATED「登录范围已变化，请重新登录。」 | UNAUTHENTICATED 登录范围已变化，请重新登录。 | 通过 |
| C50 | 新代数不能读取旧代数任务 | account.exportStatus（旧 jobId） | FORBIDDEN，不泄露任务存在性 | FORBIDDEN 导出尚未完成或已失效，请重新读取。 | 通过 |
| C51 | 新代数导出不含旧代数内容 | account.requestExport → downloadExport | ok，正文 journals 为空，不含旧记录正文 | ok journals=0 oldText=false | 通过 |
| C52 | 待生成任务不能领取 | planClaim（job.state=pending） | CONFLICT「导出尚未就绪。」 | CONFLICT 导出尚未就绪。 | 通过 |
| C53 | 可领取任务生成领取计划 | planClaim | 对象键为 accountEpoch,expiresAt,issuedAt,jobId,ownerId,scope,sourceRevisions，无 token 字段 | accountEpoch,expiresAt,issuedAt,jobId,ownerId,scope,sourceRevisions | 通过 |
| C54 | 凭证与任务一致时可读 | authorizeRead | ok，返回 fileId（内部结果） | ok fileId=private-db-export:c2xy_policy_job_1 | 通过 |
| C55 | 他人凭证被拒绝 | authorizeRead | FORBIDDEN「当前无法领取此导出。」 | FORBIDDEN 当前无法领取此导出。 | 通过 |
| C56 | 凭证 scope 被篡改 | authorizeRead | FORBIDDEN「当前无法领取此导出。」 | FORBIDDEN 当前无法领取此导出。 | 通过 |
| C57 | 凭证被标记撤销 | authorizeRead | FORBIDDEN「当前无法领取此导出。」 | FORBIDDEN 当前无法领取此导出。 | 通过 |
| C58 | 凭证已过期 | authorizeRead | FORBIDDEN「当前无法领取此导出。」 | FORBIDDEN 当前无法领取此导出。 | 通过 |
| C59 | 凭证的源版本与当前不符 | authorizeRead | FORBIDDEN「当前无法领取此导出。」 | FORBIDDEN 当前无法领取此导出。 | 通过 |
| C60 | 来源变化后凭证不可读 | authorizeRead（源版本前进） | FORBIDDEN「当前无法领取此导出。」 | FORBIDDEN 当前无法领取此导出。 | 通过 |
| C61 | 任务到期后不能再生成领取计划 | planClaim（now=expiresAt） | FORBIDDEN「当前无法领取此导出。」 | FORBIDDEN 当前无法领取此导出。 | 通过 |
| C62 | 领取计划的时间窗不超过文件到期与凭证上限 | planClaim（now=expiresAt-1ms） | expiresAt ≤ fileExpiresAt 且 expiresAt-issuedAt ≤ 300 秒 | issued=2026-11-24T01:59:59.999Z expires=2026-11-24T02:00:00.000Z | 通过 |
| C63 | 收藏来源前进后任务转为已过期 | exportStatus（favorites 版本 +1） | ok，state=expired | state=expired | 通过 |
| C64 | 账号导出代数前进后旧任务过期 | exportStatus（account.exportEpoch=1） | ok，state=expired | state=expired | 通过 |
