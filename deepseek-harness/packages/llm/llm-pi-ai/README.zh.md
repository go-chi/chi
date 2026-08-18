# @deepseek-ai/dsh-llm-pi-ai

[English](README.md) | 中文

基于 [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) 的 harness LLM（大语言模型）seam 通用多提供方适配器。一个插件实例拥有一份以路由为键的提供方 profile 字典；每个请求使用 `GenerateOptions.provider` 选择 profile，并针对该路由已配置的 catalog 解析 `GenerateOptions.model`。点名了已安装 pi-ai 提供方的路由会继承其端点、协议格式（wire format）与模型 catalog 作为默认值，并逐字段覆盖；pi-ai 未提供的路由则整体声明出来，因此接入 OpenAI 兼容网关、自建服务，或比已安装 catalog 更新的提供方，都属于配置而非改代码。

包根入口导出 Cordis 插件约定、`PiAiAdapter` 与 `supportedProtocols()`；profile 解析、catalog 物化、提供方构造、回放转换和流转换保留在包内部。

## 配置

按提供方配置凭据、模型 catalog 与部署特定传输设置，并以提供方路由本身为键。`apiKeyEnv` 是按请求解析的凭据*引用*，因此机密不进入该文件。省略它会让该路由处于未认证状态；对已安装 catalog 路由而言，这意味着交给 pi-ai 的提供方原生环境发现。已配置却解析不出任何值的引用则相反，会让请求以 `MISSING_CREDENTIAL` 失败，因为放行下去就会用环境里恰好持有的某个无关密钥完成认证。一条凭据服务该路由下的全部模型。

```yaml
- id: llm
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      # Catalog route: endpoint, protocol, and models all come from pi-ai.
      openai:
        apiKeyEnv: OPENAI_API_KEY
        baseURL: https://proxy.example.com:8443
        reasoning: high
        retryPolicy:
          mode: normal
          maxRetries: 3
          backoff:
            initialDelayMs: 500
            maxDelayMs: 10000
            jitterRatio: 0.1
      # Catalog route with its catalog narrowed to one model and that model's
      # capacity corrected; every unset field still comes from the catalog.
      anthropic:
        apiKeyEnv: ANTHROPIC_API_KEY
        streamIdleTimeoutMs: 300000
        models:
          - id: claude-sonnet-4-5
            contextWindow: 200000
      # Catalog route with one model reshaped in place; the rest of the
      # catalog keeps serving (a models list would replace it instead).
      deepseek:
        apiKeyEnv: DEEPSEEK_API_KEY
        modelOverrides:
          deepseek-v4-pro:
            reasoningEfforts:
              off:
              high: high
      # Hand-declared route: pi-ai ships nothing under this key, so the profile
      # supplies the whole provider.
      acme-gateway:
        displayName: Acme Gateway
        apiKeyEnv: ACME_GATEWAY_API_KEY
        api: openai-completions
        baseURL: https://gateway.acme.example/v1
        # Reasoning dialect for an endpoint whose URL pi-ai cannot recognize.
        compat:
          thinkingFormat: deepseek
        models:
          - id: acme-large
            name: Acme Large
            contextWindow: 65536
            maxTokens: 4096
          - id: acme-think
            name: Acme Think
            contextWindow: 262144
            maxTokens: 32768
            # key = selectable level, value = its wire spelling; only off may
            # leave the value empty (supported, send nothing).
            reasoningEfforts:
              off:
              high: high
              max: ultra
```

字典形状使重复路由无法表示，发布前的数组形状（每个 profile 携带 `provider` 字段）会加载失败并给出迁移指引。`providers` 也可以为空或整体省略：适配器将以**休眠**姿态挂载——零路由、模型选择器不多一条——一旦 `llm-pi-ai:` settings 分节提供了 profile 就即时注册路由，分节清空时随之撤销。无论是否休眠，插件都会在可配置提供方目录（`ctx.llm.listConfigurableProviders()`，settings 路径 `providers.<provider>`）中声明每个已安装 catalog 提供方，并与当前 profile 声明的每条路由取并集，因此配置界面既能在任何路由存在之前就提供完整 catalog，也能寻址一条手工声明的路由。每个条目都带上 `declared`：pi-ai 在这个键下是否什么都没有。它跟随已安装 catalog 而非设置文档，因为收窄一个内置提供方的模型同样会存下 profile，而那条路由仍然是 pi-ai 认识的——只有适配器分得清两者，所以由目录直接给出答案，而不是留给界面去猜。哪些适配器存在归组合面；哪些提供方在运行可以完全交给用户的设置文档。向 `ctx.llm` 注册具有原子性：如果与另一适配器已拥有的任何提供方路由冲突，插件会加载失败，不注册剩余路由。模型 id 不是生命周期配置；路由未配置的模型会在发起任何提供方请求前以 `LlmError('UNKNOWN_MODEL')` 失败。

