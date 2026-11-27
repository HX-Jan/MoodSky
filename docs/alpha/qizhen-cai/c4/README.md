# C4｜A/B 隔离与分批清理测试记录

关联：Issue #209；执行人：蔡奇真（在助手指导下本人操作）；日期：2026-11-26。

## 本人操作的本地测试

- 分批清理：15:26 运行 `node tools/week6-xy/verify-export-cleanup.cjs --out <新目录>`，14/14 场景通过。清理进度共 11 批，最终 `completed`；A 待清理业务数据归零，B 的记录等保留，公共地点和任务模板未触碰。
- 合成 A/B：15:28 运行 `node tools/alpha-h/ab-workbench.cjs --out <新目录>`，16/16 通过。B 查询/领取 A 导出返回 `FORBIDDEN`；A 修改后旧导出返回 `CONFLICT`；A 停用后旧导出返回 `ACCOUNT_DISABLED`，B 记录仍可读；显式注册的新账号不继承旧数据。
- 分享链路：11 月 26 日在禁云测试构建中，A 的真机调试记录 `share_send`，页面为 `pages/today/index`，路径为 `/pages/today/index?fromShare=page&date=2026-11-26`，参数键为 `fromShare`、`date`；B 打开分享后记录 `share_receive`，同一页面的 `optionKeys` 为 `fromShare`、`date`，`fromShare: true`，`sessionResolution: guest_public`。两端日志显示的配置构建标识均为 `dc5e9b66fa0794f98fdc45a3d2f2fa8c9d11f94c`。发送时间 15:35:26、接收时间 15:50:29（北京时间；日志原始时间为 UTC），以用户提供的控制台截图为证。
- 环境：本地生产业务入口及一次性内存数据库，合成 A/B 身份，不连接真实云或真机账号。工具执行字段保留默认未代填，测试人由实际操作截图说明，不代表复核人签字。

## 证据与来源边界

- [分批清理进度](evidence/cleanup-progress.csv)、[清理前后对照](evidence/cleanup-before-after.csv)、[场景覆盖](evidence/cleanup-coverage.csv)。
- [本人运行的 A/B 结果](evidence/ab-results.csv)。
- 运行源码本地快照：`4ba9efd048eac6e12332adb3f1f94fefd37c3f73`，工作区干净；该本地快照与远端 commit 的映射未确认，不得当作手机构建或远端 SHA。
- 本地合成测试不证明真实云维护或微信文件实际送达。分享链路已有测试构建下的发送与接收日志，但 `guest_public` 仅证明游客公共页接收，不能证明真实账号会话或真实云数据隔离；日志中的 buildSha 是测试配置报告值，不等于独立核验的设备包指纹。
- 11 月 24 日 C3 的 16 项由 AI 助手代运行；此前文档写成本人独立执行不准确。11 月 26 日为测试人按助手指导亲自运行，保留原先结果与日期。

## 待完成

核对本地测试源码与远端映射；基于最终候选构建逐功能复核并核对洪翔本期范围；真实云清理回执、微信文件送达和服务端脱敏日志继续待验。B 已提供本次测试构建的分享接收日志。最终意见和签认由实际复核人作出。

## 候选草案复核意见（11 月 26 日）

蔡奇真确认已复核 [C3 候选范围草案](https://github.com/HX-Jan/MoodSky/blob/dde127cb78f7a4a078c3239ee06dba64a4430201/docs/alpha/xiang-hong/c3-20261126/candidate-scope-draft.md)，对当前草案表示可以。此意见不替代 C4 最终冻结包的逐功能复核或洪翔的最终放行决定。

## 截图说明

分享发送与接收日志按测试人提供的截图转录至本记录；原截图尚未纳入此 PR。`share_receive` 的 `fromShare: true` 为实际截图结果。前面普通启动出现的 `fromShare: false` 不作为分享接收成功证据。
