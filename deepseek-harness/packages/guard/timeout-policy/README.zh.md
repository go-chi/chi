# dsh-tool-call-timeout-policy

[English](README.md) | 中文

工具调用超时强制执行器：单个 `tools/execute` 环绕分发监听器，会在 `exec.signal` 上设置单次调用的协作式截止时间；适用于声明了 `timeoutMs` 且声明位于其 `ToolDefinition` 上的工具。该截止时间先到时，它返回结构化 `TOOL_TIMEOUT` 结果。预算从工具自身的声明中读取（`ToolDefinition.timeoutMs`，由拥有该工具的插件设置），因此此插件是**零配置**的。它是 `tools/execute` 包装层的参考实现，也是面向模型工具调用预算的强制执行归属地（[超时库 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)）。

## 插件（命名空间：`timeout-policy`）

它是函数／命名空间插件（`name`／`inject`／`apply`），而非服务。它不注册工具，也不接受配置；它消费 `ctx.tools` 的 `tools/execute` waterfall（瀑布式事件）（由 `dsh-tools` 注册表始终提供），并读取每个已分发工具声明的 `timeoutMs`；该声明来自注册表（`ctx.tools.get(exec.name)`）。

```yaml
- id: timeout-policy
  name: '@deepseek-ai/dsh-tool-call-timeout-policy'
```

每工具预算由工具插件声明（例如 `dsh-tool-web` 的 `fetchTimeoutMs`／`searchTimeoutMs` 配置，会附加为 `ToolDefinition.timeoutMs`）；此插件只负责强制执行，因此不可能拼错工具名。

### 行为

对 **声明了 `timeoutMs` 的工具**，监听器会：

1. 从注册表中的工具自身声明（`ctx.tools.get(exec.name)?.timeoutMs`）读取预算，并设置 `deadline(exec.signal, timeoutMs, 'TOOL_TIMEOUT')`：一个将调用方中止与此插件计时器融合的信号（`@deepseek-ai/dsh-timeout`）。
2. 将该派生信号替换到 `exec` 上用于下游分发，然后恢复调用方自身的信号（Cordis `next()` 忽略传入的参数，因此包装层会原地修改共享 `exec`；恢复可使 `tools/post-execute` 看到调用方的信号）。
3. 分发后，如果 `timeoutOf(d.signal, 'TOOL_TIMEOUT')` 检测到此插件自身的计时器已触发，则将结果替换为结构化 `TOOL_TIMEOUT` 工具结果：`{ isError: true, error: { message, info: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' } }, content: 'Error: tool call timed out after <ms>ms' }`。

**未声明预算的工具** 会原样委托（不启动截止时间）。

基础 `next()` 是注册表为 `tools/execute` 提供的、带规范化处理的分发 thunk，因此当超时信号到达抛出自身上游中止错误的提供方时，分发会先将其转换为普通错误结果，再由此包装层替换为 `TOOL_TIMEOUT`。这一顺序就是替换依据信号（`timeoutOf`）而非已分发结果形状的原因。

### 协作式，而非硬终止

派生信号只会**通知**；是否终止仍取决于工具及其将 `exec.signal` 转发到的能力（`dsh-timeout` 库本身不负责硬终止）。**因此，声明 `timeoutMs` 意味着「与 `exec.signal` 协作」**：忽略该信号的工具不会在超时时停止。只有转发信号的工具才应声明该字段；已交付的 `web_fetch`／`web_search`（通过 `ctx.web` 转发给提供方）是参考实现。`TOOL_TIMEOUT` 无需会话事件以满足可重建性：它是最终面向模型的 `tool/result`，已由循环记录。

### 与其他 `tools/execute` 包装层组合

多个 `tools/execute` 监听器按 Cordis 注册顺序组合。与未来的重试／沙箱／指标包装层一起使用时，注册顺序决定语义：「超时覆盖整个重试操作」（超时注册在外层），或「超时覆盖每次尝试」（超时注册在内层）。

## 模型体验

### 条件工具结果

#### 模型看到的内容

此插件不添加提示词或 schema。如果已声明的截止时间先到，它会将提供方结果替换为 `Error: tool call timed out after <ms>ms` 与结构化 `TOOL_TIMEOUT`；否则原结果保持不变。

#### Token 影响

未超时的调用不会增加 token。超时会添加一条会被保留的简短错误结果，并可防止体积更大、较晚返回的提供方结果进入上下文。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **协作式，绝不是硬终止**：截止时间只通过 `exec.signal` 通知；忽略该信号的工具不会在超时时停止（参见「协作式，而非硬终止」一节）。
- **没有统一预算**：只有声明 `timeoutMs` 并将其放在 `ToolDefinition` 上的工具才会获得截止时间；未声明工具没有注册表级默认值（已交付的 `bash`／`read`／`write`／`edit` 有意不声明）。