## Catalog 解析

profile 的 `models` 列表是*替换*该路由已安装 catalog，而不是扩充它；省略它（或留空）则原样服务该 catalog。每个条目都会从同 `id` 的已安装模型继承自身未设置的字段，因此把 catalog 路由收窄到两个模型、更正某个容量，或加入一个比已安装 catalog 更新的模型，都是一行编辑——但一旦声明了 `models` 列表，该路由要继续服务的每个模型就都必须出现在其中，条目哪怕只写一个 `id` 也足够。可配置的条目字段是 `id`、`name`、`contextWindow`、`maxTokens`、`reasoningEfforts` 与 `compat`。定价与输入模态没有 harness 消费方，因此沿用已安装条目或直接缺席。

`modelOverrides` 无需这份代价就能就地重塑单个已安装 catalog 模型：每个键是一个 catalog 模型 id，每个值可写 `models` 条目接受的同一批字段，只是 id 落在键上，而 catalog 的其余部分原样继续服务——「改一个模型、其余三十七个原样保留」只是一次三行编辑。一条覆盖会成为该 catalog 条目的配置，因此容量、档位与 compat 沿与 `models` 条目相同的路径解析，携带相同的诊断与相同的请求默认值语义。覆盖只在正服务自身 catalog 的 catalog 路由上才有意义：与 `models` 列表并存的一份（该列表本就替换了 catalog）、落在手工声明路由上的一份（其模型已在 `models` 中完整写出），或点名了 catalog 未描述模型的一份，都会被拒绝而非跳过，因为一个静默保持原样的模型，就是一个否则要有人费力追查的笔误。

### 按模型的推理（reasoning）档位

`reasoningEfforts` 声明模型可选的思考级别：每个键是选择器提供的一个档位，其值是分派在协议中发送的拼写，因此 `high: high` 原样透传规范名称，而 `max: ultra` 则为使用自有词汇的网关改名。键取自 pi-ai 的档位集合（`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`）；未声明的档位不会被提供。省略该字段会保留已安装 catalog 条目的能力（手工声明的模型没有这份能力，也不推理）；`false` 声明一个不具备推理能力的模型，profile 正是以此从其网关无法服务的 catalog 模型上剥除推理；空声明会被拒绝，而不是在这两种含义之间去猜。

该声明会转换为 pi-ai 的 `Model.reasoning` + `thinkingLevelMap`，其中每个档位都被显式决定——未声明的档位一律固定为不支持，而不是留给 pi-ai 自己的默认规则：那套规则并不对称（键缺席对五个基础档位意味着「支持」，对 `xhigh`/`max` 却意味着「不支持」），也本不该要求 profile 作者了解。`off` 是唯一的三态键：不写它，选择器不提供 Off，显式请求 Off 会被拒绝——不点名任何档位的请求仍会在不带该参数的情况下发出，提供方随后做什么是它自己的默认行为；声明而不给值（`off:`），则会提供 Off，选中它时什么也不发送——对 `deepseek` 方言则是一个显式的 `thinking: {type: "disabled"}`——这同时覆盖完全不点名任何档位的请求；声明并给值（`off: none`），该值就会作为档位参数在协议中发送。没有任何写法能把 catalog 映射中的键恢复为「未设置」：这份声明就是对外提供的全部，因此把你要保留的 catalog 档位重述出来。

### 推理分派的 compat 开关

