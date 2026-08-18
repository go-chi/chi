# dsh-tools

[English](README.md) | 中文

工具注册表与执行流水线。工具插件注册各自的 schema 和执行器；agent loop（智能体循环）依次让每次调用经过 `tools/pre-execute`（可扩展的允许／拒绝门禁）→ 已注册的单调守卫 → `tools/execute`（供超时／重试／指标插件使用的环绕分发包装层）→ `tools/post-execute`（检查／替换结果、附加上下文）→ 由工具定义持有的 `finalizeContent` 边界 → 仅观测的 `tools/result` 通知。注册表还决定以何种方式向模型呈现工具：`mode` 配置可以选择原生 Function Calling（函数调用）、[Code Mode](#code-mode)，或同时选择两者；单个 agent 可用 `presentAs` 为自己遮蔽该默认值。

## 服务：`ToolRuntime`（ctx 键：`tools`）

### 配置

```yaml
tools:
  mode: native   # native (default) | code | both
```

`native` 以函数定义的形式贡献可见工具。`code` 会提供保留的 `run_code` 传输、生成的 `tools:sdk` 段，以及声明「只有 `run_code` 可被直接调用」的 `tools:code-only` 规则。执行器随后强制执行该规则：模型直接调用其他任何工具时，会在策略运行前将该调用解析为 `UNKNOWN_TOOL`；`both` 同时提供两种形式，且不声明该规则，因为其中的原生调用确实可以执行。没有单独声明呈现模式的 agent 默认采用此配置；agent preset 可通过 [`dsh-agent-tool-presentation`](../agent-tool-presentation/README.md) 自行选择呈现模式。不能注册、遮蔽、限制或移除该保留传输，且无论配置何种模式，该名称都是保留的，因为任何 agent 都可能选择 code 模式。非原生模式要求所加载 `ctx.codeRuntime` 的 `language` 有已注册的 SDK 渲染器——TypeScript 经 [`dsh-code-runtime-worker-thread`](../../code-runtime/code-runtime-worker-thread/README.md) 交付；Python 渲染器内置，驱动任何报告 `language: 'python'` 的运行时（第一方 `dsh-code-runtime-python` 后端另行交付）。没有渲染器的运行时语言会导致提示词组装明确失败；如果 `systemPrompt.toolOrder` 条目指向当前模式未贡献的工具，系统会拒绝组装提示词。`system-prompt/assemble` 监听器可以替换注册表贡献；它返回的组装结果具有权威性，因此该监听器负责保留可用的 Code Mode 协议。

### 公开 API

- `ctx.tools.register(definition: ToolDefinition): () => void`：注册一个受信任、带类型的同进程定义，其中必须包含规范的 `output` 声明。所在层由调用上下文的作用域决定：普通插件上下文会全局注册；agent 的 `agent.ctx` 只为该 agent 注册，并在此处遮蔽同名全局工具。同一层内名称重复会抛出；非原生模式还会拒绝保留的 `run_code` 传输名称。缺失或不受支持的输出声明，以及非正数或非有限的 `timeoutMs`，都会使注册失败。可选的同步 `finalizeContent` 回调会在调用开始时纳入快照；在所有流水线结果（包括实体化其他结果字段时发现的错误）规范化之后，它只能替换最终面向模型的内容。该注册会随调用方 fiber 一同 dispose（资源释放）。
- `ctx.tools.presentAs(mode: ToolPresentationMode): () => void`：为本 agent 选择面向模型的呈现方式，仅对该 agent 遮蔽 `mode` 配置；从普通上下文调用会抛出（进程级呈现方式是那个配置字段），同一 scope 内第二次声明也会抛出。code 类模式还会为该 agent 注册它自己的 `tools:sdk` 段。工具目录保持不变：`schemas(agent)` 仍会报告该 agent 的能力；只有组装结果中的工具列表会按所选呈现方式收束。随调用方 fiber dispose。
- `ctx.tools.restrict(filter)`：对全局工具应用 agent 作用域的允许／拒绝掩码；从普通上下文调用会抛出。筛选器在注册时创建快照；多个掩码取交集，随后再合并作用域本地工具。拒绝掩码会接纳后来出现且未点名的全局工具，而允许掩码会排除后来出现的名称。未知、本地或保留名称以及空筛选器都会被拒绝。这是实时可见性组合，不是权限边界；参见[作用域安全非目标](../../../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals)。
- `ctx.tools.get(name: string, scope?: ScopeKey): ToolDefinition | undefined`：返回指定作用域可见的解析结果，其中已应用名称遮蔽；被作用域限制排除的全局工具会被视为不存在。呈现器会传入发起调用的 agent，使卡片与实际执行内容一致。
- `ctx.tools.schemas(scope?: ScopeKey): ToolSchema[]`：返回该作用域可见的所有 schema（不含 `execute` 函数）。已交付工具的 schema 收录在 [docs/tool-catalog.md](../../../docs/tool-catalog.md) 中；该目录通过启动每个工具插件并采集此方法的结果生成（参见[工具 schema 目录 Agent Note](../../../.agents/notes/implemented/process/2026-07-02-tool-schema-catalog.md)）。
- `ctx.tools.guard(guard: ToolGuard): () => void`：在 `tools/pre-execute` 之后注册单调同步执行守卫：返回理由会拒绝调用，返回 `undefined` 则保持原决定。普通上下文守卫全局生效；`agent.ctx` 守卫只对该 agent 生效。后续 waterfall（瀑布式事件）监听器无法将守卫的拒绝重新变为允许。随调用 fiber dispose。
- `ctx.tools.execute(exec)`：以无损方式快照并冻结参数，分配不透明 token，运行完整的策略／分发／结果流水线，然后在最终观测前独立快照权威结果。无效参数会进入同一结果路径，但不会到达策略或工具主体。环绕包装层只能替换 `signal`；注册表会在进入工具主体之前，立即将调用方的原始信号重新合并到当前信号中。
- `ctx.tools.executionMode(exec)`：返回 `parallel` 的唯一条件是可见定义的 `isConcurrencySafe(exec.arguments)` 分类器恰好返回 `true`；未知、隐藏、未声明、无效或抛出异常的分类结果均为独占。

### 注入的服务

`SystemPrompt`：注册表通过 `ctx.systemPrompt.tools()` 自动将工具 schema 送入系统提示词组装。审批 seam 则在可用时使用（`ctx.get('approval')`，无静态注入）：未部署该 seam 时仍会将询问退化为拒绝，而无论是否存在该 seam，注册表都会保持活动。

### 取消

取消采用协作方式，并等待完全停稳。每次类型化调用都提供由调用方拥有的 `AbortSignal`；工具主体通过必填的只读 `exec.signal` 接收它，只有 `tools/execute` 包装层可以临时替换这个必填信号。注册表会在替换期间保留调用方取消，并且绝不会在已启动的同进程 Promise 尚未结算时提前返回。工具主体调用前发生的取消为 `ABORTED_BEFORE_DISPATCH`；工具主体被调用后发生的取消，只能将成功结果替换为 `ABORTED`。拒绝、包装层失败、工具失败、后置策略失败或由超时机制产生的 `TOOL_TIMEOUT` 仍保留更具体的结果。入口处已中止的调用会实体化并冻结参数，随后跳过所有策略和分发阶段，只发布一个结果。每个异步工具都必须观测或转发该信号，并且只能在其负责的工作停止后结算。[工具取消 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-19-cooperative-tool-cancellation.md) 规定完整约定和强制终止边界。

### 实时事件

实时注册表流水线先经过 3 道可转换的 waterfall，再经过由工具定义持有的内容终结器，最后发布仅供观测的 `tools/result` 事件；注册表变更通知有意不作过滤，并作为共享状态通知发布。确切签名、分发 mode、作用域筛选和失败隔离约定位于 [tools.md](../../../docs/subsystems/tools.md#cordis-surface) 的生成区块，完整顺序则在生成的[工具执行流水线](../../../docs/tool-execution-pipeline.md)中可视化。`tools/result` 是实时事件；名称相近的 `tool/result` 是 agent loop 随后追加的持久会话事件。

### 关键类型

- `ToolDefinition`：`ToolSchema` + 必填的 `output { schema, render, presentationMeta? }` + `execute(args, exec)`，以及可选的最终内容回调、呈现回调、协作式 `timeoutMs` 和逐调用的 `isConcurrencySafe(args)` 分类器。主体只能返回输出 schema 声明的规范 JSON 值，并通过 `exec.signal` 协作停止。`finalizeContent(exec, result)` 对每个规范化结果都恰好运行一次，包括绕过后置策略的失败，并且只能替换 `content`；它必须是同步且对所有输入都有定义的函数。
- `ToolExecutionInput`：调用方提供的调用描述：`{ callId, name, arguments, signal, agent?, parent? }`；`signal` 必填且只读，调用方可以将外层执行的不透明 token 作为 `parent` 传入，但绝不能选择新执行自身的 token。
- `ToolExecutionToken`：注册表分配的全新带品牌 `Symbol`。它只支持通过相等性进行关联，绝不会跨越模型、日志或 worker 边界。
- `ToolExecution`：只读流水线视图：不可变的 `{ token, callId, name, arguments, signal, agent?, parent? }`；注册表会另行保留并重新融合调用方的原始信号。`ToolDispatchExecution` 是仅供 `tools/execute` 使用的视图，其必填信号可变，因此包装层可以替换并还原它，但不能删除它。嵌套调用的 `parent` 是 `ToolExecutionToken`，而不是执行对象。
- `ToolRunContext`：传给工具主体的执行上下文，在 `ToolExecution` 基础上增加 `deferContext(context)`。它把一条上下文推迟到该工具的最终结果抵达循环时——通常是组合工具转运的嵌套分发上下文，也可以是叶子工具创建的全新插件来源指令（如 `tool-goal` 的收尾注入）——即使工具后来抛出或取消胜出也不例外；该方法绝不会立即注入上下文。
- `ToolExecutionResult`：带判别标记的执行局部结果。成功形态为 `{ isError:false, value:JsonValue, content, meta?, additionalContexts? }`；失败形态为 `{ isError:true, error:{ message, info? }, content, meta?, additionalContexts? }`，且不含值。调用身份保留在不可变的 `ToolExecution` 上。注册表会在呈现前快照、验证并冻结规范值，随后在最终观测前实体化持久呈现字段。`ToolFailure.info` 携带内部的 `{ name, code }`，用于表示 `HarnessError`；`additionalContexts` 会保留每个通过延迟或 post-execute 加入且带标识的 `UserMessage`，供循环在结果后按 FIFO 顺序处理。
- `PreToolDecision`：`{kind:'allow'}` | `{kind:'deny', reason}` | `{kind:'ask', reason?}`。该类型有意不提供输入改写；`ask` 在挂载 [`ctx.approval`](../../interaction/user-approval/README.md) 时由它处理，否则退化为拒绝。
- `PostToolDecision`：接受决定可以替换 `content` 或 `value`（不能同时替换），并可附加 `additionalContexts`；阻止决定会把反馈变成无值失败。替换内容会保留规范值和元数据。替换值会重新验证，并重新呈现内容／元数据。接受决定会先保留工具延迟的上下文，再附加决定上下文；阻止决定会丢弃工具延迟的上下文，只公开阻止决定显式提供的上下文。
- `ToolGuard`：`(execution) => string | undefined`；返回的字符串是最终单调拒绝理由，在可重排的前置执行 waterfall 之后、分发之前求值。
- `ToolCallView` / `ToolResultView`：提供方无关、带 `card` 标签的呈现意图；工具通过 `presentCall` / `presentResult` 返回该意图，从而拥有 UI 呈现其自身调用的方式（参见「工具拥有的 UI 呈现」）。

### 扩展点

- 工具插件调用 `ctx.tools.register()`：schema 会自动流入组装结果。
- `tools/pre-execute` 是可重排的允许／拒绝／询问门禁；`ctx.tools.guard()` 在其后添加单调的拥有方策略。
- `tools/execute` 会环绕包装规范化后的规范分发，以支持超时、重试或指标采集。包装层只能替换操作信号；包装层生成的成功结果会根据已解析工具的输出声明进行规范化。每个规范结果属于一个不可变分发 token，因此来自其他调用或工具的缓存结果会根据当前声明重新验证。
- `tools/post-execute` 可以替换呈现内容、替换规范值、通过反馈阻止，或附加有序上下文。随后，定义可选的 `finalizeContent` 会在普通结果和外层流水线失败中维护其最终、仅涉及内容的不变式；`tools/result` 观测不可变的最终结果。内容替换不是保密边界：当编程消费方不得接收某个值时，应阻止或替换该值。
- 确切签名与顺序位于 [tools.md](../../../docs/subsystems/tools.md#cordis-surface) 的生成区块和[流水线](../../../docs/tool-execution-pipeline.md)中。
- MCP 服务器：每个服务器使用一个插件；发现工具后，使用服务器的 schema 调用 `ctx.tools.register()`。

### 类型化工具参数 schema

第一方插件作者可以使用本包导出的 `defineTool()` 辅助函数定义类型化工具参数 schema：

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

declare const ctx: Context

ctx.tools.register(defineTool({
  name: 'read_file',
  description: 'Read a file from disk.',
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute file path' },
    offset: { type: 'number' },
    limit: { type: 'number' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args, exec) {
    // args is typed: { path: string; offset?: number; limit?: number }
    return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
  },
}))
```

统一 schema DSL 使用 `ParameterSchemaSpec` 表示隐式开放参数对象，使用 `ValueSchemaSpec` 表示任意 JSON 值根。它支持 `string`、`number`、`integer`、`boolean`、`null`、`array`、`object`、仅供作者使用的 `json`，以及恰好匹配一个分支的 `oneOf`；标量 `enum`/`const` 值必须符合其声明类型。每个显式 DSL 对象都声明 `additionalProperties: true | false`，而隐式参数根和原始 JSON Schema 保持标准的开放默认值。schema 记录只接受自身可枚举字符串键，schema 数组必须是稠密普通数组。编译、验证、从注册表分离以及 schema 到 TypeScript 的呈现均使用显式工作栈，因此，对有效深层 schema 的运行时处理受内存而非调用栈限制；`InferValue` 在 16 层容器内保留精确类型，之后回退到 `JsonValue`，使 TypeScript 自身也保持栈安全。

`defineTool` 定义会在执行前验证模型参数，并把缺失必填值、基本类型错误、无效枚举成员和嵌套违规转换为 `ToolArgsError`（`INVALID_ARGS`），进入普通错误结果路径。它还会根据 `output.schema` 推断主体返回类型和纯输出投影器；注册表在呈现前快照并验证返回的无损 JSON。隐式参数根是开放的；显式对象只有在设置 `additionalProperties: true` 时才接受额外键，而没有声明属性的封闭对象只接受 `{}`。原始 JSON Schema 对象保持开放，除非显式设置 `additionalProperties: false`。系统不会应用默认值；没有 `properties` 的开放对象和没有 `items` 的数组只接受容器类型检查。通过原始方式注册的工具负责输入验证，但仍需声明输出，并由注册表强制校验输出。

有关详细信息，请参阅公开 API 中的 `defineTool`、`validateArgs`、`ToolArgsError`、`ValueSchemaSpec`、`ParameterSchemaSpec`、`InferValue`、`InferArgs`、`valueSchemaSpecToJsonSchema` 和 `parameterSchemaSpecToJsonSchema`。

可选的 `timeoutMs` 必须为正数且为有限值；它是策略元数据，不是模型可见的 schema。

可选的 `isConcurrencySafe(args)` 接收经过软验证的类型化参数。只有确切的 `true` 才允许并发分发／主体执行；无效输入和所有其他结果仍为独占。选择并发的主体不得改变父级拥有的状态；共享状态竞态必须具有交换性，否则必须安全拒绝。[并行工具调用 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md) 规定完整安全约定。

### 强制执行的原始 JSON Schema 子集

`JsonSchemaNode` 是工具输出、Code Mode 生成、subagent 和工作流共享的原始 JSON Schema 对应类型。它允许任意 JSON 根、仅含注解且不施加约束的 JSON 节点，以及恰好匹配一个分支的 `oneOf`；注解必须保持为无损 JSON。`assertSupportedJsonSchema()` 拒绝不受支持的构造，而 `validateJsonSchemaValue()` 返回带路径的违规信息。subagent 和工作流通过 `assertObjectJsonSchema()` 与 `ObjectJsonSchema` 保留调用方定义的对象根要求，而不是依赖共享词汇的限制。

### 由工具定义的 UI 呈现

工具可以选择通过纯函数 `presentCall()` 和 `presentResult()` 定义呈现意图，使 UI 无需针对工具名称编写特殊逻辑：

- 调用视图为 `{ card: 'generic', title, kind?, rawInput?, content?, locations? }`、`{ card: 'terminal', title, description?, cwd? }` 或 `{ card: 'diff', title, diffs, locations? }`。
- 结果视图为 `{ card: 'generic', title?, content? }`、`{ card: 'terminal', title?, output?, exitCode?, signal? }`、`{ card: 'diff', title?, diffs }`、`{ card: 'search', shape, title?, truncated, total, … }`（已完成的发现型搜索——`shape: 'matches'`（grep）为按文件分组的匹配，`shape: 'paths'`（glob）为扁平路径列表，配 `truncated`/`total` 使 UI 永不把被截断的结果当作完整结果呈现；该视图不携带结果文本，且搜索没有 `card: 'search'` 的调用时对应视图）、`{ card: 'read', title?, path, offset, lines, totalLines, lang?, content? }`（已完成的文件读取→带行号、可选语法高亮的代码视图；`offset` 是窗口请求的 1-based 起始行，即使 `lines` 为空也保留；`lines` 是 `{ number, text }[]`，保留每一行的文件行号，`content` 是去除读取结果外层封装后的正文，供不支持读取视图的 UI 回退显示）或 `{ card: 'web', kind: 'search' | 'fetch', title?, … }`（已完成的 web 检索；`kind` 各分支携带结构化的搜索来源或抓取摘要，不具备 `web` 能力的 UI 回退到原始结果内容）。

返回 `undefined` 会选择通用回退。呈现器只依赖其参数和持久结果，因为 UI 会在实时流式输出和日志回放期间调用它们。`output.presentationMeta(args, value)` 为直接的顶层调用派生 JSON 元数据；该元数据随 `tool/result` 持久化并传回 `presentResult`，而规范值本身仍只存在于执行局部，绝不会回放。嵌套 Code 分发不会计算元数据。`defineTool` 会软验证较旧的日志参数并回退，而不会使回放崩溃。`dsh-tool-bash` 与 `dsh-tool-fs` 是参考实现；[规范输出 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-20-canonical-tool-output-contract.md) 规定值／呈现拆分，[呈现意图 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md) 规定卡片词汇。

### Code Mode

在 `code` 或 `both` 模式下，注册表为当前作用域公开保留的 `run_code` 传输和按所加载运行时语言生成的确定性 SDK——注册表按 `ctx.codeRuntime.language` 选择渲染器（`typescript` → 下方的 TypeScript SDK，`python` → Python SDK）。SDK 为每个可见工具声明精确的参数与规范输出类型（TypeScript 为 `ToolArgsMap`/`ToolOutputMap`，Python 为具名 `TypedDict`），每个绑定都会解析为该工具的规范 JSON 值。每个无损 JSON 绑定调用都会在原生调度约定下重新进入完整工具流水线（并发安全的调用最多可重叠 `maxParallelSubCalls` 个；独占调用单独运行并构成排序屏障），并在日志中与外层调用建立关联。拒绝及其他失败结果会以程序实际可见的 `ToolCallError` 形式拒绝，且只携带 `toolName` 和 `message`；Native 内容和内部错误码留在 Code 约定之外。程序的外层日志与返回值会重新进入模型上下文；当成功结算的子调用最终 Native 内容包含图片时，桥接层还会经父结果延后完整有序内容，避免图片被 JSON 专用绑定遮蔽。最终 post-execute 阻止或内容替换具有权威性。普通副作用不会回滚，子调用的 `additionalContexts` 会通过父结果延迟，以保持调用／结果相邻。运行结算会中止并排空尚未完成的绑定；运行时失败以 `CodeRunFailedError` 形式出现。

在 `code`（而非 `both`）下，该传输同时也是模型唯一可用的入口：模型直呼其他任何可见工具名，都会在创建执行时、早于 `tools/pre-execute`、审批 `ask` 和 guards 解析为 `UNKNOWN_TOOL`，因此没有任何一方会观察或批准一个注定失败的调用。拒绝信息会给出正确路径（`only \`run_code\` is callable directly — call \`<name>\` from inside a \`run_code\` program instead`），因为同一份提示词刚刚声明过那个工具，只说 `unknown tool` 会被读成部署损坏。SDK 子分发携带外层执行的 `parent` token，不受此限制，因此程序保留 SDK 声明的全部绑定。参见[执行器塌缩 note](../../../.agents/notes/implemented/bug-fix/2026-08-07-code-mode-executor-collapse.md)、[Code Mode 基础](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md)、[类型化返回约定](../../../.agents/notes/implemented/feature/2026-07-20-code-mode-typed-tool-returns.md)和[代码运行时 seam](../../code-runtime/README.md)。可以运行 `pnpm run demo:code-mode` 试用。

- **SDK 段**（`tools:sdk`，顺序 150）：一个在组装时求值的提示词段，每次组装都会重新生成与所加载运行时语言相符的 SDK 文本。TypeScript 形态会生成 `JsonValue`、精确的 `ToolArgsMap` / `ToolOutputMap`、`ToolName`、`ToolCallError` 声明，以及映射调用作用域最终可见工具的 `tools` 命名空间（特殊名称使用带引号的键），并附带固定的使用说明；Python 形态（`ctx.codeRuntime.language === 'python'`）发出等价的具名 `TypedDict` 与一个带相同用法说明的 `tools` 对象。其输出具有确定性：工具按字典序排列；工具集合不变时，文本逐字节相同（有利于前缀 cache）。两个代码生成器都已导出，且绝不会在提示词组装期间抛出：`jsonSchemaToTs` 处理统一 schema 的每种构造并将不受支持的原始构造降级为 `unknown`；`jsonSchemaToPy` 同理，降级为 `Any`（当某字段名不是合法的 `TypedDict` 属性时，或在 SDK 渲染之外被调用时——`TypedDict` 声明所需的命名上下文由该渲染提供——整个对象降级为 `dict[str, Any]`）。
- **分发桥接层**（`run_code` 的 execute）：每个绑定调用都会在分发前快照为无损 JSON（`undefined`、`BigInt`、循环、稀疏数组、`-0` 和特殊对象会使该次调用被拒绝），经由每次运行独有、复用原生并发约定的池调度——调用严格按提交顺序启动，连续的 `isConcurrencySafe` 调用最多可重叠经校验的 `maxParallelSubCalls` 配置个（默认 10；设为 `1` 即恢复串行分发），被分类为独占的调用先排空池、单独运行并阻挡其后的调用——以外层执行的不透明 token 作为 `parent`，并经过完整的 pre-execute → guards → execute → post-execute → result 流水线。成功会返回策略处理后的最终规范值；失败以一条消息到达 worker，并成为 `ToolCallError(toolName, message)`。每个已启动的子调用在进入流水线时记录一条 `tool/code-dispatch-start` 事件（确定性 id `<parent>:code:<n>`，按提交顺序编号），并以一条携带完整模型可见 `content`/`isError` 结果的 `tool/code-dispatch` 事件完结（采用 `tool/result` 词汇，因此 UI 会沿原生路径呈现子调用——这对事件的 `time` 字段承载每个子调用的计时）；因 run 结算而被放弃的排队调用两者都不记录。`deriveMessages()` 既不公开这两个事件，也不持久化规范值。token 关联使按提交语义工作的观察器可以延后提交内部调用的成功结果，直到最终 `run_code` 结果确定，而无需暴露进行中的外层执行；普通工具副作用不会回滚。每个子调用的 `additionalContexts` 条目以及每份成功且含图片的最终内容序列都会按分发顺序通过外层 `ToolRunContext` 延迟；循环只在父级 `run_code` 结果之后追加这些上下文，从而保持相邻关系和来源归属，即使程序后来失败也不例外。
- **结算纪律**：桥接层拥有一个运行作用域的中止机制；该中止会跟随传入的外层信号，并在运行因任何原因结算时触发，因此预算耗尽会中止正在运行的子工具，而不会将其遗留。桥接层随后会在返回之前排空队列，使每个 `tool/code-dispatch` 都落在仍打开的轮次内。失败的运行会抛出 `CodeRunFailedError`（`code: 'CODE_RUN_FAILED'`，message = 失败类型 + 已捕获日志），流水线会将其转换为模型可据以自我修正的结构化 `isError`。
- **结果大小**：中间绑定值会完整传入 worker 进程，且没有逐绑定字节上限。`run_code` 返回规范的 `{ logs: string[], result?: JsonValue }`；字符串原样呈现，其他所有存在的 JSON 根都通过栈安全的美化 JSON 遍历呈现，总缩进最多为 10 个字符（更深的子树保持紧凑），`null` 保持显式，而缺少 `result` 表示程序返回 `undefined`。worker 可配置的 `maxOutputBytes`（默认 64 MiB）只应用于组合序列化后的外层日志数组、完成值或失败消息载荷；固定的结果封装语法和呈现空白不计入该上限。无效和超限的完成会明确失败，只有这个外层结果可以按常规 spill 机制处理。

### 并行执行

agent loop 将连续的 `parallel` 调用归入有界滚动池，并把每个 `exclusive` 调用视为顺序屏障。只有分发／主体会重叠；策略、持久结果和上下文仍保持模型顺序。Code Mode 绑定通过桥接层自己的池复用同一套分类。[并行工具调用 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md) 规定已交付声明及其原理。

## 模型体验

### 普通工具 schema

#### 模型看到的内容

在普通模式下，模型会看到每个可见定义的确切名称、描述和 JSON Schema；已交付定义记录在生成的[工具包映射和 schema 章节](../../../docs/tool-catalog.md#tool-package-map)中。agent 作用域的限制、遮蔽和扩展注册会改变该 agent 的最终工具集合。

#### Token 影响

每次请求的固定成本与可见定义成正比。隐藏工具的限制会为该 agent 移除其全部 schema 成本。

#### KV Cache 影响

只要可见定义及其顺序不变，前缀就保持稳定。注册、dispose 或作用域限制可能从第一个改变的 schema token 起使复用失效。

### Code Mode schema 与系统提示词

#### 模型看到的内容

Code Mode 会公开生成的 [`run_code` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tools)、下方 SDK 说明，以及按所加载运行时语言生成的精确 SDK 块（TypeScript 的 `declare const tools` 块，或 Python 的 `tools` 声明）。`both` 会同时公开普通 schema 与此 Code Mode API。在 `code` 下，提示词还会带上 `tools:code-only` 规则，其顺序排在逐工具指导段之前，让模型先读到「可以调用哪些工具」再读「每个工具做什么」；`both` 下它渲染为空。说明与 SDK 块随所加载运行时的语言切换；下方展示 TypeScript 版本（经 [`dsh-code-runtime-worker-thread`](../../code-runtime/code-runtime-worker-thread/README.md)），Python 版本（用于任何报告 `language: 'python'` 的运行时）以 Python 语法提供相同操作和类型（`await tools.name(args)`、特殊名称用下标访问、`print(...)` 与顶层 `return`）。

##### Code Mode SDK 说明

```markdown
## Writing code for run_code

`run_code` takes two required arguments: `code` — the body of an async TypeScript function (erasable syntax only — no `enum` or namespaces; type annotations are advisory, the code runs type-stripped) — and `description`, a short summary of what the program does. Inside the program:

- Call tools as `await tools.name(args)` — quoted access for exotic names: `tools["my-tool"](args)`. Every call resolves to the tool's typed canonical JSON value. Tool arguments must be lossless JSON.
- A FAILED tool call rejects with `ToolCallError`, whose `toolName` identifies the failed tool and whose `message` is human-readable — `try/catch` it to handle and continue.
- Independent read-only calls MAY overlap under `Promise.all` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with `await`.
- Emit results with `return` and/or `console.log(...)`. ONLY what you print or return comes back to you — intermediate tool results never enter the conversation, so extract just what you need.

The available tools:
```

#### Token 影响

每次请求的固定成本与可见定义成正比。Code Mode 使用生成的 SDK 文本加一个传输 schema 取代最终工具 schema，但不承诺普遍减少成本。

#### KV Cache 影响

只要 Code Mode 选择、生成的 SDK、传输 schema 和可见工具集合不变，前缀就保持稳定。模式或筛选器变更可能从第一个改变的提示词或 schema token 起使复用失效。

### 工具调用历史与结果

#### 模型看到的内容

循环会保留模型发出的参数和注册表的最终内容。任何抛出异常或遭到拒绝的调用，都会转换为确切的 `Error: <message>`。Code Mode 只返回外层程序打印的行和呈现后的返回值；两者都为空时返回 `(run_code completed with no output)`；失败时返回 `Error: code run failed (<kind>): <message>`，并根据是否存在已捕获内容，在其后附加 `Captured output:` 与捕获的行。内部分发事件只保留在日志中；成功且含图片的子结果会在外层结果之后作为带来源归属的上下文追加，后置执行监听器也可以在同一边界追加其他带来源归属的上下文。

#### Token 影响

参数、结果和附加上下文取决于数据，并会重复发送直至压缩（compaction）。隐藏工具的限制还会在模型可以调用这些工具之前移除其 schema。

#### KV Cache 影响

仅追加；新的可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **并发策略不是事件门禁**：`executionMode()` 直接读取已解析的工具定义；插件只能在自身拥有的定义上声明分类器。
- **`tools/pre-execute` 有意不允许改写 `exec.arguments`**：否则日志记录和呈现的参数会与实际运行内容失去同步；改写设计记录在[拟议的 Agent Note](../../../.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.md)中。
- **调用方定义的 subagent 与工作流结构化输出仍要求对象根**：这是消费方层面的守卫；共享 schema 词汇和工具输出支持任意 JSON 根。
- **定义中的 `timeoutMs` 仅作声明之用**：注册表绝不会强制执行截止时间；要强制执行，必须使用 `@deepseek-ai/dsh-tool-call-timeout-policy` 包装层。
- **Code Mode 的 SDK 语言由当前加载的运行时决定，且呈现方式按 agent 而非按工具**：`mode: code`/`both` 会拒绝组装提示词，除非 `ctx.codeRuntime.language` 有已注册的 SDK 渲染器（TypeScript 或 Python）；作用域限制／遮蔽与 `presentAs` 会选择每个 agent 的可见绑定及其形态，但在同一个 agent 内不能让一个工具仅使用 Native，而另一个仅使用 Code。
- **Code Mode 中间值只存在于执行局部，且没有字节上限**：这些规范的类型化值无法从会话回放重建，并可能耗尽进程或 worker 内存；只有外层 `run_code` 输出受 worker 可配置的硬上限约束。每个子调用的持久日志副本则确实有上限：`tools/code-dispatch-log` waterfall 允许 spill 策略把过大的 `tool/code-dispatch` 内容替换为预览加定位符（[原理](../../../.agents/notes/implemented/feature/2026-07-26-code-dispatch-log-spill.md)）。
- **每次运行都会获得全新的 `run_code` 状态**：MVP 不采用持久 REPL 风格内核（跨调用状态不会出现在日志中）；参见 [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md)。
