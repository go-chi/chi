# Agent Note: GUI 分层与 RPC 协议——host/client 按能力提供方分层、四象限消息模型与 fetch 载体

Status: implemented

[English](2026-07-19-gui-layering-and-rpc-protocol.md) | 中文

> 分工线：本篇 = 分层模型 + 通道无关的 RPC 协议；协议的 Web 实现由 HTTP 上行加 [WebSocket 下行载体](2026-08-04-websocket-downlink-carrier.md)组成，浏览器对象层见 [Web 客户端架构笔记](2026-07-19-gui-web-client-architecture.md)。

## Problem

需要提供 UI 对接层，除已有 ACP（Agent Client Protocol）/stdio 基线外，还需要 Web（server）、Electron 等其他产品客户端。我们把它们统一称为 Client。希望具备以下能力：
- 一个 `dsh` 进程同时支持 `dsh web`（启动）和 `dsh --profile headless`（headless），一个进程两种模式（设计预留）
- 在 Electron 中使用与 `dsh web` 相同的 Web 技术启动

那么当前的工程代码需要稳定的分层职责模型，便于以后接入各类 client。

同时各消费方的物理通道不同（浏览器 HTTP／WebSocket、进程内 fetch/SSE、将来 IPC），还需要一个通道无关的消息模型和单一约定真源，让「加一个方法」「换一种载体」互不牵连，且 wire 上的每条消息可类型校验、可观测、可对账。

## Decision

### 分层

目录按照如下分层：
- `packages/host/*`：包只提供 Host 侧能力（代表了以现在 Harness 实体插件系统为主体的 Node.js 代码核心工程），除此之外，还包含
    - 统一后端协议（fetch、HTTP、流式接口等）定义和支持，见本篇「消息协议」起各节
- `packages/client/*`：包只提供 Client 侧能力，每包单边不混。这里住三类包（两条轴归 [client 插件装载笔记](2026-07-23-client-plugin-loading-model.md) 所有）：
    - **纯库**（`ui-slots`、`web-react`、`ui-primitives`，外加内核包 `loader`）：普通根入口包，静态打包进壳；前三者播种进模块表。
    - **静态到达 entry 包**（`connection`、`runtime`、`ui-theme`、`i18n`、`hmr`）：无 `dsh.client` 键、无浏览器 bundle——壳把它们的 `src/client/` 半边打进自己的 bundle 并向 `ctx.modules` 登记；它们与其余单元一样，作为 host 独家撰写的图里的 entry 受治理。
    - **fetch 到达插件包**（`ui-layout`、`ui-sidebar`、`ui-conversation`、`ui-trajectory`）：双入口——根入口是 node 半边（空 `apply`，其存在是为了让 host Loader 管辖生命周期、让 web 插件注册表发现 package.json 的 `dsh.client` 声明）；实现住在 `src/client/` 下，经 `./client` 子路径发布（tsdown 闭包工厂 bundle）。跨插件消费 `/client` 只限类型；值层面的协作走 cordis 服务。
- `apps/` 作为对外导出的应用入口，可以由 Client / Host 混合组装。
    - `apps/web`（`dsh-web-frontend`）是 vite 应用：`dsh-client-web` 导出的壳 API 之上的一层薄 `main.ts`。
    - `apps/cli`（`@deepseek-ai/dsh`）分发命令：`dsh web` = Host + webserver + 构建出的 `dsh-web-frontend` dist；`dsh --profile headless` = [直接使用核心 Agent／Session 的入口](2026-08-09-headless-direct-core-entry-point.md)，不含 Host、HTTP 或浏览器层。
    - 将来的 Electron 应用经由 IPC fetch 载体复用同一套 web client 包。

