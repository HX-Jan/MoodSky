# 待协作问题和 Issue 草稿

以下是本地复核发现的实现与环境缺口，未证明线上越权，不作为已确认安全漏洞。以下三项尚未单独创建缺陷Issue或正式分派；本次材料交付跟踪见[Issue #19](https://github.com/HX-Jan/MoodSky/issues/19)。基线 `1be13f8287e177ae3f057a9298164eb631181778`。

## QT-B01 正式入口尚未接入账号和角色适配器

- 类型：联调阻塞；关联AUTH-01—11、QT05。
- 复现：运行`node --test tests/account-identity.test.js tests/identity-adapters.test.js`；查看cloudfunctions/moodsky/index.js最后的createRouter()，没有传createAdapters。router默认resolveAccount会抛NOT_IMPLEMENTED。
- 预期：从可信平台上下文查到active内部账号，运营再查服务端角色，每次私人请求复核状态。
- 实际：候选createAdapters在替身DB下可验证查询及撤销；正式入口没有接线。Web目前也没有可信uid映射分支，真实OAuth未验证。
- 影响：没有真实成功对照，无法完成双账号归属和运营边界验收。不能将NOT_IMPLEMENTED视为业务权限通过。
- 建议协作：Jiawei、Junhan、Qizhen Chen、Xiang Hong。完成接口评审和接线后提供A/B/D/O/撤销O受信测试身份，再按AUTH-01—11补测。
- 证据：新增QT-M01/03、现有identity-adapters、account-identity及对应TAP。人工接收、处理版本、复测待填。

## QT-B02 导出清理和恢复尚无真实执行器

- 类型：功能阻塞；关联AUTH-12/13、LIFE-01—15。
- 复现：以本地active替身调用account.requestExport、exportStatus、downloadExport、close，全部到domains/account.js的notImplemented；回执适配默认也未实现。
- 预期：导出归属验证、≤5分钟凭证、≤24小时对象保留、删除立即失效、注销立即停用、幂等重试、分模块清理及恢复前重放删除标记。
- 实际：Me只有合成偏好和空records导出、模拟进度，本地24小时内容过期不等同云文件删除。无真实签名URL、调度、模块清理与恢复证据。
- 影响：无法给任何完整生命周期用例签通过，无法实测24小时/7天/30天保留承诺。
- 建议协作：Xiang Yu、Jiawei、Linghan、各模块后端。先确认字段白名单、回执绑定和requestId幂等，再提供隔离环境、时钟、失败注入和受控查询。
- 证据：QT-M04/06/08、[本轮矩阵](artifacts/baseline/permission-matrix.json)、account.js源码；细分缺口见MoodSky_权限与生命周期详细测试用例_精简修订版.md。人工接收与复测待填。

## QT-B03 缺少真机首屏和正式可用性条件

- 类型：测量阻塞；关联QT04、AUTH-14/15、LIFE-16。
- 复现：本轮无Android/iOS测试入口或真机，performance-20-runs.json全部not_run；操作型可用性尚未开展。用户已确认先交本地包。
- 预期：A-C/A-W/I-C/I-W各5次D30，统一T0/T1及操作响应证据；后续12人完成四任务。
- 实际：统计器与合成2300ms练习可运行；没有实际TTI、成功率或真人答案。真实缓存、设备Storage和全链路日志亦未覆盖。
- 建议协作：Yuen登记两类设备；Xiang Hong提供测试环境/版本；Linghan提供功能接入；Jiaqi协助可用性活动。
- 关闭条件：环境就绪后执行本包runbook，保留失败并按组汇总；12人测试另行开展。整体2.5秒验收口径和U04成功人数阈值须事前确认。

完整逐项状态见[权限与生命周期记录](MoodSky_权限与生命周期详细测试用例_精简修订版.md)，测量安排见[性能与可用性方案](MoodSky_性能与可用性测量方案_精简修订版.md)。
