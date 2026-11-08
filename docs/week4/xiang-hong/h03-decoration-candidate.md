# W4 H03 静态装饰服务候选

11月8日补齐素材撤回后的原请求恢复。使用 Jiaqi 交付的目录和同一事务仓库，先保存贴纸及背景，再从候选白名单撤回这两个 ID。撤回后，原请求可确认已保存的版本，返回当前允许显示的装饰；新请求仍拒绝撤回素材。同一请求 ID 换载荷仍返回 `CONFLICT`。验证保存的配置与来源版本保持一致，恢复过程不会重新保存装饰。此项只影响装饰候选，生产入口仍未开放。

11月7日已接收 Jiaqi 的六款贴纸、两张背景及两种降级资源。26 项文件指纹与声明一致，PNG 尺寸、来源和许可说明已核对。用交付目录的 ID 复跑候选服务的 11 项检查，并将该目录用于现有 H03/H04 联调。真实测试入口覆盖配置读取、原请求重试、关闭后保留、旧导出失效、删除关联日期后的过滤及注销隔离。客户端演示目录的 ID 和顺序与交付一致。[素材交接与许可](../jiaqi-zhu/specs/03_static-assets-handoff.md)

本轮验证使用合成账号和事务内存库。生产入口继续返回 `NOT_IMPLEMENTED`。Zhifeng 仍需确认运行素材路径、页面加载和失败降级，Xiang Yu 仍需核对正式存储、清理及恢复约定。

## 现有实现与本次工作

复用services/decorations.js、createCloudJournalRepository与candidate-router显式注入目录，不另造服务或生产开关。已有get/replace/reset、版本、原请求签名回执、六贴纸/两背景目录上限、目标月本人记录校验及删除后失效；关闭使用account.preferences.decorationsEnabled，不删除配置。

本次新增组合联调把真实候选服务接到合成生产账号、事务存储和导出链路：保存目标贴纸→重试不重复推进版本→关闭装饰仍保留配置→旧导出失效→导出目标转成日期→删除日记后贴纸与导出悬空引用消失。账号停用后候选访问被存储围栏拒绝。固定素材ID均以synthetic开头，仅在测试中注入。

## 初次交接记录（11月3日）

1. miniprogram/assets目前只有天气和导航图标，没有经Jiaqi确认的STICKER/BACKGROUND正式目录、资源对应及授权/失效信息。需要JQ03提供：ID、类型、文件路径、展示名、来源/使用许可、版本和加载失败替代；贴纸最多6类、背景最多2类。
2. Xiang Yu的#96交接已请求修改，不能据其未核验描述确认生产存储和恢复约定。需对齐month_decorations、账号sourceRevisions.decorations与exportEpoch、request_receipts、owner过滤及账号停用围栏；不添加未经约定的删除账本或迁移。
3. Zhifeng页面当前完整编辑仍为演示，云侧为受控只读候选；正式资源就绪后还需对应读/存/关/重置入口联调及真机素材失败检查。

生产backend不注入decorationCatalogue，review.decorations仍返回NOT_IMPLEMENTED。本次测试同时确认该入口没有因候选存在而被打开。H03保持阻塞，候选链路本地可复现不等于正式素材或生产入口完成。
