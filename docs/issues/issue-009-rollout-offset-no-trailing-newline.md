# [中] 增量解析在末行无换行时 offset 可能偏大并误判截断

## 概要
增量解析时 `bytesRead` 通过 `+1` 估算换行字节数；当文件最后一行没有换行符时，`newOffset` 可能超过真实文件大小，下一轮解析被误判为截断并清空缓存。

## 影响
- 工具统计/最近调用可能被清空或闪烁。
- 运行中工具调用状态可能丢失。

## 位置
- `src/collectors/rollout.ts:146`
- `src/collectors/rollout.ts:127`

## 复现步骤
1. 准备没有末尾换行的 rollout `.jsonl` 文件。
2. 触发增量解析后，再追加新行（仍不补换行）。
3. 观察是否出现 `wasTruncated` 分支触发，导致统计被清空或回退。

## 预期结果
增量解析偏移准确，不应误判为日志截断。

## 实际结果
可能出现 `fromOffset > fileSize` 进而清空运行中调用与缓存统计。

## 修复建议
- 使用 `fileStream.bytesRead` 计算真实读取字节数，或在 `close/end` 后校准 `newOffset`。
- 将 `newOffset` 与 `fileSize` 做 `min` 限制，避免超过真实文件大小。

## 修复记录
- 状态：待修复
- 备注：与 CRLF 的偏移问题不同，此处是末行无换行导致偏移偏大。
