# H02/H04 本地接口候选与样例

提供人：Xiang Hong。用途：让 Yifan、Zhifeng、Xiang Yu 和 Yuen 在正式接口评审前，使用同一份类型和合成样例核对字段、日期、排序及统计。候选未接入正式小程序或云函数，不提供平台身份验证、数据库访问、真实快照或写入能力。

## 文件与使用

| 文件               | 用途                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------- |
| contracts.d.ts     | 三个 journal 和五个 review 入口的类型初稿；公共记录不含 ownerId，失败 requestId 可为 null |
| reference.js       | 候选输入校验与五个回顾入口的合成只读投影；装饰仅覆盖无配置 get，replace/reset 不执行      |
| demo.js            | 重算原 H04 的 8 组只读样例，另 2 组装饰修改只验证形状                                     |
| type-assertions.ts | 编译期正反例；包括禁止客户端指定账号、禁止公共视图读取 ownerId、窗口及天气代码限制        |

在项目根目录安装 README 列出的锁定依赖后运行：

```shell
node tools/week1-contracts/demo.js
node --test tests/week1-contract-candidates.test.js tests/h03-sdk-error-boundary.test.js
```

第一条输出 mode:synthetic-offline-reference，以及每个样例实际重算的 syntheticData。装饰 replace/reset 输出 NOT_IMPLEMENTED 说明，不能当成修改成功。第二条执行候选边界和 SDK 离线复现；不连接微信或云端。

类型候选使用锁定的 TypeScript 5.9.3 开发依赖检查，不生成 JS，也不增加小程序或云函数运行依赖。2026-10-23 起已纳入 `npm run check`，GitHub quality 同步执行：

```shell
npm run typecheck
```

## 交接给谁、看什么

- Yifan：使用 [H02 六组输入](../../docs/week1/xiang-hong/w1-h02-examples.json)，固定今天为 2026-10-16；今天含新建和已有记录两个子状态。重点核对 expectedVersion 和保留原请求。
- Zhifeng：使用 [H04 样例](../../docs/week1/xiang-hong/w1-h04-examples.json)，其固定今天为 2026-10-15。月历升序、档案和时间线降序；缺日期留白，分母为有效记录数，少于三条只显示记录而不生成趋势结论。
- Xiang Yu：核对来源版本和一致读取方案、删除/重建代际及关联失效；合成函数的单次内存计算不是数据库原子快照证据。
- Yuen：运行以上检查并保留版本、预期、实际及错误；缺乏云权限可先核对这些离线输入。真实调用另行记录。

## 需要共同确认的差异

候选新增查询/删除白名单、非负安全整数版本校验；H04 的 sourceRevision、decorations.operation、单月六项贴纸上限仍待接口评审。素材 ID 只做形状检查，不验证目录成员、归属或状态。无配置装饰 get 不代表已有配置能正确读取。真实写入、回执、冲突重试、偏好正文预览、月份目录分页和会话缓存失效均不在候选实现范围。

2026-10-23 已按现有实现校正共享声明：`JournalEntry` 表示客户端投影，不含内部 ownerId；输入、返回记录及回顾标记复用 `JournalWeather` 判别联合，CUSTOM 必有名称，普通天气禁止残留名称；候选结果复用 `ApiResult`，非法请求失败的 requestId 可为 null。编译期正反例覆盖以上约束，避免共享类型和候选类型各自漂移。这是与已实现返回形状的同步，没有新增接口字段或替代成员联合确认。此前 W1 的未实现范围保留其时点，W2 当前可执行实现见 [接入清单](../../docs/week2/xiang-hong/contracts.md)。

## 常见情况

| 现象                             | 原因及处理                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------- |
| Cannot find module wx-server-sdk | 尚未安装云函数锁定依赖；按根 README 执行 npm ci --prefix cloudfunctions/moodsky |
| 候选输入返回 INVALID_INPUT       | 核对日期、月份、数字窗口、版本和额外字段；不要用客户端 now 改写窗口             |
| 合成夹具报 TypeError             | 显式提供 synthetic:true、合成账号、固定今天、来源版本及唯一的有效记录           |
| 正式云函数仍返回 NOT_IMPLEMENTED | 本目录没有接入正式入口；离线成功不改变正式服务状态                              |

H03 SDK 测试固定底层合成传输，并独立阻断 HTTP/HTTPS 回退。多个后端错误仍可能映射为 -501001，测试没有把这个数字当作可自动重试的业务冲突，也没有修复或重发历史云端失败批次。
