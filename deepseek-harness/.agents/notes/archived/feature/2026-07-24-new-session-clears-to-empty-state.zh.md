# Agent Note: New Session clears onto the empty-state launch

Status: implemented
Archived: 2026-07-26

[English](2026-07-24-new-session-clears-to-empty-state.md) | 中文

## Problem

侧栏「New Session」会立即创建并打开空白会话，因此中间栏显示带空 transcript（文本记录）与常驻 composer 的 `ConversationRoot`。Figma 的 NEW SESSION 屏（`EmptyState` + 共用的 `InputBar` hero）仅在 `sessions.current` 已为 undefined 时渲染，因而主创建控件无法到达启动页。

## Decision

`SessionsService.clear()` 清除持久化选中项与 `list.current`。顶层侧栏创建入口（无 cwd 的 `onCreate()`——New Session 与 New Workspace）调用 `clear()`，使 `AppFrame` 渲染 `conversation.empty`。空态的首次发送仍走 `conversation.startSession`（create → open → send），并复用与常驻 composer 相同的 `InputBar` 组件（`variant="hero"`）。按项目的「+」（`onCreate(cwd)`）继续 create-then-open，直到空态选择器能接受预填的 cwd。

## Alternatives considered

**为 New Session 保留 create-then-open，并在 transcript 为空时于 ConversationRoot 内再加一套空态 chrome。** 否决：这会重复启动页的 InputBar，并破坏 empty→content 的约定——同一 InputBar 应移动位置，而非互换组件。

**将 New Session 路由到选中状态之外的专用 route 或 slot。** 本轮否决：`conversation.empty` 已拥有启动 UI；清除 `current` 即是既有的空态分支。

## Consequences

New Session 在首次发送前不再创建 host 会话。clear 后重新加载仍停留在空态。项目范围的「+」仍立即创建。`EmptyState` 按 Figma 堆叠英雄区（Input_Bottom 75:8208）：鱼标 + 标题、卡片上方由 Menu 驱动的工作区 chip，再接共用的 `InputBar`（`variant="hero"`，max-width 800，与 composer 一致的 r20 卡片——而非更高的 r24 英雄区），选择器与卡片背后居中铺一层柔光椭圆（figma 313:14109），宽度按卡片锁定为 `1051/776` asset 比例，随卡片缩放。Chip 采用 75:8208 的柔和交互 hover 填充与 12px 圆角，并打开 MenuDropdown（figma 122:9481；`--dsw-specific-menu` + `--dsw-shadow-lv3`）：带文件夹图标与尾随勾选的 basename 行，分隔线后是 "New Workspace"，其子菜单（figma 419:16920）提供 "Use a existing folder" 与 "Create new"。Use a existing folder 打开路径 Dialog（figma 451:18655 copy — "Enter an existing folder path" / Open Folder），置于全视口遮罩（`--dsw-alias-bg-mask-1` + `--dsw-mask-blur`）之上，并设置 chip 的 cwd。Create new 打开同一套 Dialog chrome，在 `host.describe().cwd` 下命名文件夹；成功则走 `sessions.createWorkspace` → host `session.create`（mkdir recursive）→ `sessions.open`，在新 workspace 中默认落下一会话。`InputBar` 绘制底栏 chrome（attach / Plan / Read-only / model），仅用本地原生 `<select>` 状态——host 侧的 plan、access、model 接缝仍未接线。
