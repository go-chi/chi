# @deepseek-ai/dsh-subagent-fork-in-process

[English](README.md) | 中文

fork 提供方会创建一个进程内子 agent（智能体），并以父 agent 已完成的对话轮次作为初始内容。它与 spawn 共用全部运行机制；唯一的行为差异是会话初始内容。

## 初始内容边界

subagent 启动时，父 agent 当前的工具调用轮次仍未结束：其日志包含 assistant 工具调用，但尚无匹配的工具结果或 `turn/end`。直接复制这份原始日志会给子 agent 一个无效且不平衡的会话。

因此，fork 会计算截至最后一个 `turn/end` 的连续前缀。子 agent 能看到父 agent 所有已完成轮次，但看不到进行中的轮次。如果父 agent 尚未完成任何轮次，初始内容为空，子 agent 的行为与全新 spawn 相同。

初始内容只传递对话历史。子 agent 仍会获得全新的扁平注册作用域；它不继承父 agent 的工具限制或权限。

## 启动与能力

`start(request)` 将已完成轮次的初始内容传给 [`startInProcessRun`](../subagent-in-process-driver/README.md)，并等待子 agent 发布。共享驱动器负责取消、深度、定制、结果读取和 dispose（资源释放）。

fork 声明 `{ outputSchema: true, depthLimit: true, toolFilter: true, persona: true }`，与 spawn 相同。

## 配置

| 键 | 含义 |
|---|---|
| `providerName` | `ctx.subagents` 上的注册表名称（默认 `fork`）。 |
运行生命周期、模型继承与深度跟踪均为共享行为，见 [`dsh-subagent-spawn-in-process`](../subagent-spawn-in-process/README.md)。

## 模型体验

### 子 agent 历史与包络

#### 模型看到的内容

子 agent 先接收由父 agent 已配平的已完成轮次构成的表层前缀，再逐字接收新的任务内容。配置的 persona 会在子 agent 的全新作用域中遮蔽提示词文本；工具限制会过滤其全局协议 schema、可执行工具查找和 Code Mode SDK 绑定，但不影响独立的指导内容。父 agent 的工具视图与权限不会被继承。可选的结构化输出请求会添加仅属于子 agent 的约定。父 agent 当前进行中的轮次会被排除。

#### Token 影响

fork 会把保留的已完成历史复制到独立的子 agent 请求中；随后子 agent 独立累积自己的 token。persona 会改变重复提示词的成本，过滤会改变 schema 或生成 SDK 的成本，而首轮 fork 没有继承历史。

#### KV Cache 影响

在提供方和模型相同的前提下，子 agent 可以复用继承的逐字节相同前缀。persona、工具过滤、生成 SDK 或路由变化可能在继承历史之前使复用失效；后续子 agent 历史仅追加。因此随附组合把本提供方绑定为 `backgroundMode: one-shot`：可继续子 agent 还会额外携带作用域局部的 `report` 工具及其提示词 section，而这些增量位于继承历史之前，会使继承历史整体失效（见 [fork 保持 one-shot 的 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-fork-children-stay-one-shot.md)）。

### 父 agent 工具结果（间接）

#### 模型看到的内容

父 agent 只通过 `dsh-tool-subagent` 接收子 agent 自身的最终输出，不接收继承的前缀或中间工作。

#### Token 影响

父 agent 输入会增加一个取决于数据的最终结果，并保留到压缩（compaction）为止。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **初始内容是一次性快照**：子 agent 只能看到 fork 时父 agent 已完成的轮次，看不到父 agent 此后记录的任何内容；不会实时共享上下文。
- **没有任何随附组合会创建可继续的 fork 子 agent**：`prepareContinuable` 仍然实现完好，seam 也接受它，但每份随附的 `cordis.yml` 都在 fork 委派工具上设置 `backgroundMode: one-shot`，因此该提供方的可继续路径没有生产调用方。重新开放它需要子 agent 的系统提示词与工具 schema 与父 agent 逐字节一致，而这一点目前被 [`report` 返回通道](../tool-subagent-report/README.md)阻止。理由与重新开放条件见 [fork 保持 one-shot 的 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-fork-children-stay-one-shot.md)。
