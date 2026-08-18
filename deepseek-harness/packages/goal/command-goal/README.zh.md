# @deepseek-ai/dsh-command-goal

[English](README.md) | 中文

面向用户的 `/goal` 控制，基于 [`ctx.goals`](../goal/README.md) 实现。该插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册一个全局命令，因此每个已组合的命令适配器都能发现并执行它，无需模型轮次。[用户 goal 命令 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-human-goal-command.md) 负责用户体验与组合决策。

## 命令约定

| 输入 | 结果 |
|---|---|
| `/goal` | 显示当前目标、持久 phase、Round 计数／上限、进程本地续行启用状态与有效的下一步命令；被阻塞的 goal 还会显示策略代码和说明，没有 goal 时则显示用法。 |
| `/goal <objective>` | 创建 goal 并启用续行，或用全新身份替换已完成 goal。未完成 goal 绝不会在没有显式 clear 的情况下被替换。 |
| `/goal edit <objective>` | 编辑当前目标，不改变其 phase 或续行启用状态。编辑已完成 goal 会创建新的 active goal。 |
| `/goal pause` | 暂停 active goal，并停用续行。 |
| `/goal resume` | 恢复已停止 goal，或在会话 resume／fork 后为 active goal 重新启用续行；仍受剩余 Round 上限约束。 |
| `/goal clear` | 清除当前指针，同时保留其持久历史和 tombstone。 |

只有控制词占据完整输入时才不区分大小写。其他任何非空后缀都属于目标，因此 `/goal pause after verification` 会创建该字面目标。goal 领域会去除目标首尾空白并进行验证。由于通用命令平面没有模态编辑器或确认原语，`edit` 会内联接收替换内容；若试图替换未完成的 goal，则直接返回错误，提示用户执行 edit 或 clear。

可预期的领域拒绝会变成稳定的直接命令错误，不公开带品牌类型的 id 或 revision。意外实现失败仍会 reject 分发，使适配器能将其报告为命令失败。通用命令文本和输出仍属于实时 UI 状态；`dsh-goal` 通过自有的持久 `goal/change` 事件记录每项已接受变更。

## 组合

生产方注入 `commands` 和 `goals`。自定义应用会挂载它们的所有者与此插件；自动续行仍是独立选择：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: goal
  name: '@deepseek-ai/dsh-goal'
- id: command-goal
  name: '@deepseek-ai/dsh-command-goal'
```

随附 `dsh` 基础配置启用持久 goal 栈和此命令；Web 客户端提供其交互适配器。ACP（Agent Client Protocol）自动化应用启用领域与模型工具，但不挂载命令适配器；`goals: false` 会移除该栈。无 UI 的 `agent-spine-demo` 必须显式配置 `goals: {}`，避免无头单次调用方在不知情时从一个物理轮次变为包含多个 Round 的操作。

## 模型体验

### 用户 `/goal` 控制

#### 模型看到的内容

斜杠输入、变更以及直接状态／错误输出不会进入模型请求。goal 领域把变更记录为 `goal/change`；已启用的同会话驱动器可以在后续继续执行提示词中暴露结果状态。呈现文本绝不会记录到日志中。

#### Token 影响

读取状态、变更 goal 或收到直接命令错误不会增加模型 token。已启用的同会话驱动器可能增加后续 Goal Round 提示词。

#### KV Cache 影响

命令发现、变更与直接输出不会影响缓存。后续继续执行提示词遵循驱动器的普通请求历史。

## 已知限制与暂缓事项

- **仅纯文本交互**：通用命令注册表没有模态编辑表单或替换确认回调；内联 edit 与显式 clear 能在不同适配器中保持明确且一致的破坏性意图。
- **没有逐命令 Round 上限参数**：`defaultMaxGoalRounds` 仍是部署配置；用户直接请求时，可以要求模型通过另行授权的 goal 工具编辑 `max_goal_rounds`。
- **没有持续状态组件**：裸 `/goal` 是可移植的观察接口；适配器专用徽标和重连后可恢复的命令输出仍属于未来 UI 工作。
- **随附应用中只有 Web 命令适配器使用此命令**：无头、ACP 自动化和 JSON-RPC 适配器不消费 `ctx.commands`。如果组合中包含面向模型的 goal 工具，普通提示词仍能授权它们。
