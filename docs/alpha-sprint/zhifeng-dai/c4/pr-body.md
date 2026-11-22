# Pull Request（待发起）

- 仓库：`HX-Jan/MoodSky`
- base：`main`
- head：`test/alpha-z-c1`
- 标题：`test(review): Alpha Z four-view evidence for C1-C4`
- 关联：`Refs #200`（AS-Z01／AS-Z02；全部复核通过前不使用 `Closes`）
- 合并方式：由仓库拥有者 Squash

> 当前状态：四个周期提交与原生证据补充已完成，`npm run check` 通过；分支 `test/alpha-z-c1` 已推送。`gh` 未登录，PR 通过用户已登录的 Edge 创建，不提取浏览器凭据、不伪造 PR 链接。

## 概要

仅新增 Alpha 周期证据与采集工具，不改动小程序运行源码：

- `tools/week6-z/alpha-review-harness.cjs`：加载真实页面模块，在禁云演示与云替身下运行，输出“预期—实测—判定”CSV 与运行状态渲染的 SVG。
- `docs/alpha-sprint/zhifeng-dai/c1..c4/`：四期 CSV、SVG、日志、演示说明与个人总结；C1/C4 各附 6 张 2026-11-22 补录的微信开发者工具原生模拟器 PNG。

## 四期结果

| 周期 | 交付                                 | 结果       |
| ---- | ------------------------------------ | ---------- |
| C1-Z | 基线四入口、跨页图、空月图、日志 1   | 40/40 PASS |
| C2-Z | 修改删除传播、失败与素材降级、日志 2 | 25/25 PASS |
| C3-Z | 旧响应隔离、回归、日志 3、博客草稿   | 41/41 PASS |
| C4-Z | 最终候选复核、演示、总结、日志 4     | 60/60 PASS |

## 关键结论

- 四入口对共享种子逐条一致；正文只出现在详情。
- 非当前月刷新与离页返回保留原月；空月保持 0 条与留白。
- 修改删除传播一致，9 月不受影响；删除后旧详情为 `missing`。
- 月历／档案失败保留所选月份且不画脏数据；素材失败只降级背景与贴纸文字。
- 切月、离页、模块切换、切号均未出现旧响应覆盖；旧账号详情为 `stale`。

## 复跑

```bash
node tools/week6-z/alpha-review-harness.cjs --cycle c1 --out docs/alpha-sprint/zhifeng-dai/c1
node tools/week6-z/alpha-review-harness.cjs --cycle c2 --out docs/alpha-sprint/zhifeng-dai/c2
node tools/week6-z/alpha-review-harness.cjs --cycle c3 --out docs/alpha-sprint/zhifeng-dai/c3
node tools/week6-z/alpha-review-harness.cjs --cycle c4 --out docs/alpha-sprint/zhifeng-dai/c4
npm run check
```

## 检查

- `npm run check`：lint、format、structure、docs、typecheck 通过；单测 **1612/1612**。
- 专项：`node --test tests/week6-review-zhifeng.test.js` 8/8。
- 日志：`docs/alpha-sprint/zhifeng-dai/c4/evidence/check.txt`。

## 限制

- SVG 为运行状态渲染，**不是原生截图**；C1/C4 已分别补充 6 张微信开发者工具模拟器 PNG。原生 90 天窗口按补录业务日为 `2026-08-25—2026-11-22`，共 7 条。
- 真机与真实云端未执行；当前月空态和 9 月下拉刷新未在本轮原生补录中操作。
- 旧响应用进程内云替身固定时序，不等同真实网络乱序。

## 发起命令（凭据就绪后）

```bash
git push -u origin test/alpha-z-c1
gh pr create --repo HX-Jan/MoodSky --base main --head test/alpha-z-c1 \
  --title "test(review): Alpha Z four-view evidence for C1-C4" \
  --body-file docs/alpha-sprint/zhifeng-dai/c4/pr-body.md
```
