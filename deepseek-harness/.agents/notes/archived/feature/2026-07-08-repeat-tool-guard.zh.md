# Agent Note: 重复工具调用守卫插件

Status: implemented
Archived: 2026-07-27

[English](2026-07-08-repeat-tool-guard.md) | 中文

## 问题

模型陷入循环时，会以字节级相同的参数反复发起同一个工具调用——重新运行一条失败的 grep、重新读取一个未变化的文件、轮询一条已经给出答案的命令——每一轮往返都消耗 token、挂钟时间以及（对付费 API 而言）金钱，却不带来新信息。harness 目前没有任何机制能察觉这一点：循环没有步骤预算，没有插件追踪调用重复，模型只有在碰巧改变自身行为时才能跳出。这种失败模式真实存在且检测成本极低——[pi-repeat-tool-guard](https://github.com/Kingwl/pi-repeat-tool-guard) 正是以 pi coding-agent 扩展的形式提供了这一功能：统计连续相同调用次数，超过阈值后追加一条 `<system-reminder>` 告诉模型停止重复并换个方向。

harness 已经具备 pi 扩展所使用的全部 seam，而且更好：[拦截 seam Agent Note](2026-06-30-interception-seams.md)赋予 `tools/post-execute` 一种经过认可的方式，将面向模型的上下文附加到已完成的调用上；循环缓冲并注入该上下文，同时保持调用/结果的邻接关系；注入的上下文是一条已记录的 `context/message`——因此原生守卫无需新增会话事件即可满足「模型可见 ⟺ 已记录」规则。缺少的只是插件本身。

## 决策

该守卫是一个循环卫生插件，而非面向模型的工具。它统计对同一工具以相同规范化参数发起的连续调用次数，并在配置的阈值处注入建议性提醒。它从不延迟、阻止或改写调用；模型自行决定是换种方式重试还是结束。

插件为 `@deepseek-ai/dsh-repeat-tool-guard`，位于 `packages/guard/repeat-tool-guard/`，开辟 `guard/` 分组用于循环卫生插件（单包（package）分组有先例：[todo-write Agent Note](2026-06-29-todo-write-tool.md)发布了 `todo/tool-todo`）。它注册两个监听器，将状态保存在以存活 `Agent` 对象为键的 `WeakMap` 中——工具注册表是上下文级别的单例，其 waterfall（瀑布式事件）交错所有 agent（智能体）的调用（subagent 运行在同一个上下文上），因此按 agent 分键是正确性要求，而非锦上添花；弱对象键还使得纯清理用途的 disposal 监听器不再必要。

- **`tools/post-execute`（waterfall）**——唯一的检测点。监听器同时接收 `(exec, result)`，因此计数和提醒投递无需跨事件的 pending map（pi 扩展需要它，仅因为其 `tool_call`/`tool_result` 钩子是分开的事件）。它始终通过 `next()` 委托，当命中阈值时，将提醒前置到下游决策的 `additionalContexts`——这正是[钩子桥接](2026-06-30-hook-bridges.md)已采用的「观察并丰富」姿态，遵守 waterfall 契约。计数放在此处而非 `tools/pre-execute`，因为 post-execute 也会为被拒绝的调用触发（`ToolRegistry.execute` 将 deny 路由到同一条流水线），而模型反复敲击一个被拒绝的调用恰恰是值得打破的循环。
- **`agent/prompt-submit`（waterfall）**——纯重置钩子：通过 `next()` 委托，清除提交 agent 的链。用户介入改变了上下文；跨越介入的重复不是循环。

### 检测语义

链的键是 `(tool name, canonical arguments)`；与前一个被追踪调用相同的调用递增该 agent 的连续计数器，不同的被追踪调用将其重置为 1。规范化方式为深度键排序加 `JSON.stringify`：`ToolExecution.arguments` 按构造就是循环中 `JSON.parse` 的输出（或格式错误的参数 JSON 的原始字符串回退，其本身也是可比较的值），因此 pi 原版对 bigint/循环引用/`undefined` 的处理在此没有输入，被有意去除。

两条刻意的规则，均记录在[包 README](../../../../packages/guard/repeat-tool-guard/README.md) 中，因为它们是读者否则只能猜测的行为：

- **未追踪的调用对链透明。** 被 `include`/`exclude` 排除的调用既不递增也不重置计数器，因此 `grep X → todo_write → grep X` 在 `todo_write` 被排除时仍计为两次连续的 `grep X`。这正是排除功能有用的原因——穿插在循环中的簿记工具不得为循环洗白——也是 pi 扩展的（未文档化的）语义，有意保留并明确写下。
- **没有 agent 的调用被忽略。** 直接调用 `ctx.tools.execute()` 的调用方（测试、非循环消费方）没有可提醒的模型，也没有可作键的存活 agent 对象。

### 提醒投递

提醒作为独立条目搭载在 `additionalContexts` 上（source 为 `{kind: 'plugin', plugin: 'repeat-tool-guard'}`——依照 `HookContext`，该标签承载语义），绝不替换 `content`：`tool/result` 事件仍是工具自身的审计输出，循环则在步骤结果之后把缓冲的上下文追加为 `context/message`，会话将其渲染为带标签的合成 user 信封，并由派生历史回放。阈值逐级升级：第一个配置阈值获得简短的「你正在重复自己，请分析先前结果」提示；后续各阈值获得详细形式，包含工具、重复计数和规范参数（在头部截断到 `argumentsPreviewChars`，默认 500——循环中的 `write` 级 payload 不得无界地进入下一次请求；链键始终比较完整规范字符串），并说明这些调用没有取得进展。pi 原版把温和文本硬编码为字面计数 3；本守卫以 `thresholds[0]` 为键，修复了移植中的这一 bug。下游钩子桥贡献仍是独立数组条目，因此两个插件都保留各自的 source、信封与元数据。

### 配置

```yaml
- id: repeat-tool-guard
  name: '@deepseek-ai/dsh-repeat-tool-guard'
  config:
    thresholds: [3, 5, 8]        # default; consecutive counts that trigger a reminder
    include: []                  # tool-name patterns to track; empty ⇒ all tools
    exclude: [todo_write]        # tool-name patterns transparent to the chain
    argumentsPreviewChars: 500   # default; cap on arguments quoted in the detailed reminder
```

`thresholds` 在加载时校验，遇到空列表、非整数、小于 2 的值或重复项时抛出异常——配置错误快速失败，取代 pi 原版的静默回退到默认值。`include`/`exclude` 条目支持 `*` 通配符。模式是对调用时实际存在的工具的谓词，而非对注册表条目的引用，因此匹配不到当前已注册工具的条目不是错误——与 `toolOrder` 的引用检查不同，`exclude: [mcp_*]` 在未加载 MCP 工具的部署中也必须保持有效。

## 测试

- **单元测试：** 使用脚本化适配器的真实循环，覆盖计数与重置规则、未追踪透明性、dispose（资源释放）清理、按 agent 隔离、规范化参数键序、升级、被拒绝的调用、无 agent 执行、通配符转义、无效配置，以及下游阻止或 replacement 决策，达到逐文件 100% 覆盖率。
- **快照测试：** keyless 的 `repeat-tool-guard` 场景发起五次相同的 `todo_write` 调用，在 ACP 输出和会话日志中固定第三次调用的温和提醒与第五次调用的详细提醒。该插件在实时示例中加载，但在其他场景中保持静默。
- **E2e 测试：** 无。该插件是确定性的且与提供方无关，其 seam 契约由各自的所有者覆盖。

## 曾考虑的替代方案

- **将提醒追加到工具结果中**（以替换 `content` 的方式 `accept`——pi 扩展的机制，它修补结果内容是因为那是其 API 提供的唯一通道）：否决。这会让已记录的 `tool/result` 对工具实际返回的内容撒谎，而 `additionalContexts` 是 post-execute 评注的独立认可通道，循环级缓冲保持了调用/结果的邻接关系。
- **在 `tools/pre-execute` 中计数并使用 pending-reminder map**（pi 的两阶段形态）：否决。post-execute 单独就能同时看到 `(exec, result)` 且也为被拒绝的调用触发，因此一个监听器、无跨事件状态即可以更少的机制覆盖严格更多的尝试。
- **在最高阈值升级为 `block`**：在初始范围内否决。阻止调用会惩罚合法的相同重复（轮询长时间运行的终端、重新检查 agent 预期会变化的文件），而建议性提醒让模型保持控制权。待有证据后重新审视；决策形状（`PostToolDecision`）已支持此选项。
- **通过 CC/Codex 桥接的逐部署外部钩子**（一个 `PostToolUse` 脚本）：否决作为最终答案。它对单个部署有效，但一个已发布、有单元测试、可通过 `cordis.yml` 配置的插件才是 harness 原生的形式，且没有逐调用的子进程开销。
- **在 `agent-loop` 中设置循环级步骤或重复预算**：否决。「用插件，不改循环」；硬性步骤预算是一种更粗粒度的正交控制，需要自己的提案。
- **模糊/近似相同检测**（路径归一化、相似但不完全相同的参数）：否决。规范化后的精确匹配成本低、确定性强、且可向模型解释；相似度阈值引入误报风险，需要证据才能换取复杂度。
- **将包放在 `core/`**：否决。core 是产品主干；行为守卫是可选的叶子插件，`todo/` 的先例是每个插件族一个小型专属分组。

## 后果

- 提醒在设计上是建议性的：有意重复相同调用的幂等轮询模式仍会在超过阈值后收到提示，减压阀是配置（`thresholds`、`exclude`）加上明确允许「在已收集足够证据时结束」的提醒文本。每次触发在下一次请求中增加提醒 token 的开销；阈值限制了触发频率。
- 链状态仅存于内存：从持久化恢复的会话以全新的链开始，因此跨越恢复的循环比实时循环更晚收到提醒——可以接受，守卫是启发式提示而非已记录的不变式，持久化计数器状态带来的收益不值得其复杂度。
- 当多个 post-execute 生产者在同一次调用上附加上下文时，每项贡献保持为独立的 `HookContext`；顺序遵循 waterfall 嵌套关系，每个条目保留自己的溯源信息。
- 实现快照层时暴露了 suite kit 的一项隐藏假设：fixture guard 把「撰写的模型场景」等同于「由 override 驱动」。`Scenario` 表现在携带显式的 `overridden` 标志，并且 sidecar 是否存在会以双向方式与其核对（未注册的游离 sidecar 会静默替换派生脚本）——suite kit 比本插件出现前更严格。

## 延后事项

- 压缩（compaction）不重置链：压缩后的历史改变了模型所见的内容，但重复风险通常在压缩后仍然存在。
- 在高阈值升级为 `block` 未实现；`PostToolDecision` 已支持此选项，待证据到来时启用。
- subagent 的链按 agent 隔离；在出现具体用例之前不提供共享机制。
