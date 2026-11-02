# Qinghan Zhang 第四周交付

本目录对应 W4 QH01—QH05。输入为用户提供的 ZIP 和第四周计划；ZIP 内 package 为 0.4.0，README 已含第四周成果，因此不能将它称为纯 Week 3 基线。ZIP 无独立 Git 元数据，无法证明其 HEAD 或远端一致性。未执行部署、生产导入、发布或真实写库。

| 任务                       | 本次交付                                                                          | 状态与剩余条件                                                                   |
| -------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| QH01（承接 W3 QH01）       | catalogue.json：五条历史现场资料、来源入口及启用缺口                              | 阻塞：Junhan 核定有效期和来源；Xiang Yu 确认导入格式；暂无可正式启用资料         |
| QH02（承接 W3 QH02/QH05）  | 复用筛选、分页去重、独立详情重读及服务端过期投影；见验证日志                      | 待复核：真实后台修改后重读、Yuen 复测                                            |
| QH03（承接 W3 QH04）       | 复用候选收藏读取、添加、取消、重复点击保护、失败保持原状态及原请求重试            | 阻塞：privateActionsReady=false；生产入口关闭；需后端契约共同确认及 A/B 独立验证 |
| QH04（承接 W3 QH04）       | 修正页面 content/text 契约不一致；新增实际页面到后端校验的 emoji 与同请求重试测试 | 待复核：Junhan/Yuen 审核；真实审核后重读待执行                                   |
| QH05（承接 W3 QH03 / #23） | device-checklist.md：主动授权、拒绝、撤回、地图失败步骤                           | 阻塞：指定设备、候选构建和可靠 GCJ-02 坐标未提供                                 |

## 改动与验证入口

源码：miniprogram/pages/campus/index.js。后端 validateCorrectPlace 只接收 placeId/text，原页面发送 content 会被拒绝；同时修正输入比较，避免相同输入丢弃原请求。测试：tests/campus-week-four.test.js。未开启全局功能开关，待联调不等于已上线。

定位不保存或上传精确位置；坐标系未知不启用导航。固定天气继续为虚构示意。纠错提交响应不等于审核通过，私人内容不写入公共地点。

原 W2/W3 报告保持原样。新资料表以 W3 补正为历史来源，不追认本周现场到访，不自行设置有效期。支持资源尚无可核实条目，保持空清单。

实际验证以 evidence 原日志为准。真实云端、设备、独立账号、后台审核和人员签认未执行。个人耗时、难度点及复核意见由本人和实际复核人填写，本目录不代签已验收。

## 学习验证

请本人说明：为何 Unicode 码点计数用 Array.from；为什么重试必须保留 requestId 和 payload；为什么成员到访日期不能自动作为正式资料有效期。可独立练习增加“201 个 emoji 不产生提交请求”的测试。

## 本次验证结论

Node v24.22.1。cloud:prepare 等价脚本执行成功。npm 命令未在 PATH，使用 Node 直接运行各检查工具。

- 校园定向测试：47/47 通过（targeted-final.txt）。
- 全量测试：1123 项，1116 通过、7 失败（full-tests-unsandboxed.txt）；不能声称完整 check 通过。失败涉及 experience/h03/performance/prelaunch/private-pilot/production 包检查，含解压包不具备独立受 Git 跟踪文件等环境条件，未修改这些断言。
- 九组合成联调通过（team-check.txt），不代表真实云与手机通过。
- ESLint、结构、文档链接、TypeScript 检查通过。格式检查结果见 format-final.txt；安装生成的 pnpm 锁文件只属本地环境，不纳入增量交付。
- 原始失败日志保留。早期缺 SDK、pnpm 依赖路径与 esbuild 沙箱错误，与最终完整测试日志分列。SDK 离线测试使用 NODE_PATH 指向 cloudfunctions/moodsky/node_modules/.pnpm/node_modules，未改业务依赖声明。

输入 ZIP SHA256：D66E0C5BF214AEF39996E47B06B57B10B3A6E9145747AD7D024AA60AFB5561B3。
用户确认无新增现场资料或设备信息。下一步由 Junhan 提供接口启用/审核候选、Xiang Yu 确认导入字段、Yuen 提供设备构建，Qizhen Cai 独立验证账号边界。本次无 Git 提交、远端推送或 PR。
