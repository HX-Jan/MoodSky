# Pull Request｜W6-Z 月历、档案与回顾一致性

> 目标仓库：`HX-Jan/MoodSky`　基础分支：`MoodSky-main`　提案分支：`week6/review-zhifeng-dai`

## 标题

```
feat(review): W6-Z 月历/档案/回顾一致性验证与演示模式离开页面重读修复
```

## 摘要

- 复用 Yifan 的合成种子记录，固定「月份 → 日期 → 四页表现」的期望表，并用自动化断言覆盖。
- 覆盖修改 / 删除后的跨页同步、非当前月份下拉刷新、空月份、读取失败恢复、装饰素材失败降级。
- 覆盖迟到旧请求（切月 / 离页 / 切模块）与多账号切换隔离。
- 修复演示模式下一处真实缺陷：读取在途时离开页面，返回后因 `calendarBusy` 卡住而跳过重读，
  旧响应会把空快照写回当前月份。

## 改动

| 文件                                  | 类型 | 说明                                                                      |
| ------------------------------------- | ---- | ------------------------------------------------------------------------- |
| `tests/week6-review-zhifeng.test.js`  | 新增 | 8 个用例（Z01–Z08），禁云演示路径加载真实页面 + 合成种子                  |
| `miniprogram/pages/universe/index.js` | 修复 | 演示模式 `onHide` 作废在途读取并释放 `calendarBusy` / `decorationLoading` |
| `docs/week6/zhifeng-dai/*`            | 文档 | 对照表、异常用例集合、证据、复核交接、PR 说明                             |

## 验证

```bash
npm run cloud:prepare
node --test tests/week6-review-zhifeng.test.js   # 8/8 通过
npm run check                                    # lint / format / structure / docs / typecheck / test 全绿
```

- 全量用例：1612 条全部通过，无跳过。
- 降级与失败路径均有断言，不依赖人工肉眼判断。

## 兼容性与风险

- 仅调整演示模式（`journalDemo`）的 `onHide` 行为，云模式分支未改动。
- 正常路径下 `onHide` 前后 `_requestSeq` 自增只是让旧响应失效；页面重新显示时仍按当前月份重读，
  不改变既有数据口径。
- 空月份、非法月份、缺参数等入口行为保持原样，仅新增断言。

## 合并检查清单

- [x] 基于 `MoodSky-main` 分支开发，单任务单分支
- [x] 提交信息关联任务编号 `W6-Z`
- [x] `npm run check` 无错误、无告警
- [x] 新增用例覆盖本次任务 4 项执行要求
- [ ] Yifan 核对合成记录一致性（待签字）
- [ ] Yuen 完成全流程复现验证（待签字）
- [ ] 开发者工具截图补齐（见 w6-z03 第 4 节，环境阻塞）
