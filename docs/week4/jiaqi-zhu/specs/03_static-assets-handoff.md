# JQ03 静态装饰目录 H03/Z04交接

目录版本w4-jq03-20261105-1.0.0，日期2026-11-05。文件级交付：6贴纸+2背景，沿用demo-data既有ID，不增加玩法。每项SVG源、PNG、尺寸/哈希、引用许可、预览与降级图见 [catalogue.json](../assets/catalogue.json)。批准状态仍为PENDING_XIANG_HONG_ZHIFENG；没有注入production backend或改存储。

| ID                   | 展示名     | 交付PNG / SVG源尺寸 | 来源                                    |
| -------------------- | ---------- | ------------------- | --------------------------------------- |
| STICKER_STAR         | 一颗小星   | 128×128 / 256×256   | 当前CUSTOM.png图形复用，配静态圆底      |
| STICKER_MOON         | 安静月亮   | 128×128 / 256×256   | 本轮原创SVG路径                         |
| STICKER_LEAF         | 一片绿叶   | 128×128 / 256×256   | 当前leaf-active.png图形复用，配静态圆底 |
| STICKER_UMBRELLA     | 给自己撑伞 | 128×128 / 256×256   | 本轮原创SVG路径                         |
| STICKER_CAT          | 陪伴小猫   | 128×128 / 256×256   | 本轮原创SVG路径                         |
| STICKER_BALLOON      | 慢慢向上   | 128×128 / 256×256   | 本轮原创SVG路径                         |
| BACKGROUND_SKY_DAY   | 留白晴空   | 750×1334 / 同尺寸   | 本轮静态SVG，使用现有品牌色             |
| BACKGROUND_SKY_NIGHT | 柔和夜色   | 750×1334 / 同尺寸   | 本轮静态SVG，不引入暗色模式             |

PNG为小程序接入文件，SVG是编辑源。贴纸建议显示64 CSS px等效尺寸，按128像素资源提供2x；实际rpx布局由Zhifeng按视口换算。背景仅是装饰层，核心日历/正文置于不透明白卡；背景不承担状态信息。无动效、声音、拖拽、购买、解锁、评分或新玩法。

## 候选接入边界

服务工厂createDecorationService接收catalogue为纯ID数组：本包 [service-catalogue.json](../assets/service-catalogue.json) 可供批准后显式注入；不要把文件路径/作者/许可字段塞入请求payload，也不要由客户端扩服务端白名单。未知/撤回ID仍按服务校验，不迁移旧记录或修改原请求。

独立候选测试复用当前candidate-router、回执策略和内存仓库，用本包ID检查replace/get/原请求/冲突/reset及撤回过滤；只是本地合成，不是正式账号、云端部署或H03整体通过。源码入口及当前阻塞见 [H03原交接](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/docs/week4/xiang-hong/h03-decoration-candidate.md)、[Z04素材阻塞与失败回退](https://github.com/HX-Jan/MoodSky/blob/43a72337316e515391fd0e8b8af8f779f21c1948/docs/week4/zhifeng-dai/w4-z04-static-decoration.md)。

## 降级与撤回

- 贴纸文件失败：换sticker-unavailable.png（128×128），界面另用可读文字“素材未加载”；若降级图也失败则隐藏装饰图，保留文字及原日历记录。
- 背景失败：background-default.png（750×1334）或直接使用现有#FAF8F3底色，无图也能读核心内容。
- 关闭装饰不删除配置、日记或版本；加载失败不显示“记录丢失”，不阻塞保存/回顾。
- 素材撤回从经复核服务白名单移除，读取过滤未知ID并回退，保留历史版本和原请求语义；目标记录被删时依既有逻辑过滤关联贴纸，不复活已删记录。
- ID代表语义，后续换画必须新assetVersion/文件哈希，目录版本同时递增；本包未授权自动覆盖已发布资源或添加第7种贴纸/第3背景。

## 接收签认与剩余输入

| 负责人          | 需确认                                             | 实际意见与日期 | 状态       |
| --------------- | -------------------------------------------------- | -------------- | ---------- |
| Xiang Hong H03  | 目录白名单、回执/生产关闭、撤回策略及候选复测      | 未收到         | 待复核     |
| Zhifeng Dai Z04 | PNG实际加载、叠层不遮内容、关闭/失败/重置/目标删除 | 未收到         | 待复核     |
| Xiang Yu        | 既有存储/导出/停用围栏兼容与交接                   | 未收到         | 待共同确认 |

本包补齐“没有资源文件”的设计输入，不能据此把H03生产存储、接口开放、素材真机失效和独立验收全部标为完成。[素材预览](../assets/preview/index.html) 仅是独立交接工具。

## 建议运行路径（未接入）

批准采纳后由页面负责人将PNG复制到miniprogram/assets/decorations/v1/，建立ID到资源路径的客户端映射；建议路径记录在catalogue的proposedRuntimeFile，runtimePathApproved仍为false。docs中的文件不能直接当成小程序包内路径。服务端目录仍只接收ID，不传这些路径字段。尚未将任何文件复制入工程运行目录。
