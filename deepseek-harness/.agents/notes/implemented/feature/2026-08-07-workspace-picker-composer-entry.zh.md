# Agent Note: 未选择 Workspace 时从编辑器打开现有选择器

Status: implemented

[English](2026-08-07-workspace-picker-composer-entry.md) | 中文

## 问题

[Session scope 决策](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.md)会在 Workspace 存在前保留同一个常驻编辑器，但 textarea 处于禁用状态，只有较小的 Workspace chip 能打开选择器。用户首次点击最显眼、也最熟悉的输入区域时，界面不会响应，尽管同一界面已有继续操作的入口。

## 决策

新会话尚未归属任何 Workspace 时，整张输入卡片都可通过鼠标点击激活现有的 `conversation.hero.workspace` 选择器——点击处理器归卡片所有，其禁用控件放行指针事件，因此整个胶囊是同一个目标；只读的常驻 textarea 也可经 Enter 或 Space 激活。`aria-haspopup="menu"` 和 `aria-expanded` 在共享选择器菜单挂载时描述其展开状态。全新安装没有 Workspace 行时，选择器会立即转交目录对话框并清除自身的展开状态；该对话框使用自己的可访问性语义。虚线 l4 描边（SVG dash ring，因为原生 `dashed` 的间距不可调）配合 hover 时的 business 蓝，把卡片标记为选择入口。卡片会拦下 `pointerdown`，使已打开选择器的外点关闭无法与点击的重新打开竞态——先关后开会让 chip 的展开回显闪动。消息提交、命令、权限、模型及其他 Session 作用域控件会保持锁定，直到用户选择 Workspace 并创建或重新连接真实 Session。

Workspace 选择继续使用现有 owner 和流程。`ConversationRoot` 打开选择器，`WorkspacePicker` 列出或创建 Workspace；Session 到达后，同一个 textarea DOM 节点变为可编辑状态。

## 考虑过的替代方案

**保持 textarea 禁用并突出 Workspace chip。** 这样能保留原有控件边界，但首次操作时最主要的编辑器区域仍然没有响应。

**在 textarea 上方放置透明按钮。** 按钮具备直接的触发器语义，但它会在常驻 textarea 上方增加第二个可聚焦元素，并使保留焦点、输入法和草稿行为的 DOM identity 过渡更复杂。

**在选择 Workspace 前接收草稿。** 这需要由 client 拥有的草稿 Session 或另一条 Session 前状态轴。此功能只需要提供一个更容易发现的现有选择器入口。

## 后果

用户首次点击编辑器即可继续必要的设置流程，键盘用户也能激活同一路径。textarea 会如实报告只读状态，直到 Session 存在；相邻控件仍处于禁用状态。界面没有引入新的 Workspace 状态、传输或目录选择流程。

组件测试会固定鼠标和键盘激活、覆盖整卡的点击目标、被拦下的 `pointerdown`、相邻控件锁定、选择器展开，以及同一节点变为可编辑 textarea 的过渡。组装后的 Web helper 会通过 textarea 开始全新 Workspace 设置，因此重放浏览器场景会覆盖实际交付路径。
