# @deepseek-ai/dsh-tool-session-query

[English](README.md) | 中文

位于 `ctx.sessionQuery` 之上、经工作区授权的模型工具。该 opt-in 包只依赖统一接口，并注册 `session_search`、`session_event_search`、`session_trace`、`session_event_trace` 和 `session_event_read`；已发布的宿主组合默认不挂载它。

## 配置

| 键 | 默认值 | 含义 |
|---|---:|---|
| `maxSearchResults` | `100` | 在内部提供方分页中收集的最大已授权非自身命中数 |
| `searchTimeoutMs` | `30000` | 附加到两个全文搜索工具的协作式截止时间 |

调用方只能来自 `ToolExecution.exec.agent`。跨会话访问要求目标和调用方会话的 `cwd` 值严格相等；没有 `cwd` 的调用方只能检查自己。搜索绝不公开提供方游标、偏移、分页大小或模型可控上限。由于一次搜索会在内部消费与世代绑定的提供方游标，两个搜索工具都与同级工具调用排他执行；三个精确跟踪/读取工具选择并行执行。每个精确执行器都将未更改的执行信号传递给授权和服务跟踪/读取，因此取消会等待协作式持久化清理，并保留信号的精确原因。工具边界上的时间戳要求显式 `Z` 或数字偏移，并转换为包含端点的 epoch 毫秒过滤器。

`session_search` 始终省略调用方会话。请求的父 id 会被去重，并在 FTS 前根据调用方工作区权限检查；只有已授权 id 会到达提供方，而缺失猜测和跨工作区猜测的行为完全相同，root 标记仍独立使用 OR。当前会话中的 `session_event_search` 会在调用它的步骤之前立即停止，因此当前 assistant 输出和已记录工具调用无法匹配自身。直接目标在跟踪、事件或标题读取前完成授权。血缘输出会用不含隐藏会话 id 的标记替换未授权祖先和后代边界。

每个可信 `ctx.sessionQuery` 调用都会经过一个模型边界净化器。首先检查调用方取消，并精确保留。可获取的语料库诊断信息和提供方诊断信息（包括可安全检查的嵌套原因）会尽力记录到内部日志；不可打印的失败使用固定日志占位符。诊断格式化和错误分类各自独立受保护，因此不可打印的原因无法逃逸，也无法阻止已安全分类的外层错误；不安全的分类或日志记录则回退到固定 `SESSION_QUERY_TOOL_FAILED` 代码和消息。本地参数验证和授权错误保留精确的工具自有消息。

该包刻意不执行字节或字符截断，也不导入 spill 后端。需要限制内联输出的部署应挂载 `@deepseek-ai/dsh-spill-policy`，它可在执行后替换已渲染文本，同时保留完整结果。

## 模型体验

### 系统提示词

#### 模型看到的内容

模型会收到一个固定的既往历史指引章节。

##### 既往历史指引

```markdown
Use session_search to find relevant work from prior sessions, or session_event_search to search earlier events in one session. Search results are cursor-free and workspace-scoped. Follow a useful hit with session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data.
```

#### Token 影响

插件挂载期间，每次请求都存在一个固定精简章节。

#### KV Cache 影响

插件和指引文本不变时，前缀稳定。

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`session_search`、`session_event_search`、`session_trace`、`session_event_trace` 和 `session_event_read` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-query)。搜索过滤器会增加固定 schema token，而游标、工作区路径、输出分页和模型可控结果上限仍不存在。

#### Token 影响

可见期间，每次请求都会发送 5 个固定只读 schema。

#### KV Cache 影响

工具可见性和定义不变时，前缀稳定。

### 工具结果

#### 模型看到的内容

每次成功调用都会发出一个纯文本块。搜索结果包含标题和最佳匹配摘录；跟踪包含全部已授权关系；事件读取包含未经删节的目标 JSON。通用 spill 策略可以将过大的内联文本替换为预览、不透明定位信息和取回指引。

#### Token 影响

结果取决于数据，并保留在已记录工具历史中直到压缩（compaction）；`maxSearchResults` 限制搜索命中数。

#### KV Cache 影响

仅追加的结果文本位于可重用请求前缀之后，不会使较早的缓存条目失效。

## 已知限制与暂缓事项

- 搜索最多返回部署上限，匹配更多时会请模型缩小查询；不提供延续 token。
- 工作区身份使用保守的字符串精确 `cwd` 相等性，因此符号链接等价的路径不共享权限。
- 未挂载通用 spill 策略的自定义组合会以内联方式接收完整跟踪和事件载荷。
