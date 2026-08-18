# Agent Note: 启动 slogan 取代配置化的 TUI 欢迎语

Status: implemented
Archived: 2026-07-26

[English](2026-07-20-tui-startup-slogans.md) | 中文

> **已被取代**：slogan/动画的那一半由[横幅扫入 Agent Note](2026-07-21-tui-banner-sweep.md)取代：slogan 库和打字机动画上线后实际使用中显得怪异，已替换为无副标题的横幅加整体扫入。移除示例配置中欢迎语的决定与动画生命周期基础设施（`ui.start()` 后启动、经 `detachListeners` 清除）保持不变。

## Problem

TUI 头部副标题来自一个 `welcome` 配置，示例叶子配置把它设为 "TUI agent ready. Give it a coding task."——一句说明书式的填充语，对老用户毫无信息量，每次启动都在复述产品是什么，而且它还有一个硬编码的孪生兄弟（`'ready.'`）作为两个包里的 schema 默认值。产品需要的是一个有性格的启动时刻，而不是一条静态横幅说明。

## Decision

- `examples/tui-agent/cordis.yml` 不再配置 `welcome`；该配置键保留给需要固定、确定性副标题的部署与 fixture（Code Mode overlay 和所有快照/脚本化 fixture 都保留各自的欢迎语）。
- `welcome` 未设置时，`dsh-tui` 每次启动从导出的 `STARTUP_SLOGANS` 库里挑选一条（`pickStartupSlogan`，随机源可注入），并以打字机动画逐字显示：每帧 40 ms 一个字符，完成前尾随一个 `▌` 块状光标。动画只在 `ui.start()` 成功后启动，其定时器与其他监听器一起在 dispose 时清除。
- slogan 库是展示文案，刻意不做成配置：想控制措辞的部署已经有 `welcome` 这个出口。按契约 slogan 只含 ASCII，因为逐字显示按字符切片。
- `dsh-tui-demo` 只在配置了 `welcome` 时才转发它，不再填默认值，应用不再替 TUI 决定空闲副标题。
- 无 key 的 PTY 启动场景改为等待逐字显示的光标（`▌`——空 transcript 里该字形的唯一来源），不再等待已删除的欢迎文本。

同一变更把 `packages/ui/tui/src/index.ts` 恢复到 100% 的单文件覆盖率（颜色方案合并曾在集成分支上破坏它）：`applyColorScheme` 里对编辑器边框颜色的重新赋值是死代码（紧随其后的 `setStatus` 调用会重新推导它），已删除；颜色方案查询的 `.then`/`.catch` 箭头函数改为具名、有测试的处理器（`applyReportedScheme`、`ignoreSchemeQueryFailure`——后者由一个让终端在 DSR 查询写入时抛错的测试固定）。

## Alternatives considered

**换一条更酷的固定 slogan。** 否决：一条每次启动都重读的字符串会和它取代的那行一样退化成墙纸；一个小的轮换库以零复杂度代价让这个时刻保持新鲜。

**把 slogan 库和显示速度做成配置。** 否决：那是为展示文案新增两个旋钮；对措辞有主张的部署已经有 `welcome` 这个出口，而「插件里不许硬编码可调参数」规则针对的是随部署变化的行为，不是品牌文案。

**在 `HeaderComponent` 内部做动画。** 否决：组件将需要持有 TUI 句柄和自己的生命周期；聊天层已经拥有渲染循环、定时器和释放路径，所以逐字显示与 `createTuiChat` 的其他资源放在一起，由 `detachListeners` 清除。

## Consequences

- `welcome` 未设置时启动输出不再字节级确定（随机 slogan、定时帧）。所有录制或快照表面都显式固定 `welcome`，因此没有快照变化；PTY 冒烟测试改为锚定逐字显示光标和会话 id 行。
- `welcome` 的 schema 默认值从 `dsh-tui` 和 `dsh-tui-demo` 中消失；不传 welcome 的直接调用方现在得到的是 slogan，而不是 `'ready.'`。
- 新增一条 slogan 只需在库里加一行；测试断言成员归属，不断言具体文本。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 固定以下行为：注入随机源后的确定性选取、逐字显示（库中某条完整渲染、观察到光标帧）、配置了 welcome 时逐字动画不启动且原文渲染、以及 dispose 停止进行中的动画。`examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` 在 PTY 里启动真实配置树并等待显示光标。已在 tmux 中实机验证（中途帧 `no map below▌`，随后是完整 slogan）。
