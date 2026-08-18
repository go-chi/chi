# @deepseek-ai/dsh-subagent-spawn-in-process

[English](README.md) | 中文

spawn 提供方会在当前进程中创建一个全新的子 `Agent`。子 agent（智能体）有自己的会话，看不到父 agent 的对话历史，并复用宿主的 agent 工厂及 LLM（大语言模型）/工具服务。

## 行为

`start(request)` 不传入 seed，直接委托给 [`startInProcessRun`](../subagent-in-process-driver/README.md)，并在子 agent 发布后才返回。子 agent 获得父 agent 的工作目录/会话谱系，并默认继承父 agent 模型（除非覆盖），但以空对话开始运行。

共享驱动器负责深度检查、persona 与工具过滤器设置、结构化输出、通过必需的信号执行取消、单次执行、结果读取和完全停稳后的 dispose（资源释放）。启动遭拒不会留下已发布的子 agent；启动调用兑现后卸载提供方，也不会撤销由持有方拥有的运行。

## 能力

spawn 声明 `{ outputSchema: true, depthLimit: true, toolFilter: true, persona: true }`，因为它控制子 agent 的创建窗口，能够强制执行全部四项功能。

## 配置

| 键 | 含义 |
|---|---|
| `providerName` | `ctx.subagents` 上的注册表名称（默认 `spawn`）。 |

## 模型体验

### 子 agent 请求

#### 模型看到的内容

全新的子 agent 逐字接收独立任务内容，默认继承父 agent 的模型和工作区，并看到带有已配置子 agent 作用域 persona 遮蔽的全局提示词。工具过滤器会为该子 agent 移除全局协议 schema、可执行工具查找和 Code Mode SDK 绑定，但保留独立注册的指导内容。它不接收任何父 agent 对话消息；过滤控制的是可见性与组合，并非从父 agent 继承的权限授予。

#### Token 影响

子 agent 会为全新的独立上下文和历史消耗 token；不会复制父 agent 历史的 token。persona 会改变该子 agent 反复使用的提示词成本，过滤则会改变其 schema 或生成 SDK 的成本。

#### KV Cache 影响

与父 agent 请求缓存相互独立。子 agent 历史仅追加；persona、工具过滤、生成 SDK、提供方或模型变化会建立不同的子 agent 前缀。

### 父 agent 工具结果（间接）

#### 模型看到的内容

通过 `dsh-tool-subagent`，父 agent 只接收子 agent 的最终输出或结束原因错误。

#### Token 影响

父 agent 输入会增加一个取决于数据的结果，并保留到压缩（compaction）为止。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **全新表示不含父 agent transcript（文本记录）**：子 agent 会继承 cwd、谱系、模型及显式配置的 persona/工具限制，但不继承父 agent 的任何对话；需要已完成轮次上下文时，请使用 fork 提供方。
