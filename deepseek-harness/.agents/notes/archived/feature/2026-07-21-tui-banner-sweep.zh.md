# Agent Note: 横幅整体扫入；副标题行移除

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-banner-sweep.md) | 中文

> **已被取代**：由[移除启动横幅 Agent Note](2026-07-21-tui-no-banner.md)取代：横幅本身已移除，扫入动画随之移除。

## Problem

[启动 slogan Agent Note](2026-07-20-tui-startup-slogans.md) 用随机 slogan 库加逐字打字机动画取代了说明书式的欢迎行。实际使用中这些引语显得怪异——工具头部出现随机的风味文案——而且动画很慢（每字符 40 ms，扫完一整句），却只动画四行横幅中的一行。本 note 取代该决定中 slogan 的那一半；移除示例配置中欢迎语的决定与动画生命周期的基础设施保持不变。

## Decision

- 删除 slogan 库、`pickStartupSlogan` 和打字机动画。`welcome` 未设置时横幅直接**没有副标题行**——只有标题和模型/会话详情。`welcome` 配置保留给想要固定副标题的部署与 fixture，无动画、逐帧确定地渲染。
- 启动动画现在作用于**整个横幅**：`HeaderComponent` 增加 `revealWidth` 裁剪，头部盒子以约 24 帧、每帧 15 ms（总计约 360 ms、约 60 fps）从左到右扫入，在 `ui.start()` 成功后启动，经打字机动画用过的同一条 `detachListeners` 路径清除。`stopBannerReveal` 同时重置裁剪，因此扫入中途被 dispose 的头部会重新完整渲染。
- PTY 冒烟测试的启动标记从打字机光标（`▌`）改为横幅右上角（`╮`），它只在扫入完成后才渲染。

## Alternatives considered

**保留动画原样、只改文案。** 否决：任何每次启动都被重读的固定或轮换语句都会退化成墙纸；用户的判断是引语本身——而不只是内容——对这个表面来说就是错的。

**按横幅行逐行（自上而下）动画而非左右扫入。** 否决：只有四行时动画只有四个可见步骤——更像闪烁而不是展开；水平扫入用满终端宽度，在相同总时长内动作更平滑。

**用 `revealWidth` 对带样式文本做字符级裁剪。** 采用 pi-tui 的 `truncateToWidth`——头部处理宽度溢出时已在使用的同一个 ANSI 感知裁剪器——因此扫入不可能撕裂转义序列。

## Consequences

- `welcome` 未设置时启动输出再次依赖动画但不再随机：每次启动扫入同一幅横幅。配置了欢迎语的场景（全部快照/脚本化 fixture、Code Mode overlay）保持逐帧确定且不变。
- `STARTUP_SLOGANS`/`pickStartupSlogan` 导出移除；除被删除的测试外没有消费者引用它们。
- 默认横幅少一行（无副标题），因此锚定横幅几何的 PTY 断言使用角落字形而非任何副标题文本。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 固定：扫入完成为完整横幅（两个角 + 标题）且产生了至少一个裁剪的中途帧；配置的欢迎语原文渲染且无裁剪帧；未设置欢迎语的横幅没有副标题；dispose 清除扫入自己的定时器句柄。PTY 冒烟测试在 tui-demo bin、dsh CLI 和个人 overlay 场景中以 `╮` 完成标记启动。已在 tmux 中实机验证。
