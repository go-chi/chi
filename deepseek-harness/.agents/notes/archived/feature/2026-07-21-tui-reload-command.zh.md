# Agent Note: /reload 命令按需重读 loader 配置

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-reload-command.md) | 中文

## Problem

HMR 的文件监听器只对其配置根目录（示例中即配置叶子所在目录）下的就地 `change` 事件起反应。以重命名方式替换文件的编辑器（BSD `sed -i`、`git checkout`）不产生事件，而没有挂载 HMR 配置项的运行时则完全没有配置重载路径。开发时这意味着监听器漏掉一次配置编辑就得重启 TUI。曾考虑把监听根目录扩大到整个仓库，讨论后否决：包之间的密集共享使模块级 HMR 变成「重挂大半棵树」的操作，externals 边界也不可预测。

## Decision

`dsh-tui` 增加一个**实验性、仅供开发**的 `/reload` 斜杠命令：遍历 `ctx.loader.entries()`，对每个文件后端的子树（`Include`）调用 `refresh()`——即 HMR 监听器配置变更分支所走的同一条代码路径，改为手动触发、不依赖监听器。未变化的文件是无操作（`Include.read` 做内容比较）；无效文件记录警告并保留运行中的树（热重载韧性契约）；include 的 `patches`——包括 dsh CLI 的个人 overlay——在每次重读时重新应用。

TUI 以**结构方式**访问 Loader（通过局部类型访问 `ctx.loader`，而非 `inject`）：测试和嵌入方在没有 Loader 的情况下运行 TUI，此时 `/reload` 退化为一条警告通知而不是挂载失败。模块源码热重载仍由监听器负责；`/reload` 只刷新配置。

## Alternatives considered

**把 HMR 监听根目录扩大到 `packages/`/`apps/`。** 暂缓否决：插件源码变更会重载每个依赖插件的 fiber，而仓库中密集共享的包（`dsh-session`、`dsh-llm`、`dsh-tools`）使其等同于会话中途拆掉主干和 UI——伪装成热重载的重启，还带部分重载的隐患。手动的、只覆盖配置范围的命令抓住了安全、可预测的那个子集。

**在 `inject` 中声明 `loader`。** 否决：那会让 Loader 成为 TUI 的硬依赖，为了一个开发便利破坏所有无 Loader 的组合（单元测试 harness、嵌入方）。

**在 dsh-tool-cordis 里做一个面向模型的 `cordis_reload` 工具。** 否决：这是终端前人类操作者的动作，不是模型应当触发的能力；cordis 工具集的 mount/unmount 表面已经覆盖模型的运行时修改需求。

## Consequences

- `/reload` 出现在帮助行、自动补全（标注 EXPERIMENTAL (dev)）和两个渲染帮助的快照中（已重新录制）。
- 命令以 transcript 通知报告树数量与完成；单文件失败只出现在 loader 日志里，TUI 不显示——对仅供开发的表面可以接受，完成消息中已注明。
- 重入保护串行化重载：前一次进行中时 `/reload` 会被拒绝并提示警告，使 loader 无互斥的树更新过程保持单写者；保护在完成或失败时释放。
- `/reload` 只在 agent 空闲时运行：重载可能卸载并重新挂载配置项，在活跃轮次下这会把工具或适配器从进行中的调用脚下抽掉。检查是建议性的（检查后仍可能有 send 竞争进来），但消除了常见的坑。
- 若 `refresh()` 的永不 reject 契约将来改变，命令会报告失败而不是留下未处理的 rejection。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 固定：`/reload` 刷新每个文件后端子树并跳过普通配置项（结构化的假 Loader）、报告完成、在门控的刷新进行中拒绝重入并在释放后可再次运行、失败分支同样释放保护、拒绝运行中的 agent 并在空闲后可再次运行、报告 reject 的 refresh、无 Loader 时退化为警告——包括作为真实插件 fiber 挂载的情形，在那里会抛出的服务查找会泄露出去。已在 tmux 中对真实配置树实机验证：探针编辑 → reload 生效；无效编辑 → reload 保留运行中的树。
