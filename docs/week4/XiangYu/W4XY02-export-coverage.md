# W4XY02 完整导出覆盖矩阵

基于源码 `cloudfunctions/moodsky/domains/export.js` 中的 `SOURCES` 定义与 `services/account-data.js` 的实际投影，核对导出域覆盖：

| 模块 (Domain)          | 源码覆盖  | 导出字段校验与约束                             | 实际导出验收状态 |
| ---------------------- | --------- | ---------------------------------------------- | ---------------- |
| 天气记录 (journals)    | ✅ 已覆盖 | 必须包含 **CUSTOM weatherName**、text、tags 等 | 已通过源码对齐   |
| 收藏地点 (favorites)   | ✅ 已覆盖 | placeId, placeName, createdAt                  | 已通过源码对齐   |
| 任务历史 (tasks)       | ✅ 已覆盖 | 匹配 `taskHistoryItem` 投影，最多 100 条       | 已通过源码对齐   |
| 偏好设置 (preferences) | ✅ 已覆盖 | 包含 **profile**、cardTextPreview 等           | 已通过源码对齐   |
| 装饰信息 (decorations) | ⚠️ 待接入 | 当前仅在源码中预留，前端与素材未定稿           | 未完全验收       |

_注：字段必须在云函数层通过 `readSourceState` 进行版本控制，以防范中途被篡改。_
