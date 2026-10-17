# Qinghan Zhang 第一周成果说明

任务：QZ01—QZ05 / UW3-F11—F16。负责人：张晴涵 Qinghan Zhang。整理于 2026-10-16，续作检查日期 2026-10-17（Asia/Shanghai）。状态：本地交付待复核；不是团队验收完成。

## 已交付

| 任务 | 本次成果 | 状态与边界 |
| --- | --- | --- |
| QZ01 | 11 条旗山校区真实候选；原始开放时间、标签、坐标及无障碍说明；逐条来源缺口与区域核验项 | 已整理，全部未独立核验；Junhan、Xiang Yu 待复核 |
| QZ02 | 主动开启的 6 条合成列表，校区/标签筛选、分页、无结果、过期、关闭状态 | 本地 Node 行为测试通过；微信渲染未验收 |
| QZ03 | 详情地址、开放信息、无障碍、核验日期；主动导航门禁及失败路径；地图字段需求 | mock 平台技术验证通过；真实地图未验证，候选导航禁用 |
| QZ04 | 首次无定位调用、主动请求、拒绝仍可浏览、地图失败返回列表的测试与复现步骤 | 本地 mock 证据已提供；要求的开发者工具/真机截图或录像仍阻塞 |
| QZ05 | 收藏读取、去重新增、取消；1—200 Unicode 码点纠错；模拟待审核/通过/驳回；资源未核验空态 | 本地内存演示及交互草图完成；接口待 Junhan 确认，正式写入第二周 |

## 阅读入口

- [真实候选表](real-candidates.md) / [结构化候选](real-candidates.json)
- [交互草图与用例](interaction-and-cases.md)
- [接口及地图字段问题](interface-questions.md)
- [实际检查记录](checks.md) / [原始日志](evidence/check-results.json)
- [成员交接与隐私清单](handoffs.md)
- [周报草稿](weekly-report.md) / [PR 描述](pr-description.md)
- [初始 ZIP 对照](evidence/initial-zip-comparison.json) / 最终变动清单见 evidence/final-change-manifest.json

## 使用方式

使用现有独立副本 MoodSky-main，未重新解压。微信开发者工具导入该副本的 project.config.json；成员权限需已开通。Campus 首次进入展示待核验空态；点击“开始合成演示”，查看列表及详情。点击“退出并清除演示”释放本页演示数据。无需开启云服务或填写真实地点坐标。

保留原生微信小程序、Node.js 云函数/CloudBase 架构、四个主标签页、模块 service、api 请求信封和共享 LIMITS。未新增公共投稿或评论入口。列表和详情通过 campus service 创建的显式本地适配器读取；线上 API 包装保留，真实后端失败不会自动切为演示。收藏只在适配器 Set 中；纠错审核是页面状态示意，均未发送。

## 审查修复

原草稿缺少开始/退出按钮与首次空态绑定，测试错误期待首次自动加载；测试平台 wx 提前恢复导致事件处理器无法使用 mock；导航夹具缺少核验日期和坐标系；textarea 的原生 200 长度限制与码点规则不一致；重复收藏仅有 toggle，缺少独立 add/remove 去重验证。现已修复并覆盖边界；补充合成审核反馈入口、日期门禁和太阳图标 CSS 作用域，减少样式冲突。

## 基线与提交范围

基线仅为本地 MoodSky-main.zip，SHA-256 见对照记录；下载时间与对应 Git 提交未核实，不称为远端最新版。仓库历史文档中的 commit 和通过记录不能作为本次代码证据。外层 Git 根为工作区且 HEAD 不存在，本次未创建提交、分支或 PR，也未操作远端。

代码范围：miniprogram/modules/campus/、miniprogram/pages/campus/、miniprogram/app.json、tests/campus-week-one.test.js；个人材料在本目录。app.json 的定位声明属于共享集成候选，需 Linghan/Xiang Hong/Qizhen Cai 复核。共享常量、正式 API 合同、云业务和数据库未扩展；cloud:prepare 只生成被忽略的副本。

## 学习重点

区分“资料核验状态”“界面演示状态”“实际权限结果”；页面负责交互，service 负责数据边界；导航前再次检查真实、有效、已核验且坐标系明确的数据；Array.from(text).length 计算 Unicode 码点，不等于字符串 length 或用户看到的字符数。
