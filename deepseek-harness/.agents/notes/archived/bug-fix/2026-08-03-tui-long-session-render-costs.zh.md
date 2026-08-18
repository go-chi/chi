# Agent Note: TUI 长会话渲染开销：共享步骤耗时扫描与卡片行缓存

Status: implemented
Archived: 2026-08-04

[English](2026-08-03-tui-long-session-render-costs.md) | 中文

## 问题

在一个恢复后的长会话（196k 条事件、2.2k 个步骤、1.8k 张工具卡片）中，TUI 渲染 transcript（文本记录）耗时约 12 秒，回显一次按键耗时约 800 毫秒。性能剖析表明，两项耗时都来自渲染路径，而非会话加载（zstd + 解析 + 表层播种约为 1.7 秒）：

- 每个步骤的耗时页脚都会调用 `stepTimingAt`，而它会针对每个页脚从索引 0 起回放整个事件日志，因此初次渲染的复杂度为 O(步骤数 × 事件数)，占用约 6 秒 CPU 时间。
- pi-tui 每一帧都会重新渲染所有组件，并依赖各组件自己的行缓存（它的 `Text`/`Markdown` 会按 `(text, width)` 缓存）。`ToolCardComponent.render()` 和 `ContextCardComponent.render()` 构造用后即弃的 `new Text(...)`/`new Markdown(...)` 实例，且构造发生在 `render(width)` 内，因此每一帧，也就是每次按键，都会重新对每张已结算卡片的输出进行折行。

## 决策

`packages/ui/tui/src/chat/timing.ts` 不再使用 `stepTimingAt`，改用 `StepTimingTracker`：每次挂载聊天界面时在 `createTuiChat` 中创建一个累加器，再经 `StreamingAssistantComponent` 传入每个 `StepTimingComponent`。每次查询都会推进游标，扫描上次查询后追加的事件，并在一个映射表中保存各步骤的 bucket 状态，因此所有页脚合计只需 O(事件数)。查询时，系统把未闭合 bucket 累加到查询时刻；步骤在其 `step/end` 处固定。该跟踪器要求会话日志仅追加，即遵守 `seq = log length` 契约。

`ToolCardComponent` 和 `ContextCardComponent` 按宽度键控缓存渲染行。调用任一状态修改方法（`updateResult`、`setVisibility`、`setExpanded`）或 `invalidate()`（pi-tui 的全树级联）时会清空缓存，因此状态变化一定会重新渲染；其他情况，包括每一次按键帧，都会返回缓存行。这恢复了上游 pi 自身的组件惯例：使用常驻子组件；自定义渲染时显式使用 `cachedWidth`/`cachedLines`，例如 pi `coding-agent` 的 `bash.ts`。而这里命令式的 `render(width)` 函数体此前让这套惯例失效。

在该 196k 条事件的会话上测得（tmux，200×50）：恢复后提示符就绪耗时从 12.2 秒降至 7.2 秒；每次按键的回显耗时中位数从 796 毫秒降至 17 毫秒（与新会话持平）。

## 曾考虑的替代方案

- **索引 `step/start` 偏移量，保留逐页脚回放**：这会消除 `findIndex`，但每个页脚仍要从共享数组扫描所属步骤的区间；跟踪器的一次共享遍历以更少的额外状态记录取得相同的复杂度改进。
- **把卡片重构为常驻 pi-tui 子组件**（上游 pi 的主要风格）：稳定状态下成本相同，但卡片状态处理所需改动更大，相较按宽度键控的缓存并无额外收益。
- **在 pi-tui 的 `Container.render` 内缓存**：层级不对：对第三方内嵌代码的补丁范围会扩大，而上游已经约定由组件拥有各自的缓存。

## 后果

- 输入延迟不再随工具输出总量增长；剩余的每帧成本是 pi-tui 的树遍历与行拼接，与渲染行数呈线性关系。恢复时的渲染成本现由 pi-tui 的一次性初始布局（196k 条事件时约 4 秒）与加载（约 1.7 秒）主导，两者均为线性。
- 该跟踪器直接采用日志记录的事件时间，不再像已移除的实现那样，在扫描中途遇到 `time > at` 时截断；由于每个页脚的 `at` 值不同，共享扫描无法采用这种截断；挂钟时间倒退时，每个 bucket 都以零为下限，所得总计值可能与旧截断下的总计值不同。
- 卡片的 `render()` 不再是每次调用时 `(state, width)` 的纯函数，状态修改方法必须清空 `linesCache`。若新增状态修改方法时忘记清空，界面会显示陈旧行；`packages/ui/tui/tests/transcript-card-cache.spec.ts` 中的缓存测试固定了现有状态修改方法的契约。
- `StepTimingTracker` 假定步骤坐标在 `step/end` 后不会复用；对已关闭步骤重复出现的 `step/start` 会被忽略，不会重新启动该步骤。