思考级别如何在协议中传输——单独一个 `reasoning_effort`、DeepSeek 的 `thinking: {type}` 加上档位、z.ai 的 `thinking` 对象，诸如此类——就是 pi-ai 的 `compat.thinkingFormat`，pi-ai 会从端点 URL 猜测它；私有网关的 URL 什么也说明不了，于是说 DeepSeek 方言的网关只会收到 OpenAI 方言的请求，且无从更正。因此 `compat.thinkingFormat` 与 `compat.supportsReasoningEffort` 既可配置在路由上（作为其模型的默认值），也可按模型配置（逐字段胜出），解析顺序为模型 → 路由 → 已安装 catalog 条目 → pi-ai 按 URL 得出的猜测；设置路由级开关会为路由上的每个模型遮蔽 catalog 条目的值，而且除了重述其值，没有任何写法能把某个字段交还给 catalog。`thinkingFormat` 接受 pi-ai 可分派的各种格式，但不含两个 `chat-template` 变体：它们需要的 `chatTemplateKwargs` 本配置并不暴露。两个开关都只存在于 `openai-completions` 上——其余协议的推理形状由协议本身承载——因此在其他协议的模型上设置模型级开关会使解析失败，路由级开关会跳过其他协议的模型，而完全没有 `openai-completions` 模型的路由则会被拒绝。pi-ai compat 面的其余部分（`supportsStore`、`maxTokensField`……）保持自动检测，特意不在此处开放配置。

条目与已安装 catalog 都没有给出尺寸的模型，会采用该路由的 `defaultContextWindow`（262,144）与 `defaultMaxTokens`（32,768），因此一份只公布 id 的列表同样能产出可服务的路由。两个回退值本质上都是猜测，这正是它们作为路由字段、供网关服务更小模型的部署一次性更正的原因，而不是埋在适配器里的常量；回退值只用于给模型定尺寸，绝不会变成单次请求上限。

请求模态的解析顺序是：条目的 `input` → 已安装 catalog 条目 → 路由的 `defaultInput`（默认 `[text]`），与上面两个容量字段的顺序和「回退值」定位完全一致。因此 catalog 模型保留 catalog 为它记录的模态，更窄的路由默认值也绝不会把它剥掉；而**未被 catalog 描述的**模型全都接受图片的网关，只需在路由上写一次 `[text, image]`，不必逐条目写。条目的空列表与缺省同义——它描述的是一个什么都不接受的模型，因此不作答，解析继续往下走——这正是当 `models` 条目点到某个 catalog 模型却不声明模态时，该模型仍保留 catalog 自有模态的原因。路由的那个则不得为空，因为它下面已经没有可以代为作答的层级。

`[text]` 是「尚未声明」，而不是对端点的猜测——这也是为什么这里的回退值取保守值，而两个容量回退值只是取一个说得过去的值。这里没有任何环节会去询问网关实际接受什么，而两种猜错的代价并不对等：模态中不含图片时，Harness 会在图片被附加之前就拒绝，因此少声明的代价是一次点名该模型的拒绝；而多声明会接纳一张图片、再由提供方在轮次中途拒绝——此时消息已经持久化，会话便会不断重复一个不可能成功的请求。

路由完全无法服务时解析仍会失败得响亮，并点名出问题的路由与模型：catalog 未提供的路由需要 `api`、`baseURL`，以及一个由唯一标识的模型组成的非空 `models` 列表。该解析在分节 schema 内部运行，因此无法服务的 profile 会在**写入之处**被拒绝——`settings.mutate` 以 `settings-rejected` 点名路由与模型——而不是先存下来、再悄悄让该 namespace 下每条路由失效。对于已经存下的、在此失败的分节，settings seam 会保留该 namespace 上一份可用值，因此这不会把部署卡死。`api` 接受 `supportedProtocols()` 中的协议，且仅在 catalog 无法提供协议时才需要：catalog 中不存在的模型会继承其同门模型一致同意的协议，因此向单协议 catalog 路由添加模型无需重述任何内容。


`baseURL` 设定该路由下每个模型的端点，因此仍支持 `https://proxy.example.com:8443` 等私有 proxy；省略它的 catalog 路由会保留每个 catalog 模型自己的端点。在 catalog 路由上点名 `api` 会把整条路由改指到该协议，这正是部署把某个提供方在 Responses 与 Chat Completions 之间迁移的方式。

