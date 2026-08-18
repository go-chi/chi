# dsh-llm

[English](README.md) | 中文

提供方无关的 LLM（大语言模型）词汇与抽象服务。本包定义 agent loop（智能体循环）、会话日志和所有插件共同使用的规范词汇。

## 服务：`LlmRuntime`（ctx key：`llm`）

一个适配器注册表加单一流式调用接口，可通过 waterfall（瀑布式事件）拦截。

### 公开 API

- `ctx.llm.registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle` 为给定提供方路由注册一个适配器实例。注册要么全部成功，要么全部不生效，并且会随调用 fiber 一起 dispose（资源释放）。返回的句柄还提供 `replace(providers)`：候选路由集合会在注册状态发生任何变化前完成整体验证，因此与另一适配器发生冲突时，当前路由仍保持注册并继续提供服务。替换会在一次同步操作中完成，不会出现可观察的空档。`replace([])` 合法，表示保留注册但不持有任何路由；初始注册则不得为空。
- `ctx.llm.listProviders(): LlmProviderInfo[]` 按注册顺序描述已注册提供方路由。
- `ctx.llm.registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle` 声明适配器插件可通过配置激活的提供方路由——无论已注册还是休眠——每个条目指明其所属 settings namespace，以及 profile 在该分节内的路径。要么全部成功，要么全部不生效（`INVALID_DIRECTORY`/`DUPLICATE_DIRECTORY`），并随调用 fiber dispose。该句柄还带 `replace(entries)`：候选集合会先被整体校验，因此其中若有条目已被另一个注册声明，当前集合原封不动；此处允许传空数组。声明集合随配置变化的插件必须使用 `replace`，而不是先 dispose 再重新注册——后者会在新集合被拒时让目录整个落空。
- `ctx.llm.listConfigurableProviders(): LlmConfigurableProvider[]` 按声明顺序列出可配置提供方目录；配置界面将其与 `listProviders()` 合并，为每个条目标注存活或休眠。条目可携带 `declared`，表示拥有该路由的适配器是否只因配置点名才知道它。只有适配器能回答这一点：该字段缺失时，只表示该适配器不区分这两种来源，不能据此判断路由是否随产品交付。
- `ctx.llm.registerModelDiscovery(settingsNs: string, discover): () => void` 为本插件拥有的 settings namespace 提供查询提供方端点的能力。每个 namespace 只能有一个（`INVALID_DISCOVERY`/`DUPLICATE_DISCOVERY`），并随调用 fiber dispose。
- `ctx.llm.listModelDiscoveryNamespaces(): string[]` 列出可以询问端点的 namespace，让界面只在可用之处提供该动作。
- `ctx.llm.discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest): Promise<LlmDiscoveredModel[]>` 询问某个端点它公布了哪些模型。
- `ctx.llm.providerRetryPolicy(provider: string): ResolvedRetryPolicy` 返回注册时捕获的提供方自身的重试策略，并解析 normal 默认值。
- `ctx.llm.listModels(provider: string): Promise<LlmModelInfo[]>` 发现某个已注册提供方当前公布的模型。
- `ctx.llm.resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>` 从拥有该精确路由的适配器中，解析并校验确切模型身份，以及可用上下文、输出默认值和推理（reasoning）元数据；异步适配器可选地支持取消。
- `ctx.llm.resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>` 校验显式推理强度，并填入适配器配置的调用默认值，但不自动调整。
- `ctx.llm.prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>` 在一次精确模型查询中解析配置、脱耦的上下文元数据以及标明哪些字段由适配器默认值填入的标记，再将当前适配器注册和不可变重试策略捕获为一次可取消、一次性调用。
- `ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>` 将一次模型调用流式输出为原始分片（token 级增量）。消费方使用 `BlockAssembler` 将分片组装为块／消息。

