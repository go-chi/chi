# Agent Note: 询问草稿中的提供方端点

Status: implemented

[English](2026-08-04-draft-provider-endpoint-interrogation.md) | 中文

## Problem

当 pi-ai 路由变成[一份声明而非 catalog 查表](2026-08-03-pi-ai-declared-provider-catalog.md)之后，要接入一个 OpenAI 兼容网关的人，必须先知道它的模型 id 才能完成配置。适配器不再把人限制在已安装 catalog 里——这正是那次改动的目的——但也意味着没有任何东西告诉用户该端点究竟服务什么，而这类端点大多在 `GET /models` 上公布了这份列表。

显而易见的答案——后台刷新的运行时动态 catalog——已随下层一并被拒绝：它会把路由的模型列表变成需要缓存、失效语义与离线路径的外部可变状态，而产品需求要窄得多。真正需要的是*一次性询问*，其答案由用户采纳进 `settings.yaml`，从而让 `settings.yaml` 始终是决定路由服务内容的唯一真源。

麻烦之处在于，被问的对象还不存在。正在新增的提供方没有路由、没有已存 profile、也没有已存凭据；端点与密钥都是用户尚在输入的表单值。而现有的每个 LLM（大语言模型）Service Definition 操作都以已注册的提供方路由为键，因此没有一个能承载它。

## Decision

询问以 **settings namespace** 为键，而不是提供方路由：

- `ctx.llm.registerModelDiscovery(settingsNs, discover)` 让适配器插件为自己拥有的 namespace 提供「询问端点」的能力，`ctx.llm.discoverModels(settingsNs, request)` 发起询问。没有任何办法枚举哪些 namespace 注册过：询问不了的界面会从那句拒绝里知道，而一份无人消费的列表只会变成一个什么都不做的必填协议字段。以 namespace 为键是对的，因为配置界面已经从可配置提供方目录里拿到了它，也因为正在新增的提供方没有路由可点名。
- `LlmModelDiscoveryRequest` 携带草稿——可选的 `provider`、可选的 `baseURL`、可选的 `api`、可选的 `apiKey`，以及一个 signal——且 `provider` 与 `baseURL` 至少要有一个，才有东西可答。`provider` 之所以存在，是因为适配器已经描述过的路由直接由它自己的注册表作答、完全不联网；只有它未描述的路由才会抵达某个端点。这条路径不写 settings 与 credentials。唯一的读取是请求所点名路由的凭据：配置界面拿到的是脱敏描述符而非已存的机密，因此草稿里的 `apiKey` 只在用户正键入时才存在；没有这次读取，已配置好的路由就会被不带认证地询问，只换回一个 401。键入的密钥优先，因为那正是被测试的那一把。
- `LlmDiscoveredModel` 除 `id` 外每个字段都可选，因为大多数列表只公布 id。回复是候选而非 catalog：采纳其中一条的界面仍要补上适配器所需的容量。
- `llm.discoverModels` 把同一份草稿送过协议层。它的 `apiKey` 是可承载机密的第三个、也是最后一个载荷（另两个是 `settings.update`/`mutate` 与 `credentials.set`），且绝不被存储或回显。它确实会像其他承载机密的载荷一样随客户端外发信封同行，`subscribeEnvelopes()` 观察者看得到；把那个抽头脱敏是整个配置面的改动，不该由这一个方法独自决定。除密钥之外，将它限制为仅可通过回环访问还有第二个理由：它让宿主向调用方选定的 URL 发起 GET 并回报结果，这是匿名 LAN 调用者不该拥有的探测能力。每一种拒绝都折叠为 `model-discovery-failed`，其消息是适配器自己的文本，details 点名被询问的端点，绝不点名所提供的凭据。

`dsh-llm-pi-ai` 的实现只是一次朴素的 `GET {baseURL}/models`，且仅限 OpenAI 兼容协议。它们的列表形状是网关、自建服务与官方端点三方一致认可的那一种，而这正是该动作存在的场景。其余协议一律以 `DISCOVERY_UNSUPPORTED` 回答，让界面回退到手工填写，而不是把猜错的响应形状报成一个空提供方。`baseURL` 按前缀而非待解析 URL 处理，因此 `https://gateway.example/openai/v1` 这类部署路径会保留其路径段。回复在四兆字节上限下读取，且上限落在实际收到的字节上——端点是用户自己填的 URL，因此会先看声明的 `content-length` 作为善意提示，但绝不把它当作边界；这与 `dsh-web-fetch` 面对自己的调用方提供 URL 时所用的两段式形状一致。