```
apps/*  (applications: apps/web = vite app, apps/cli = bin dispatch)
  │ consume
  ▼
packages/host/*                      packages/client/*
  apiproxy   front layer: protocol     pure libs: ui-slots / web-react / ui-primitives
  runtime    assembly / host entity    dsh.client plugins ×8 (node half = empty apply,
  webserver  Web HTTP carriage                              client half = src/client/)
  │ ctx.plugin(...)                      ▲ import only apiproxy's /api /client subpaths
  ▼                                      │ (type-only + the client base class)
harness core packages ──────────────────┘ (types reach the browser via import type)
```

方向纪律（每条都由包 deps 可核）：

- `runtime → apiproxy` 单向；apiproxy 仅依赖类型定义。
- client 侧包**永不 import** host 侧包的运行时（只吃 `/api`、`/client` 两个浏览器安全子路径）。
- `webserver` 不依赖 `runtime`：它提供 `{ fetch }` 特定实现 ——「webserver ← runtime」只是运行时注入关系，不是包依赖。
- client 侧跨包 import 插件包一律走 `/client` 子路径，且插件包之间只限类型 import——跨插件值 import 在 tsdown 纯度门禁处即构建错误（值层面的协作走 cordis 服务；边规则归 [client 插件装载笔记](2026-07-23-client-plugin-loading-model.md) 所有）。

TypeScript 以 solution 根引用的**两个聚合 program** 检查（`tsconfig.json` = solution；`tsconfig.host.json` = host 侧 + 测试，排除 `packages/client`；`tsconfig.client.json` = client 各包及其测试）：两侧在相同键（`sessions`、`loader`）下以不同服务合并 cordis `Context` 接口，单一 program 会同时看到两份声明合并而报冲突。共享叶子包（session/llm/tools/apiproxy 等）只构建一次，由两个 program 共同引用（[拓扑](../process/2026-07-22-tsconfig-solution-root-two-aggregates.md)）。

协议侧：TS interface（`packages/host/apiproxy/src/api/`，零 Node 依赖，浏览器可 import）；wire 消息统一为**双向模型**——每条逻辑消息按「谁发起 × request/response」分类（两轴四格，后文称四象限），与物理通道解耦；客户端统一继承 `AbstractApiClient`（协议不变量全在基类，平台差异只是 `doFetch` 传输切面）。

#### 分层角色

| 层 | 包 | 职责 | 关键纪律 |
|---|---|---|---|
| 前置层 | `dsh-host-apiproxy` | TS/zod 定义 (api/)+ fetch 抽象 (fetch/：handler + 客户端基类) | 做简单、每个消费方都要；Node/浏览器皆可 import；协议内容见下文「消息协议」起各节；client 不得经 ctx 绕开 api |
| 装配层 | `dsh-host-runtime` | 插件组合 + ApiProxy 集成 + web UI 插件挂载（覆盖八个 dsh.client 包的内存 Loader 树）；host 级配置归属地（defaults/persistenceRoot，将来用户 profile） | 装什么插件、给什么默认值只在这里定；壳不得改装配 |
| 承载层 | `dsh-host-webserver` | Web HTTP 与 upgrade：静态服务 + `/api/*`→handler 转发 + WebSocket upgrade route + close 语义；插件 bundle 端点 + `__DSH_BOOT__` manifest（元数据清单）注入（由 web 插件注册表供给） | Web（浏览器访问）专用；零 workspace 依赖（注册表经结构注入到达）；Electron 不复用它 |
| client 库 | `dsh-client-ui-slots` / `dsh-client-web-react` / `dsh-client-ui-primitives` | slot 注册表核心 / ctx↔React 胶合 / 纯 React 原子组件 | 组件零 cordis 运行时依赖；由壳播种进 loader 模块表 |
| client 插件 | `dsh-client-connection` / `dsh-client-runtime` / `dsh-client-ui-theme` / `dsh-client-i18n` / `dsh-client-ui-layout` / `dsh-client-ui-sidebar` / `dsh-client-ui-conversation` / `dsh-client-ui-trajectory` | 浏览器侧 cordis 插件树（wire 消费方、核心服务、主题、i18n、布局、侧栏、对话、轨迹）——见 Web 客户端架构笔记 | 双入口（node 半边=空 apply；实现在 `src/client/`）；消费面唯一经 ApiProxy |
| 应用 | `@deepseek-ai/dsh`（apps/cli）+ `dsh-web-frontend`（apps/web，vite 应用） | bin 粗分发 + 每个应用一个拼装模块（web.ts / headless.ts）；vite 应用是 `dsh-client-web` 壳表面之上的薄 main | 各应用使用动态 import，因此不会互相加载；dist 定位等 workspace 知识留在 app |

