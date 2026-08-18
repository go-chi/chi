# @deepseek-ai/dsh-client-ui-directory-picker-browse

[English](README.md) | 中文

应用内目录浏览界面：浏览式选取交互的浏览器半边。它通过 ui-workspace 的两个 directory-flow 洞（`conversation.hero.workspace.directoryFlow` 与 `sidebar.workspaces.directoryFlow`）装入「选择工作区目录」对话框，经 `ctx.workspaces` 驱动本地 Host 的 `host.listDirectory` 与 `host.createDirectory` 原语。它的 node 对侧是 [`dsh-host-directory-picker-browse`](../../host/directory-picker-browse/README.md)；挂载本包即用一行 cordis.yml 把界面与该后端组合起来，因此没有任何客户端代码按能力种类分支。与 [`-native`](../ui-directory-picker-native/README.md) 界面不同，本对话框不需要本地操作系统选择框，因此也服务于进程内与远程浏览器部署。

对话框是 680×500 的 Miller 分栏视图（在较矮或较窄的视口中限制尺寸）：头部承载标题、选中路径面包屑和可点击编辑的路径区；下方在未选中行时是一整栏层级，选中后该行均分为「层级 | 选中文件夹的子项」两栏。导航落地是选择锚定且安静的——面包屑跳转或提交路径被扫描期间仍渲染旧视图，目标目录与父目录两段导航在同一帧完成——因此回退时，只要尚未到达显示根目录，就会始终保持两栏，且不会闪过中间帧。**新建文件夹**打开一个嵌套创建对话框，目标为选中的文件夹，并选中它创建出来的那个；**打开**采纳选中的文件夹，没有选中时回落到当前层级。Host 标记的隐藏条目默认不显示，直到页脚开关将其揭开——那只是客户端过滤。

确认一个目录即为选中的路径，关闭对话框即为取消。浏览类失败——不可读的目标、创建冲突——都留在对话框自己的提示区内，因此本占位者从不驱动 owner 的 `onError` 分支；工作区创建的错误界面仍由 owner 持有。两处注册通过嵌套的 `slots.inject()` 安装，因为任一声明方条目都可能稍后激活或替换其声明；对话框文案注册在本包自己的 locale 命名空间下，两份字典作为一个单元落地，因此激活失败不会占住该命名空间的其中一种语言。

node 半边是一个空 `apply`：它的存在只为让插件出现在 host 的 cordis.yml 与 Loader 中，浏览器半边经 `exports["./client"]` 出货，并通过 `dsh.client` 清单声明被发现。

## 模型体验

无，因为目录浏览器属于浏览器界面；本包中的任何内容都不会进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **无搜索、无多选、无重命名或删除** —— 对话框只负责列出与创建目录；到达目标靠导航、编辑路径，或用前缀过滤最后一栏。
- **隐藏条目的过滤在客户端** —— Host 始终列出隐藏条目并加标记，因此开关只改变对话框渲染什么。
