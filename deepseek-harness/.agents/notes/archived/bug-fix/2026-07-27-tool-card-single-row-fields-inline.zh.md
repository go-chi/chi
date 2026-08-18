# Agent Note: 工具卡片的单行字段以内联方式渲染

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-tool-card-single-row-fields-inline.md) | 中文

## Problem

工具卡片的标题、描述、cwd 以及待执行的 `$ <command>` 回显各自都是一个逻辑行。bash 工具直接用模型给出的命令与描述来设置卡片标题（和描述），而对于多行 bash 脚本，这些内容包含真实换行。这些字段此前用 `displayText` 转义，而 `displayText` 会刻意保留 `\n` 作为结构性布局。于是多行标题会换到卡片行数核算未预留的额外终端行上，标题后续的行便覆盖了描述、输出，或编辑器的 steering 提示——卡片渲染成互相重叠的乱码文本。移除 gutter bar（见[可复制 transcript 的 note](../simplification/2026-07-27-copyable-transcript-no-gutter-bar.md)）后，这些行不再位于逐行前缀之后，因而暴露了这一冲突。

## Decision

单行卡片字段改用 `displayInlineText`（将 `\n` 转义为字面量 `\x0a`）而非 `displayText`：包括卡片标题、terminal 卡片的 `description` 与 `cwd` 元数据行，以及待执行的 `$ <command>` 回显。每个字段都严格保持在一行内，因此多行命令不再会换行并与相邻行冲突。真正多行的字段——捕获的命令输出与 `contentText` 结果正文——仍保留 `displayText` 加 `split('\n')`，因为它们本就应占据多行。

## Alternatives considered

- **在 presenter 输出中剥除换行**（在 bash 工具里）—— 会对该视图的所有消费方隐藏模型真实的命令形态，并把 UI 关注点塞进工具。转义应发生在单行渲染处。
- **让标题刻意换到多行** —— 卡片标题是一行式身份标识；除非重排整个卡片，多行标题仍会与其后的元数据行冲突，还会让 transcript 膨胀。

## Consequences

- 多行 bash 命令渲染为单行内联标题（`S=/tmp\x0aecho …`）；其下的描述、输出与退出码行保持完整。已在 tmux 中对待执行（`◌`）与已完成（`✓`）两种状态实测验证。
- `tui.spec.ts` 中新增了一个 `multilineTerminal` 工具卡片用例，断言对含换行的标题与描述会出现内联转义后的形式。