`supportedProtocols()` 刻意窄于 pi-ai 的完整流式 API 集合：它只保留 profile 能用密钥、端点与标头**完整描述**的那些协议。Bedrock 要用 AWS 凭据与 region 做 SigV4 签名，Vertex 需要 project、location 与应用默认凭据，Azure 需要提供方环境外加 api-version，Codex 走 OAuth——提供它们只会交回一个无法完成认证的路由。catalog 路由仍可经自己的 provider 抵达这些协议；被拒绝的只有显式覆盖。

## 动态配置（settings + credentials）

适配器经由一个 thunk **每操作读取一次** profile，而非在构造期冻结。插件在可选的 `ctx.settings` seam 上用同一份 `Config` schema 注册 `llm-pi-ai` namespace，并以其 `cordis.yml` 条目为组合 `base`；由于 `providers` 是字典，base 与用户的 `llm-pi-ai:` settings 分节**按提供方**合并：用户可以新增路由、覆盖组合路由的单个字段，或把路由指向另一个 proxy，全部在下一次请求生效，无需重启。未挂载 settings 服务时，仅由 entry 配置驱动适配器，行为不变。

凭据在每次流调用时通过 `apiKeyEnv` 与可选的 `ctx.credentials` seam 解析；未挂载该 seam 时，适配器只读取该引用指向的环境变量。只有完全没有点名任何凭据的 profile——仅限这一种情况——才交给 pi-ai 的环境发现。每个解析出的密钥都会在使用前去除首尾空白并校验格式，因此 HTTP 标头无法承载的值会被拒绝，而不是以语义不明的 `fetch` `TypeError` 形式浮现；这种拒绝会抛出 `LlmError('INVALID_CREDENTIAL')`，点名失败的路由与凭据引用，但绝不透露密钥的任何部分。路由集合与每条路由捕获的重试策略是注册级事实：两者任一变化时，插件都会原子地替换自己的注册（同一适配器实例，候选集合先经校验），因此某条路由若已被另一适配器占有，先前的路由会继续服务，而改回可用配置时注册会重新生效。提供方键的顺序绝不算作变化。本适配器无法服务的分节会在写入处被拒——注册的 `validate` 会解析整份 profile 集合，因此 `ctx.settings.mutate` 以 resolver 自身的错误拒绝（该协议将其报为 `settings-rejected`），什么都不会存储。已存储分节若因其他途径变得不可服务——比如外部编辑了 `settings.yaml`——则由 settings seam 保留该 namespace 最后可用的值并告警。entry 配置本身仍会使插件加载失败；而 llm 注册表拒绝的路由（已被另一适配器族占有的那种）会被记录下来，先前注册的路由继续服务。

适配器通过 `ctx.llm.listModels(provider)` 公开每条已配置路由的模型。这是从请求路径所用的同一个 pi-ai `Models` 集合读取的提供方无关 selector 元数据，因此发现不会创建第二个模型注册表。`ctx.llm.resolveModelInfo(provider, model)` 会执行一次精确 descriptor 查找，并返回其身份、上下文窗口、已配置输出上限和可选思考级别，让权威元数据保留在拥有路由的适配器上，而非消费方。模型**已配置**的 `maxTokens` 会成为 seam 的 `defaultMaxTokens`，因此未点名输出上限的请求会携带部署选定的那一个；而从已安装 catalog 继承来的值是模型的输出**能力**，绝不会自行变成请求默认值。

携带推理元数据的模型——来自已安装 catalog，或来自其条目的 `reasoningEfforts`——会公开 pi-ai 有序的 `getSupportedThinkingLevels(model)` 结果，不经筛选或规范化，其中包括 `off`，以及模型对 `xhigh` 或 `max` 的特定支持。Harness 将每个规范 pi-ai 级别公开为不透明 ID；提供方／模型在协议格式中的表示仍保留在 pi-ai 的 `thinkingLevelMap` 中。

