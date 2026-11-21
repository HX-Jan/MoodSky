# C1 B 层截图索引

构建与环境：本地禁云开发版（游客模式 touristappid，不使用云服务）；源码分支 docs/alpha-l-c1，提交 6e91ead92dd8ecc143e38bff956ff239e4765296；客户端版本 校园情绪天气 0.5.3（「我的」页脚可见）；基础库 3.17.4；模拟器 iPhone 12/13 Pro；采集日期 2026-11-21；采集方式 miniprogram-automator（`reLaunch` 至目标页后 `screenshot`），连接 `ws://127.0.0.1:9420`。

| 文件                             | 页面路径            | 页面与状态                                                                                     | 对应验证                             |
| -------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| sim-01-today-guest.png           | pages/today/index   | 游客态首页「今天」：七天气入口正常，提示「记录服务尚未连接，输入已保留。」（禁云构建预期状态） | LP-01 游客浏览公开入口               |
| sim-02-me-demo-profile.png       | pages/me/index      | 「我的」：本地演示账号（未连接真实身份），未设置头像昵称，页脚显示版本 0.5.3                   | LP-08/LP-09 跳过头像昵称后的默认资料 |
| sim-04-login-local-demo.png      | pages/login/index   | 登录页：微信一键登录、隐私保护指引勾选、先逛逛入口完整可见                                     | LP-03/LP-04 登录入口与隐私同意前置   |
| sim-05-account-capability.png    | pages/account/index | 账号与数据：能力围栏生效，显示「当前版本尚未开放此功能。」并提供回到首页                       | LP-02 私人入口边界与能力门禁         |
| sim-06-tasks-public.png          | pages/tasks/index   | 小任务建议页（公开入口）：游客可直达                                                           | LP-01 公开入口                       |
| sim-07-campus-public.png         | pages/campus/index  | 校园地点页（公开入口）：地点列表正常渲染                                                       | LP-01 公开入口                       |
| sim-08-profile-private-entry.png | pages/profile/index | 个人资料页（私人入口）：禁云构建下的本地表现                                                   | LP-02 私人入口                       |

## 范围说明

- 以上为 B 层普通界面截图，证明当前源码在禁云模拟器中的页面可达性与渲染状态；登录成功/隐私取消/服务失败等分支行为以 A 层自动化用例为准（见同目录 TAP 日志），不在截图中冒充真实微信交互。
- 游客模式模拟器会以替身调用 `wx.operateWXData`（调试器中有提示），属工具行为，非产品代码。
- 真实微信登录、真机文件送达保持外部待验，见 c3/device-delivery-checklist.md。