#### 命名规则

`packages/host/*` 与 `packages/client/*` 下的包名**必须含目录组前缀**：host/runtime → `dsh-host-runtime`、client/runtime → `dsh-client-runtime`。目录名不重复组前缀（host/ 已表达）。因此包名尾段 ≠ 目录名，tsconfig.base.json 的 `dsh-*` 通配（按目录名解析）命不中——**这两组的每包需显式 paths 条目**，且 client 各包的 `/client` 子路径要单列条目，使源码级解析与 exports map 一致。

#### 怎么接入一个新应用（操作清单）

1. **选 fetch 伪造方式**：浏览器同源 HTTP / 进程内 `host.handler.fetch` 注入 / 自写传输切面子类（如将来 Electron IPC，见下文「子类表」）。
2. **在 `apps/` 下写拼装模块**：`startHost()` + 客户端子类 + 该应用私有的信号/打印/退出语义；混合体不建包，拼装写在 app 里。
3. **需要 HTTP 承载才 import `dsh-host-webserver`**，否则零端口。

现有两个应用保持这一区分：Web 应用挂载 Host、载体与浏览器组合，而 `dsh --profile headless` 挂载直接使用核心服务的 runner，不包含 Host、HTTP 或端口。ACP 类协议桥不遵循 client 载体清单：它把 core 暴露给外部生态，直接通过 `ctx.plugin(入口插件)` 挂载，不使用 fetch。

## 消息协议

以下各节是前置层（`dsh-host-apiproxy`）承载的协议本体。wire 上只有四种消息（四象限）——右列的 Web 承载只是示例，换载体（进程内/IPC）时四象限不变：

```
                 client 发起                      server 发起
  request   ① ClientRequest                 ③ ServerRequest
            （POST /api/<method> body）      （WebSocket message：session 事件、审批/问答 requested）
  response  ② ServerResponse                ④ ClientResponse
            （该 POST 的 HTTP 应答体）        （POST /api/respond body，回填 ③ 的 rpcId）
```

### wire 全形：四具名判别 union（`api/rpc.ts`）

| 类型 | 判别 tag | 字段 | rpcId 归属 | Web 承载 |
|---|---|---|---|---|
| `ClientRequest` | `'client-request'` | `rpcId` `method` `payload` | client mint | `POST /api/<method>` body |
| `ServerResponse` | `'server-response'` | `rpcId` `result` | 回填 ① | 该 POST 的应答体（恒 HTTP 200） |
| `ServerRequest` | `'server-request'` | `rpcId` `method` `payload` | server mint | WebSocket text message |
| `ClientResponse` | `'client-response'` | `rpcId` `result` | 回填 ③ | `POST /api/respond` body |

`RpcMessage = ClientRequest | ServerResponse | ServerRequest | ClientResponse`，`switch (message.type)` 窄化。

**rpcId 纪律**（`RpcId` 是 branded string，构造函数 `RpcId()`）：

- 谁发起谁 mint；应答一律回填对应 request 的 rpcId，**绝不 mint 新 id**。
- server-request 分两类，静态按 `method`（=帧 type）区分，**不设第三种 kind**：可应答帧（`approval/requested`、`question/requested`）的 rpcId 是稳定逻辑请求 id（受理时 mint 一次、基线回放原样复用、client 以它回填应答）；纯推送帧（`session/event` 等）的 rpcId 标识该次推送（每次新 mint）。
- 业务代码不 mint：unary 的 mint 收口在客户端基类 `callUnary`，帧的 mint 收口在 host 侧。

