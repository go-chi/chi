# @deepseek-ai/dsh-host-webserver

[English](README.md) | 中文

Web HTTP 与 upgrade route 注册插件（默认导出 `WebServer`，配置为 `{host, port}`）：一个在激活时开始监听的 `node:http` 服务器，提供 `ctx.webServer`。`register(route)` 添加具名的 `exact`／`prefix` HTTP route；`registerUpgrade(route)` 添加精确 pathname 的 upgrade route；同一张表内的重复路径会抛错，因为 route 模式是组合层约定，冲突即配置错误；两者返回的 disposer 都会移除注册。`registerFallback(handler)` 注册一个 handler，处理所有未被具名 route 命中的请求。第二次注册会抛错；随附的 SPA dist 服务器 [`dsh-host-frontend-static`](../frontend-static/README.md) 是该 handler 的所有者，没有注册 handler 时服务器返回 404。`tapIndex(transform)` 添加一个 index.html 转换，`applyIndexTaps(html)` 按注册顺序对一段响应体运行已注册的转换；fallback handler 在每次 index 响应时调用它。`port` 读取正在监听的端口（当 `port` 为 0 时读取 OS 分配的值），`host` 读取配置的绑定宿主（这些是其他插件据以自适应的组合期事实，例如 directory-picker 选择器）。HTTP 匹配顺序固定不变：先在整张表中匹配精确 route，再匹配最长前缀，最后交给 fallback handler。upgrade 只做精确匹配，未命中连接直接关闭；注册顺序不影响请求处理。

该包不了解任何 harness 概念，也不提供任何文件服务：`/api` HTTP 桥接与下行 WebSocket 是 connection 插件的 route，插件 bundle 与 HMR（热模块替换）事件流是 modules／hmr 插件的 route，dist 服务则属于 fallback 持有者。upgrade handler 拥有协议握手与连接内容；webserver 只交付原始 socket 与 request。`host` 只接受 `127.0.0.1`（默认安全姿态）和 `0.0.0.0`（有意向网络开放）。该服务器只服务浏览器；Electron 通过 `file://` 加载 dist，并经 IPC 桥接承载 fetch。该包从不打印内容；URL 行属于 shell。

监听失败（EADDRINUSE……）会从激活过程抛出，并以绑定诊断信息拒绝 Loader 组合；失败的候选 fiber 会被 dispose（资源释放）。处理 HTTP 请求时抛错（例如 fallback 持有者的 `decodeURIComponent` 收到格式错误的百分号转义，或客户端在请求体传输中途断开）时，服务器会响应 400；若响应头已经发出，则销毁 socket，并记录 warning，但绝不会退出进程。upgrade handler 抛错或升级 socket 出现传输错误时，会记录 warning 并销毁对应 socket。资源释放会启动 `close()` 与 `closeAllConnections()`，销毁所有受跟踪的升级 socket，并仅在 HTTP server 与这些 socket 均已关闭后返回。

## 模型体验

无。该包只是浏览器与其他插件所注册 HTTP／upgrade route 之间的 Web 载体，其中没有任何内容会进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **不提供 TLS、认证或来源策略**：绑定非回环地址会向对应网络公开服务器；面向部署的加固措施（或在前方放置真正的反向代理）有意不纳入面向开发环境的 v1。
- **Socket 选项固定不变**：配置只选择绑定宿主与端口；在具体部署产生需求前，backlog 和其他 socket 设置仍保持内部实现。
