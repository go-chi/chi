# Agent Note: Fixed `Tool / <name>` header for tool-call cards

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-tui-tool-card-header.md) | 中文

## Problem

TUI 曾把每次工具调用渲染为 `{glyph} {title}`，其中 `title` 是 presenter 拼接的「动词加细节」字符串（`Read src/index.ts (1200-1360)`、`Edit files`，或 bash 卡片的模型描述），以状态色加粗并加下划线显示。单一扁平的槽位同时承载了工具身份、操作对象和状态，而样式又混用了加粗、下划线和颜色，前后不一致——表头读起来像噪声，「运行了哪个工具」在视觉上与「它操作了什么」无法区分。

## Decision

表头是固定的 `{ring} Tool / <name>` 框架，采用单一扁平的状态色——不加粗、不加下划线、不变暗——因此整行的颜色保持一致。`Tool` 是字面常量；`<name>` 是原始工具名。分隔符是 ASCII 的 `/`。环形标记在调用挂起时为 `○`，落定后为 `●`；表头颜色（挂起用 warning、成功用 success、错误用 error）区分挂起、成功与错误，因此同一个实心环可同时服务于两种落定状态。

表头只携带一个可选的额外内容：bash（终端）卡片由模型撰写的描述，作为 ` / <desc>` 段追加（`● Tool / bash / Run the coverage gate`）。其他工具都不向表头贡献细节。

每一项工具专属的细节都移入表头下方的正文块。非终端卡片的 presenter 标题（`Read src/index.ts`、`Grep pattern`）成为正文第一行，除非它只是重复工具名（无 `presentCall` 的工具的兜底 presenter，或未知工具），此时表头已经显示过。终端卡片保留其命令作为 `$` 行。diff 卡片完全弃用其标题——由各文件的路径表头与一条变更页脚承载含义——并追加一条变暗的 `└ +A -R · N file(s)` 页脚，汇总各文件增删的行数。

本次改版仅限 TUI。它改动 `packages/ui/tui/src/components/transcript.ts` 中的 `ToolCardComponent`，不触碰任何 presenter：`Tool / <name>` 框架在 TUI 侧从调用的工具名推导出名称，正文标题的迁移则复用 presenter 已返回的标题。`presentation.ts` 以及每一个 `presentCall`/`presentResult` 均保持不变。

## Alternatives considered

**把工具名加粗使其突出。** 已否决：在把 SGR-1 渲染为亮色变体的终端上，加粗的绿色工具名读起来与其余绿色表头是不同的颜色——重新引入了改版本要消除的不一致。工具名靠它在固定框架中的位置突出，而非靠字重。

**把 presenter 标题保留在表头**（例如 `Tool / read / Read src/index.ts`）。已否决：动词与工具名重复，而非 bash 工具并没有真正独立的单行描述——操作对象属于正文，因此只有 bash 向表头贡献描述段。

**为每一种卡片都加一条汇总页脚**（行数、退出码徽章、diff 计数统一为一条 `└ …` 行）。已推迟：仅 diff 页脚落地。终端退出保留其既有的变暗 `[exit N]` 行，长输出保留其既有的首尾中段省略，空结果保持仅表头，错误正文保持朴素（仅表头颜色承载错误）——这些既有处理是有意保留的，而非遗漏。正文原本以默认前景色平铺，这种样式后来也经过调整：[整合后的 TUI 呈现](../architecture/2026-07-28-consolidated-tui-presentation.md)把整个正文收进本文所述彩色状态标题之下的同一种暗色调。

## Consequences

工具调用现在把身份显示在一个稳定的位置，状态每行读作一种扁平色，于是许多调用的记录扫读起来是一列 `Tool / <name>`，而非一堵混合样式的动词字符串之墙。代价是非终端工具多出一行正文（迁移过来的标题），以及丢失了先前的冗余抑制——当表头已命名路径时省略 diff 的各文件路径；如今表头不再命名任何路径，因此每个 diff 都会把路径打印一次。由于改动局限于 `ToolCardComponent`，其他 UI 桥（ACP、JSON-RPC）保留各自的工具调用呈现；`Tool / <name>` 的形态是 TUI 局部的，不属于任何跨包契约。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 固定了新表头（`Tool / <name>`）、弃用的 diff 标题、迁移后的 generic 标题以及 `· N file(s)` 页脚。包级语义快照在无界面终端中覆盖各类卡片。已删除的应用流程此前提供组装后的工具执行；未来的终端部署负责提供等价的 transcript 覆盖。