### 签名窄形与载体补全

域接口签名只感知窄形：`RpcRequest<P> = { rpcId, payload }`、`RpcResponse<T> = { rpcId, result: RpcResult<T> }`。载体层把窄形补全为全形（补 `type` tag 与 `method`），方向不靠通道推断。`RpcResult<T> = { ok: true; value } | { ok: false; error: RpcError }`——方法不 throw 业务错误。

### RpcReceipt：载体回执

`ClientResponse` 的 HTTP 应答体是 `RpcReceipt = { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' }`——载体层回执，**不是** RpcMessage（response 不再有 response）；迟到/重复应答收 `not-pending`，逻辑收敛点是 `*/resolved` 帧。

## 类型体系：函数签名即真源

### RpcMethodMap 与派生泛型（`api/rpc-map.ts`）

方法的参数/返回结构**只住在接口方法签名里**；map 登记方法本身；其余一切位置（handler、client、store、测试）引用派生泛型，禁止复写字面量或另起平铺具名类型：

```ts ignore-check
export interface RpcMethodMap {
  'session.list': SessionsApi['list']        // map key 即 wire 路径段
  // …其余方法同形登记，全集见 api/rpc-map.ts
}
// 派生泛型（穿透窄形取业务类型；实际声明带 K extends keyof RpcMethodMap 约束）
export type RequestPayload<K> = Parameters<RpcMethodMap[K]>[0]['payload']
export type ResponseValue<K> =
  Awaited<ReturnType<RpcMethodMap[K]>> extends RpcResponse<infer T> ? T : never
```

流方法（`events.mux`/`events.host`）不进 map（不是 unary）；`respond` 不进 map（是 client-response 不是方法调用）。

### 错误模型（`RpcErrorDetailsMap`）

错误码示例一行：

| code | details | 何时 |
|---|---|---|
| `bad-request` | `{ issues: ZodIssue[] }` | wire/payload zod 校验失败 |

码全集见 `api/rpc.ts` 的 `RpcErrorDetailsMap`。`RpcError` 是 map 展开的分布式 union：`code` 判别、`switch` 后 `details` 自动窄化；**details 必填**——新码=map 加一行+错误 schema 加一支，漏填是编译错误。transport 故障（断网、host 没起）由载体抛异常，与业务错误两层不混。

### zod 双向校验与锚定

- **两级 parse**：全形 schema 一次（type/rpcId/method 结构 + handler 校验 path==method）→ 业务 payload 按 method/帧型分派二次 parse；拒收 = `bad-request`。
- **锚定**：schema 统一 `satisfies z.ZodType<Wire<T>>`（`api/rpc.schema.ts`）。`Wire<T>` 是深度「| undefined」宽化——仓库开 `exactOptionalPropertyTypes` 而 zod `.optional()` 输出 `T | undefined`，直接锚原类型全线不可用；JSON wire 上缺席与 undefined 同形，宽化不损失校验语义。透传宽分支（`SessionEvent`/`ContentBlock`/帧 union/`RpcError`）与 brand id schema 用显式 cast + 注释。
- brand cast 单点：每个 schema 文件的 id cast 收口一处（`rpcIdSchema` 是 rpc.schema.ts 唯一 cast 点）。

## 约定面（ApiProxy）

根接口 `ApiProxy = { sessions, host, events, respond }`（`api/index.ts`）。新 client-request 域 = 新的一对文件（`<域>.ts` + `<域>.schema.ts`）+ 根接口一个字段 + map 加行。

### unary 方法表

方法示例一行（表结构即读法）：

| method key | 请求 payload | 返回 value | 语义 |
|---|---|---|---|
| `session.list` | `{ cursor?: string }`（cursor 留座不实现） | `{ items: SessionSummary[] }` | 已持久化 session，updatedAt 倒序；v1 不建索引 |

其余方法（`session.create`/`session.history`/`session.rename`/`session.prompt`/`session.cancel`/`host.describe`）的参数与返回不在此复写——签名即真源，见 `api/sessions.ts`、`api/host.ts` 与 `RpcMethodMap`。

