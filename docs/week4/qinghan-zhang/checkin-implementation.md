# 手动打卡页面与持久化适配候选

范围：用户确认直接点击打卡，不验证到场；同账号、同地点、北京时间每天一次。基线为用户提供的 main ZIP 加 PR104局部修复，本目录没有独立Git历史，未核实远端HEAD。

## 已实现

- miniprogram/modules/campus/checkin/controller.js：提交、原请求重试、回执基本校验、分页读取本人历史、隐藏及切号迟到响应隔离。
- page.js与校园页：候选适配器挂载时显示打卡、今日已打卡、失败重试及本人历史；登录提示后可回到原地点再操作。没有自动登录即完成。
- transport.js：提出 campus.checkin / campus.checkinHistory 传输候选，不加入正式action注册表，不冒充现有接口。
- persistent.js：CloudBase形态事务适配候选，按可信owner散列文档ID，事务内核对active与地点有效性，保存同日唯一记录和请求回执。重建service对象后仍从同一数据库读取。每账号候选上限500条到访/500个请求，超限明确拒绝，后续拆集合不能静默截断。
- exportMine返回本人记录和revision；cleanupDisabled要求可信停用状态，删除私人记录和回执、保留修订墓碑，重复清理为0。它们尚未接正式完整导出/注销执行器，不能声称完整生命周期已上线。

## 本地验证

node --test tests/campus-checkin-page.test.js tests/campus-checkin-candidate.test.js

合成身份与数据库替身验证，不调用真实云、不修改权限或索引。校园及后台相关共123/123通过，见evidence/checkin-implementation-tests.txt。改动JS ESLint、结构和文档检查通过。没有运行当前候选的完整check，不将之前CI结果算作本次验证。

页面测试以service.checkinAdapter注入适配器；默认为null且生产页面不挂载。未开启真实手机入口。候选适配器必须由可信云调用构造，不可把客户端binding当owner；binding只用于客户端会话取消。resolveIdentity、resolveActive、resolveDisabled、findPlace都需接实际服务，账号状态和地点读取必须使用同一tx。数据库需配置缺文档读取不抛错，例如与既有仓库一致的throwOnNotFound:false；实际SDK行为仍需隔离云验证。

## 尚需完成才能交付完整功能

1. 团队确认action、字段及集合布局后，将服务接到真实云路由；禁止把客户端scope当服务端身份。
2. 评审并配置持久化集合、权限、容量与多实例并发，实际CloudBase SDK验证事务冲突、删除/停用围栏。
3. 将revision接到现有导出失效机制，并将cleanupDisabled接到正式停用清理执行器，补SDK层联调。
4. 给确认范围的候选包启用适配器；手机验证按钮、登录返回、断网重试、重开读取、跨日与切号。未正式部署，不需要现在在手机盲测。

历史地点清单和有效期规则沿用此前本人核验资料，尚待正式启用审核。本候选不自动导入五个地点。请新建独立PR，不将本次打卡文件混入等待复审的PR104。

## 最终实现更新

本阶段已将services/checkins接入production/backend，正式注册campus.checkin/checkinHistory；打卡记录已接入完整导出、来源失效和生产停用清理。此前未接入的说明属于阶段性历史，以merge-review-handoff.md和当前README为准。

最终本地完整check为1275/1275通过，九组team:check通过。另对原请求重放同样写账号围栏的最终补正执行24项定向复测通过。所有结论仅针对本地与SDK离线替身，不代表真实云/手机/独立验收。未部署，客户端打卡flag默认关闭。
