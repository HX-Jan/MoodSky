# YF02-C2 证据索引

## 证据清单

| 编号 | 文件                           | 内容                                                                                  | 执行时间   | 基线                                     |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------- | ---------- | ---------------------------------------- |
| E01  | evidence/yf02-tests-output.txt | node --test 七文件原始输出（tests 73 / pass 73 / fail 0，exit 0，duration 约 1.81 s） | 2026-11-24 | 44d7e4a302758fc13fe12c1a0b8ed2d44e0ccf39 |

逐文件 sha256 指纹与字节数见同目录 manifest.json（由脚本在入库证据文件上直接计算生成，未手工填写）。

## 复跑命令

在仓库根目录、基线 44d7e4a302758fc13fe12c1a0b8ed2d44e0ccf39 下执行：

`node --test tests/journal-pages.test.js tests/journal-recovery-native.test.js tests/journal-recovery-plan.test.js tests/journal-rejected-receipts.test.js tests/journal-snapshot-concurrency.test.js tests/journal-preflight.test.js tests/journal-demo.test.js`

Windows 下重定向保存：在上述命令后追加 `> yf02-tests-output.txt 2>&1`，随后 `echo %ERRORLEVEL%` 应为 0。

## 说明

- 证据已入库（本目录 evidence/ 下）；执行机本地原始备份另存于 D:\Projects\MoodSky-Alpha证据\1124\。
- 证据仅含测试运行输出，不含任何用户输入内容。