### 帧（server→client，具名 union）

两条逻辑流：mux 流（`/api/events.mux`，全 session 聚合）与 host 流（`/api/events.host`，host 级事件）。浏览器通过每流一条下行 WebSocket 消费，进程内 fetch 载体以 SSE 保持同构；物理边界见 [WebSocket 下行载体](2026-08-04-websocket-downlink-carrier.md)。帧示例一行：

| 帧 type | 载荷 | 何时发 |
|---|---|---|
| `session/event` | `{ sessionId; event: SessionEvent }` | 核心透传：core 事件原样过，`assistant/chunk` 即 token 流，无独立 delta 帧 |

其余帧型不在此复写，union 全集见 `api/events.ts` 的 `MuxFrame`/`HostFrame`。语义上须知三点：`session/subscribed` 的 lastSeq 供 history 竞态检测；`approval/question` 的 requested 帧可应答（rpcId 稳定）、resolved 帧是收敛面；`host/agent-error` 是无 turn 位置 live 失败的唯一出口。

**透传纪律**：wire 上的事件/消息/内容块就是 core 类型（`SessionEvent`/`ContentBlock`），不造第二套 DTO；类型经 `import type` 依赖链直达浏览器。`SessionEventMap` merge-extensible：client 对未知 type documented-default（忽略），事件 schema 留「合法信封+未知类型」分支——信封仍严格，不是字段级 passthrough。

### 会话语义（impl 侧承诺）

- **历史 = 事件回放**：一套 fold（client 侧），历史分页与 live 增量同一条代码路径；server 不做物化快照第二套。history **页边界对齐消息边界**（绝不从消息中间截断；分片随定稿消息归组），尾页含进行中 partial 的分片。
- **提示词关联**：提示词的 rpcId 经 MessageSource（`'user-rpc'`）透传进 `user/message` 事件，client 以此把乐观回显转正。
- **重连 = 重建**：不做续传 cursor（`mux` 的 `since` 签名留座、传了忽略）；断线重开流 + 重拉 history；`subscribed.lastSeq` 与 history 尾 seq 比对，有缝再补拉一次。
- **冷会话处理遵循所有权**：`session.history` 与 `session.fork` 的源端读取会在不获取 Agent 的情况下检查持久化存储，而绑定到 Agent 的普通会话方法（如 `prompt`）则通过在途表去重后恢复会话。由会话支撑的 subagent 会拒绝这条通用恢复路径，且附加状态不对客户端暴露（`running` 已经覆盖）。
- **审批/问答**：requested 帧受理时 mint 稳定 rpcId；先到先赢，host 内存 pending 表（keyed by rpcId）是唯一裁判；mux 重开后在 subscribed 帧后回放仍 pending 的 requested 帧（rpcId 原样复用，刷新恢复）。审计事件 `approval/asked`/`decided` 照旧走 durable 日志——帧=live 控制面，事件=durable 审计。**现状**：约定与帧类型已 shipped，host 侧 pending 表/wire answerer 未实现（`api-proxy.ts` 的 `respond` 是 stub，恒回 `not-pending`）；PendingCard v1 只展示。
- **不设协议版本**：client 与 host 绑定发布，`host.describe` 无 protocolVersion 字段；出现独立发布的 client 时再引入。
- **预留方法纪律**：map 只含已实现方法，未知 method 在信封 parse 即 fail loud（`bad-request`），不设 not-implemented 兜底码。预留清单（实现时把签名抄进域接口+map 加行+schema 加对即升格）：`session.fork`、`prompt.mode` 加 `'inject'`、`task.list`、`host.listModels`、describe 加 `hostInstanceId`。（`session.rename` 已从本清单毕业：追加 user 来源的 `session/title` 事件。）

## 客户端载体：AbstractApiClient 类体系（`fetch/client.ts`）

