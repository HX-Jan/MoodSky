# W4XY02 完整导出覆盖矩阵

基于 0.3.0 上线版本，本人核对了 JSON/Markdown 导出的实际字段覆盖范围：

| 模块                    | 是否支持导出 | 导出字段说明                       | 备注/缺口                |
| ----------------------- | ------------ | ---------------------------------- | ------------------------ |
| 天气记录 (journals)     | ✅ 已覆盖    | date, weather, tags, text, version | 完整                     |
| 收藏地点 (favorites)    | ✅ 已覆盖    | placeId, createdAt                 | 完整                     |
| 任务历史 (task_history) | ✅ 已覆盖    | taskId, state, createdAt           | 完整                     |
| 偏好设置 (preferences)  | ✅ 已覆盖    | cardPreview, decorationsEnabled    | 完整                     |
| 装饰信息 (decorations)  | ⚠️ 待接入    | month, stickerId                   | 当前依赖 Jiaqi 素材定稿  |
| 纠错记录 (corrections)  | ❌ 未接入    | -                                  | 私人纠错无导出需求，待定 |

_注：所有导出查询均在 `ownerId` 边界内，不会越权拉取他人数据。_
