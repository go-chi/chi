# Agent Note: 运行状态行展示轮次阶段与已用时长

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-verbose-status-line.md) | 中文

## 问题

在轮次运行期间，[全屏 TUI](2026-07-17-dedicated-full-screen-tui-front-door.md) 只显示一个静态的 "Working" loader 动画。它既不表明当前步骤已耗时多久，也不表明 agent（智能体）正在做什么——等待模型、思考、流式输出回复，还是运行工具——因此运行缓慢或卡住的轮次与运行很快的轮次无从区分。

## 决策

- 轮次运行期间，编辑器上方的状态行显示一个派生的阶段标签及已用时长，并保留末尾的 `— Enter sends steering, Esc cancels` 提示。四个阶段及其标签为 `waiting` → "Waiting for the first token"、`thinking` → "Thinking"、`responding` → "Responding"、`executing` → "Executing tools"。
- 阶段是 TUI 从实时会话事件派生出的呈现状态，而非它自有的会话事件或 agent 状态。`step/start` 进入 `waiting`；`assistant/chunk` 的 reasoning 分片或 reasoning 块开始（`block-start`）进入 `thinking`；text 分片或 text 块开始进入 `responding`；`tool/call` 进入 `executing`。该事件映射可合并扩展，因此其余任何事件类型都落入默认分支，保持阶段不变。
- 标签汇报两个时钟——`<phase> <phase-elapsed> · total <step-elapsed>`——但 `waiting` 只显示步骤总时长。阶段时钟在真正发生阶段切换或进入新步骤时重置；步骤时钟在 `step/start` 时重置。时长在不足一分钟时格式化为 `8s`，达到或超过一分钟时格式化为 `1m05s`。`step/end` 与下一个 `step/start` 之间的工具时间计入结束步骤的总时长。
- 单一的 `RunningStatus` 控制器——loader、阶段、两个基准时刻以及一个刷新定时器——仅在轮次运行期间存在。一个每秒触发的 `setInterval` 刷新已用时长；阶段事件则立即刷新。`clearStatus` 清除该 interval、停止 loader 并丢弃控制器，因此任何向 idle 或 disposed 的转变都不会遗留活动定时器，与[无边框横幅](2026-07-21-tui-borderless-banner.md)的定时器清理保持一致。轮次进行中的调色板重建（终端颜色方案变化时 `setStatus` 会重新派生编辑器边框）会将阶段与两个基准时刻一并沿用过来，因此运行中的状态绝不会退回 `waiting`。

## 曾考虑的替代方案

**将阶段作为会话事件或 agent 状态发出。** 已否决：阶段是 TUI 从已记录事件重建出的呈现细节。一个持久、模型可见的阶段会依据 model-visible ⟺ logged 规则要求新增一个会话事件，而对模型没有任何好处。

**复用 pi-tui 的 `Loader` 动画定时器来刷新已用时长文本。** 不可行：`Loader` 是 vendored 依赖，只驱动其加载动画字形，其 dist 不归我们改动。TUI 自持一个独立的每秒 interval，并在拆卸时清除。

**从工具耗尽或流式组件状态推断阶段。** 已否决：`step/start`、`assistant/chunk` 和 `tool/call` 这些生命周期事件是更干净的信号，已在同一个实时监听器中处理，且避免让状态行与其他组件耦合。

**只显示已用时长，或只显示阶段。** 已否决：两者都需要——按阶段的时长回答 agent 在做什么，按步骤的总时长回答该步骤已耗时多久。

## 后果

- 状态行例如显示 `Thinking 4s · total 8s — Enter sends steering, Esc cancels`，从而 agent 的当前活动与步骤时长一目了然，卡顿也随之可见。
- 阶段检测是尽力而为的呈现：未处理的未来分片或事件类型会保持上一个阶段不变，绝不抛错。
- 每个活动轮次恰好运行一个 `setInterval`，在每次向 idle 或 disposed 的转变以及关停时随控制器一并清除。

## 测试

`packages/ui/tui/tests/tui.spec.ts` 针对触发事件锁定每个阶段标签（`step/start`、reasoning 与 text 的分片及块开始、`tool/call`），并锁定新步骤会重新开启等待窗口、已用时长在控制器自有定时器上超过一秒后递增、超过一分钟的步骤渲染为 `1m…`、轮次进行中的颜色方案变化会保留阶段与已用时长，以及轮次开始前到达的实时事件不移动任何状态。已在 tmux 中实机验证。