**没有**这份元数据的模型——条目未声明 `reasoningEfforts` 的手工声明模型，以及 pi-ai 标记为不具备推理能力的 catalog 模型——完全不公开 `reasoning`。pi-ai 会把这类模型报告为只支持 `off` 一档，但 `off` 会被翻译成*省略* reasoning 选项，而那与「不点名任何档位」产出的请求逐字节相同：选它关不掉任何东西，于是自身默认就在思考的提供方，会在界面显示 `off` 被选中的同时继续思考。把该能力报告为不可用，界面就只剩提供方默认这一项，不会再出现自相矛盾的控件。配置 profile 的 `reasoning` 值（包括 `off`）在存在时是部署默认值；省略它会保留提供方默认值。每次请求的 `GenerateOptions.reasoningEffort` 优先；未出现在确切模型能力中的档位会让**请求**在网络 I/O 前以 `UNSUPPORTED_REASONING_EFFORT` 失败，而不会被自动调整。**描述**一个模型则从不这样失败：同一提供方下各模型接受的档位并不一致，因此 `resolveModel` 对该模型拿不下的 profile 档位报告为「没有默认值」，而不是抛错。在那里抛错会让整个提供方从任何基于它构建的模型目录中消失——一个配错的 profile 字段连支持该档位的模型也一并藏起来——所以坏配置暴露在被执行处，而不是被描述处。pi-ai 的通用流选项通过省略 `reasoning` 表示 `off`。

受支持的 profile 字段是 `apiKeyEnv`、`displayName`、`api`、`baseURL`、`models`、`modelOverrides`、`compat`、`defaultContextWindow`、`defaultMaxTokens`、`defaultInput`、`headers`、`reasoning`、`thinkingBudgets`、`cacheRetention`、`transport`、`timeoutMs`、`websocketConnectTimeoutMs`、`streamIdleTimeoutMs` 和 `retryPolicy`。每个 profile 的可选重试策略都会与该提供方路由一同捕获；省略时使用有界的常规默认值。流空闲间隔必须是正的有限 Node 定时器延迟，默认为五分钟，且只覆盖未完成提供方读取，不包括消费方思考时间。若已配置标头中有同名项，则以 Harness 应用归因为准。

适配器强制 pi-ai SDK `maxRetries` 为零，因此一次 `stream()` 调用只会发起一次提供方请求。已移除 profile 字段 `maxRetries` 和 `maxRetryDelayMs` 会使加载失败，而不是静默倍增或隐藏单独组合的 agent（智能体）级重试预算。空闲超时会 abort SDK 的稳定请求信号，并以 `TIMEOUT` 呈现；较早的调用方 abort 仍为 `ABORTED`。

## 端点询问

插件提供 `ctx.llm.registerModelDiscovery('llm-pi-ai', …)`，用来回答「这个提供方能服务哪些模型？」——针对配置界面正在编辑或起草的路由。它刻意**不是** catalog 刷新：什么都不存储，回复是界面供用户采纳的候选。`settings.yaml` 始终是唯一决定路由服务什么的东西。

点名了**已安装 catalog 所提供路由**的请求，直接由该 catalog 作答，完全不联网：pi-ai 的注册表才是它自家提供方的权威列表，且携带列表端点不会公布的上下文窗口与输出上限。这类路由根本不需要 `baseURL`。只有 catalog 未描述的路由——网关、自建服务——才会经协议层询问；若它也没给端点，则会被告知去设置一个或手工填写模型。

草稿携带的是用户当下键入的凭据（如果有）；已经存好凭据的路由，在配置界面上只呈现一个脱敏描述符，因此询问会解析该路由的 `apiKeyEnv`，而不是不带认证发出去、再把端点的 401 报成密钥不对。键入的密钥优先，因为那正是被测试的那一把。解析只发生在真正要联网的路径上，因此 catalog 路由作答时完全不会触碰凭据。用户提供或已存储的探测密钥也会经过同样的去除空白与格式校验：HTTP 标头无法承载的值会被立即以 `LlmError('INVALID_CREDENTIAL')` 拒绝，而不会传到 `fetch`——否则会呈现为一个和端点不可达难以区分的、语义不明的 `ByteString` 失败。

