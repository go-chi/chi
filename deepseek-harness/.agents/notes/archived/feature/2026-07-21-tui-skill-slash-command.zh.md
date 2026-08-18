# Agent Note: TUI skill slash command

Status: implemented
Archived: 2026-08-04

[English](2026-07-21-tui-skill-slash-command.md) | 中文

## Problem

[skill 系统](2026-07-05-skill-system.md)交付时只有模型发起加载这一条路径：`skill({ name })` 工具让模型把某个 skill 正文拉进一个轮次，但操作 TUI 的人无法按需加载 skill。其他编码 agent（智能体）正是为此提供了 `/skill:<name>` 斜杠命令——由用户而非模型判断某个任务与某个 skill 匹配，并注入其指令。skill 系统 note 把直接的用户发起调用列为待办工作，而交互式前门正是它该落地的地方。

## Decision

[`@deepseek-ai/dsh-tui`](../../../../packages/ui/tui/README.md) 前门拥有一条 `/skill:<name> [instructions]` 命令。提交时它加载指定的 skill，并投递一个文本块作为用户轮次——空闲时用 `agent.send()` 发送、运行中用 `agent.steer()` 中途引导，与普通编辑器输入遵循同一规则。该文本块由 `renderSkillInvocation(skill, instructions)` 生成：一个包裹 skill 正文的 `<skill name="…">` 元素，当提供方暴露资源基址时在其前加一行资源基址行，用户尾随的文本在空行之后追加。该命令是 TUI 独有的功能；它不新增任何面向模型的工具。其可见性和加载策略来自共享的[模型与用户独立 skill 调用策略](2026-07-28-skill-invocation-policy.md)。

TUI 通过 `ctx.get('skills')` 读取 skill 服务，而非声明式注入，因为 skill 是条件挂载的：没有注册表的部署仍保有可用的前门，此时 `/skill:` 会报告 skill 不可用，而不是挂载失败。`createTuiChat` 是同步的，而 `ctx.skills.list()` 是异步的，所以自动补全先立即种入静态斜杠命令，待目录解析完成后再用 `skill:<name>` 条目重建 provider（提供方）；在 dispose（资源释放）之后才到达的解析结果会被丢弃，而被拒绝的查找会保留基础命令。

自动补全使用 `isUserInvocable` 过滤与调用策略无关的 `list()` 结果；手动提交则在受信的 `get()` 解析定义后应用相同判定。因此，即使模型调用已禁用，仅供用户调用的 skill 仍会显示并可加载；用户禁用的 skill 既不会展示，也无法按精确名称加载。每个补全条目都以其胜出来源的作用域为标签——`project-` 来源标为 `(project)`，其他一切来源标为 `(user)`——标签置于斜杠命令的参数提示位，菜单会显示它，但选中时绝不会插入，因此尾随指令仍然跟在补全后的名称之后。未知名称、前缀之后为空的名称、用户禁用的名称以及查找失败，都会各自呈现为 transcript（文本记录）中的一条通知，且不发送任何内容。

`renderSkillInvocation` 及资源基址行是 TUI 自有的，刻意不复用 `dsh-tool-skill` 的 `skill` 工具结果。该工具把正文包进 `<skill_content>`/`<skill_resources>`/`<skill_instructions>` 是为了一个*工具结果*；而手动调用是一个*用户轮次*，把两个渲染器耦合起来会迫使一种面向模型的形态同时服务两个界面。代价是两个都在格式化 skill 正文的渲染器；收益是各界面面向模型的文本可以独立演进，且各自在其产出处被固定。

## Alternatives considered

**仅在最初的 TUI 变更内新增 `user-invocable` frontmatter 字段。** 当时未采纳，因为 TUI 独有的字段会在没有共享调用模型的情况下改变注册表、提供方和工具契约。后续的[独立调用策略决策](2026-07-28-skill-invocation-policy.md)将其扩展到每个相关消费方，并保留 `get()` 作为受信原语。

**把 `skills` 声明为 TUI 注入。** 否决，因为 skill 是条件挂载的；声明式注入会使前门必须依赖注册表，缺少它就拒绝挂载，与本包可选服务的立场相悖。`ctx.get('skills')` 读取全局存储并容忍其缺失。

**复用 `dsh-tool-skill` 的渲染器。** 否决，因为它的输出是为模型的工具通道所写的工具结果形态（`<skill_content>` 及其同类），而斜杠调用是一条用户消息。共用它要么把工具结果词汇泄漏进用户轮次，要么按 `surface` 标志分叉共享渲染器——比两个小格式化器耦合更重。

**让提交经由模型的 `skill` 工具。** 否决，因为用户已经作出了判断；一次工具调用会花掉一个模型往返去取一份前门可以直接加载的正文，而且在 agent 处于轮次中途时也无法工作。

## Consequences

手动调用总是重新加载完整的 skill 正文：TUI 不会检测某个 skill 是否已在对话中出现，因此重复的 `/skill:` 会再次追加其指令——这可以接受，因为重新注入有时正是意图所在，且已在本包 README 的已知限制中说明。上文接受的双渲染器重复是一项长期维护成本。`<skill name="…">` 包装层是稳定的、模型可见的文本，并在包测试中针对一个真实的 `SkillService` 逐字固定；包语义矩阵固定帮助面板中的这一行。自动补全填充、仅限用户的发现、向空闲及运行中 agent 投递，以及 dispose 后查找和查找失败分支，都由挂载真实注册表或可控服务的包测试覆盖。已移除的产品 TUI 的无密钥 PTY 冒烟测试过去覆盖组装后的 Loader 路径；未来的终端部署负责该应用级场景。
