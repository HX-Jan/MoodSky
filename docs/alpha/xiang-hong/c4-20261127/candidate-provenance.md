# 候选来源核对及第三期指纹复现

当前冻结源码为 `00c59a1af7ccd27e9c2ae4bc77f6b65fc66b117c`，版本0.5.3，任务`closed`，新增打卡暂停，手机号入口关闭。产品树为`22be47ad17520215fc3d81d23536deaa3d98a8af`。本轮新增的文档与验证工具不进入客户端和两支云函数；资料整合提交与冻结产品提交分开登记。

## 第三期差异的原因

Yuen在PR264报告无法复现清单`29b31dd…`，本次实际找到原包：`C:/Users/LENOVO/Desktop/MoodSky_C3_0.5.3_20261126_dde127c`。其manifest完整指纹为`29b31ddae1e29b9148c8aa1ae516cfaad70e66082cdc79d4439b5280c5de73fa`，来源`dde127cb78f7a4a078c3239ee06dba64a4430201`。

维护者在该提交的独立干净工作树执行当时的`cloud:prepare`与`release:package closed`，重新装配到工作区外全新目录，得到相同完整指纹。原审计的183客户端、两云7文件加根配置共191项不变。

新版打包器在#261/#262之后增加`phoneLoginEnabled`清单字段、生成配置和环境模板。用新版打包脚本指向旧源码不是复现旧工具链，清单不同不等于旧包被篡改。本轮保留Yuen的原观察，补上实际路径、脚本版本和重装结果；不改写其原报告。本期使用新包，不将旧包作为当前冻结依据。

## 当前同包比对

负责人包：`test-results/2026-11-27-wechat-login-candidate`；Yuen独立包：`E:/MoodSky/c4-candidate-00c59a1`，后者未由维护者读取磁盘，依据PR264提交的manifest与原始报告。

两份manifest逐字节一致：`711deb7e5f20c1c0c7473b3b9de4e0a52fafc8aea5e9c67524a2746abcd1edb0`。负责人包193项文件指纹复核通过：客户端185、业务云3、维护云4、根配置1。195总文件另含manifest及空密钥环境模板，不能与193项指纹数混用。

当前包已在27日通过官方开发者工具上传客户端开发版本，回执见[evidence/client-upload.json](evidence/client-upload.json)。包内manifest保留创建时`uploaded:false`，不改写已冻结文件；上传属于后续外部回执。两云未在本轮部署，体验版选择、审核和公开状态未核实。

复现命令应在对应干净提交的源码目录执行，不把当前工具复制到旧目录：

```powershell
npm.cmd run cloud:prepare
npm.cmd run release:package -- <工作区外全新绝对目录> closed
```

## Qinghan新增候选的范围

PR265使用同一00c59a1源码的enabled测试包。维护者独立重装enabled包，精确复现其清单1b9cba6495bf43a5f44bdaa7fc6739483eb6004c8b4f24222a80cdbfc40e9ce0；报告涉及的源码指纹和10张原图指纹均一致。这个包与本期closed冻结包模式不同，C4-QH保持部分交付，不能因源码相同便当作最终同包通过。