`LlmRuntime` 将最终适配器选择、同步分发、迭代器构造和迭代期间的失败，统一转换为流协议唯一的终止形式：`finish { kind: 'error' | 'aborted', failure }`。部分增量输出后发生失败时，内容块可能仍未闭合；消费方会丢弃这些不完整输出。`llm/stream` middleware、嵌套调用、适配器清理和下游消费方的错误仍会抛出，因为它们属于插件或消费方失败，而非模型请求结果。已准备调用会暴露随其确切适配器注册一同捕获的不可变重试策略；完全由 middleware 处理的路由没有服务策略。

询问端点属于配置期针对**草稿**的操作，以 settings namespace 而非提供方路由为键——界面正在新增的提供方还不存在，也就没有路由可点名。但请求仍可**点名**它正在编辑的路由，而已经描述该路由的适配器会用自己的知识作答，无需联网；路由名称和 `baseURL` 至少需要提供一项。除此之外，请求携带端点、协议，以及一条 harness 只用于这一次询问、绝不存储的凭据。这里既不读取也不写入 settings 或 credentials；返回内容是界面可以提供给用户采纳的候选元数据，而不是已注册的 catalog。`LlmDiscoveredModel` 除 `id` 外每个字段都是可选的，因为大多数提供方列表只公布 id；采纳其中一条的界面仍要补上其适配器所需的容量。重复与不可用的 id 会被丢弃，无人服务的 namespace 以 `NO_DISCOVERY` 失败，既不点名路由也不给端点的请求以 `INVALID_DISCOVERY` 失败。

提供方和模型元数据用于发现，不构成路由白名单。`registerAdapter()` 仍拥有提供方路由的排他性，并为每条路由捕获适配器的重试策略；适配器可以接受未出现在 `listModels()` 中的模型 id，消费方不得仅因模型未列出而拒绝请求。返回的 selector 元数据已分离；无效或重复的适配器条目会以 `INVALID_ADAPTER` 或 `INVALID_CATALOG` 失败。

每个拓扑提交点——适配器路由注册或 dispose、目录条目出现或撤回——都会在变更之后发出无载荷的 `llm/adapters-updated` 事件，消费方因此会重新读取 `listProviders()`/`listModels()`/`listConfigurableProviders()`，而不是轮询。观察者故障会被记录并隔离，不能否决变更；只有带 `INVARIANT` 码的故障会在通知完所有观察者后重新抛出。

确切模型元数据是独立的正确性查询，不是 catalog 装饰或全局 LLM 设置。`resolveModelInfo()` 会向拥有精确提供方／模型路由的适配器查询一次；适配器可以描述未列出的动态模型。缺少 `context` 表示模型容量未知；缺少 `defaultMaxTokens` 表示继续沿用提供方自身的输出默认值；缺少 `reasoning` 则表示推理能力不可用。无效的身份、上下文、输出默认值或推理元数据会以 `INVALID_MODEL_INFO`、`INVALID_MODEL_CONTEXT`、`INVALID_MODEL_MAX_TOKENS` 或 `INVALID_MODEL_REASONING` 失败。

`defaultMaxTokens` 是适配器配置的单次请求输出上限，不是模型硬上限。仅当请求省略 `maxTokens` 时，`resolveCallConfig()` 才会填入该值；显式上限优先。推理标识符是由适配器定义的不透明字符串，而非核心枚举：同一次解析只接受与已公布标识符完全一致的值，在存在 `defaultEffort` 时填入它，否则保留提供方默认值。异步模型解析器会接收调用方信号，并且必须在取消后尽快结算。`prepareCall()` 还会返回同一次查询得到的、与适配器内部状态分离的上下文元数据，通过 `adapterDefaults` 标明填入了哪些 `maxTokens` 和 `reasoningEffort` 字段，并在请求头记录和最终分发期间始终保留同一项精确的适配器注册。因此，HMR（热模块替换）不会把一个适配器的能力结果与另一个适配器的请求混用；复用其一次性句柄或更改调用配置字段会以 `INVALID_PREPARED_CALL` 失败。不支持的显式或配置推理强度会在提供方 I/O 前以 `UNSUPPORTED_REASONING_EFFORT` 失败。

