# dsh-system-prompt

[English](README.md) | 中文

系统提示词组装注册表。插件可以贡献有序段、工具 schema 和具名变量。循环在每个步骤组装一次，并将结果渲染为完整的模型提示词。此插件拥有静态 harness 身份和全局部署 persona；agent（智能体）作用域的 persona 会遮蔽全局默认值。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `includeHarnessIdentity` | `true` | 是否包含顺序为 −100 的固定开场白 `You are an AI agent powered by DeepSeek Harness.`。仅当兼容性部署拥有完整系统提示词时设为 false。 |
| `includeRuntimeContext` | `true` | 是否在组装中包含有序动态上下文。设为 false 时不会求值上下文提供方，并会在 waterfall 后丢弃 `system-prompt/assemble` 监听器添加的上下文；其他服务及其强制机制仍然生效。 |
| `persona` | `''` | 全局部署 persona 默认值：唯一由配置提供的提示词片段，渲染为顺序为 0 的 `deployment:persona` 段，除非 agent 作用域的贡献将其遮蔽。它是模板，完整的 `{{…}}` 组会严格按已注册变量解释（随附循环注册 `{{model}}`/`{{cwd}}`），目前没有表达字面量花括号的转义语法。为空 ⇒ 渲染时删除该段。 |
| `toolOrder` | 无 | 显式指定面向模型的工具顺序。该列表由 `ToolSchema.name` 组成，并且必须恰好包含一个 `'<unlisted-tools>'` 其余项标记（`TOOL_ORDER_REST`）：已列工具按列表位置排列，未列工具则按名称字典序插入该标记所在的位置。缺席 ⇒ 直接按名称字典序排列。该顺序会在 `system-prompt/assemble` waterfall（瀑布式事件）之前应用于已收集的工具。与段的 `order` 排序一样，它会规范化注册表贡献的内容；注册顺序只是插件加载时序的产物。修改列表的 waterfall 监听器对其输出的确定性负责。配置错误会明确失败：列表没有恰好一个其余项或存在重复项，会在加载时抛出；已列名称没有对应已注册工具，会使每次 `assemble()` 被拒绝；工具提供方返回保留的其余项名称也会被拒绝。在随附循环下，轮次会在任何模型请求前失败。为何采用中心列表而非每插件权重，见[显式面向模型工具顺序](../../../.agents/notes/implemented/feature/2026-07-06-explicit-tool-order.md)。 |

## 服务：`SystemPrompt`（ctx 键：`systemPrompt`）

### 公开 API

- `ctx.systemPrompt.section(section: PromptSection): () => void`：贡献一个段。层由调用上下文的作用域决定：`agent.ctx` 只为该 agent 贡献，并在该处遮蔽同名全局段。一个 `complete: true` 段会在组装 waterfall 之后成为精确的完整提示词；有效 complete 段超过一个时，组装会被拒绝。同一层中的重复名称和非有限顺序会抛出。随调用 fiber 一并 dispose（资源释放）。
- `ctx.systemPrompt.context(context: PromptContext): () => void`：为调用作用域贡献有序动态上下文。每次符合条件的组装都会求值提供方，并在随附循环下成为模型历史中带来源的 runtime-context 快照。
- `ctx.systemPrompt.suppressRuntimeContext(): () => void`：抑制调用作用域的所有动态上下文贡献。多个注册会独立组合；只有当不再存在抑制器时，dispose 返回的 effect 才会恢复上下文。
- `ctx.systemPrompt.tools(provider: (context: AssembleContext) => ToolProviderResult): () => void`：贡献工具 schema；每次组装时使用该次组装的上下文求值。`ToolProviderResult` = `{ schemas, knownNames? }`：`schemas` 是限制后的可见集合；`knownNames` 是限制前由 `toolOrder` 使用的全集。提供方不得返回名为 `TOOL_ORDER_REST` 的 schema。带作用域提供方只在其作用域的组装中查询。随调用 fiber 一并 dispose。
- `ctx.systemPrompt.variable(name: string, provider: (context) => string | undefined): () => void`：贡献提示词变量，在段文本中以 `{{name}}` 引用。带作用域变量会为该 agent 遮蔽同名全局变量。同层重复或无法引用的名称会抛出；`undefined` 表示「本次组装没有值」。随调用 fiber 一并 dispose。
- `ctx.systemPrompt.assemble(context?: AssembleContext): Promise<PromptAssembly>`：为一个调用方组装提示词：将全局层与 `context.scope` 的层合并，并在变换 waterfall 前分离工具 schema。它经过按作用域筛选的 `system-prompt/assemble` waterfall，之后将一个有效的 complete 段恢复为唯一的提示词段，并实施任何活动的 runtime-context 抑制器。可选的 `context.signal` 显式控制本次组装请求；提供方与监听器可以配合该信号，但不得将它保留给另一轮次。存在多个 complete 段、已配置的 `toolOrder` 指名提供方 `knownNames` 全集以外的工具，或提供方返回保留的其余项名称时，调用会被拒绝。

<a id="live-events"></a>

### 实时事件

