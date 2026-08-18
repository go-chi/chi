# Agent Note: 所有 /api 路由共用一道载体级浏览器信任边界

Status: implemented

[English](2026-07-28-api-browser-trust-boundary.md) | 中文

## 问题

Web GUI 宿主以纯 HTTP 提供 `/api`（默认 `127.0.0.1:3080`，支持 `--host 0.0.0.0`），而这个面上有远程代码执行级别的方法——`session.prompt` 驱动的 agent（智能体）可以运行 bash。浏览器会用两种经典方式把操作者变成攻击此类本地 API 的「混淆代理人」：恶意页面发出跨站「简单请求」 POST（`text/plain`——不经 CORS 预检即发出），其副作用照常执行、只是响应不可读；以及 DNS rebinding 后的源以「同源」身份直连 socket，CORS 整体失效，只有 `Host` 头会暴露攻击者的域名。在本决策之前，系统里唯一的浏览器信任检查（`isTrustedNativeDialogRequest`：回环 socket、同源、回环 Host）只守着一个装饰性的路由——`host.pickDirectory`，其原生对话框弹在宿主屏幕上——而所有真正具有严重后果的方法都没有防护。按 RPC 逐个设防也活不过应用内目录浏览器：它存在的意义就是服务合法的远程客户端，回环规则恰恰会拒绝它们。

## 决策

在载体层对整个 `/api` 前缀一次性执行浏览器信任检查——分为两部分：

- **媒体类型栅栏（dsh-host-apiproxy）**：每个 `/api` POST 必须声明 `application/json`，否则在解析前以 415 拒绝。跨站「简单请求」由此不复存在：任何跨站尝试都被逼进一次本服务器从不应答的 CORS 预检。
- **权威栅栏（dsh-client-connection，`src/api-request-trust.ts`）**：每个请求的 `Host` 都必须是回环地址，或与某个 `trustedHosts` 条目匹配（带端口的 `host:port` 条目精确匹配，不带端口的条目匹配任意端口，均经 WHATWG 归一化；rebinding 防御）。刻意不为无标记请求开捷径：明文 HTTP 下浏览器的读取（EventSource、图片、导航——这些头只发给可信目标）既不带 `Origin` 也不带 Fetch-Metadata，因此无标记请求可能是被重绑页面发起且响应可被读走的读取，而 Host 是重绑唯一伪造不了的请求头；非浏览器客户端经由回环地址、推导的 LAN IP 字面量或已声明的权威通过。若带 `Origin` 则必须与 Host 权威完全一致；`sec-fetch-site: cross-site` 一律拒绝。不是单纯规范化 authority 的 `trustedHosts` 条目会导致插件加载失败——否则 WHATWG 解析会悄悄授权笔误里的 hostname，或放大精确端口授权。`host.pickDirectory` 失去专属守卫，与其他请求同栅而行。

两条边界刻意留在范围之外：可达性由 webserver 的绑定配置（`host: 127.0.0.1 | 0.0.0.0`）控制；真正远程部署的认证是延期工作，记录在 connection README——这道栅栏是混淆代理人防御，不是认证层。旧守卫的回环 socket 检查被放弃而非泛化：绑定表达可达性、`trustedHosts` 点名远程权威之后，socket 地址提供不了头部栅栏覆盖不到的任何东西。

## 曾考虑的替代方案

- **按 RPC 设防（延续现状）。** 否决：守卫清单永远追着方法清单跑，价值最高的方法本来就没被守住，而 browse RPC 上的回环规则会破坏它们为之存在的远程部署。
- **CORS 头与省略凭据。** 否决：我们根本不想要任何跨源读取，应答预检只会扩大暴露面；拒绝预检严格更强也更简单。
- **现在就上认证令牌。** 在本变更中否决：令牌的签发、存储、轮换是真实的产品面；栅栏今天就能封死浏览器混淆代理人漏洞，无需预先决定认证设计。

## 后果

- 未来任何 `/api` 方法天然在覆盖范围内；不存在会被遗忘的按路由信任决定。
- 非回环部署的对外服务 authority 必须列入信任范围，否则请求会被拒绝。dsh CLI 通过把本机 LAN IP 字面量推导进 connection 行（不带端口的条目——IP 字面量 Host 不可能是被重绑的域名，且绑定端口可能由操作系统分配）来保住它公布的 `--host 0.0.0.0` LAN URL，并提供 `dsh web --trusted-host` 声明具名权威；并非由 CLI 启动的组合自行声明 `trustedHosts`。非浏览器自动化走同一道栅栏：回环地址、推导的 LAN IP 或已声明的权威可通过；未声明的 DNS 别名会被拒绝。
- 客户端必须给 POST 体标注 `application/json`（我们自己的客户端一向如此；裸 fetch 测试补上了该头）。
- 无认证 `0.0.0.0` 部署的「可信网络」假设从隐含变为成文。