### 为什么不用 pi-ai 自己的 refresh 机制

pi-ai 提供了 `createProvider({ fetchModels })` 加上 `Models.refresh()` 与 `ModelsStore`，而下层本来就在构造 pi-ai `Provider` 对象。把询问接到它们上面，意味着每问一次就要构造一个用完即弃的提供方与集合，而那个 store 的全部目的——跨运行持久化 catalog——恰恰与「`settings.yaml` 拥有 catalog」的决定相抵触。而且它什么也换不来：**没有任何一个 pi-ai 内置提供方实现了 `fetchModels`**，因此 HTTP 调用及其响应解析无论如何都是本包的代码。直接 fetch 才如实说出正在发生的事。路由已存的凭据由本插件自己那套逐请求解析器取出，且只在真正要联网的那条分支上进行，因此 catalog 路由作答时既不触碰凭据，也不会因为一把这次询问根本用不上的密钥而失败。

## Alternatives considered

**以提供方路由为键。** 与其他每个 LLM Service Definition 操作对称，也能让请求省去端点。但催生该功能的场景——新增提供方——没有路由，于是这个操作只对已配置好的提供方可用，而它们恰恰最不需要它。

**把能力挂在 `LlmAdapter` 上。** 适配器要经由路由注册才能抵达，因此问题相同；而且这会让一个适配器实例去回答它并不服务的端点的问题。

**让 host 读已存 profile，而不是接受草稿。** 对已配置好的提供方来说，不会有机密跨越协议层。但这样一来新增提供方就必须先保存一份不可用的配置，而端点已改却尚未保存的表单会静默地去询问旧地址。接受草稿让用户看见的与被询问的保持一致——凭据是唯一的例外，因为它是从不向界面展示、因而永远无法放进草稿的那个字段。

**询问 pi-ai 的每一种协议。** Anthropic 的列表恰好与 OpenAI 共用同一层信封，而 Google 的不是。只支持容易的那几种会让覆盖范围变得任意；更糟的是，猜错的响应形状会与「该提供方没有模型」无法区分。一个明说自己无法被询问的协议，会把用户送去手工填写——那正是既定的回退路径。

**用 `response.text()` 缓冲整个回复再判断长度。** 更简单，但上限会在字节已经到达之后才生效，而端点是用户随手填的任意 URL。

## Consequences

接入网关的人可以直接问它服务什么，而不必去翻它的文档；答案以候选形式抵达，由用户自己挑选，而不是被背着写进配置。seam 因此多了一个刻意保持很小的注册表：每个 namespace 一份、不存储、生命周期不超出 fiber。

代价是：协议层多了第三个承载机密的载荷，配置面的只写接口从两个方法变成三个。发现覆盖范围按协议而非按提供方划分——一个 Anthropic 兼容网关即便其列表能被解析，也仍须手工填写。而且由于没有任何环节会重跑该询问，模型列表的新鲜度依旧只到最近一次编辑为止；这与下层刻意做出的取舍是同一个。

## Testing

`packages/llm/llm/tests/topology.spec.ts` 覆盖注册表：每个 namespace 一份、随 fiber dispose（资源释放）、丢弃重复与不可用 id 且不凭空补容量的归一化，以及 `NO_DISCOVERY`/`INVALID_DISCOVERY` 两种拒绝。`packages/llm/llm-pi-ai/tests/discovery.spec.ts` 针对本地 HTTP 服务器驱动探测——含与不含公布容量的列表、被保留的部署路径、无凭据、草稿没带密钥时已配置路由自行取用凭据且键入的密钥压过它、catalog 路由完全不解析凭据即作答、被丢弃的行、401/403 与服务器故障之别、非列表与非 JSON 响应、不可达端点、调用方取消、不支持的协议，以及尺寸上限的「声明长度」与「流式」两种形态。`packages/host/apiproxy/tests/api-proxy-config.spec.ts` 在真实 proxy 上覆盖该 RPC：草稿完整抵达其 namespace、缺席字段保持缺席、没有 namespace 或凭据被写入，以及失败以 `model-discovery-failed` 呈现且序列化后的错误里不含凭据。