询问只读 `openai-completions` 与 `openai-responses`，它们「`GET /models` + bearer 认证」的形状是网关、自建服务与官方端点三方一致认可的那一种。Azure 尽管出身 OpenAI 也被排除——它用 `api-key` 标头认证并要求 `api-version` 查询参数——Codex 则走 OAuth；其余协议一律以 `DISCOVERY_UNSUPPORTED` 回答，让界面回退到手工填写，而不是把认证失败报成一个没有模型的提供方。`baseURL` 按前缀而非待解析 URL 处理，因此 `https://gateway.example/openai/v1` 这类部署路径会保留其路径段。

多数列表只公布 id；`context_window`/`context_length` 与 `max_output_tokens`/`max_tokens` 在网关提供时会被读取，没有可用 id 的条目会被跳过而不是让整份列表失败，其余仍由采纳方补齐。回复在四兆字节上限下读取，且上限落在实际收到的字节上——端点是用户自己填的 URL，因此会先看声明长度，但绝不把它当作边界。端点不可达、凭据被拒、响应非 JSON、以及响应没有 `data` 数组，都会以 `DISCOVERY_FAILED` 失败，消息点名端点；仅当 401 或 403 时才点名凭据。读取响应体期间被取消会呈现为 `ABORTED`，与请求发出之前被取消一致。

## 提供方／模型路由与回放

每次解析产出一份**不可变**快照——profiles 加上一个持有各路由所建 `Provider` 的 `createModels()` 集合——每个操作都在自己第一个 `await` 之前整体捕获一份快照。配置变化会构造**新**集合，而不是改动正在被使用的那个：`Models.streamSimple()` 是惰性的，它在流首次被消费时才解析 provider，而那已在 credential await 之后，因此改动共享集合会让一个在旧配置下开始的请求在新配置下结束，或者撞上一个已不存在的 provider。这正是 seam 的每步调用冻结（`llm.prepareCall()`）能贯通到底的原因——回复途中切换模型会在下一步生效，绝不会影响在途的那一步。请求经 `Models.streamSimple()` 抵达提供方。保持 catalog 协议不变的 catalog 路由会**复用**已安装提供方，只替换其模型列表，因为该提供方持有本包无法重建的 API 实现——Bedrock 经由独立入口加载其 Smithy 模块——从零件重建会静默收窄可用提供方的范围。其余路由都由 `createProvider()` 基于 `supportedProtocols()` 背后的协议表构造，表中条目正是 pi-ai 自己的提供方工厂所用的同一批 factory。

凭据绝不进入该集合。harness 在请求抵达 pi-ai 之前经自身 seam 解析路由密钥，并作为请求的 `apiKey` 选项传入，而 pi-ai 将其视为优先级最高的 auth 覆盖；因此 `Models` 不持有任何凭据存储，harness 也保住了自己明确失败的引用语义。没有点名任何凭据的路由会解析为「已配置但无密钥」，把该要求留给协议——那才是它真正所在的位置。

所选模型 descriptor 提供协议实现。这包括原生 API 差异，例如 descriptor 使用 Responses API 而非 Chat Completions 的 OpenAI 模型；harness 适配器不会按模型名称硬编码端点选择。

成功的 assistant 响应会将经版本化的无损 JSON 回放状态与生成该响应的提供方和模型一同存储，其形式是 `ReplayEnvelope`：一个响应级半区（kind、版本、API、路由、响应 id、原生停止原因），加上每个流式块一条、携带该块 signature 的逐块条目。逐块对齐正是 `BlockAssembler` 在组装丢弃某个块（`max-tokens` 下的工具调用）时裁剪的对象，因此存储的条目始终描述存储的内容——保留的块保有其 signature。请求时，`LlmRuntime` 只有在历史提供方路由与目标提供方路由当前由同一个 `PiAiAdapter` 实例拥有时，才会传递回放状态。即使目标提供方或模型改变，适配器也会验证状态并恢复 pi-ai 响应 id 与提供方 signature；随后由 pi-ai 判定目标 API 可以复用哪些元数据。没有回放状态的历史会被转换为外来的、与提供方无关的内容，绝不伪装为原生 pi-ai 响应。

