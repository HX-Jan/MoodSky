# 最终需求基线

功能范围来源于2026-10-11开题方案；执行职责依据2026-10-12更新的中英文需求规格和项目计划。本仓库提供开始开发所需的精简基线；功能编号沿用 UW3-F01—UW3-F24。此表描述计划，除固定模拟说明外，业务功能尚未实现或验收。

| 编号    | 内容                                       | 前端 / 后端                                                |
| ------- | ------------------------------------------ | ---------------------------------------------------------- |
| UW3-F01 | 本人选择五种天气之一，每日一条，正文可空   | Yifan Ji / Xiang Hong                                      |
| UW3-F02 | 最多5个固定标签、0—1000码点正文和静态提示  | Yifan Ji / Xiang Hong                                      |
| UW3-F03 | 今天及此前29天补记；编辑本人已有较早记录   | Yifan Ji / Xiang Hong                                      |
| UW3-F04 | 编辑与删除同步影响全部回顾视图             | Yifan Ji / Xiang Hong                                      |
| UW3-F05 | 私人月历，未记录日期留白                   | Zhifeng Dai / Xiang Hong                                   |
| UW3-F06 | 天气分类分布，以实际记录数为分母           | Zhifeng Dai / Xiang Hong                                   |
| UW3-F07 | 日期时间线；阶段窗口7/30/90天              | Zhifeng Dai / Xiang Hong                                   |
| UW3-F08 | 私人月份档案                               | Zhifeng Dai / Xiang Hong                                   |
| UW3-F09 | 天气卡片，正文预览默认关闭                 | Zhifeng Dai / Xiang Hong                                   |
| UW3-F10 | 最多6个静态贴纸和2个背景；可关闭、重置     | Zhifeng Dai / Xiang Hong                                   |
| UW3-F11 | 核验过的校园地点列表与地图                 | Qinghan Zhang / Junhan Huang                               |
| UW3-F12 | 场景筛选，不使用私人正文推断偏好           | Qinghan Zhang / Junhan Huang                               |
| UW3-F13 | 地点详情、开放信息与用户主动导航           | Qinghan Zhang / Junhan Huang                               |
| UW3-F14 | 私人地点收藏，重复操作不产生重复数据       | Qinghan Zhang / Junhan Huang                               |
| UW3-F15 | 1—200码点私人纠错，运营审核后更新正式资料  | Qinghan Zhang / Junhan Huang                               |
| UW3-F16 | 获授权人员核验的支持资源与有效期           | Qinghan Zhang / Junhan Huang                               |
| UW3-F17 | 最多3项自主小任务建议                      | Qizhen Chen / Jiawei Fang                                  |
| UW3-F18 | 自报完成、替换、跳过；状态转换幂等         | Qizhen Chen / Jiawei Fang                                  |
| UW3-F19 | 私人任务历史                               | Qizhen Chen / Jiawei Fang                                  |
| UW3-F20 | 独立轻选择入口，不要求先保存日记           | Yifan Ji / Jiawei Fang                                     |
| UW3-F21 | 隐私和显示偏好                             | Linghan Chen / Jiawei Fang                                 |
| UW3-F22 | 本人JSON/Markdown导出、领取权限和到期控制  | Linghan Chen / Xiang Yu；Jiawei提供共用账号校验            |
| UW3-F23 | 账号停用、注销清理与受限进度回执           | Linghan Chen / Jiawei Fang账号入口与进度；Xiang Yu清理执行 |
| UW3-F24 | 明确标为固定虚构的校园气象，不采集真实贡献 | Linghan Chen / 固定模拟内容                                |

五种编码为 SUNNY、PARTLY_CLOUDY、CLOUDY、RAINY、STORMY。八个固定标签为 STUDY、REST、EXERCISE、SOCIAL、ALONE_TIME、ANTICIPATION、TIREDNESS、CALM，标签选择不得重复。

身份来自可信微信上下文；内部账号 active 才能访问私人服务。停用账号不能借仍有效的平台登录恢复旧数据。运营员只能维护校园资料，不能访问私人日记或身份映射。导出/删除必须跨记录、卡片、档案、客户端缓存和未领取导出一致处理。

同日唯一由服务端 ownerId+date 约束；新建窗口由服务端判断，已有旧记录编辑不受新建窗口误伤。expectedVersion 防止竞争更新静默覆盖；requestId 必须绑定原输入摘要，防止超时重试重复写入。

导出凭证最长5分钟、服务端文件最长24小时；主库删除24小时、注销清理7天和备份最长30天属于后续待验证目标，基础架构没有声称达成这些目标。不足3条记录不得输出趋势结论，不对天气进行健康评分。

首版没有树洞、公共评论、陌生人互动、真实校园情绪汇总或诊断。测试与演示只用合成数据。真实地点和支持联系方式必须核验，不把示例内容当作正式服务。

八周计划为2026年10月12日至12月6日。功能验收按 T01—T24 对应需求编号，隐私/跨模块检查单独记录；完成状态以实际版本与证据为准。

资料后台界面和Web可信身份接入由Qizhen Chen负责，后台业务及角色查询由Junhan Huang负责；第一周验证Web登录授权。前端集成由Linghan Chen负责，CI和测试部署由Yuen Lin负责，平台账号与AppID由Xiang Hong负责。F22/F23分工见[模块分工](team.md)。