### 事件

| 事件 | 模式 | 用途 |
|---|---|---|
| `llm/stream` | waterfall | 拦截／包装每次流式模型调用，用于缓存、日志或路由 |

### 扩展点

- 继承 `LlmAdapter` 并调用 `ctx.llm.registerAdapter(providers, adapter)`，添加一条或多条提供方路由。`GenerateOptions.provider` 选择适配器；`GenerateOptions.model` 属于适配器，可以动态解析。覆盖 `providerRetryPolicy()` 以提供由提供方定义的恢复配置，覆盖 `providerInfo()` 和异步 `listModels()` 以公开 selector 元数据；精确身份、容量、输出默认值或可选推理强度可用时，实现 `resolveModel()`；异步解析器必须响应其可选的取消 signal。默认实现使用有界的 normal 重试策略，将路由和模型 id 用作名称，不公布模型，也不返回容量、输出默认值或推理元数据。
- 包装 `llm/stream` 时，通过 `ctx.on()` waterfall listener 实现缓存、日志或路由。包装层如果在已经发出分片后重试，就没有可持久记录的尝试边界；因此，随产品交付的 agent 重试策略改用 `agent/request-error`。

### 消息（`message.ts`）与内容块（`types.ts`）

`Message` 是投递、持久历史和模型请求共享的不可变值。每条消息从创建起都必须具有 `MessageId`、角色、内容和带类型的来源。`createMessage(input)` 生成标识，并返回与输入分离且深度冻结的值；`createUserMessage({ content, source })` 固定 user 角色；`createAssistantMessage({ content, source })` 固定 assistant 角色与模型来源类别；`createToolResultMessage({ callId, content, isError })` 固定 user 角色，并将工具来源与其结果块耦合；`freezeMessage(message)` 导入已有标识，绝不将其替换。改写消息时会保留标识，并产生另一个冻结值。浏览器端代码会从依赖最少的 `@deepseek-ai/dsh-llm/message` 入口导入这些值构造函数，而不是从包含服务的包根入口导入。

消息内容是类型化内容块数组：`text`、`reasoning`、`tool-call`、`tool-result`。联合从可合并扩展的 `ContentBlockMap` 派生，因此插件可以通过 declaration merging 添加块类型。assistant 消息使用模型来源，其中携带生成该消息的提供方和模型，以及可选的适配器私有回放状态。dispatch 前，`LlmRuntime` 只在历史提供方路由与目标提供方路由当前由完全相同的适配器实例拥有时才保留该状态；随后由适配器判定能否在模型／提供方间恢复或转换该状态。核心块集只包含每条已发布路径都支持的块。多模态内容（图像、音频等）没有核心块类型；需要它的功能会通过 map 添加，并一并添加相应的适配器／UI／压缩（compaction）支持。

流式输出是原始分片协议（`block-start`、`text-delta`、`reasoning-delta`、`tool-call-delta`、`block-end`、`usage`、`finish`）。每个适配器结果都以一个终止 `finish` 到达消费方；运行故障使用 `error` 或 `aborted` 作为结束原因，而不会跨流 API 抛出。`BlockAssembler` 是将分片组装为块／消息的唯一共享实现。成功的 `finish` 可以携带 `ReplayEnvelope`——不透明的响应级回放元数据，加上与发射块序列对齐的可选逐块条目。组装对内容与元数据只做一次保留/丢弃决定：`max-tokens` 结束会丢弃可能被截断的工具调用，数据在每个被丢弃的位置同步失去对应条目，因此存储的元数据始终描述存储的内容。

### 调用配置（`call-config.ts`）

