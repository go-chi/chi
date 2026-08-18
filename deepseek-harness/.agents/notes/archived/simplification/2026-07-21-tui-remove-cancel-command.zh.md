# Agent Note: Drop the TUI `/cancel` slash command

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-remove-cancel-command.md) | 中文

## Problem

TUI 提供了两条完全相同的取消运行中轮次的方式：`Esc`（以及 `Ctrl+C`）键位绑定，和一条 `/cancel` 斜杠命令。两者都以相同的原因调用 `agent.cancel('cancelled from terminal')`；空闲时 `/cancel` 只打印一条 "The agent is already idle." 通知，而键位绑定保持静默。运行状态行本就标示了该键位绑定（`Enter sends steering, Esc cancels`），且按键取消无需提交编辑器，因此这条斜杠命令只是通往同一效果的第二条、且更难被发现的路径——一块本身不含任何行为的界面。

## Decision

`/cancel` 已移除。取消运行中的轮次是一项仅由键位绑定提供的能力（`Esc`，或运行中的 `Ctrl+C`），状态行提示与 `/help` 快捷键清单已对其作出说明。`baseCommands` 自动补全条目、`/help` 命令行、编辑器提交处理函数中的 `case '/cancel'` 分支，以及它拥有的 "already idle" 通知都已删去；其余每一条斜杠命令（`/help`、`/clear`、`/reasoning`、`/tools`、`/redraw`、`/reload`、`/resume`、`/exit`、`/skill:<name>`）保持不变。键入 `/cancel` 会像任何其他无法识别的斜杠输入一样，落入通用的 `Unknown command:` 警告。

## Alternatives considered

**保留 `/cancel` 作为便于发现的别名。** 否决：运行状态行与 `/help` 都已标示 `Esc`，因此一个键入式别名会为一项单个按键已能更直接完成的操作，增加一条需维护的代码路径和一条逐空闲状态的通知。没有任何消费方需要经由编辑器提交来触发取消。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 断言 `agent.cancelled` 包含 `'cancelled from terminal'`，由该轮次中的 `Esc`/`Ctrl+C` 按键驱动——这是唯一的取消能力。`errors-and-help` 与 `disposed-terminal` 快照固定了不含 `/cancel` 的 `/help` 行；`packages/ui/tui/src` 的逐文件覆盖率维持在 100%。

## Consequences

无法再经由编辑器提交取消一个轮次；取消仅由键位绑定提供。这是对一条冗余路径及其空闲状态通知的净移除，与其余停止能力已遵循的单一原语形态一致（[public stop surface](2026-06-20-public-agent-stop-surface.md)）。若要恢复键入式取消，需连同自动补全条目、提交处理函数分支及其专属测试一并回归。
