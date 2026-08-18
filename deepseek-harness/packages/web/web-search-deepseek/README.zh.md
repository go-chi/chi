# @deepseek-ai/dsh-web-search-deepseek

[English](README.md) | 中文

由 [DeepSeek](https://deepseek.com) 支持的 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它调用 DeepSeek 的 **Anthropic 兼容 Messages API**（`POST {baseURL}/messages`），启用原生 `web_search_20250305` 服务器工具，并把 DeepSeek 返回的结构化 `web_search_tool_result` 块映射为 seam 规范化的 `WebSearchResult`。

这是一个**实现**包：它向 `ctx.web` 注册提供方，通过可选的 `ctx.credentials` seam 为每次搜索解析凭据，若存在发起请求的 agent（智能体）会话，还会在其中记录该辅助请求，且不注册面向模型的工具。与 `@deepseek-ai/dsh-llm-deepseek` 一样，它是函数／命名空间插件（`inject: ['web']`）。Anthropic 协议格式（wire format）是提供方私有细节，并**不**使该提供方依赖 `ctx.llm`。

## 与专用搜索端点的区别

Exa 和 Perplexity 提供专用搜索端点，DeepSeek 则没有。该提供方改为发起一次携带 `web_search` 服务器工具的**完整 Messages 模型调用**，因此一次搜索会产生完整模型轮次的延迟与 token 开销，比纯检索端点更重。DeepSeek 在服务器侧执行搜索，返回**结构化** `web_search_tool_result` 块；提供方解析这些块，**绝不会从模型文本中抓取 URL**。

**严格模式**：如果响应不含 `web_search_tool_result` 块（未触发原生搜索），提供方会抛出 `WebError` `WEB_PROVIDER_ERROR`，而非降级为文本抓取。

它复用 `DEEPSEEK_API_KEY` 凭据引用（不增加密钥），但**不会**复用 `$DEEPSEEK_BASE_URL`：搜索端点使用 Anthropic 兼容基址（`https://api.deepseek.com/anthropic/v1`），不同于 LLM（大语言模型）适配器使用的 chat-completions 基址（`https://api.deepseek.com`）。已挂载的凭据服务具有权威性；没有该服务时，提供方会回退到启动进程的环境变量。每次搜索都会解析该引用，因此在 Web 的 Models 页中存储或轮换的密钥无需重启，即可用于下一次调用。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | DeepSeek API 密钥字面值。优先使用 `apiKeyEnv`，避免密钥进入配置；非空字面值优先。 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次搜索都会通过 `ctx.credentials` 解析该凭据引用；没有该 seam 时则从进程环境解析。值缺失时，调用以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://api.deepseek.com/anthropic/v1` | Anthropic 兼容端点基址；追加 `/messages`。缺省时回退到任一环境层中的 `$DEEPSEEK_SEARCH_BASE_URL`；禁止复用属于 chat-completions LLM 适配器的 `$DEEPSEEK_BASE_URL`。无法解析时提供方不可用。 |
| `model` | `deepseek-v4-flash` | Anthropic 格式模型名称。 |
| `apiVersion` | `2023-06-01` | `anthropic-version` 标头值。 |
| `maxTokens` | `4096` | Messages 请求生成 token 的正整数上限。 |
| `maxUses` | `5` | 每次请求使用 `web_search` 服务器工具的正整数上限。 |

```yaml
- id: web-search-deepseek
  name: '@deepseek-ai/dsh-web-search-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    baseURL: https://gateway.internal/anthropic/v1
```

上面的条目是 `web-search-deepseek` Settings 段的 base 层：叠加其上的用户层会作用于**下一次**搜索，因为提供方是按次投影该段，而不是在注册时固化它。因此端点或模型变化时，seam 的提供方选择不会闪断。`apiKey` 带有 `role('secret')`，所以它在任何一层都不会出现在 `describe()` 响应中——配置表层只能知道 credentials 领域是否为 `apiKeyEnv` 所命名的引用持有值，而无从知道某一层是否带着字面密钥。

## 映射

DeepSeek 返回的提供方生成答案均不被该提供方信任为 `content`，因此省略 `content`。`sources[]` 来自 `web_search_result` 条目，这些条目位于 `web_search_tool_result` 块内：`url` ← `url`、`title` ← `title`、`publishedAt` ← `page_age`。`cited_text` 条目按 URL 标识，单独位于文本块的 `citations[]` 中；提供方会按 URL 将它们关联到相应结果，没有摘录时省略 `snippet`。

结果按 URL 去重，因为一次请求可能在多次搜索中呈现同一页面。DeepSeek 公开 `maxUses` 而非结果数量旋钮，因此 seam 会强制执行 `maxResults`：截断 `sources[]` 并设置 `truncated`。

提供方失败变为 `WEB_PROVIDER_ERROR`；调用方取消变为 `WEB_ABORTED`。HTTP 重定向会在接触 `Location` 目标前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。

## 请求日志

由 agent 发起的搜索会在发出请求前一刻，向相应会话追加仅用于日志的 `web/deepseek-search-llm-request` 会话事件。其中包含已解析端点、API 版本，以及发送给 DeepSeek 且不含密钥的精确 JSON 请求体；不包含标头和凭据。发出请求前发生凭据处理失败或取消时不会创建事件；发出请求后才发生 HTTP 或响应失败时，本次请求尝试仍保留持久记录。在 agent 之外通过程序直接调用提供方时，没有发起会话可供记录。

## 模型体验

### 辅助 DeepSeek 搜索请求

#### 模型看到的内容

独立的 DeepSeek 模型会原样接收 `Perform a web search for the query: <query>` 作为用户文本，并收到一个原生 `web_search` 服务器工具定义。该请求不属于会话模型上下文。

#### Token 影响

每次搜索都会产生独立的提供方输入与输出 token；`maxTokens` 限制生成输出，`maxUses` 限制原生搜索次数。

#### KV Cache 影响

与会话请求缓存相互独立。辅助指令与原生工具定义可以形成稳定前缀，但查询或模型路由的每次变化都会阻止从首个差异起的复用。

### 间接的会话工具结果

#### 模型看到的内容

通过 [`dsh-tool-web`](../tool-web/README.md)，会话模型会看到结构化搜索块中去重后的 URL、标题、日期与引用 snippet；提供方文本不会作为答案受到信任。该提供方的具体错误消息包括带有处理指引的凭据缺失消息、`DeepSeek search credential resolution failed: <error>`、`DeepSeek search aborted`、`DeepSeek search request failed: <error>`、`DeepSeek returned no web_search_tool_result blocks; the request may not have triggered native web search` 和 `DeepSeek returned an unprocessable response body: <error>`；HTTP 失败保留提供方消息。错误包装属于消费方。

#### Token 影响

注册不会直接产生会话 token。结果 token 随返回源与 snippet 增长，随后 seam 会强制执行请求的源数量上限。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **一次搜索需要完整的 Messages 模型轮次**：会产生延迟与生成 token，并且最多执行 `maxUses` 次服务器侧搜索；DeepSeek 不公开专用检索端点。
- **动态凭据的可用性在操作内部解析**：同步的 `available()` 约定可以确认解析器存在，但无法查询异步凭据存储。因此，选中的无密钥提供方会使搜索以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败；稳定的 `web_search` schema 仍保持注册。调用方取消在本地与该预检存在竞态，但无法强制任意凭据后端自行停止工作。
- **超量返回的源仍消耗 token**：协议没有结果数量旋钮，`maxResults` 只能由 seam 在事后截断。
- **未引用的结果没有 `snippet`**：只有 `text` 块中的引用（`cited_text`）匹配其 URL 时，源才会获得 snippet。
