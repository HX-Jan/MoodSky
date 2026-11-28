# C4 校园服务目标云补验交接

日期：2026-11-28　任务：C4-JH　冻结源：`00c59a1af7ccd27e9c2ae4bc77f6b65fc66b117c`

## 一、冻结与本地证据

| 项目         | 值                                                                                      |
| ------------ | --------------------------------------------------------------------------------------- |
| 冻结源码     | `00c59a1af7ccd27e9c2ae4bc77f6b65fc66b117c`                                              |
| 集成 main    | `20f6156`（产品目录 `cloudfunctions/`、`miniprogram/`、`database/` 与冻结源逐文件一致） |
| 候选模式     | `closed`；新增校园打卡暂停；手机号登录关闭                                              |
| 本地检查     | `npm run check` 1733 通过、0 失败；定向 41 通过                                         |
| 校园最终复检 | [`final-campus-service.csv`](final-campus-service.csv) 16 行，全部 PASS                 |
| 云端         | **未调用**；目标云版本、权限与部署包未核对                                              |

## 二、目标云必须支持的接口

| action                  | 访问    | 本地结果                                                                   |
| ----------------------- | ------- | -------------------------------------------------------------------------- |
| `campus.checkIn`        | private | 未登录 `UNAUTHENTICATED`；写入成功返回 `placeId/date/completedAt/replayed` |
| `campus.checkins`       | private | 返回当日 `{date,items[]}`；只列当前推荐地点                                |
| `campus.checkinHistory` | private | 返回 `{items,page,pageSize,total,hasMore}`；含已下架地点历史               |

当前源码生产后端同时接受 `campus.checkIn`、`campus.checkins`、`campus.checkin`、`campus.checkinHistory` 四个别名；注册表四个都在。W5 曾发现 `moodsky-release` 0.4.0 只识别小写 `campus.checkin` 与 `campus.checkinHistory`，**本次未重新核对目标云是否已包含大写 `campus.checkIn` 与 `campus.checkins`**，这是补验的第一项。

## 三、集合与权限

| 集合                              | 用途                    | 客户端权限       |
| --------------------------------- | ----------------------- | ---------------- |
| `place_checkins`                  | 本人自报打卡（规范）    | 禁止直接读写     |
| `campus_checkin_states`           | 旧聚合访客/回执         | 禁止直接读写     |
| `request_receipts`                | 原请求重放/导出版本栅栏 | 禁止直接读写     |
| `places`                          | 公共推荐目录            | 可公开读，禁止写 |
| `cleanup_jobs`/`deletion_markers` | 注销清理                | 禁止客户端访问   |

所有私人读写必须经云函数与可信 `OPENID`；不接受客户端 `ownerId`/`role`。若控制台仍允许客户端直读这些集合，私人打卡不得开放。

## 四、补验步骤与通过条件

1. **构建与健康**：为目标云函数记录完整构建 SHA、候选包版本、云函数版本；`system.health` 返回 `ok:true`，并记录 `campusCheckinWritesPaused:true`。
2. **接口存在性**：分别调用三个 action；不得出现 `ACTION_NOT_FOUND`。若仍缺大写两个，先部署当前后端或保持校园只读，不开放打卡。
3. **鉴权**：无会话调用三个 action 均 `UNAUTHENTICATED`；A 的会话不能读取 B 的当日状态/历史。
4. **分页**：两条记录、`pageSize:1` 时第 1 页 `total:2/hasMore:true`，第 2 页 1 条 `hasMore:false`。
5. **暂停语义**：新写入 `NOT_IMPLEMENTED`；历史与已有原回执仍可读，原请求返回原日期且 `replayed:true`。
6. **下架历史**：从推荐目录移除的地点不出现在当日列表，但本人历史仍返回；再次打卡 `INVALID_INPUT`。
7. **导出/清理**：本人 JSON/Markdown 导出含打卡 `placeId/date/completedAt`；B 不能领取 A 的导出；注销清理后 A 打卡 0、B 与公共地点保留。
8. **证据**：记录请求 ID、响应、构建 SHA、云版本、设备/微信版本与脱敏截图；本地通过与真实云通过分开登记。

## 五、已知缺口

- 动态停用 `places.enabled=false` 的实时传播未实现；当前写入只校验静态 `PLACES`，下架验证用独立合成 ID。
- 未执行真实文件导出、24 小时领取、真实清理触发器与真机。
- 目标云实际版本、集合索引、客户端禁直读写权限均未核对。
- Qinghan 的 C4 页面材料可作前端对照，但本人未取得其独立复核。

## 六、回退

若真实云复验失败：保持 `campusCheckinWritesPaused:true`，校园入口收敛为五地点只读推荐；回退云函数到上一已记录版本，保留 `place_checkins` 与回执，不回滚/删除用户已有记录；记录版本、时间、执行人与复测结果。
