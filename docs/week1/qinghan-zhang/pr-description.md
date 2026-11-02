# PR 草稿

建议标题：feat(campus): add explicit week-one place demo and verification handoff

## 本次改动

关联 Issue：待补真实 Issue 编号，不填写虚构 Closes。
需求编号：UW3-F11—F16；W1 QZ01—QZ05。

Campus 草稿缺少可触达演示入口和首次未核验空态，且测试与导航门禁、Unicode 码点规则不一致。本次接通显式合成列表、校区/标签筛选、分页、无结果、过期与关闭状态；详情展示资料和核验信息，首次不请求定位，用户主动触发后才申请，失败可返回列表。真实候选全部待核验，合成及未知坐标系均禁导航。

新增内存收藏读取/去重新增/取消、纠错 1—200 Unicode 码点与审核反馈演示；没有真实写入或公共投稿评论入口。整理 11 条旗山线索、字段问题、隐私清单、用例与交接材料。

修改范围：Campus 模块/页面、app.json 定位声明、Campus 测试、docs/week1/qinghan-zhang。正式公共合同和云端适配器未扩展；示例 payload 仍待 Junhan/Xiang Yu 确认。shared 生成副本和个人配置排除提交。

## 验证

- [ ] 整合/发布前核对成员 PR（本次只准备本地草稿，没有执行整合或发布）
- [ ] npm run cloud:prepare 和 npm run check 全部通过（未满足）
- [x] 直接 node scripts/prepare-cloud.js 与 check-structure.js 通过
- [x] Campus 标准测试 18/18；非隔离对照 18/18；本次 JS 语法检查通过
- [x] 记录全量测试实际结果：149 通过、2 失败，缺 esbuild/wx-server-sdk
- [x] 关键正常/异常本地行为有证据，并明确 mock 范围
- [ ] ESLint/Prettier、开发者工具、真机及真实云端验收（未执行）
- [ ] 共享 app.json 声明、字段/接口建议已获相关负责人确认（待复核）
- [x] 本次未上传个人配置、私人数据、凭证；未推送或部署

需要评审：Xiang Hong（最终审批/权限）、Linghan（装配/app.json）、Junhan（校园业务）、Xiang Yu（字段）、Yuen（检查）、Qizhen Cai（隐私）、Jiaqi（视觉）。接收确认由本人填写。

限制：基线为本地 ZIP，下载时间与对应提交未知，不称最新 main。外层 Git HEAD 不存在，未提交整个工作区。正式创建 PR 前将最终变动清单逐项应用于已确认的任务分支，重跑完整 quality、核对远端差异，取得必要评审。正式记录写入闭环留第二周。
