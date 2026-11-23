# 手机号入口与原微信重新注册不兼容

复现对象：PR237固定head `98c0659a73a1c6a5fbb7cb4b284b68ee3776ab2f`，真实`pages/login/index.js`和`createCloudSession`，本机VM/合成回执，不连接云。

1. 启用手机号入口，未登录，勾选指引；选择已注销原微信账号关联号码。
2. 服务返回`ACCOUNT_DISABLED`。页面只显示“账号已注销”，不请求`account.registration`，`registrationAvailable=false`。
3. 再点主登录按钮；`onWechatLogin`因手机号模式且未认证直接return，仍不读取注册状态，无法进入确认并创建空账号。

已有#226约定是同一微信可以显式重新注册空账号、旧数据不恢复。本分支只在关闭手机号入口时保留原测试路径，不能满足开启后的可达性要求。

实际[机器结果](evidence/phone-reregister-counterexample.json)；[复现脚本](evidence/phone-reregister-counterexample.cjs)用`node <脚本> <绝对路径的PR237检出目录>`执行，须先setup和cloud:prepare。脚本确认回退存在时退出0，输出`reproduced:true`；这不是产品用例通过。

返修须同时覆盖原微信号码与其他独立号码，注销后确认/取消、新代空数据、重新退出再登录、新旧凭证及清理边界。需新的实际页面/生命周期回归和原生证据；不能只显示无操作入口的提示或复活旧账号。仓库“未部署”与PR正文“已启用”的来源也需按回执日期核对。本轮未操作线上环境。
