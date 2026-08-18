# Agent Note: 浏览器下行 WebSocket 载体

Status: implemented

[English](2026-08-04-websocket-downlink-carrier.md) | 中文

## Problem

浏览器 Web GUI 的 `events.mux` 与 `events.host` 长期使用两条 SSE（Server-Sent Events）响应。HTTP/1.1 浏览器通常只允许每个来源约六条并发连接；每个页面永久占住两条会让同源多标签页、插件资源和普通 RPC 争抢连接槽，达到上限后不是降速而是排队阻塞。RPC 协议本身是通道无关的，约束来自浏览器物理载体，不应渗入会话/运行时对象层。

## Decision

浏览器真实载体为两类下行流各开一条独立 WebSocket：`/api/events.mux` 只发送 `MuxFrame`，`/api/events.host` 只发送 `HostFrame`。每条文本消息是一份完整的 `ServerRequest` JSON；客户端继续先校验信封，再按路径校验具体 frame union，并把窄形 `RpcRequest<Frame>` 交给既有 `ConnectionController`。两条流保持独立生命周期和无跨流顺序保证，任一条结束仍使整个 connection generation 失败并按既有退避策略重建。

WebSocket 只承担 host→browser 下行。所有 client→host unary 调用和对 server request 的 `respond` 继续使用既有 `POST /api/*`；不在 WebSocket 上接收任何客户端业务消息。`WebApiClient` 因而同时持有 HTTP `fetch` 上行与 WebSocket 下行，而 fixture（测试前置数据）和 `InProcessApiClient(toFetchHandler(api))` 继续实现同一 `IApiClient` 双流抽象。进程内 fetch 载体保留 SSE 编解码来检验通道无关的协议同构，但网络上对 `/api/events.*` 的 GET 请求只返回 upgrade required，不作为浏览器兼容回退。

## Upgrade 与生命周期边界

`dsh-host-webserver` 提供与普通 route 并列的精确 upgrade-route 注册点，只按 pathname 分发 Node upgrade socket，隔离原始 socket 错误，并在 server teardown 期间等待仍存活的升级连接关闭；它不认识 Harness 帧或 WebSocket 消息。`dsh-client-connection` 拥有 WebSocket handshake、frame 写出和流取消，并在 upgrade 前复用 `/api` 的 Host／Origin 信任栅栏。未受信任的 authority 或跨来源 Origin 在 `ctx.apiProxy.events.*` 启动前即被拒绝。

浏览器 abort 或 socket close 会取消对应的 host 流；插件 teardown 还会等待该 source iterator 完成清理。host 流中途抛错时，载体发送一个现有的 `stream/error` frame 后关闭 socket；客户端把该 frame 收敛为连接丢失，不投递给业务 sink。每条 WebSocket 独立报告 open，既有 readiness handshake 仍等待 mux、host 都 open 且 `host.describe` HTTP 调用成功后才发布 connected。

## Verification

webserver 约定测试钉住 upgrade pathname 分发、重复注册拒绝、资源释放与 teardown；connection 的真实网络测试钉住两条 WebSocket 各自的信任检查、open、schema 信封、frame 顺序、流错误与关闭时取消；客户端测试同时证明下行创建 `ws:`／`wss:` URL，而 unary 与 `respond` 仍调用 HTTP `fetch`。组装后的 keyless 浏览器回放继续覆盖 Chromium、真实 host、HTTP 上行与 WebSocket 下行整链。

## Alternatives considered

**用一条 WebSocket 复用 mux 与 host。** 这会新增 channel tag、复用队列与单连接背压策略，并改变现有双流 readiness 语义；两条 WebSocket 已避开 HTTP/1.1 六连接上限，同时让本次变更保持在物理载体层。

**把 unary 与 respond 一并迁入全双工 WebSocket。** 这会改写超时、取消、HTTP 状态、信任栅栏和请求关联行为，却不能为当前的下行连接槽问题带来额外收益；上行 HTTP 是明确保留的边界。

**保留网络 SSE 回退。** 双载体会让生产浏览器路径可因代理或握手差异静默分叉，并让连接上限问题继续存在于一个受支持分支；预发布阶段只交付 WebSocket 下行，失败由既有重连与连接状态显式呈现。

**依赖 HTTP/2 扩大并发连接能力。** 内置开发服务器是明文 Node HTTP/1.1，部署前置代理也不是产品可依赖的不变式；物理下行应直接使用不受该连接池限制的浏览器原语。

## Consequences

每个 Web 页面仍有两条长期下行连接，但它们不再消耗浏览器的 HTTP/1.1 六连接配额；运行时继续消费原有双流并保留所有重连、流修复和跨流无序语义。代价是 webserver 多一个 upgrade 注册面，connection 包的 host 半侧新增一项 WebSocket 实现依赖，并需分别维护浏览器 WebSocket 与进程内 SSE 两种物理编解码；它们共享同一 `ServerRequest`／frame schema 和 `IApiClient` 语义，避免形成第二套业务协议。
