# Agent Note: TUI 标题来自 session-title 服务

Status: implemented
Archived: 2026-07-27

[English](2026-07-22-tui-titles-from-session-title-service.md) | 中文

## 问题

每会话标题让终端窗格和标签页易于区分，但 TUI 本地模型调用会在[日志承载的会话标题](../feature/2026-07-21-log-backed-session-titles.md)旁形成第二条标题管线。本地路径需要自己的提示词、截断上限、一次性闩锁、恢复推导、取消和失败回退，而其进程本地结果仍对会话列表、fork、Web 消费方和回放不可见。若两条路径同时运行，同一会话还可能被不同策略命名两次。

## 决策

session-title 服务是唯一的标题来源。TUI 不包含 `autoTitle` 配置、标题模型请求、闩锁、abort controller、提示词或输出上限。TUI 在挂载时折叠最新的已记录标题（`foldSessionTitle`），将其渲染为横幅副标题，并在每个被接受的 `session/title` 事件上调用 `runtime.terminal.setTitle`，传入 `<session title> — <configured title>`。同一条终端安全的 OSC 0 路径会处理配置的回退标题、恢复的会话和实时修订，既不重命名 tmux 窗口，也不增加另一套终端控制接口。

模型生成的标题是组合选择：`examples/tui-agent/cordis.yml`（以及脚本化 PTY fixture）挂载 `@deepseek-ai/dsh-session-title-first-message-llm`，它继承主请求的确切路由，用简短的模型摘要替换 spine 的确定性回退。未挂载该 provider 的部署保留 `dsh-agent-spine-demo` 内置 `SessionTitleService` 的回退标题。

## 备选方案

**两者并存，已记录标题胜出。** 这是第一版合并决议：auto-title 独占整个窗口标题，直到已记录的 `session/title` 以后缀形式到达。它保留了行为，但每个新会话产生双倍模型调用，且 TUI 的标题在日志中不可观察，实质上违反 model-visible ⟺ logged，并把标题契约拆给两个所有者。

**把 auto-title 的提示词和截断移植为服务的第三个 provider。** first-message-llm provider 已经存在，节奏相同，且有经过评审的提示词契约、持久的请求记录和替换围栏；再造一个近乎相同的 provider 纯属重复。

**只使用截断后的首条提示词，或只使用模型标题。** 确定性回退可以立即且免费地提供标题，而可选模型 provider 可以提升质量，不会延迟主轮次。强制采用任一种策略都会移除这项部署选择。

**让模型标题成为 TUI 默认行为，或为此阻塞第一个轮次。** 成本与路由归组合所有，辅助标题的延迟不得进入交互关键路径。TUI 只消费已接受的状态，不拥有生成策略。

**重命名 tmux 窗口，或使用另一种终端转义序列。** 不予采纳，因为现有终端适配器的 OSC 0 路径可以标记窗格或标签页，无需取得 tmux 归属，也无需增加第二套控制 API。

## 验证

TUI 测试锁定恢复后和实时的 `session/title` 消费、终端安全的标题渲染、配置的回退标题，以及不存在 TUI 自有模型路径。无密钥 PTY 冒烟测试启动真实组合，接收已记录的 provider 标题，并观察由此产生的终端标题。[日志承载标题决策](../feature/2026-07-21-log-backed-session-titles.md)拥有 provider、持久化、恢复、fork、取消和陈旧完成结果的覆盖。

## 影响

唯一的标题管线持久、可回放、对所有消费方可见，并由服务防止陈旧完成结果生效。TUI 不再有 `llm` 流式标题路径。若要提升模型标题质量，组合中必须挂载 provider 插件；未挂载的部署保留确定性回退。终端标题始终采用 `<title> — <product>` 后缀形式。
