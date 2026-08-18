# Agent Note: TUI 页脚展示会话缓存命中率

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-footer-cache-hit-rate.md) | 中文

## Problem

页脚原本把会话的 token 用量汇总为 `↑<input> ↓<output>`，其中 `↑` 是模型上报的未缓存输入。`TokenUsage` 的各项计数互不重叠：计费的输入 token 由 `inputTokens`（未缓存）加上 `cacheReadTokens` 与 `cacheWriteTokens` 构成。只暴露未缓存的那个数字，用户就无从判断每轮提示词有多少由提供方缓存承接——而这恰是最能反映复用的请求前缀是否奏效的信号。在以缓存读取为主的长会话里，`↑` 始终很小，掩盖了提示词其实很大但很便宜的事实。

## Decision

页脚在 `↑<input> ↓<output>` 之后追加 `cache <rate>%`，该比率是计费输入 token 中由提供方缓存承接的占比。

- `TokenTotals` 累加四个互不重叠的桶（`input`、`output`、`cacheRead`、`cacheWrite`）。`addUsage` 把单次调用的 `TokenUsage` 折入总量，缺失的 `cacheReadTokens`/`cacheWriteTokens` 视为零。
- `cacheHitRate(totals)` 为 `round(cacheRead / (input + cacheRead + cacheWrite) * 100)`，在尚无输入计费前返回 `undefined`。比率为 `undefined` 时 `FooterComponent` 整段略去 `  cache N%`，因此空会话不会显示无意义的零。
- `↑` 仍表示未缓存输入，而非计费输入：页脚全程遵守互不重叠的桶约定，缺失的复用信号由缓存百分比补足。
- 挂载时由 `sessionTokens` 重建总量，它对带 usage 的 `assistant/message` 事件求和（绝不用 `assistant/chunk`，以免重复计数）；此后每条携带 usage 的 `assistant/message` 事件都会实时更新。

## Alternatives considered

**把计费输入（`input + cacheRead + cacheWrite`）作为 `↑`，不单列百分比。** 否决：这会让 `↑` 偏离 harness 其余部分上报的互不重叠 `inputTokens` 桶，且仍旧藏住用户真正想要的复用占比；派生一个百分比既补上信号，又不给计数加载额外含义。

**用全部 token（`input + output + cache`）作分母计算比率。** 否决：输出 token 从不由缓存承接，把它折进分母只会无意义地拉低比率；缓存命中率是提示词的属性。

**从分母里去掉 `cacheWrite`。** 否决：缓存写入是提供方为填充缓存而付费的计费输入，剔除它会在写入的那一轮高估命中率。DeepSeek 目前不上报缓存写入指标，但公式保持通用，写入路径也有覆盖。

**在空会话上渲染 `cache 0%`。** 否决：此时计费输入为 `0`，比值是 `0/0`，在全新会话上打出 `0%` 是对一个尚不存在的值撒谎；在输入计费之前该段一直隐藏。

**给该指标单独一个右对齐的页脚元素，紧挨 `tools:`。** 否决：它派生自相邻的 token 计数，按 `input → output → cache` 的顺序阅读最顺；左置分组还让优先级更低的 `tools:` 指示成为宽度紧张时最先被裁剪的元素，与页脚既有的布局优先级一致。

## Consequences

- 左段增加了 `  cache N%`，因此窄终端上右侧的 `tools:` 状态更早被裁剪。这沿用页脚既有的左段优先裁剪策略，是可接受的取舍。
- 该指标是从 `assistant/message` 的 usage 派生的尽力而为实时 UI 状态：挂载时从会话重建、随后实时更新、从不持久化。
- `packages/ui/tui/src/index.ts` 保持 100% 单文件覆盖率。
- `examples/tui-agent` 终端快照带有该段：有缓存读取的一轮渲染为如 `cache 49%`，首个冷启动轮次渲染为 `cache 0%`。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 通过真实的 `createTuiChat` 驱动页脚：空会话渲染 `↑0 ↓0` 且无缓存段（隐藏路径），冷启动一轮（仅 `inputTokens`）渲染 `cache 0%`，随后实时的热轮次携带 `cacheReadTokens` 与 `cacheWriteTokens`，把它更新为 `cache 60%` 且不再显示 `cache 0%`。`examples/tui-agent` 快照套件对已录制的预期输出回放通过。
