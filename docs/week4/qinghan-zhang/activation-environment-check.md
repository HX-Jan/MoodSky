# 地点启用与环境核对

用户明确转述组长已审核五条资料并授权直接启用。已生成places-approved-import.jsonl，五条enabled=true，openState=LIMITED，仍遵守各条营业与进入限制。verifiedAt保留实际现场核验日期；verifiedBy为现场核验人Qinghan Zhang，不伪造组长审核时间。reviewRecordedAt是本会话收录审核结果的时间，不是组长实际签字时间。旧候选文件保留来源。

截图环境ID mood-sky-d5gqy3spkff37566d，与cloudfunctions/moodsky/production/config.js的ENV_ID完全相同；AppID也一致。这是当前代码正式发布目标环境，不能仅因“我的环境”字样判断为独立测试环境。截图不能证明是否承载当前线上服务，不能证明具有部署权限，也不包含函数版本、数据库集合和客户端权限结果。

本次完成本地启用数据和五条可发布校验，没有真实写库、没有创建集合、没有部署或修改身份密钥。接下来先只读核对云函数列表及places集合现有条目，避免重复导入已有placeId或覆盖正在使用的正式函数；候选验证不能使用不明环境身份或伪造生产测试用户。

jsonl每行一条地点文档，包含稳定_id。实际导入前需核对控制台格式、同名记录与规则；文件不自动执行写库。尚未配置新campus_checkin_states集合时，不启用客户端打卡flag。

## 真实地点导入证据

用户提供云控制台截图：places集合显示福友阁、大梦书屋、望舒湖、阳光园、光彩创咖五个稳定_id。当前选中福友阁显示enabled:true、isSynthetic:false、openState:LIMITED及对应文字路线。可确认五条地点记录已出现在控制台；未逐条检查全部字段、权限或小程序服务读取，不据此宣布打卡已开放。

导入文件notes仍含准备阶段“尚未写入真实数据库”的历史措辞，这是助手生成资料时遗留的说明，现已由本条导入证据更新，不影响服务判定；不建议为修正文案重复导入或覆盖五条记录。后续维护时可将notes改为“已获启用授权；受开放与进入条件限制，不表示实时营业”。

下一步只读查找campus_checkin_states是否存在，核对数据权限，再安排具体候选服务部署。现有线上moodsky-release不因地点导入自动获得新action。

## 新集合与客户端权限证据

用户随后提供云控制台数据权限截图：已选中campus_checkin_states集合，权限为“所有用户不可读写”。据此登记集合已创建、控制台已显示禁用客户端直接读写。未执行真实客户端负向读写探针，不能将截图视为后端部署或权限穿透测试通过。没有手工添加打卡记录。

## 云函数实际部署与回读核对

2026-11-04 已通过微信开发者工具官方CLI增量部署，目标环境mood-sky-d5gqy3spkff37566d，顺序为moodsky-release-maintenance再moodsky-release，每个函数只上传index.js。控制台更新时间分别显示20:57:45、20:58:20（北京时间）。CLI服务端口由用户手动开启。

随后使用官方CLI下载部署后代码：两份index.js的SHA256均与本地已核对候选一致。主函数runtime.local.json及package.json未变化；维护函数runtime.local.json、config.json、package.json、package-lock.json均与原备份逐文件哈希一致。未更换稳定身份、会话、回执密钥。原备份和含私有配置的部署材料仅留本地，不上传GitHub。

云控制台只读system.health调用返回ok:true、version:0.4.0、stage:production-candidate、configured:true，requestId=req_checkin_deploy_health_20261104。初次编辑器未采纳set_value而提交默认Hello World时得到INVALID_REQUEST，未产生业务写入；用实际键盘输入正确请求后健康检查通过，不将初次失败隐藏为成功。

实际打卡写入、本人历史、导出/清理和手机回归仍未在真实用户链路执行，本次未主动触发维护清理或注销账号。下一步导入已开启campusCheckinEnabled的客户端候选，使用本人账号开展指定范围的打卡验证，不需要地图或到场证明。

## 本人手机主路径反馈

用户随后报告已完成登录和打卡验证，均未发现问题。登记为本人反馈通过，详见phone-feedback-20261104.md；重开、去重、断网恢复、切号及独立复核没有单独回传，不扩大结论。
