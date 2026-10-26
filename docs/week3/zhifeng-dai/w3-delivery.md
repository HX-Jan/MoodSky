# MoodSky 第三周 Zhifeng Dai 交付文档（天气宇宙与回顾前端）

整理日期：2026-10-25。岗位：天气宇宙与回顾前端。任务范围：W3 Z01—Z05。

## 1. 七天气与 CUSTOM 显示边界（W3 Z01）

### 1.1 接口定义与前端实现对照

| 契约项 | 接口约定 | 前端实现位置 | 状态 |
| --- | --- | --- | --- |
| 天气类型 | 七天气：SUNNY/PARTLY_CLOUDY/CLOUDY/RAINY/STORMY/HEAVY_RAIN/TYPHOON | `miniprogram/shared/constants.js` `WEATHER_TYPES` | 已实现 |
| 自定义天气 | CUSTOM + weatherName（1—20 码点） | `LIMITS.weatherNameCodePoints=20` | 已实现 |
| 校验边界 | CUSTOM 必须携带 1—20 码点 weatherName；非 CUSTOM 不得携带 weatherName | `miniprogram/shared/weather.js` `validateWeather` | 已实现 |
| 显示图标 | HEAVY_RAIN=🌧, TYPHOON=🌀, CUSTOM=🌈 | `miniprogram/modules/review/presentation.js` `ICONS` | 已实现 |
| 显示标签 | CUSTOM 返回 weatherName，缺省"自定义" | `weather.js` `weatherLabel(code, name)` | 已实现 |
| 回顾白名单 | marks 只输出 `{id, date, weather, weatherName?}`，不含 text/tags/ownerId | `cloudfunctions/moodsky/services/review.js` `snapshotMarks`；`miniprogram/modules/review/reader.js` `projectMark` | 已实现 |
| 分布 bins | 8 类：七天气 + CUSTOM，顺序固定，总和=recordCount | `review.js`；`reader.js` `DISTRIBUTION_BIN_CODES` | 已实现 |

### 1.2 历史五天气样例说明

历史五天气样例（SUNNY/PARTLY_CLOUDY/CLOUDY/RAINY/STORMY）不得作为本周验收输入依据。
本周已将常量扩展为七天气并新增 CUSTOM，所有回顾视图均按 8 bins 输出。

## 2. 月历档案与详情接线（W3 Z02）

### 2.1 接线状态

| 页面 | 云模式接线 | 序列令牌 | 旧 ID 兼容 | 失败状态 | 卡片正文 |
| --- | --- | --- | --- | --- | --- |
| `pages/review/month` | `reviewReader.monthArchive(month)` | `_seq` | — | `reviewErrorMessage` | `cardTextPreview:false` 强制 |
| `pages/review/detail` | `reviewReader.getEntry(date)` | `_seq` | `entry.id !== query.id` → stale | `reviewErrorMessage` | 正文仅本页展示 |
| `pages/review/insights` | `reviewReader.insights(windowDays)` | `_seq` | — | `reviewErrorMessage` | — |
| `pages/review/archive` | 月份选择器 → 跳转 month 页 | 演示订阅 | — | — | — |

### 2.2 覆盖场景

- 空月：`monthArchive` 返回 `recordCount:0, cards:[]`，页面展示空态
- 跨月：月历按 `YYYY-MM` 过滤，跨月记录不混入
- 排序：cards 日期降序，entries 日期升序（reader 校验顺序）
- 旧 ID：详情页核对 `entry.id`，删除重建后旧链接显示 stale
- 失败：NOT_IMPLEMENTED/ACCOUNT_DISABLED/NETWORK_ERROR 等映射为安全提示

## 3. 统计与时间线一致性（W3 Z03）

### 3.1 单次快照派生

`reader.insights(windowDays)` 只调用一次 `timeline`，从同一份 `items` 派生 `distribution.bins`，
避免二次读取导致的统计不一致。不生成健康评分（无 health/score 字段）。

### 3.2 手工可核算测试样例