持久化内容是权威记录；回放状态只负责恢复原生保真度。当前构建无法使用的已存状态——其他适配器的 kind、其他版本（包括旧日志携带的平铺前信封形式）、格式错误的元数据、消息与回放状态之间的提供方／模型不匹配，或内容／块不匹配——会把这一条 assistant 消息降级为同样的外来提供方无关转换而不是让请求失败，插件通过其 `onReplayDegrade` 钩子记录 `INVALID_REPLAY_STATE` 诊断。

## 词汇差异

- pi-ai 工具调用参数是已解析对象；harness 存储原始 JSON 字符串。适配器会解析输入，并将输出重新字符串化。
- pi-ai 将失败报告为流内错误事件；它们会映射到 `finish {kind:'error'|'aborted', failure}` 分片。提供方特定错误文本会区分终止型 `QUOTA` 与暂时型 `RATE_LIMIT`，针对已解析模型上下文窗口评估的文本与 usage 信号则将溢出规范化为 `CONTEXT_WINDOW_EXCEEDED`。终止时的 `stop` 若消息不含内容块，则会映射为 `finish {kind:'error'}`，code 为 `EMPTY_RESPONSE`（默认策略会重试），而非成功空消息。
- pi-ai 将推理 token 折叠到输出 usage 中；没有可映射的独立推理计数。
- pi-ai 的 `off` 思考级别会原样穿过 Harness 能力 seam，并在分派时变为被省略的 pi-ai 通用 `reasoning` 选项。
- `GenerateOptions.stop` 会以 `UNSUPPORTED_OPTION` 被拒绝，因为 pi-ai 的通用流式输出接口无法保证所有提供方都支持它。

## 应用归因

