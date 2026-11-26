# YF02-C3 证据索引

## 证据清单

| 编号 | 文件                                  | 内容                                                                                                                                     | 执行时间   | 基线                                     |
| ---- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------- |
| E01  | evidence/ab-results.json              | A/B 工作台原始输出（16 案全过；含逐案 requestId / expected / facts；会话、回执、正文经工具脱敏；含 sourceCommit 与 sourceWorktreeDirty） | 2026-11-25 | 7feca53ff0ed461cac270b7da7e7c36f36b7973b |
| E02  | evidence/ab-results.csv               | 工作台 16 案一览（case / actor / action / expected / actual / passed）                                                                   | 2026-11-25 | 同上                                     |
| E03  | evidence/ab-tests-output.txt          | node --test 三文件原始输出（18/18，exit 0）                                                                                              | 2026-11-25 | 同上                                     |
| E04  | evidence/latest-full-check-output.txt | 最新全量检查原始输出（静态检查全过；1693 中 10 失败，待核簇）                                                                            | 2026-11-25 | 同上                                     |

逐文件 sha256 指纹与字节数见同目录 manifest.json（脚本在入库文件上直接计算生成，未手工填写）。机器生成文件（E01–E04）按原字节入库，未经手工编辑。

## 复跑命令

在仓库根目录、基线 7feca53ff0ed461cac270b7da7e7c36f36b7973b 下：

1. `npm.cmd ci --prefix cloudfunctions/moodsky`（工作台依赖，一次性）
2. `node tools/alpha-h/ab-workbench.cjs --out <新的空目录绝对路径>` → 预期 `{"cases":16,"passed":16,"failed":0}`
3. `node --test tests/logout-work-protection.test.js tests/ab-workbench.test.js tests/alpha-qc-unknown-results.test.js` → 预期 18/18，exit 0
4. `npm run cloud:prepare` 后 `npm run check` → 预期静态检查全过、测试 fail 10（待核簇）

## 说明

- 工作台仅使用合成双账号（SIMULATED_C2H_A/B）与内存库，无真实云、无真机、无真实账号；输出已由工具脱敏（sessionScope / receipt / content / text 以占位符代替）。
- 执行机本地原始备份另存于 D:\Projects\MoodSky-Alpha证据\1126\。