**协议不变量住基类，平台差异是两个切面**：抽象方法 `doFetch(url, init)`（传输）+ 可覆写 `onEnvelope`（观测）。

### IApiClient：caller 视图

与 `ApiProxy` 同域树，但 unary 方法**收业务 payload 直传**——载体 mint rpcId 并包信封，业务代码永不 mint；需要本次调用 rpcId 的从返回的 `RpcResponse` 回显里读。`ApiProxy` 是 impl 侧实现的窄形签名约定，`IApiClient` 是 client 侧消费的 payload 直传视图，`AbstractApiClient` 桥接两者。方法逐 key 从 `RpcMethodMap` 派生——map 加行即机械更新。

### 基类持有的协议路径

| 路径 | 内容 |
|---|---|
| `callUnary` | mint → tap → POST 全形 → `serverResponseSchema` parse → **rpcId 回显校验**（不符即 throw）→ tap → 吐窄形 |
| `readSse` | streaming fetch（非 EventSource）、`\n\n` 分帧、`data:` 拼接、ServerRequest 全形 parse、tap、吐窄形 `RpcRequest<帧>` |
| `respond` | client-response 透传（rpcId 是回填，此处不 mint）；应答体 `rpcReceiptSchema` parse |
| unary 时限 | 普通 unary 调用使用 `AbortSignal.timeout`（默认 30s，构造参数可调）；由用户掌控节奏的 `host.pickDirectory` 和 `command.execute` 不设该时限，但保留调用方／连接取消；流不设时限 |
| `resolveBase` | 浏览器=同源 origin；无 location 环境（Node）=`http://dsh.internal` 假 authority |

### 实例级 envelope 观测切面

四象限全形均过 `onEnvelope`；基类实现是**实例持有的微任务合批缓冲**（帧风暴不逐帧惊扰消费方；模块级状态会跨实例/测试泄漏，故实例持有）。观测者经 `subscribeEnvelopes(listener)` 订阅（收整批 `readonly RpcMessage[]`，返回退订函数）；listener 抛异常被隔离（观测不得反噬载体）。无订阅者时零缓冲成本。当前没有任何现役消费方订阅——该切面是 wire 诊断的预留位（已退役的 RPC 调试面板是它的首个消费方，将来的诊断消费方接入时不动载体）。

### 子类表（传输承载）

| 子类 | 所在包 | doFetch | 用途 |
|---|---|---|---|
| `InProcessApiClient` | apiproxy 本包 | 注入的 `{ fetch }` handler | **同构点**：`new InProcessApiClient(toFetchHandler(api))` 全程不过网络但真跑 wire 序列化/zod/SSE 帧；载体测试与调用方可以在不打开端口的情况下运行这套协议，而产品 `dsh --profile headless` 直接驱动 core |
| `WebApiClient` | dsh-client-connection | `globalThis.fetch` 上行 + 每逻辑流一条同源 WebSocket 下行 | 浏览器客户端；物理边界见 [WebSocket 下行载体](2026-08-04-websocket-downlink-carrier.md) |
| `FixtureApiClient` | dsh-client-connection | 不用（协议层覆写） | 无 server 的 UI 开发（`?fixture`）：覆写 `callUnary`/`openMux`/`openHost`/`respond` 虚方法，自己就是假 server（帧 rpcId 由它 mint，语义自洽） |
| IPC 桥子类（假想示例——尚无此形态） | Electron 壳 | IPC 序列化往返 | 只需换 doFetch，约定/基类零改 |

## 怎么扩展（操作清单）

**加一个 unary 方法（5 步）**：①域接口加方法签名（参数/返回内联，这是唯一真源）；②`RpcMethodMap` 加一行；③`<域>.schema.ts` 加 request/value schema 对（锚 `Wire<RequestPayload<'…'>>`）；④handler `UNARY_ROUTES` 加一行（handler 的 Web 承载见 Web 客户端架构笔记）；⑤impl 实现（回显 `request.rpcId`）。client 侧 `IApiClient`/`AbstractApiClient` 的域方法表同步加一行透传。