普通段以 `system-prompt/assemble` 的返回结果为准；complete 段则会在 waterfall 之后作为最终提示词约束生效。替换条目的监听器必须保留任何已启用的 Code Mode 或结构化输出协议。筛选需要在呈现、查找与执行之间保持一致时，应使用 [`ToolRuntime.restrict()`](../tools/README.md)。注册表变更通知不经过筛选。[system-prompt.md](../../../docs/subsystems/system-prompt.md#cordis-surface) 的生成区块拥有事件签名和分发约定。

### 关键类型

- `AssembleContext`：说明一次 `assemble()` 调用的用途。它可通过合并扩展；此处声明 `scope?: ScopeKey`（层选择器）与 `signal?: AbortSignal`（显式请求控制能力），而 `dsh-agent` 声明 `agent?: Agent`（类型化 DX 字段；绝不能在没有 `scope` 时设置，应使用 `assembleContextFor(agent, signal)`）。提供方必须容忍字段缺席，因为裸 `assemble()` 携带的是无作用域、无信号的空上下文。`signal` 是请求值，不是环境 Agent 执行 frame 的一部分。
- `PromptSection`：`{ name, order, text, complete? }`。各段按 `order` 升序拼接。顺序区间：`-100` 是 harness 身份，`0` 是部署 persona，工具引导使用 `100–199`。协作式组装完成后，一个有效的 `complete` 段会抑制其他所有段。
- `PromptAssembly`：`{ sections: AssembledSection[], tools: ToolSchema[], variables: Record<string, string | undefined> }`。各段文本到达时已求值，但尚未插值；`variables` 保存所有已注册变量在当前上下文中求得的值。工具 schema 按设计属于组装结果：「模型获知自己能做什么」是一个连贯整体，尽管适配器把 schema 作为独立 wire 字段传输。
- `renderPrompt(assembly)`：插值每个段中的 `{{variable}}` 引用，删除空段，并用空行连接。严格规则：未知引用（使用 `Object.hasOwn` 查找，因此 `{{constructor}}` 等原型名称未知）、已注册但无值的引用、格式错误的完整 `{{…}}` 组，或出现 `{{` 却没有形成完整组、而后文仍有 `}}`（`{{{model}}}`），都会抛出异常；明确失败胜过交付格式错误的提示词。孤立的 `{{` 如果后面任何位置都没有 `}}`，会按字面量通过；替换值绝不再次扫描。

可通过合并扩展：插件可以借助声明合并，为 `PromptAssembly` 和 `AssembleContext` 声明额外字段。

### 扩展点

- 段提供方：工具包拥有自身的跨调用指导（`tool:bash`、`tool:read` 等）；此插件拥有 `harness:identity` 与 `deployment:persona`。
- 变量提供方：agent loop（智能体循环）注册 `model` 与 `cwd`；任何插件都可以注册自己拥有的事实（未来的 `date`、git 状态等）。
- 工具 schema 提供方：`ToolRuntime` 自动将自身注册为工具提供方。
- [`system-prompt/assemble` waterfall](#live-events)：按调用方协作式修改或替换组装结果，之后再实施 complete 段约束。

设计原理：[提示词变量 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md)。

## 模型体验

### 系统提示词

#### 模型看到的内容

默认情况下，每次组装都从下方 harness 身份开始，然后在严格变量插值后追加已配置 persona 与有序插件段。`includeHarnessIdentity: false` 仅省略这个固定开场白。空段会消失；带作用域的段和变量可以为一个 agent 遮蔽全局项。`system-prompt/assemble` waterfall 决定交付的提示词与工具 schema，除非一个有效段声明自身为 complete；此时，该确切段会成为完整的系统提示词，而 waterfall 得到的上下文、工具和变量保持不变。有序动态上下文与系统提示词段分离，只在存在时才会成为带来源的 user 角色快照。`includeRuntimeContext: false` 或带作用域的抑制器会移除所有这类上下文，包括监听器添加的内容，但不会禁用拥有底层策略或状态的服务。

##### harness 身份

```markdown
You are an AI agent powered by DeepSeek Harness.
```

#### Token 影响

启用时，身份是每次请求的固定成本。Persona 与插件文本在每次请求中重复，成本随渲染内容增长。

#### KV Cache 影响

只要身份、persona、变量、段文本与顺序的渲染完全相同，前缀就保持稳定。任何变更都可能从第一个变化的系统提示词 token 起使复用失效。

### 工具 schema

#### 模型看到的内容

对于已交付工具，模型会收到[生成工具 schema](../../../docs/tool-catalog.md#tool-package-map) 中对每个 agent 可见的子集；限制与组装拦截完成后，按配置或字典序排列。扩展可以通过同一注册表贡献其他定义。段与 schema 提供方是独立的组装输入，因此工具限制不会移除独立注册的引导。

#### Token 影响

schema token 在每次请求中重复。限制工具会为该 agent 移除其全部 schema 成本，但不会移除独立提示词段；重排序会改变缓存形状，但不改变语义内容。

#### KV Cache 影响

只要可见 schema 集合、渲染与顺序不变，前缀就保持稳定。注册、限制或重排序可能从第一个变化的 schema token 起使复用失效。

## 已知限制与暂缓事项

- **部署方编写的提示词文本只来自配置／组合**：此插件拥有全局 persona 默认值；创建方插件可以注册 agent 作用域的遮蔽项；其他段来自拥有相应事实的插件。不存在终端用户提示词编辑 API。
- **没有表示字面量 `{{…}}` 花括号的转义语法**：每个完整组都会按已注册变量插值；只有实际提示词需要转义时才会实现。
- **`toolOrder` 配置错误在提示词组装（首轮）时出现，而不是启动时**：只有形状违规会在配置加载时抛出。
- **共享同一 `order` 值的段按注册顺序打破平局**：这是插件加载产物；确定性依赖在顺序分段内使用不同值的约定，与已规范化的工具顺序不同。
