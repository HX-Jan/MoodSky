# C4-QC｜候选核对、演示及总结交接

预定周期：**2026-11-27—28**；本次候选装配/技术预验实际日期：**2026-11-24**。完整源码 **7feca53ff0ed461cac270b7da7e7c36f36b7973b**，版本0.5.3。没有负责人将此SHA确认成最终冻结包的回执，因此本页为C4预验与可执行交接，不是最终发行通过记录。

## 已完成的当前候选静态核对

在改工具/资料之前，从干净主干分别装配closed、readOnly、enabled三个本地候选，sourceWorktreeDirty=false。每包183客户端文件、两云函数3+4文件、根项目配置1个，共191文件哈希验证；13页/4底栏。完整manifest及本轮核对：

| 模式     | 固定manifest                                | 实测哈希、版本与入口                                                     |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| closed   | [manifest](evidence/manifest-closed.json)   | [核对通过](evidence/candidate-closed.json)，任务入口关闭                 |
| readOnly | [manifest](evidence/manifest-readonly.json) | [核对通过](evidence/candidate-readonly.json)，仅建议                     |
| enabled  | [manifest](evidence/manifest-enabled.json)  | [核对通过](evidence/candidate-enabled.json)，实际Page动作/历史与服务相符 |

服务范围：moodsky-release、moodsky-release-maintenance；新增校园打卡默认暂停。manifest未含个人配置/密钥，uploaded/deployed/phoneVerified/submittedForReview/publicRelease均false。核对工具tools/alpha-qc/check-candidate.cjs会检查完整SHA、模式、每个文件哈希及与原源码的客户端字节一致性，**不导入候选的cloudEnabled:true配置执行网络调用**。

## 当前源码运行及原样包的边界

[final-task-page.csv](final-task-page.csv)将静态候选、独立禁云Page/原生预览分列。原生预览使用同一主干产品字节；临时内存配置改为离线SDK桥接、合成身份、按场景模式且不要求真实微信登录，磁盘始终禁云。正式候选配置的真实环境/函数/explicitWechatLogin:true与这套预览有明确差异；本轮没有运行原样包端云联调。工具/资料dirty=true及源文件哈希均保留。两条往返、完成/历史、右侧布局和异常已于11/24通过，不再以旧图改日期。

## 最终包到达后的执行步骤

1. 洪翔/Yuen给最终完整SHA、模式和服务清单；先比对本文manifest和受影响文件。相同源码/配置引用已有证据；有变化仅补受影响路径。
2. 从该干净SHA cloud:prepare后本地装配新的绝对目录；执行 node tools/alpha-qc/check-candidate.cjs /absolute/candidate FULL_SHA MODE，保存真实日期输出，不覆盖本次manifest。
3. 原样候选静态核对和独立禁云预览分开；若需新图，在最终源码的隔离预览复跑wechat.cjs及--record-reopen，finally恢复配置/会话。展示顺序、输入和重置见[演示步骤](../demo-tasks.md)。
4. Jiawei/Yuen各按QC01/02给实际结论；云、手机、平台和上传状态须来自各自回执。全部满足才登记最终通过，Refs #206保持，不能提前Closes。

## 可交给团队的材料

当前最终表预验版、3份manifest、哈希核对、19张新原生图、[测试文章](../c3-20261125/testing-essay.md)、[个人总结供稿](personal-summary.md)均已形成。团队图沿用[维护者11/24原图及CSV](../../../reviews/2026-11-24-c2-integration/README.md)，当前11/48；没有以预验另增完成点。CSDN、真机、云及平台未在本轮执行，实际工时/个人确认未提供。
