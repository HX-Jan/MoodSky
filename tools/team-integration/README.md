# 组内本地联调入口

第一次运行、不了解终端/目录/安装步骤时，先按[组员使用手册](../../GETTING_STARTED.md)第1—4节操作；后端逐行调用样例见第6节，常见错误见末尾速查。

用途：组员从同一main取代码后，先验证现有模块能否按当前契约协作。没有云权限也可运行；它不会修复微信/腾讯云账号授权，不提供多人共用的在线数据库。

## 首次运行

在仓库根目录使用Node.js 24执行：

```sh
npm ci
npm run team:check
```

命令会先从共享源码生成云函数shared，然后运行9组真实处理器调用链：基础协议、七天气保存/读取、原请求重试/版本冲突、游客/停用/账号隔离、删除后回顾一致性与正文排除、校园筛选/详情、运营门禁/维护重读、纠错审核不修改地点、公开任务只读。中文输出逐项显示通过/失败，失败返回非零退出码。

运行前用`git rev-parse HEAD`确认双方源码版本；九组通过只表示这些固定用例通过，不代表完整项目或各成员任务验收。它不替代`npm run check`。

需要机读结果时：

```sh
npm run team:check -- --json
```

npm会先打印命令日志。程序自身的纯JSON可在已准备shared后用`node tools/team-integration/check.cjs --json`获取。结果明确包含`LOCAL_SYNTHETIC_ONLY`、固定模拟时间以及真实云/手机未检查的状态，不返回原始记录、身份凭据或平台堆栈。

## 在本地调用候选

在仓库根目录新建自己的临时脚本，或在Node交互模式中：

```javascript
const { createLocalTeamBackend } = require('./tools/team-integration/local-backend.cjs');
const local = createLocalTeamBackend();
await local.call('campus.listPlaces', { tags: [] });
await local.call(
  'journal.upsert',
  {
    date: '2026-10-29',
    weather: 'CUSTOM',
    weatherName: '合成彩虹😀',
    expectedVersion: 0,
  },
  { actor: 'a', requestId: 'req_local_example_001' },
);
await local.call('journal.get', { date: '2026-10-29' }, { actor: 'a' });
```

上面的顶层await适用于Node交互模式；CommonJS文件请放进async函数。每个新建的local实例独享内存，关闭进程或重建实例后清空。模拟时间固定在北京时间2026-10-29中午，换成真实日期可能触发记录新建窗口；这不是服务器真实时钟。

仅接受guest（默认）、a、b、operator、disabled五种合成身份。它们用于验证门禁，不映射真实微信或Web用户，不能用于生产授权。新逻辑操作使用新requestId；原请求重试保留原ID及payload。本工具没有自动写入重试。

## 接线及边界

`local-backend.cjs`显式组装现有`createCandidateRouter`、journal/review服务、校园/admin处理器及只读任务候选，复用仓库已有内存替身和合成回执策略。校园fixture为合成来源；其中`isSynthetic:false`仅用于覆盖公开投影条件，不表示核验过真实地点。它不导入个人environment.local、不初始化SDK、不读取云凭据，也不监听网络端口。

默认云入口不导入本目录。它不提供原生事务、真实索引、跨实例一致性、任务私人状态机、导出文件领取、账号完整注销、Web身份、手机或平台性能的验证。真实校园/任务/私人入口的关闭状态不变。网络/SDK/个人配置被阻断时仍能跑通、处理器失败时退出1、不支持的CLI参数退出2，均有独立子进程回归。

若本地通过但云端报错，继续按[双平台权限排障](../../docs/collaboration/team-sharing.md)核对组员实际账号与入口；不要把本地合成成功当成云权限已修复。
