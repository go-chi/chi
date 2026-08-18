# @deepseek-ai/dsh-client-ui-plan

[English](README.md) | 中文

Plan mode 状态徽章，纯浏览器 surface 插件。浏览器侧占用会话声明的 `conversation.input.plan` 单实例 seat（位于 access 模式控件右侧）；node 侧是空 apply（roster 行）。plan 行为本身——`/plan` 命令、边界或空闲即时提交的 `plan/mode` 状态、`plan` 投影单元与 policy 段——归 [`@deepseek-ai/dsh-plan-mode`](../../plan/plan-mode/README.md) 所有，由 host roster 独立组合。

plan mode 经 `/plan` 命令路径进入：用户可以从 composer 的 `+` Command 菜单选择 Plan，也可以输入 `/plan`，而本包不渲染未激活态 plan 控件。当 host 计算的 `plan` 投影有效目标为 plan mode 时（`pending ? !active : active`——折叠的 host 值而非客户端乐观态，帧到达即自动纠正），座位渲染 warn 色的 "Plan ×" 状态按钮，该按钮经 `command.execute` 执行 `/plan off`；否则座位保持为空——未组合 plan-mode 的 host（或尚无会话的 Draft）不显示任何内容。plan mode 为有效目标期间，composer 文本框的 placeholder 切换为 plan 任务提示——"describe your task to generate plan"（中文「描述你的任务以生成计划」），经 ui-conversation 的 `conversation` locale 命名空间（`placeholder.plan` / `hint.plan` 键）本地化，并与已认领 `/plan` 命令的提示逐字共用同一份文案（由 composer 从同一投影渲染；owner 提供的 placeholder 优先）。

chip 携带无障碍描述 "Plan mode on, press to turn off"。准入失败（`matched: false`、业务错误、传输故障）以内联错误呈现，chip 保持显示直至投影确认退出。

模型通过稳定的 `exit_plan_mode` 工具退出 plan mode；其 plan 评审走已组合的 Web question 通道。

## 模型体验

间接地，通过 chip 派发的 `/plan off` 命令行：`@deepseek-ai/dsh-plan-mode` 拥有该命令行驱动的模型可见 policy 段、退出工具 schema 与已记录状态，本包只渲染投影并发送用户同样可以手敲的内容。

#### KV Cache 影响

进入或离开 plan mode 会改变活跃的 `plan:policy` 系统提示词段，因此改变请求前缀；chip 本身不添加任何提示词内容。

## 已知局限与延后工作

- **Plan mode 是引导而非执行沙箱**：需要强制只读规划的部署必须组合独立的沙箱与审批策略。
- **chip 属于默认编辑器**：待处理的整编辑器交互（如 plan 评审）会临时取代 InputBar 及其 chip。
- **无未激活态 plan 控件**——入口使用共享 Command source；有能力但 mode 未激活的会话在工具行不显示 plan 入口。
