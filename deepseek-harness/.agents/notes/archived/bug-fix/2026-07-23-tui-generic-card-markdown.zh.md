# Agent Note: TUI 通用卡片的 Markdown 渲染

Status: implemented
Archived: 2026-08-04

[English](2026-07-23-tui-generic-card-markdown.md) | 中文

## Problem

工具展示器可以在通用卡片（generic card）内容中写入 Markdown，其中包括用于后台任务确认和执行错误的围栏 `console` 输出。把这些内容按纯文本渲染会暴露围栏标记，并与同一 transcript（文本记录）中的助手内容和用户内容显示不一致。

## Decision

TUI 先用共享的 Markdown 主题渲染通用卡片的结果内容，再应用卡片的头尾行数限制。终端卡片和 diff 卡片保留各自专门的纯文本渲染器；通用卡片的原始输入仍按字面显示，因为它代表的是工具参数，而非展示器撰写的行文。

共享主题隐藏围栏语法，保留可选的语言标签，并将围栏正文按代码配色。渲染先于截断执行，因此收起状态卡片的行数和边界描述的是可见的终端行，而非 Markdown 源文本行。

## Alternatives considered

**在 Bash 展示器中剥除围栏。**这只修复一个生产方，其他工具产生的通用卡片 Markdown 仍不会被渲染，还会让展示器依赖 TUI 的行为。

**把每种工具卡片都按 Markdown 渲染。**终端输出和 diff 有专门的格式，且可能包含必须保持字面显示的 Markdown 标点。

**在 Markdown 渲染之前应用收起状态卡片的行数限制。**按源文本行截断可能从中间截断围栏块，还会让可见行数与卡片使用的行数不一致。

## Consequences

通用工具卡片与对话内容使用同一套 Markdown 词汇和净化路径。通用卡片中的 Markdown 标点会被解释，而不再总是按字面显示；需要字面终端输出的工具使用终端卡片这一渲染意图。

聚焦的 TUI 测试固定了隐藏的围栏、保留的语言标签和正文文本。无密钥的终端状态快照通过组装后的 TUI transcript 覆盖该行为。
