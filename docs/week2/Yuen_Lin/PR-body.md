# docs(week2): Yuen Lin 回归、部署与设备证据

## 摘要

提交 W2 YL01—YL05 的测试侧交付，仅新增 `docs/week2/Yuen_Lin/`，不修改业务源码、共享契约、数据库、CI 或导航。

- YL01：在最新 main `ed1d76f`（0.2.3）上重跑当前门禁，593 项本地测试通过，CI 基线 run `40074201757` 成功。
- YL02：执行记录核心回归，定向 144 项通过；覆盖保存、空正文、标签/码点、日期窗口、旧记录编辑、版本冲突、删除、重复点击和未知结果重试。
- YL03：`cloud:package` 三文件哈希与现网 0.2.3 完全一致；通过正式前端 `Me.runHealth()` 真实读取 `apiVersion=1`、`version=0.2.3`、请求号 `req_mvmj4sh6_2_2bbla7dt`。
- YL04：模拟器 8 项检查执行完成（7 项断言通过；Campus 定位仅验证到请求发起）；记录→回顾刷新、任务入口、偏好切换通过；真机未测。
- YL05：周报、失败/阻塞分列和第三周 R01—R12 回归输入。

## 验证

```text
npm run check                  -> 593 pass / 0 fail
记录定向子集                   -> 144 pass / 0 fail
后台/校园定向子集              -> 44 pass / 0 fail
node scripts/check-cloud.js    -> pass, no network query
npm audit (root/cloud/admin/h03-probe) -> 0 vulnerabilities
CI (main ed1d76f)              -> success, run 40074201757
```

原始 TAP、日志、包哈希、模拟器 JSON 和健康响应均在 `docs/week2/Yuen_Lin/artifacts/`。

## 未完成与边界

- 生产 `journal`/`review` 域仍返回 `NOT_IMPLEMENTED`；真实云端私有 CRUD、真实数据库约束与并发冲突未执行。
- 真实 Web 身份、后台保存链路未联调。
- Campus 定位拒绝/允许结果未取得；Android/iOS 真机未测。
- 本次没有部署、上传小程序、写数据库或执行清理；健康成功只代表正式入口可调用。
- 实际工时已填 4h；W2 任务难度点 2/5/3/3/2，合计 15；第三周候选估点 15。复核意见待实际复核人填写。

## 复核请求

- Xiang Hong：版本、部署边界与发布候选门槛。
- Qizhen Cai：账号隔离、越权删除与真实云复测输入。
- Yifan Ji / Zhifeng Dai / Linghan Chen / Qinghan Zhang：对应页面与刷新证据。
- Xiang Yu：数据库约束与真实环境前置条件。
