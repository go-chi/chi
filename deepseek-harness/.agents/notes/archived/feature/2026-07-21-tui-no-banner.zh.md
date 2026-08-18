# Agent Note: 移除启动横幅

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-no-banner.md) | 中文

> **已被取代**，见[无边框横幅 Agent Note](2026-07-21-tui-borderless-banner.md)：横幅及其扫入动画回归，只是去掉了盒子。本 note 为模型设立的页脚归宿得以保留。

## Problem

TUI 启动时展示一个带框的产品横幅（"DEEPSEEK HARNESS" + 模型/会话详情），最近一版还带扫入动画（[横幅扫入 Agent Note](2026-07-21-tui-banner-sweep.md)）。用户的裁决：删掉它。每次启动都被重读的产品标题是装饰，盒子在任何内容之前先占掉四行，而它承载的识别信息（模型、会话）有更好的去处。

## Decision

- 删除 `HeaderComponent`、扫入动画及其生命周期接线。TUI 直接挂载进 transcript；启动时分隔线之上不渲染任何东西。
- 模型名移入页脚状态行的左段（`<model>  <cwd>  ↑tokens ↓tokens`），会话使用的模型因此始终可见，而不只是启动时。会话 id 不再显示——它存在于会话日志和 `./.sessions` 文件名中，`dsh --resume <id>` 和 `/resume` 选择器会从中获取该 id。
- 配置了 `welcome` 时，它作为 transcript 的第一行（一条弱化的通知）在 `rebuildTranscript` 内渲染，因此调色板切换会保留它。未设置则什么也不渲染。fixture 保留各自配置的欢迎语；PTY 冒烟测试的启动标记改为页脚的模型名——无论 cwd 多长都保证渲染的唯一挂载后文本。

本 note 完全取代[横幅扫入 Agent Note](2026-07-21-tui-banner-sweep.md)：扫入动画和它所动画的横幅都已移除。

## Alternatives considered

**保留单行头部（去掉盒子）。** 否决：唯一有承载价值的信息是模型名，而页脚已经聚合会话状态；为一条信息保留专用头部行仍是同一种装饰，只是小一点。

**把会话 id 也放进页脚。** 否决：36 字符的 UUID 会占满 100 列页脚并裁掉状态段；它的用途是恢复会话的标识，属于日志/文件系统关注点，不是需要一瞥可见的信息。

**把欢迎语渲染在 transcript 之外（分隔线上方）。** 否决：transcript 上方任何固定区域都会再次变成横幅；作为 transcript 行它自然滚走，并通过与其他 transcript 元素相同的路径在重建后保留。

## Consequences

- 启动输出再次完全确定——没有任何动画帧；两轮动画迭代留下的定时器生命周期机制全部移除。
- 全部 26 个 pi-tui 终端快照重新录制（`test:snapshot:refresh`）：横幅行消失，页脚行增加模型前缀。
- 锚定横幅文本（`DEEPSEEK`、盒子角）的内容改为锚定页脚模型名；启动输出中不再出现 `main-session-`。
- `/clear` 现在也会清掉欢迎行：它是普通的 transcript 行，而 `/clear` 清空 transcript（旧横幅能在 `/clear` 后存活只因为它在 transcript 之外）。
- 页脚左段变宽；窄终端上右侧状态段更早被裁剪。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 固定：`welcome` 未设置时无盒子角/产品标题、transcript 为空、模型在页脚；配置的欢迎语作为 transcript 第一行且无横幅；欢迎语在调色板切换的 transcript 重建后保留。PTY 冒烟测试以页脚模型名为启动标记并断言 `DEEPSEEK HARNESS` 不出现。快照验证完整帧。
