# Agent Note: 用户消息气泡下方的 IconActions

Status: implemented
Archived: 2026-07-27

[English](2026-07-27-user-message-icon-actions.md) | 中文

## 问题

聊天用户气泡下方没有操作栏。Harness 设计稿（figma `User_Bubble/message_container`）在气泡下方右对齐展示三个 IconActions——复制、在新对话中分支、编辑——与产品其他位置使用的操作栏模式一致。

## 决策

仅当 `kind: 'user'` 时，`MessageItem` 拥有这些操作。布局为纵向列（`align-items: flex-end`，间距 6px）：先是气泡，再是高度 28px 的操作行；行内间距 10px，圆形图标按钮尺寸为 28px（`IconCopyOutline16`、`IconBranchOutline16`、`IconEditOutline16`）。Tooltip 承载中文标签。操作默认保持可见；`@media (hover: hover)` 下在悬停或 focus-within 前隐藏，以便触摸／`hover: none` 设备仍能发现控件（仅靠 opacity 仍会命中测试）。

复制将气泡内拼接后的文本块写入剪贴板（`navigator.clipboard.writeText`，并以 `execCommand` 作为回退）。分支与编辑目前仅有外观、尚无处理函数——它们预留设计席位，但不发明会话 fork 或编辑重提交流程。

steering（中途引导）气泡保持仅徽章形态，不展示这些操作。

## 考虑过的替代方案

**现在就把分支／编辑接到真实的会话 fork 与草稿编辑。**本次变更不予采纳：这些产品流程尚未定稿；交付无行为按钮符合请求范围，也避免半成品的变更路径。

**在悬停外始终以 `opacity: 0` 隐藏。**因触摸不予采纳：若无 `@media (hover: hover)`，空闲 opacity 看起来空白但仍会命中测试。具备悬停能力的指针保留淡入；其他设备保持操作可见。

## 后果

用户消息立即可用复制；分支／编辑仍为可点击的占位，直至后续决策明确其行为。测试钉死三个按钮、复制载荷，以及对 steering 的排除。
