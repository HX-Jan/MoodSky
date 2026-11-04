# 地点手动打卡契约候选

本目录是隔离本地候选，不属于正式 action 注册表，未接入小程序生产页面或云数据库。代码审查前不得把这里的合成身份用作真实授权。依据 docs/week4/campus-recommendation-checkin.md，供后续团队契约 PR 评审。

## 规则及接口

同可信账号、同地点、北京时间同日一次；时间由服务器确定。新日期使用新请求，原请求跨日重试仍返回最初回执。complete 输入仅 requestId 和 payload.placeId，不接受账号、坐标、客户端完成时间或照片。身份由 resolveIdentity 的可信凭据适配器解析。

complete 返回 visit（placeId/date/completedAt/placeName/selfReported）及 duplicated。history 只读取本人，page从1起、pageSize最大50。失效或关闭地点不可新增；已有历史不删。普通任务接口不加字段。

请求ID相同但地点不同返回CONFLICT。同日换ID仍不新增到访。先验证账号active，再处理重放；停用后原请求亦不得读取。只允许已核验、有效且OPEN/LIMITED地点。LIMITED需将进入限制明确展示，若正式契约要求仅OPEN，可在评审时收紧。

## 当前可运行范围

在仓库根目录运行 `node --test tests/campus-checkin-candidate.test.js`。不需要云环境，使用明确隔离的合成账号与合成地点。createLocalStore只在内存中持有数据，退出进程会清空，不能证明重启后云端持久化。controller重新创建后从同服务读取只证明页面重入读取。

backend提供事务式complete/history/exportMine/cleanupDisabled；controller提供登录提示、提交确认、失败未知状态、同请求重试、重复点击防护、隐藏与切号迟到响应隔离。尚未制作实际小程序按钮，未宣称手机可操作。

## 导出清理接缝

exportMine只投影本人的完成记录，返回revision。新到访改变revision，同日重复和重放不改变；必须在正式账号导出时把此修订纳入现有来源修订围栏，否则旧导出不会因打卡自动失效。

cleanupDisabled仅供服务端生命周期执行器调用，账号必须disabled；事务内只删该账号到访与请求回执，重复清理返回0，公共地点与其他账号保留。该函数尚未接现有注销执行器，不能称完整注销已覆盖打卡。

## 接入正式环境前的必要实现

生产适配器必须在同一数据库事务验证账号active、地点有效性、请求唯一约束和账号/地点/北京时间日期唯一约束，再写到访、回执与来源revision。不得将本地内存串行队列视为云端多实例事务保证。账号停用、地点更新和清理也必须与此事务边界一致。需要实际集合、索引、权限和持久化适配器评审，当前没有数据库变更。

正式API action命名/字段及导出注销接入待契约确认；本候选未修改共享注册表和生产开关。下一阶段实现正式服务适配、实际页面按钮和本人历史、完整导出清理后再手机验证。当前可先将本候选作为契约评审材料，不标为完整打卡交付。

## 用户确认的实现规则

本次用户明确确认：同一账号、同一地点、北京时间同日只记录一次；次日可再次打卡。组长通过用户转述明确：直接点击打卡即可，无需验证实际到达，不采集位置、照片或到场证明。前者来源是用户确认，不记作组长已审批。

按钮文案使用“打卡”，服务器确认后显示“已打卡”；不使用“定位验证成功”或要求先证明到达。重复点击、不同请求ID同日提交返回已有完成记录；超时重试保留原requestId及payload，跨日原请求重放返回原日期结果。实际记录归属取服务端身份。

上述产品规则已获本会话用户确认；正式共享action、生产数据库适配、索引和部署仍按团队PR审查执行，不能据此声称已上线。

## 页面和存储候选续作

页面现已在显式checkinAdapter注入后挂载候选控制器；此前“尚未制作按钮”的说明为历史阶段，以docs/week4/qinghan-zhang/checkin-implementation.md为准。persistent.js为事务持久化适配候选，数据库替身已测，真实SDK与完整生命周期接入仍未完成，生产入口不开放。

## 正式接入续作

本目录persistent.js现转引cloudfunctions/moodsky/services/checkins.js，正式后端action已在本PR实现；旧“尚未注册”的说明保留阶段历史，以docs/week4/qinghan-zhang/merge-review-handoff.md为当前入口。源码与部署仍分开，flag默认关闭，没有真实部署。