每个请求都携带 dsh-llm `attributionHeaders()` 的共享归因标头，并通过 pi-ai `headers` 流选项合并。不会合成提供方特定应用归因标头。详见 [dsh-llm § 应用归因](../llm/README.md#app-attribution-attributionts)。

## 依赖体量

pi-ai 会安装多个提供方 SDK，并延迟加载 catalog 模型所选的 SDK。该可选适配器包将依赖体量隔离在自身范围内。

## 模型体验

### 通过 pi-ai 发起的提供方请求

#### 模型看到的内容

所选 catalog 模型会收到 `GenerateOptions.system`、历史、工具，以及 pi-ai 通用流式 API 支持的采样字段。本包不添加提示词文本。只有当适配器验证提供方原生回放元数据与历史内容匹配时，才会恢复这些元数据。

#### Token 影响

精确输入取决于提供方 tokenization。转换不添加模型可见文本；回放元数据可能让原生 API 复用提供方侧状态。

#### KV Cache 影响

转换保留逻辑请求顺序，不添加文本；复用取决于所选提供方的序列化与回放状态。更改适配器实例、提供方、模型或任何上游请求 token，都可能使复用从首个出现差异的 token 起失效。

### 提供方响应

#### 模型看到的内容

pi-ai 事件会变为 harness 推理、文本、工具调用、usage 与 finish 分片。适配器把解析后的工具参数作为原始 JSON 字符串传给 harness。

#### Token 影响

只有在 loop 记录生成内容后，它才会影响后续输入。提供方不单独报告推理 token 时，pi-ai 会将其折叠到输出 usage 中。

#### KV Cache 影响

已记录响应内容会追加到下一个请求，不会使其较早可复用前缀失效。未记录传输元数据与 usage 计量不影响 cache 身份。

## 已知限制与暂缓事项

- **仅以 OAuth 认证的提供方不予提供**：pi-ai 的 OAuth 只从*已存储*的 OAuth 凭据解析，而本适配器构造 `Models` 集合时不注入凭据存储、也不运行登录流程，因此这类路由的每个请求都会在发出之前以 `Provider is not configured` 失败。可配置提供方目录因此不列出它们；已安装 catalog 中只有 `openai-codex` 属于此类。settings 文档已经写过的路由仍保留目录条目，配置界面据此可以编辑或删除；`apiKeyEnv` 也仍能用该密钥完成认证——对 Codex 而言那是一个会过期、且这里没有任何环节会去刷新的 token。
- **提供方自带的凭据发现只读进程环境**：不指定凭据的路由交由 catalog 提供方自行解析，而它探测的是环境变量（`AZURE_OPENAI_API_KEY`、`AWS_PROFILE`、`AWS_ACCESS_KEY_ID` 以及各提供方自己的那一组）。它不读任何本地凭据目录，因此只有 `~/.aws/credentials` 而未导出 `AWS_PROFILE` 会被解析为未配置；由 harness 凭据 seam 保管的值，除非进程环境里也有，否则对它不可见。
- **settings 能新增或覆盖路由，但不能移除组合路由**：用户层合并在组合 `base` 之上，因此删除 `cordis.yml` 提供的提供方属于组合变更；对该 namespace 执行 `replace` 只会重置用户层。
- **分层合并对字典键没有删除语义**：settings seam 把组合 `base` 与用户层按键递归合并，因此 base 声明的某个 `reasoningEfforts` 档位、`modelOverrides` 条目或 `compat` 字段，用户层只能覆盖、无法移除——而 `reasoningEfforts` 里缺席本身*就是*语义（「不提供」），于是 base 声明过的档位会一直被提供。只有 `cordis.yml` entry config 为用户层正在编辑的同一模型声明了按模型推理字段才会触发；受支持的姿态是把这些字段留给 settings 文档（shipped 组合以 dormant 方式挂载该适配器），且 `models` 列表是数组、整体替换，这是带内的解决办法。
- **`headers` 可能承载一条脱敏器看不见的凭据**：profile 的 `headers` 是纯字符串字典，因此设在其中的 `Authorization` 或 `api-key` 会被脱敏后的 `describe()` 原样返回，并被任何配置 UI 渲染出来。请把凭据存为 `apiKeyEnv` 引用；把该字典整体改为只写与其余[协议边界工作](../llm/README.md#known-limitations-and-deferred-work)一并暂缓。
- **路由的 catalog 不会自我刷新**：catalog 就是 `settings.yaml` 所写的内容，因此模型列表的新鲜度只到最近一次编辑为止。这里没有任何环节会去问提供方它服务哪些模型；路由要多一个模型，得有人写进去。
- **每条路由只有一种协议格式**：`api` 作用于整条路由，因此混合协议的 catalog 路由（跨 Responses 与 Chat Completions 的 OpenAI 式 catalog）无法承载另一种协议的模型，向这类路由添加它未描述的模型必须点名 `api` 并把全部模型一起迁过去。把该提供方拆成两个路由键是变通办法。
- **模态声明不经验证，且多声明的后果超出本轮**：没有任何环节会去询问端点接受什么，因此声明了网关并不提供的 `image` 的模型不会在这里被拦下，而是由提供方在轮次中途拒绝。prompt 准入在构造请求之前就把用户消息持久化提交，于是被拒绝的图片留在会话日志里：该模型会不断重发它，而模型选择拒绝切换到任何纯文本模型。恢复途径是换一个确实支持图片的模型、fork 到图片之前，或开启新会话；发送失败时把尚未消费的图片消息从日志中回滚出去这件事已暂缓。
- **未认证路由取决于其协议**：不点名凭据会让路由解析为「已配置但无密钥」，但 pi-ai 的 OpenAI 兼容实现仍要求 API key 或 `Authorization` 标头，因此无鉴权的本地服务需要一个由 `apiKeyEnv` 引用的占位凭据，或在 `headers` 中给出 `Authorization` 条目。
- **不支持 `GenerateOptions.stop`**：pi-ai 的通用流选项无法保证所有提供方都支持 stop sequence，因此适配器会拒绝该字段。
- **历史中的 `system` 消息使用 pi-ai 通用上下文转换**：提供方特定位置由 pi-ai 决定，而非由 harness 拥有的协议覆盖决定。
- **无法获取提供方 HTTP 状态**：pi-ai 错误事件不会在所有提供方上公开稳定 HTTP 状态；失败只公开稳定 harness 错误 code。
- **重试策略由提供方持有，而不是 SDK 重试**：每个提供方 profile 都可以配置嵌套的 `retryPolicy`，由 `dsh-llm-retry` 在 agent 的失败步骤扩展点上执行；pi-ai SDK 重试仍保持禁用，因此持久化的 agent 步骤与 `llm/retry` 事件记录每次可见尝试，直接 `ctx.llm.stream()` 调用仍只尝试一次。