固定时钟：2026-10-18（北京时间）。窗口 7 天：2026-10-12 至 2026-10-18。

| 记录数 | 日期 | 天气 | 分布 bins（8 类） | trendEligible |
| --- | --- | --- | --- | --- |
| 0 | — | — | 全 0，recordCount=0 | false |
| 2 | 10-17 SUNNY, 10-18 SUNNY | SUNNY×2 | SUNNY:2, 其余:0 | false |
| 3 | 10-16 SUNNY, 10-17 RAINY, 10-18 HEAVY_RAIN | SUNNY:1, RAINY:1, HEAVY_RAIN:1 | 对应 bin=1，其余 0 | true |

趋势门槛：`LIMITS.minimumTrendEntries=3`，`trendEligible = recordCount >= 3`。
bins 总和始终等于 recordCount，分母为实际记录数而非窗口天数。

## 4. 删除切号与乱序回归（W3 Z04）

### 4.1 缓存失效机制

- `onHide`：非演示模式下递增 `_seq`，清空卡片/统计/详情数据
- `onShow`：重新调用接口读取最新数据
- 迟到响应：`token !== this._seq` 时丢弃，不覆盖当前页面
- 账号切换：旧账号私有内容在下次 onShow 时被清除（W2 Z03 测试覆盖）
- 卸载返回：`onUnload` 递增 `_seq`，卸载后到达的响应被丢弃

### 4.2 数据隔离

- 正文、自定义名称、已删除记录不会从旧缓存返回
- 序列令牌按页面实例隔离，跨页面不共享
- 装饰响应按月份隔离，旧月份响应不覆盖当前月份

## 5. 装饰候选与素材验收（W3 Z05）

### 5.1 服务端校验

| 规则 | 实现 |
| --- | --- |
| 贴纸目录 | `catalogue.stickers` 必须为已批准 ID，去重，≤`LIMITS.staticStickers`(6) |
| 背景目录 | `catalogue.backgrounds` 必须为已批准 ID，≤`LIMITS.staticBackgrounds`(2) |
| 版本冲突 | `expectedVersion !== current.version` → CONFLICT |
| 回执绑定 | 非 get 操作必须绑定 receiptPolicy，幂等 |
| 素材撤回 | `view()` 过滤不在目录中的 sticker/background |
| 目标记录 | `targetEntryId` 必须引用当月存在的 mark |

### 5.2 前端降级

`pages/universe` 装饰面板三态：
- `unimplemented`：云端返回 NOT_IMPLEMENTED，提示"云端装饰服务尚未开放"
- `unavailable`：读取失败，降级为默认展示
- `available`：正常读写

无正式目录或存储条件时，云模式不允许装饰写操作（`onAddSticker`/`onResetDecoration` 仅演示模式可用），
不显示真实装饰保存成功提示。

### 5.3 未实现状态

- 正式素材目录与存储由 Xiang Yu 负责，当前为合成素材
- 月份目录分页入口尚未确定，archive 页仅提供月份选择器
- CUSTOM 天气的记录页输入（weatherName 编辑器）由 Yifan W3 YF01 负责

## 6. 测试

- 新增 `tests/review-week3.test.js`：7 项测试覆盖 CUSTOM 边界、八 bins、趋势门槛
- 全量测试：741 项通过（`node --test`）
- 关键测试文件：`tests/review-backend.test.js`, `tests/review-reader.test.js`, `tests/review-demo.test.js`, `tests/week1-contract-candidates.test.js`

## 7. 可接线范围

| 模块 | 可接线 | 待依赖 |
| --- | --- | --- |
| 回顾读取（calendar/distribution/timeline/monthArchive） | 候选路由已接线，生产路由待仓库适配器 | Xiang Yu 仓库适配器 |
| 详情读取（journal.get） | 候选路由已接线 | 同上 |
| 装饰读写 | 候选路由已接线，需 catalogue 配置 | Xiang Yu 素材目录 |
| CUSTOM 记录写入 | 校验已就绪 | Yifan 记录页 customName 输入 |
