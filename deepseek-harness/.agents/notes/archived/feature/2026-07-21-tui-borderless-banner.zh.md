# Agent Note: 横幅回归，无边框

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-borderless-banner.md) | 中文

## Problem

一个中间的无横幅设计删掉了带框的启动横幅：它删除了 `HeaderComponent` 及其扫入动画，把模型移入页脚，丢弃了会话 id，并把 `welcome` 渲染为 transcript 的第一行。用户的裁决把这一切反转：把横幅拿回来——"just remove the border"。令人反感的装饰是那四行盒子边框，而不是它承载的识别信息（模型、会话 id），也不是扫入动效。

## Decision

- `HeaderComponent` 及其从左到右的扫入动画回归，但以**无边框**方式渲染：没有 `╭─╮`/`╰─╯` 边角，也没有 `│` 侧边。每一行都是一个前导空格加上经 `truncateToWidth` 裁剪的内容，因此扫入的宽度裁剪永远不会撕裂转义序列，也不绘制任何固定边框。扫入大约经过 24 帧完成，每帧间隔 15 ms。
- 头部承载标题（`DEEPSEEK HARNESS`）、一条 `<model>  •  <session-id>` 详情行，以及——当设置了 `welcome` 时——一条弱化的副标题。`welcome` 未设置时头部只有标题加详情：不含固定或随机标语。
- 模型**同时**保留在页脚的左段，因此在短暂的横幅滚出视野后，会话使用的模型仍可一瞥可见。
- `welcome` 恢复为横幅副标题；transcript 第一行的通知从 `rebuildTranscript` 中移除。
- 仅当 `welcome` 未设置时才播放扫入动画。配置了 `welcome` 会立即渲染整个横幅，使 fixture 和快照保持帧确定性。扫入在 `ui.start()` 成功后启动，并经与之前相同的 `detachListeners` 路径通过 `stopBannerReveal` 清理；后者还会重置裁剪，使扫入中途被销毁的头部重新完整渲染。

本 Agent Note 统一记录几种已弃用启动方案的当前结论：带逐字打字机效果的随机标语、带边框的整幅横幅扫入动画，以及完全移除横幅。示例组装不设置 `welcome`；部署和确定性 fixture 仍可提供该值。无横幅方案为模型设置的常驻页脚位置继续保留。

## Alternatives considered

**保留盒子但做细或改用更轻的字符。** 否决：指令是 "just remove the border"；任何环绕的字符都是用户所反对的边框装饰。

**在未设置 `welcome` 时保留随机或固定标语。** 否决：反复出现的氛围文案很快失去信息价值，而逐字揭示仅为一行制作动画，速度又慢。因此，未设置 `welcome` 时不显示副标题，由整个横幅提供启动动效。

**完全移除横幅。** 否决：常驻页脚很适合显示模型，却无法承载完整识别详情；把 `welcome` 放入 transcript 还会使展示配置表现成对话内容。

**自上而下揭示横幅。** 否决：按四行分成四步看起来像闪烁。横向宽度裁剪利用终端横向空间实现平滑动效，并复用 ANSI 感知的截断路径。

**既然横幅重新显示模型，就把模型从页脚移除。** 否决：横幅是短暂的，会随 transcript 滚走，而页脚在整个会话中保持模型可见；这个常驻位置被刻意保留。

**将会话 id 留在横幅之外。** 否决：盒子去掉后详情行只占一行，且用户要求横幅"和以前一样"，而以前它承载 `model • session-id`。

## Consequences

- `welcome` 未设置时的启动输出再次依赖动画（扫入）；配置了欢迎语则保持帧确定性，因此每个快照和脚本 fixture 都保留一个固定副标题。
- demo 不再提供教学性质的欢迎填充文案；`welcome` 未设置就表示横幅没有副标题，而该配置仍是部署和 fixture 获得确定性输出的配置手段。
- 模型现在在启动时出现两次——横幅详情与页脚——这是有意的冗余：横幅短暂，页脚常驻。
- `/clear` 清空 transcript 但不清头部，因此横幅及其配置的副标题在 `/clear` 后存活，不同于基于 transcript 的欢迎行。
- 全部 pi-tui 终端快照与 examples/tui-agent 回放快照重新录制（`test:snapshot:refresh`）：横幅行以无盒子字符方式回归；页脚行保留模型前缀。
- 一切锚定横幅缺失的内容改为锚定其存在：PTY 冒烟测试以详情行的 `main-session-` id 为启动标记（它在扫入后段才被揭示），并断言 `DEEPSEEK`/`HARNESS` 出现且无盒子角。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 固定：无边框横幅扫入至自然完成——无盒子角、标题与 `main-session` 详情出现——且至少有一帧扫入中途被裁剪；配置的 `welcome` 完整渲染横幅且无裁剪帧；未设置 `welcome` 的横幅无副标题；销毁会在扫入中途清掉扫入定时器。独立的配色方案用例覆盖终端报告的浅色/深色转换、相同方案下的空操作，以及写入 DSR 查询时抛出异常的终端；`applyColorScheme` 依靠 `setStatus` 重新推导编辑器边框，而不再重复那个导致逐文件覆盖率未达标的无效赋值。tui-agent 与 dsh CLI 的 PTY 冒烟测试以 `main-session-` 详情标记为启动标记并断言无盒子角。快照验证完整帧。
