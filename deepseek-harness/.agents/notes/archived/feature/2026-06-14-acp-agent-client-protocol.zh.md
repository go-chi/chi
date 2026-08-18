# Agent Note: Agent Client Protocol（ACP）支持——从外部编辑器驱动编码 agent

Status: implemented
Archived: 2026-07-26

[English](2026-06-14-acp-agent-client-protocol.md) | 中文

> 已被 [ACP 作为仅面向自动化的协议](../simplification/2026-07-23-acp-automation-only-protocol.md)取代。本 Agent Note 记录已退役的面向编辑器的桥接层设计。

## 问题

harness 最初仅通过 readline 循环暴露 agent。该接口能传输文本，但编辑器无法以结构化方式创建或恢复会话、关联提示词完成、流式输出推理（reasoning）与工具活动、渲染工具专属 UI、请求权限，或在不干扰其他对话的前提下取消某个对话。ACP（Agent Client Protocol）将这些交互定义为基于 stdio 的 JSON-RPC，Zed 是用于做出具体兼容性决策的目标客户端。

桥接层必须保持 harness 既有的所有权边界。它不能依赖具体的 agent loop（智能体循环），不能绕过工具注册表，不能在编辑器中执行 shell 命令，也不能发明第二个会话真源。stdout 同时也是协议传输通道，因此任何意外的日志输出都会破坏连接。

## 决策

`@deepseek-ai/dsh-acp` 曾是 `ui` 包组中的 UI/客户端驱动插件（现位于 `acp`）。它使用 `@agentclientprotocol/sdk` 的 `AgentSideConnection`（基于 stdin/stdout），仅编排接口服务：agent 创建/恢复工厂、会话持久化、工具注册表、用户交互，以及可选的审批/bash 能力。它不修改 agent loop，也不是能力 seam 的实现。

桥接层实现以下稳定的会话路径：

- `initialize` 协商协议版本，声明支持 text 与 `resource_link` 类型的提示词，并声明 `loadSession` 能力。
- `session/new` 校验绝对路径 `cwd`，将其存入 `SessionHeader`，通过 `ctx.agents` 创建 agent，并返回由组合层支持的配置选项。
- `session/load` 在构造 agent 之前校验请求的 cwd 与持久化元数据是否一致，在异步恢复期间保留 id，将用户/助手/工具事件作为 ACP update 回放，并报告恢复后的 config-option 折叠结果。
- `session/prompt` 接受文本和 resource link，拒绝不支持的或空的内容，每个会话同时只允许一个 in-flight 提示词，并在该提示词所属的 `turn/end` 时结算。错误轮次拒绝 RPC；其他关闭轮次的原因通过一个全覆盖的 ACP stop-reason 编解码器映射。
- `session/cancel` 调用队列感知的 agent 取消路径，仅结算被寻址会话的提示词。

工具调用的展示仍由工具自身负责。工具的 `presentCall` 和 `presentResult` 返回 `generic`、`terminal` 或 `diff` 渲染意图变体；桥接层对该联合类型做 switch 并映射到 ACP。没有 presenter 的工具获得通用回退。Bash 终端卡片使用 Zed 的能力门控约定 `_meta.terminal_info`、`_meta.terminal_output` 和 `_meta.terminal_exit`；harness 仍通过 `ctx.bash` 执行命令，保留沙箱、环境清洗、所有权和 cwd。不支持该扩展的客户端收到普通文本内容。文件系统工具提供 diff 卡片和文件位置，桥接层中无需硬编码工具名分支。

权限处理是[用户审批 seam](2026-07-06-approval-seam.md)上的一个 answerer，而非 ACP 中的「每次工具调用都询问」策略。对桥接层所属 agent 且带有 call id 的 `approval/request`，会变为该 agent 编辑器会话上的 `session/request_permission`，提供一次性允许/拒绝选项。外部请求或无 call id 的请求委托给下游；缺失或失败的 answerer 会在故障时保持拒绝。发起询问的插件（如预执行策略或 bash 升级）拥有「是否询问」的决策权。

