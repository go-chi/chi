# @deepseek-ai/dsh-api-gateway

[English](README.md) | 中文

为 Host 与 Client 两侧的 Cordis 环境提供 Typert RPC endpoint。Host 入口提供 `ctx.typertGateway`，`@deepseek-ai/dsh-api-gateway/client` 则提供 `ctx.remote`；两者使用同一份生成的 `InvocationDescriptor` 约定，并将业务选择交给 API Remotes，将传输、请求关联、信任和响应封装交给 Connection。

## Host 服务：`TypertGatewayService`（ctx key：`typertGateway`）

每次调用时，`ctx.typertGateway.invoke()` 都会解析当前的描述符和 Cordis 服务，校验具名参数是否完全匹配，解析已注册的对象或 Context 身份标识，调用公开的业务方法，并校验其结果。业务服务继承 [`dsh-typert-protocol`](../../typert/protocol/README.md) 的 `TypertRemoteService`，并用 `@Remote` 或 `@RemoteScope` 标记方法；已有其他基类时仍可改用 `bindTypertRemote()`。

严格模式从 `ctx.typert.local` 读取生成的调用描述符。查找参数使用 `ctx.typert.lookups` 中当前有效的 resolver：业务包注册稳定声明与默认策略，Host 组合可用 effect-scoped `configure()` 覆盖解析行为；`@RemoteScope` 则通过已注册的 Host Context 提供方解析其接收者。SRC 模式是开发阶段的回退路径，适用于从未具备严格定义的端点；它解析简单参数名，并且只允许非查找参数使用可安全表示为 JSON 的值。已观测到的严格定义一旦撤回，系统会直接报错，而不会降低校验强度。

Connection 可用时，Host 入口会在 Connection 共享的 `/api` FetchHandler 上注册 trusted-host interceptor。Connection 把这个复合 handler 交给 HTTP bridge；handler 将已认领 endpoint 分发给 Gateway，未认领 endpoint 则交给 API Proxy。直接调用 `invoke()` 会保留业务错误；`TypertGatewayError` 可区分分发、绑定、提供方、查找、Context、参数和编解码器各自负责的故障。resolver 可以用 `TypertLookupFailure` 携带既有 RPC error，使冷恢复失败或 ownership fence 等策略拒绝保持原错误码。

支持取消的 Remote 方法会把 `signal: AbortSignal` 声明为最后一个 Host 参数。signal 是 descriptor 元数据，而不是 wire 参数：Connection 将它提供给 Gateway，Gateway 则在已解码的业务参数之后注入它。SRC 识别这个保留的末位参数名，严格生成还要求它具有全局 `AbortSignal` 类型。

## Client 服务：`ClientRemote`（ctx key：`remote`）

`ctx.remote.$mount()` 会校验并注册生成的 Host-for-Client 贡献项，然后为发起调用的 Cordis fiber 安装具体的直接方法和作用域方法。每个 namespace 都是可追踪的 `remote.<namespace>` 子 Service，并在最后一个方法撤回后卸载。重复端点、命名空间冲突，以及缺少生成的严格编解码器的描述符，都会在方法可调用前报错。

每次调用都会校验位置参数，构造与描述符完全匹配的具名 `args`，再通过 `ctx.connection.rpc.call('/api', endpoint, ...)` 发送。生成的支持取消的方法接受最后一个可选 `AbortSignal`；Client 会在调用 Connection 前将它与贡献项的挂载生命周期合并。返回值经过校验后才会交给应用代码。撤回贡献项会同时移除其描述符和方法、中止正在进行的调用，并使外部仍持有的方法句柄在调用时返回拒绝。

`ctx.remote.$on()` 订阅一条被转发的 Host 事件。它的合法键恰好等于 Host 装配声明的转发选择，listener 类型就是事件所属包自己的 Cordis `Events` 声明，因此不存在会与之漂移的第二份签名。每个订阅归属发起调用的 fiber，并随该 fiber 一起消失。投递是单向的，并按注册顺序进行；抛错的 listener 会被记录并与其余 listener 隔离，绝不影响帧泵。`ctx.remote.$dispatch()` 是该面的另一半，且属于载体：持有 Host 帧 sink 的 Client 半把每个解码后的帧交进来，收到无人订阅的事件名即丢弃，因为 wire 上出现什么取决于 Host 的转发选择。消费方只订阅，绝不调用它。

生成的声明合并通过共享的 `TypertClientRemote` 约定提供 TypeScript API。Client 入口不包含 Host 服务或 Host Cordis 接口合并；方法查找和调用使用普通对象与函数，而不使用 JavaScript Proxy。

## 模型体验

无，因为该包分发应用调用，不注册任何提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；被调用的业务服务负责产生任何模型可见结果。

## 已知限制与延期工作

- Connection 适配器将普通分发故障和业务异常映射为 RPC 的 `internal` 代码，且不附带详细信息；`TypertLookupFailure` 携带的 lookup 策略错误会原样返回。结构化的 `TypertGatewayError` 类别仅供同进程调用方使用。
- SRC 模式仅支持名称唯一的标识符参数，不支持解构、默认值或剩余参数。它只校验值能否安全表示为 JSON，不校验生成的业务类型，也绝不会推断可选字段。
- Client 侧只能挂载严格模式生成的贡献项。SRC 标记不具备 Client 编解码器或类型投影。
- 该包只分发一元方法。增量会话数据通过同一个 Connection 上独立的具名流协议传输。
- lookup resolver 按 key 配置；当前无法让单个 Remote 参数或 endpoint 在同一 `agent`/`session` key 下选择 live-only 策略。
- 被转发的事件原样到达 `$on`：没有载荷投影或脱敏，不支持 Scope 化订阅，重连后也不重放。
