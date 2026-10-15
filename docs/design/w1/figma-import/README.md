# 在 Figma 中编辑 Moodsky 第一周 UI

本目录是一个无需网络的 Figma 开发插件。它读取 `design/design.json`，在 Figma 中创建原生文字、框架、矢量图层、组件和实例，并创建颜色变量、文字样式以及原型点击连线。文件中的中文正文保持文字层，支持直接修改。

1. 先解压交付 ZIP；推荐安装 **Noto Sans SC**，并打开 Figma Desktop。
2. 新建一个 **Figma Design** 文件。
3. 在 Figma 菜单选择 **Plugins → Development → Import plugin from manifest…**，选择本目录的 `manifest.json`。
4. 运行 **Moodsky · 第一周 UI 导入**，选择交付包内的 `design/design.json`，点击 **创建可编辑设计**。
5. 导入完成后保留插件窗口，查看实际字体、数量和待处理连线；可下载导入报告。关闭插件即可编辑画板。
6. 在原型页选中起点画板，点击 **Present / 演示** 查看主要路径。保存文件后可通过 Figma **Share** 生成团队可点击链接。

新建文件的默认空白页面会被复用为第一张交付页，因此导入后共三个页面；只有当前页面完全为空时才会复用，包含已有图层的页面会保留。重复导入会创建名称带「导入 2」等后缀的新页面，不覆盖现有画板。主组件位于「01 · 视觉规范」页的右侧区域，与规范画板保持至少 100 px 间距；整个交付使用视觉规范、主要原型、后台低保真三个页面。主要页面中的按钮等保持组件实例；支持 `Label` 文字覆盖。页面、组件和 token 都可继续修改。

`manifest.json` 中的 `id` 是此交付的本地开发占位标识，未用于发布插件。如果当前 Figma 版本拒绝直接导入该 manifest，可在 **Plugins → Development → New Plugin…** 新建本地插件，以 Figma 自动生成的 manifest `id` 为准：保留该真实 `id`，复制本交付的 `code.js` 和 `ui.html` 到新插件目录，将其 manifest 的 `main`、`ui`、`editorType`、`documentAccess`、`networkAccess` 设置为本交付 manifest 的对应值，然后运行新建的开发插件。无需发布插件。

## 文件说明

- `manifest.json`：Figma 本地开发插件入口及网络禁用声明。
- `code.js`：导入器；可复用的入口为 `async buildDesign(figma, data)`。
- `ui.html`：本地 JSON 文件选择和导入结果窗口。
- `../design/design.json`：设计源数据，包含画板、图层、组件、tokens、流程起点和点击目标。

本插件导入的原型模拟产品路径，不执行真实数据保存、导出或账号注销。文字图层依赖本机/Figma 的字体；插件会先检查和加载实际字体，再写入文字。SVG 仅用于矢量图标、插图等素材，SVG 中的文字可能被 Figma 转成轮廓，因此界面正文使用 JSON 的 `text` 图层导入。

导航连接需要源图层和目标画板位于同一页；未找到目标或无法设置的连线会列入报告。`NAVIGATE` 为即时切换，复杂表单输入与真实日历选择由工程实现；可在 Figma 中继续添加动画和更细的交互。

如果导入中途报错，插件会保留当前批次和导入报告，不会删除文件中已有设计。可以使用 Figma 撤销后重新导入。JS 语法及源数据可在交付前本地检查；真实 Figma 字体、账户计划和界面版本仍以导入后的报告与视觉检查为准。