当 `ctx.permission` 被组合时，桥接层从部署的预设表中暴露一个 `permission` select。已发布的 `workspace-write` 和 `danger-full-access` 预设各自捆绑一个沙箱模式与一条审批策略；无法匹配的有效旋钮组合产生只能切走的 `custom` 状态。`session/set_config_option` 通过 `PermissionService.set()` 校验并写入两个所属旋钮事件。在开放轮次中的切换立即追加；空闲时的切换叠加在响应中，并在下一次 `agent/prompt-submit` 时锚定到开放轮次之前的请求组装阶段。在此之前它仅存于内存，因此崩溃后恢复的是持久化的折叠结果。ACP session mode 不被建模，因为 config option 是面向未来的协议表面；`AcpConfig.model` 保持连接级别。

桥接层还提供基于 ACP 的 `UserInteractionProvider`：`ask_user_question` 请求变为所属会话上的表单引导。select、multi-select、选项描述与自定义回答覆盖语义均被保留。

生命周期所有权是显式的。桥接层为每个活跃会话持有一个 `AgentHandle`。断连和 Cordis dispose（资源释放）会取消待处理的提示词，并行 dispose 所有 handle，等待循环完全停稳与持久化刷写，然后移除记录。流通知失败被隔离，因此消失的客户端不会破坏 agent 轮次。ACP 应用组合不加载 stdout logger；一个测试守卫 stdout 仅包含帧化的 JSON-RPC。

当前的协议契约见 [`dsh-acp` 包 README](../../../../packages/acp/acp/README.md)。

## 曾考虑的替代方案

**在 `tools/execute` 监听器前置一层，对每个 ACP 所属调用都询问权限**：否决。这会将权限策略硬编码到 UI 桥接层，即使没有策略要求也会询问，且无法服务于执行开始后才产生的审批请求。共享的 user-approval seam 将机制、询问策略和 UI answerer 分离。

**注入具体的 `agentLoop`**：否决。agent 的创建、恢复、空闲观察与释放是 `dsh-agent` 上的接口级所有权操作；UI 插件不需要依赖规则例外。

**通过 ACP `terminal/*` 执行 bash**：否决。这会将执行移到 harness 之外，绕过其沙箱、凭证清洗、任务所有权、cwd 解析与会话日志。终端元数据仅用于展示。

**将权限预设表示为 ACP session mode**：否决。部署定义的预设已经是一个 config-option select，而 session mode 是 ACP v2 计划移除的遗留接口。

**防御性劫持 stdout**：否决。进程级 monkey-patching 超出 Cordis 副作用所有权范围，且与协议传输存在竞争。应用组合拥有 stdout 纯净性。

## 后果

编辑器可以通过一条 ACP 连接创建、加载、提交提示词、取消、渲染、询问和重新配置多个 harness 会话，无需依赖特定的循环实现。会话事件日志仍是回放、提示词结算、cwd 与每会话配置的持久真源。工具展示与人工回答通道仍是可扩展的插件契约，而非 ACP 专属行为。

桥接层有意不实现会话列表/删除/恢复/关闭能力、MCP 透传、附加目录、图片/音频/嵌入资源提示词、plan、斜杠命令、用量更新、编辑器文件系统委托或 ACP 终端执行子协议。后续已通过标准会话配置选项加入运行时模型选择，见 [LLM 目录与 ACP 选择 Agent Note](../architecture/2026-07-15-llm-model-catalog-and-acp-selection.md)。

空闲时的配置选择在实时响应中是真实的，但在下一次 `agent/prompt-submit` 将其锚定到开放轮次之前不具持久性。在该边界之前崩溃会丢失待定选择；这是保持会话事件封闭于轮次内且回放安全的代价。

## 验证

ACP 测试套件覆盖内存协议编解码器、创建/加载回放、精确的提示词结算、取消竞争、不支持的内容、工具展示、终端能力回退、权限结果映射、config-option 校验与持久化、多会话隔离、断连/释放后的完全停稳，以及 HMR（热模块替换）清理。快照测试与 built-bin 测试验证应用组合，真实 API 的 e2e 测试在无 key 时自动跳过。
