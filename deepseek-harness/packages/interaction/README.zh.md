# interaction/：人机协作平面

[English](README.md) | 中文

人与运行中的 agent（智能体）协作所经由的服务与插件——提问、审批、权限预设、命令。这些是**产品**包：由用户直接操作的真实接口。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`commands/`](commands/README.md) | 为交互式适配器注册并分派用户命令。 | `ctx.commands` |
| [`user-approval/`](user-approval/README.md) | 协调一次性审批决策。 | `ctx.approval` |
| [`permission/`](permission-presets/README.md) | 呈现并持久化面向用户的权限预设。 | `ctx.permissionPresets` |
| [`user-questions/`](user-questions/README.md) | 定义与提供方无关的用户问答 seam。 | `ctx.userQuestions` |
| [`tool-ask-user/`](tool-ask-user/README.md) | 向模型提供用户问题。 | （注册到 `ctx.tools`） |

这些包通过现有的 agent 和会话约定集成，而不改变循环。交互式应用提供具体的命令、审批和提问适配器；自动化使用 [`acp/`](../acp/README.md)，可运行的演示组合包位于 [`examples/`](../examples/README.md)。产品 [`dsh`](../../apps/cli/README.md) CLI（命令行界面）直接组合这些包。

子系统参考：[approval.md](../../docs/subsystems/approval.md)、[permission-presets.md](../../docs/subsystems/permission-presets.md)、[user-questions.md](../../docs/subsystems/user-questions.md)与 [commands.md](../../docs/subsystems/commands.md)。仅自动化的 ACP 传输是 [`acp/`](../acp/README.md)，SDK 的 JSON-RPC 服务器端是 [`sdk/server`](../sdk/README.md)，共享 bin 启动胶水是 [`boot/`](../boot/README.md)。