`LlmCallConfig` 记录一个会话的模型请求所使用的提供方、模型、由适配器定义的可选推理强度，以及采样参数（`provider`、`model`、`reasoningEffort`、`temperature`、`maxTokens`、`stop`，分别与同名 `GenerateOptions` 字段一一对应）。它是作为请求标头一部分记录在会话日志中的每会话状态（见 dsh-session `request/header` 事件），绝不是可静默调整的每次调用旋钮：`agent/request` waterfall 会提议替换，`prepareCall()` 在轮次 signal 控制下校验它并填入适配器默认值，loop 随后记录生效值以及标明哪些字段由适配器默认值填入的标记，再使用已准备调用中与注册绑定的流。下一次提议会省略带标记的默认值，使变更后的路由解析自身的值；未带标记的显式字段会保留。`callConfigEquals(a, b)` 是逐字段真实变更检测器；`deepFreeze(value)` 是 loop 使用的请求所有权辅助函数：每个构造完成的请求都会在分发前深度冻结；`llm/stream` 监听器和适配器只能读取，绝不能改写。`markAgentLoopRequest()` 将该精确对象标记为由进程本地 agent loop 创建，`isAgentLoopRequest()` 让观测方可以将其与同样可能冻结并关联会话、但独立记录的辅助调用区分。`GenerateOptions.purpose` 会对已记录的辅助压缩和会话标题调用进行分类，使适配器可以按调用目的应用不同的传输策略，而不改变普通会话请求。

### 应用归因（`attribution.ts`）

每个产品适配器都会在提供方 HTTP 请求上发送应用身份。`attributionHeaders(identity?)` 构建标准 `User-Agent`，默认为公开 `APP_IDENTITY`；白标部署可以替换它，但不能抑制它。适配器会直接验证 wire 标头，或通过自身库 hook 验证。详见 [归因 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md)。

### API 密钥校验（`api-key.ts`）

每个要把凭据放进 HTTP 标头的适配器，使用前都以同一套规则校验它。`normalizeApiKey(raw)` 会先去除首尾空白，然后接受任意非空的可打印 ASCII 值（`/^[\x21-\x7E]+$/`，不含空格），或通过 `ApiKeyRejection`（`'empty'` | `'illegalCharacters'`）说明拒绝原因。这些结果一并包含在 `ApiKeyCheck` 中。缺失从不参与校验：调用方会在询问之前自行判断是否提供了值——未点名凭据的 profile 会转由提供方自身的环境发现或 OAuth 完成认证。

### 类

- `LlmAdapter`：提供方适配器的抽象基类。唯一必需方法是 `stream()`。
- `BlockAssembler`：将原始分片逐步组装为完整内容块，并能据此创建带标识且冻结的 assistant 消息。agent loop 向它提供原始分片（同时记录以供回放），并读取已组装块以构建历史。
- `HarnessError`：harness 错误分类体系的基类，包含稳定 `code` 字符串（与面向人的 `message` 不同）以及 `cause` 链。它位于所有其他包都从中导入的叶子包中，因此可以共享单一基类，无需新的依赖边。各包的错误（`LlmError`、`ToolArgsError`、`InvariantError` 等）都继承自它。`isHarnessError(value)` 在进程边界处收窄类型。
- `LlmError`：继承自 `HarnessError`；其稳定 `code` 字符串（`NO_ADAPTER`、`DUPLICATE_ADAPTER` 与 `AUTH`／`RATE_LIMIT` 等适配器 code）与冻结可序列化 `failure.code` 匹配。Payload 还可以保留已验证状态、`Retry-After` 和品牌化提供方请求 id 事实；策略位于错误之外。
- `errorChain(value)`：渲染抛出值的完整 `cause` 链与 AggregateError 成员，供诊断输出使用，包括 UI 通知、logger 行和持久 `turn/end` 消息。因此 undici 的 `TypeError: fetch failed` 等传输包装层会显示底层 `ECONNREFUSED`／DNS／TLS 详细信息，而不是将其遮蔽。该函数只负责生成诊断文本。调用方必须依据稳定的 `code` 选择错误处理路径，绝不能通过解析渲染后的文本作出判断。
- `CONTEXT_WINDOW_EXCEEDED_CODE`：当请求超过模型上下文窗口时，无论通过 HTTP 异常抛出还是带内 finish 交付，两个 DeepSeek 适配器都使用的提供方无关 code。`isContextWindowExceededError(detail)` 是它们针对 OpenAI 兼容提供方详细信息的共享保守分类器。
- `QUOTA_EXCEEDED_CODE`：帐户配额、余额、点数、预算或用量限制耗尽时使用的非暂时性提供方无关 code。`isQuotaExceededError(detail)` 使这些失败与请求速率限制保持区分。
- `EMPTY_RESPONSE_CODE`：两个适配器都使用的提供方无关 code，用于表示退化的提供方生成结果：一个未携带任何内容块的终止 `stop`。它会被分类为错误 finish（而非成功空消息），因为尝试未产生持久内容；`dsh-llm-retry` 默认重试它。
- `INVALID_CREDENTIAL_CODE`：已提供但无法使用的凭据所用的提供方无关 code——格式错误而非缺失，修复方式是改正已存储的值，而不是补充一个凭据，这正是它与 `MISSING_CREDENTIAL` 的区别。它被刻意排除在默认可重试集合之外：格式错误的凭据每次尝试都会以同样方式失败。`assertUsableApiKey(raw, pkg, ref)` 会以该 code 抛出 `LlmError`，是每个适配器判定已存储凭据不可用时共用的诊断。

