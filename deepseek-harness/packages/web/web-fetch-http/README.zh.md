# @deepseek-ai/dsh-web-fetch-http

[English](README.md) | 中文

一个匿名公共 HTTP(S) `WebFetchProvider`，用于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它获取具体 URL，返回状态码和长度受限的解码内容。

这是一个**实现**包：它向 `ctx.web` 注册提供方，不拥有该键，也不注册面向模型的工具。它是函数／命名空间插件（`inject: ['web']`）。

## 职责拆分

提供方拥有**安全资源获取**：URL 验证、HTTP 传输、重定向策略、资源兜底超时、中止传播、字节上限、charset 解码、内容类型分类与二进制拒绝。`@deepseek-ai/dsh-tool-web` 拥有**呈现**（HTML→markdown、截断格式）。非 2xx HTTP 响应是*结果*（状态码 + 解码主体），不是错误；`WebError` 只用于无法安全获取或表示资源的失败。

提供方的 `timeoutMs` 是直接 `ctx.web.fetch()` 调用方和配置有误的部署所用的资源兜底，不是面向模型的工具调用预算。[`dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) 拥有 `web_fetch` 工具调用预算，并让 `exec.signal` 在超时时触发，以强制执行该预算。

已交付的 web 工具部署会把提供方兜底设为高于工具预算，因此模型调用通常返回 `TOOL_TIMEOUT`。如果外层截止期限先于提供方的兜底超时触发，提供方会报告 `WEB_ABORTED`，外层策略再将其替换为 `TOOL_TIMEOUT`。因此，`WEB_FETCH_TIMEOUT` 表明直接服务调用方的提供方预算已经耗尽。

## 传输卫生

- 只接受 `http:` 和 `https:` URL；拒绝 URL 中的凭据（`WEB_BLOCKED_URL`）以及过长／格式错误的 URL（`WEB_INVALID_URL`）。
- 强制执行 URL 最大长度、响应字节上限（`WEB_FETCH_TOO_LARGE`）、解码主体字符上限、超时（`WEB_FETCH_TIMEOUT`）和重定向跳数上限。
- 把调用方的中止信号（`WEB_ABORTED`）传播到网络请求与流式读取。
- 只跟随**同源**重定向；跨源重定向以 `WEB_REDIRECT_BLOCKED` 失败，要求发起新的工具调用（沿用 Claude Code 的 WebFetch 模式）。
- 发送显式的产品 `User-Agent`，绝不伪装成浏览器。
- 不受支持的内容类型（例如二进制）以 `WEB_UNSUPPORTED_CONTENT_TYPE` 拒绝。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `maxUrlLength` | `2048` | 接受的请求 URL 最大长度。 |
| `maxResponseBytes` | `5_000_000` | 响应主体最大字节数。 |
| `maxBodyChars` | `100_000` | 解码主体最大字符数。 |
| `timeoutMs` | `30_000` | Node 定时器范围内的抓取超时：直接 `ctx.web.fetch()` 调用方的资源兜底，而非面向模型的工具调用预算（后者属于 `dsh-tool-call-timeout-policy`）。 |
| `maxRedirects` | `5` | 同源重定向最大跳数（`0` 表示完全不跟随）。 |
| `userAgent` | `deepseek-harness/…` | `User-Agent` 标头。 |

数值限制会在插件构造时验证：除 `maxRedirects` 外，每个上限都必须是正的有限数；`maxRedirects` 必须是非负整数。无效值会抛出异常，不会静默构造限制荒谬的提供方。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.md) 间接影响；该工具把此提供方经 `maxBodyChars` 限制的解码文本或由 HTML 转换得到的 markdown 置于抓取结果包装层中，并保留提供方失败；重定向、标头与传输机制保持隐藏。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **SSRF／私有网络防护暂缓**：不会阻止私有、loopback、link-local、multicast 或其他非公开目标，也不进行 DNS 解析后验证或逐跳重新验证（见 [web 能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。在此功能落地前，该提供方是 SSRF 原语；能够访问敏感内部网络目标的部署**禁止启用它**。
- **只解码文本内容**：包括 html/xhtml 与 `text/*` 加 JSON/XML 家族；缺少 `Content-Type` 或任何二进制类型都会抛出 `WEB_UNSUPPORTED_CONTENT_TYPE`，可提取文本的 PDF 解码属于明确的暂缓工作。
- **charset 只来自 `Content-Type` 标头**（默认为 UTF-8）：HTML `<meta charset>` 声明会被忽略；声明但无法识别的 charset 标签会抛出异常，而非回退。