**加一个帧型（3 步）**：①`MuxFrame`/`HostFrame` union 加一支（可应答帧须注明 rpcId 稳定语义）；②帧 schema 加一支；③消费方的 fold/路由 documented-default 已兜底未知型，按需加显式分支。

**加一个错误码（2 步）**：①`RpcErrorDetailsMap` 加一行（details 必填）；②`rpcErrorSchema` discriminatedUnion 加一支。

**接一种新载体**：继承 `AbstractApiClient` 只实现 `doFetch`；需要拦截协议层（如 fixture（测试前置数据））再覆写 `callUnary`/`openMux`/`openHost` 虚方法。约定与基类零改。

**升格一个预留方法**：把预留签名抄进域接口 → map 加行 → schema 加对 → UNARY_ROUTES 加行 → impl 实现。

## Consequences

所有 client 使用同一约定：加一个 unary 方法是从单一签名出发的五步机械改动，换载体只动一个 `doFetch` 子类，wire 上每条消息可 zod 校验、可经 envelope tap 观测、可按 rpcId 对账。普通 unary 调用仍受时限约束，而 `host.pickDirectory` 与 `command.execute` 可保持挂起，直到操作完成或调用方／连接取消到来；若由用户掌控节奏的操作不自行结束，请求可能一直挂起，这是为避免把合理的操作时长视为传输失败而接受的代价。其余接受的代价：两组包需要显式 tsconfig paths 条目；预留方法（fork/inject/task.list/listModels/hostInstanceId）在真实消费方出现前保持休眠。

## Alternatives considered

| 放弃项 | 一句话理由 |
|---|---|
| 按产品分包（web 一族、electron 一族） | 产品共享的是 host/client 两侧能力，而不是某个应用实现；能力提供方分层让新应用零新包 |
| 混合体建包（如 headless 独立包） | 混合体只有一个消费方（它自己的 app），建包是无主抽象；拼装写在 app 里可读可弃 |
| 消费型 client 直连 ctx（省 apiproxy 一层） | client 需要 wire 校验、观测与多 client 一致性。直接 headless 是没有 client 边界的本地入口，使用公开的 Agent／Session seam，而不是 client 命令面 |
| webserver 依赖 runtime（省 handler 注入） | 结构 typing 注入让 webserver 可被 sidecar/测试复用且零 workspace 依赖；包依赖会把装配知识拖进承载层 |
| 包名不带组前缀（沿用 dsh-<尾段>） | `dsh-runtime`/`dsh-web-ui` 在扁平 npm 命名空间里失去归属信息；代价只是每包一条显式 paths |
| 复用仓内 JSON-RPC 2.0（dsh-sdk-jsonrpc-server） | 数字错误码退化成单码兜底、约定双份人肉对齐、命名无 convention 自然漂移 |
| 三信封模型（Request/Response/Frame 各一信封，签名不感知方向） | rpcId 是逻辑层关联，帧与应答的方向语义靠通道推断在换载体时即失效 |
| 具名 Request/Response 类型对为真源（map 登记类型对） | 平铺具名类型是同一事实的第二个名字；签名 infer 反推让加方法只改一处 |
| REST 风格路径 | 消费方是自家 client，无第三方 REST 体验诉求；RPC 直映方法表更机械 |
| DTO 层（wire 专用第二套结构） | core 类型 type-only 直达浏览器零成本；DTO 是永久的双向同步税 |
| cursor 续传（mux since 实装） | 重连=重建（opencode 同款）覆盖 v1 全部需求；签名留座，实装等真实消费方 |
| createApiClient 工厂函数（原实现） | 平台差异（传输/观测）是继承切面不是参数；类体系让 fixture 在协议层替换而不是包一层假信封 |
| 对 `command.execute` 应用 30 秒传输时限 | 命令耗时属于操作本身，而非传输健康预算；该时限会终止本应继续运行的长时处理器，调用方／连接取消已提供所需的停止路径 |
