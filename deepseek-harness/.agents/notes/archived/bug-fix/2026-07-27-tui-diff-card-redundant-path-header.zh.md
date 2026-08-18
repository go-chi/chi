# Agent Note: TUI diff 卡片重复打印文件路径

Status: implemented
Archived: 2026-07-31

[English](2026-07-27-tui-diff-card-redundant-path-header.md) | 中文

## Problem

`edit` 与 `write` 工具卡片会把目标路径打印两次。两者的 `presentCall`/`presentResult` 返回的 diff 卡片，标题为 `Edit <path>`/`Write <path>`，而其唯一的 `FileDiff` 又携带相同的 `path`。TUI 的 `diffLines` 无条件地将 `palette.bold(diff.path)` 渲染为每文件的表头，因此单文件编辑会渲染成：

```
✓ Edit src/foo.ts
src/foo.ts
- old
+ new
```

既有的快照 fixture 掩盖了这个问题：它把编辑卡片标题设为 `Edit renderer`（不含路径），并让结果包含两个 diff，于是标题从未与某个 diff 路径匹配，表头也就不显得冗余。

## Decision

`diffLines` 新增 `showPath` 参数；当一个 diff 卡片只有一个 diff、且生效标题（`resultView?.title ?? callView.title`）已包含该 diff 的路径时，`ToolCardComponent.renderBody` 抑制每文件表头。多文件 diff 卡片保留全部每文件表头。空白或空路径同样落入这条 `String.includes` 判定之下，这正是有意去除的噪声。

抑制逻辑放在 TUI 渲染层，而非各工具的 present 方法中，因为这种冗余是所有当前及未来单文件 diff 卡片共有的展示问题；工具仍在标题和 diff 中同时给出路径，从而非 TUI 消费方依旧能拿到它。

## Alternatives considered

- 从 `edit`/`write` 卡片标题中去掉路径。已否决：标题是可快速扫读的摘要行，去掉路径会削弱它，而且需要在每个工具里重复处理。
- 一律去掉每文件表头。已否决：多文件结果 diff（以及未来任何多文件 diff 卡片）确实需要每文件表头。

## Consequences

该启发式是子串匹配，因此若标题恰好包含某个单一 diff 的路径，即便是偶然匹配也会抑制表头；对真实的产出方而言标题恰为 `Verb <path>`，故在实践中是正确的。快照 `edit` fixture 现在与生产一致：单个 diff，其路径正是标题所命名，从而证明表头被去除；而多文件表头保留由 `tui.spec.ts` 的 `edit` fixture（`Edit files` 标题下的 `a.txt`/`b.txt`）覆盖。

## Testing

`tui.spec.ts` 新增一个聚焦用例，断言标题为 `Edit src/only.ts` 的单 diff 卡片中路径恰好出现一次。`advanced-cards-*` 无密钥快照已重新录制，展示标题行紧接 diff 正文、不再有重复的路径表头。
