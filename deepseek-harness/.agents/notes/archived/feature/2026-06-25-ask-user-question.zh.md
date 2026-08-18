# Agent Note: ask-user 提问能力

Status: implemented
Archived: 2026-07-27

[English](2026-06-25-ask-user-question.md) | 中文

## 问题

agent（智能体）有时仅凭模型推理（inference）无法安全地继续执行：它需要人类选择路径、确认有风险的或默认的操作，或者提供缺失的信息。在此变更之前，获取答案的唯一方式是模型在 assistant 文本中提问然后停止，这打断了正常的工具调用循环：agent 没有结构化的暂停方式，没有供 UI 使用的选项元数据，没有中止/错误分类体系，也没有让非 stdio 前端一致地呈现问题的途径。

这是一个面向用户的能力，但它也跨越了包（package）边界。面向模型的工具需要一套提供方无关的请求词汇；每个 UI 界面需要决定如何展示和收集答案；agent loop（智能体循环）应保持不变，因为工具调用本身已具备正确的异步形状。

## 决策

引入 `dsh-user-interaction` 作为 `ctx.userInteraction` 的提供方无关接口包，与面向模型的消费方 `dsh-tool-ask-user` 一同放在 `packages/ui` 下。这一分组是有意为之的：向人类提问是一种由 UI 支撑的产品功能，不属于无提供方的核心主干。seam 仍然拥有稳定的请求/应答/错误词汇，而 UI 产品界面提供收集答案的具体提供方。该工具注册 `ask_user_question`，转发 `{ questions, agent, signal }`，并将提供方计算出的结构化答案作为工具结果返回。

面向模型的请求词汇有意与产品调研 schema 对齐：`ask_user_question({ questions: [{ id, question, header?, options?: [{ label, description? }], multi_select? }] })`。`id` 按问题提供并在结果中回传，使批量请求无需依赖问题文本即可路由。`label` 既是面向用户的显示文本，也是返回给模型的选中值；没有单独的 `value`，没有 `recommended`，没有 `allow_custom`，也没有 `desc` 别名。

提供方返回 `{ answers: [{ id, selected, custom? }] }`。`selected` 始终是选中选项 label 的数组，因此单选和 `multi_select` 的答案共享同一种结果形状。`custom` 承载自由文本的「其他」答案；无选项的问题直接收集 `custom`。当 `custom` 存在时，它覆盖任何已选择的选项，`selected` 为空。支持部分完成的提供方使用现有的 `{ id, selected: [] }` 形状表示某项被有意跳过，在不扩展工具结果词汇的前提下保留其他答案。

`UserInteractionError` 继承 `HarnessError`，因此 `NO_PROVIDER`、`ASK_ABORTED` 或请求归属缺失等失败会以机器可路由的 `{ name, code }` 工具错误形式通过 `ctx.tools.execute()` 传出。这与结构化错误分类体系一致，使模型或包装插件能够区分「用户取消」与一般的抛出异常。

## UI 映射

`dsh web` 挂载 `dsh-client-ui-question`：其 host 侧使 Web 产品选择性加载面向模型的工具，浏览器侧则在 conversation 拥有的具名输入区 slot 中注册 `question` 项。`createApiProxy` 使用以 host 生成的 rpcId 为键的进程内 pending 表实现 Web 提供方。它先注册等待项，再广播 `question/requested`；每次 mux 重开时以相同 id 重放；在受理前校验会话和完整答案批次；并在回答、取消、中止或资源释放后广播 `question/resolved`。受理会同步删除该条目，因此首个有效响应胜出，重复或迟到的响应返回 `not-pending`。

Web 输入区一次显示一个问题，同时在会话对象层保留每个请求。它支持单选、多选、无选项问题或显式自定义答案、描述文本与可视化推荐标记，但不会自动选中推荐项。选择单选项后会立即进入下一项；当所有项都已回答或显式跳过时，按 Enter 提交；IME 组字期间按 Enter 只会确认输入候选项。页脚只跳过当前项并保留先前的草稿；关闭控件以 `ASK_CANCELLED` 拒绝整个工具调用。常规输入区只有在 host 的 resolved 帧移除待处理项后才会恢复。

`dsh-tui` 将每个问题渲染为键盘叠层，展示选项描述，支持单选、多选和自由格式自定义答案，并在中止、提供方 dispose（资源释放）或终端关闭时拒绝待处理的问题。批量请求和并发请求都会排队，确保同一时刻只有一个叠层占用键盘焦点。

在桥接层还是编辑器 UI 时曾存在一个 ACP（Agent Client Protocol）elicitation 映射；[ACP 作为仅面向自动化的协议](../simplification/2026-07-23-acp-automation-only-protocol.md)移除了这第三个映射。

## 曾考虑的替代方案

**Assistant 文本后跟一个停止的轮次。** 模型可以在纯 assistant 文本中向用户提问然后停止。这会丢失结构化选项元数据，UI 没有提供方无关的方式来渲染选择，且下一条人类回答只能作为新的 user 提示词到达，而非作为需要答案的那次操作的结果。

**核心拥有的 ask-user 包。** 最初实现将 seam 和面向模型的工具分别放在 `packages/core` 和 `packages/ui`，但两者描述的是同一个由 UI 支撑的人机交互功能。seam 仍然是提供方无关的，但它不是像会话、工具或 agent 注册表那样的无提供方核心基础设施。将 `dsh-user-interaction` 和 `dsh-tool-ask-user` 一起放在 `packages/ui` 下，使包的划分与产品边界一致：应用和 bridge 提供人类答案的提供方，stdio 应用选择性加载面向模型的工具。

**用权限请求处理通用提问。** 权限请求是对工具执行的授权；`ask_user_question` 是带可选自由格式答案的信息收集。复用权限通道会混淆两个不同的产品概念。

**循环级别的暂停原语。** agent loop 已经知道如何等待工具调用并从工具结果恢复。添加新的循环特殊分支会重复这一异步形状，并迫使每个循环实现都了解一个 UI 关注点。

## 后果

该功能赋予模型一个强大的暂停原语，因此提示词引导很重要。工具描述告诉模型：提问要简洁，尽可能使用选项。产品策略后续可以包装 `tools/execute` 来限制工具何时可用，但循环不应对其做特殊处理。

`dsh-user-interaction` 和 `dsh-tool-ask-user` 都位于 `packages/ui`，因为它们共同构成一个面向产品的人机交互能力。`agent-core` 不加载工具或提供方。`dsh-tui-demo` 选择性加载 seam、TUI 提供方和面向模型的工具。`dsh web` 在 host 运行时启动 seam/提供方，并通过选定的 Web question 插件暴露该工具。ACP 自动化应用既不挂载 seam 也不挂载该工具。

## 测试

单元覆盖率固定了以下场景：提供方注册/释放、重复提供方拒绝、提供方就绪前中止、空问题拒绝、通过 `ctx.tools.execute()` 传出的结构化工具错误、批量答案、多选答案、自定义答案、显式按项跳过，以及模型 schema（包括移除 `value`、`recommended`、`allow_custom` 和 `desc`）。TUI 测试覆盖选项描述、排队请求、关闭/中止清理、无选项自由格式输入、无效选择、重复多选和批量问题流。Web 测试固定稳定 id 重放、响应校验、首个响应胜出的结算、重复和迟到响应、整个请求的取消与拥有方中止的区别、单选后前进、IME 安全的 Enter 提交、按项跳过保留、输入区接管、结构化批量提交，以及常规输入区的恢复。
