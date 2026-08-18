# Agent Note: TUI 状态行标示排队中的 steering 消息

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-steering-queue-badge.md) | 中文

## Problem

轮次运行期间，编辑器提交会调用 `agent.steer()`，在运行中的轮次后面加入 steering（中途引导）队列（[前门 Agent Note](2026-07-17-dedicated-full-screen-tui-front-door.md)）。运行时的状态行只以 `Enter sends steering, Esc cancels` 提示收尾，因此按下 Enter 后没有任何反馈表明消息已入队、也看不出有多少条正在等待送达模型。连续 steering 多次的用户无法把队列和被吞掉的按键区分开。

## Decision

agent（智能体）的收件箱（inbox）才是权威的 steering 队列，但 TUI 无法观测它，因此徽标是从公开的 `agent/queued` 与 `steering/message` 事件重建出的实时计数，而非对队列本身的投影。

- 运行时的状态行经 `formatTurnStatus` 组装：`queued > 0` 时在 `Enter sends steering, Esc cancels` 提示前插入 `${queued} queued · ` 徽标，为零时是纯提示文本；其前的阶段标签与耗时归[详细状态行](2026-07-21-tui-verbose-status-line.md)所有。
- `createTuiChat` 持有一个 `pendingSteering` 计数器：每收到一个针对本 agent 且 `info.steering` 为真的 `agent/queued` 就 `+1`，agent loop（智能体循环）每排空一条时随对应的 `steering/message` 会话事件 `-1`（下限为零），agent 一旦离开 `running` 状态即重置为零。
- 计数通过 `setMessage` 刷新到实时的 `Loader` 上；空闲时刷新是空操作，因为 loader 只在运行中的轮次期间存在。
- 重置放在 `agent/status` 状态切换里，而非 `setStatus` 中，因为 `setStatus` 在轮次中途的颜色方案变化时也会运行，绝不能清掉一个实时计数。

## Alternatives considered

**仅从会话日志推导计数**（入队数减去排空数，回放时重算）。否决：取消会清空 inbox 而不记录排空，因此日志无法区分一条消息是被排空还是被丢弃；「离开运行态即重置」这个锚点更简单，且每轮自我校正。

**在 `setStatus` 内重置。** 否决：`setStatus` 会在轮次中途的 `applyColorScheme` 时重新运行，会错误地把实时计数清零；状态切换才是轮次真正结束的唯一位置。

**去掉递减的下限钳制。** 否决：agent loop 自行产生的 steering（如 continuation 续跑原因）会记录 `steering/message`，却没有对应的用户入队递增，这会把计数压到负数；零下限让徽标成为下界，而非谎报。

**把措辞或某个阈值做成配置。** 否决：「插件里不许硬编码可调参数」规则针对的是随部署变化的行为，不是品牌文案；`welcome`/提示字符串本就是固定的展示文案。

## Consequences

- 徽标是尽力而为的实时 UI 状态，不写入日志：它由事件重建、每轮重置、从不持久化，因此恢复（resume）出的运行中轮次徽标从零开始。
- 队列中途取消会经由「离开运行态即重置」干净地清掉徽标，排空到零以下则是空操作——两者都不会残留一个陈旧计数。
- 如果 agent loop 续跑时让 agent 保持 `running`、同时把未排空的迟到 steering 重新入队，则可能短暂多计，直到下一次空闲重置；徽标只作参考，因此这个窗口可以接受。
- `packages/ui/tui/src/index.ts` 保持 100% 的单文件覆盖率。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 通过真实的 `createTuiChat` 驱动运行时状态帧：为零时的纯提示、忽略他方 agent 的入队、递增到 `2 queued`、非 steering 的入队保持不变、每条消息排空时的递减、排空到零以下时的钳制、以及轮次结束时的重置。已在 tmux 中实机验证——三次 `agent.steer()` 调用后徽标显示 `3 queued`，随后两条排空时显示 `1 queued`。