### 真实适配器

两个适配器使用不同内部机制实现 `LlmAdapter`：[`@deepseek-ai/dsh-llm-deepseek`](../llm-deepseek) 针对 `deepseek-official` 路由使用直接 fetch 加 `eventsource-parser` SSE（Server-Sent Events）分帧，[`@deepseek-ai/dsh-llm-pi-ai`](../llm-pi-ai) 则通过 `@earendil-works/pi-ai` 动态解析已配置提供方／模型对。两者都遵循 `types.ts` 中的 `StreamChunk` 约定：usage 先于 finish，工具参数保持原始字符串。适配器实现在内部可以抛出异常或发出失败 finish；`LlmRuntime` 会将两者都暴露为终止失败 finish。适配器理由见[双 LLM 适配器](../../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md)，服务边界见[终止失败决策](../../../.agents/notes/implemented/architecture/2026-07-29-terminal-llm-stream-failures.md)。

## 模型体验

无。服务不添加任何与模型绑定的文本、schema 或消息；它只会填入并记录适配器配置的推理强度。

#### KV Cache 影响

透传；注册表保留已组装请求前缀，cache 复用与路由边界属于所选适配器和提供方。

## 已知限制与暂缓事项

- **本服务不执行重试、缓存或速率限制**：提供方注册会存储重试策略，但 `llm/stream` 仍是单次尝试调用包装层。agent loop 会将已验证模型请求失败单独提供给 `agent/request-error`，其默认行为是保留原始失败；`@deepseek-ai/dsh-llm-retry` 是共享示例主干加载的可选执行器。
- **`GenerateOptions` 采样只包含 `temperature`／`maxTokens`／`stop`**：没有 `tool_choice`、`top_p` 或 penalty 字段；有产生方落地时词汇才会增长（见 [已删除惰性旋钮](../../../.agents/notes/archived/simplification/2026-07-04-drop-inert-request-knobs.md)）。
- **只有出现实际产生方后，相应变体才会加入**：`prefill`、逐工具 `strict`、内容块 `cache` 提示和 `agent` 消息来源变体，都因当前没有产生方而被移除（见 [Agent Note](../../../.agents/notes/archived/simplification/2026-07-04-prune-producerless-vocabulary-variants.md)）。
- **`BlockAssembler` 只处理核心块类型**：如果插件添加块类型的流从未由 `block-end` 关闭，`blocks()` 会抛出异常。
- **`APP_IDENTITY.url` 指向一个尚不存在的仓库**：该公开主页必须在发布前可访问。
- **`GenerateOptions.sessionId` 是本地声明的品牌类型**：导入 dsh-session 的 `SessionId` 会产生循环；未来拥有 id 的包可以消除该权宜之计。
