# Agent Note: “插件”设置中的功能自有标签页

Status: implemented

[English](2026-08-11-plugin-settings-tabs.md) | 中文

## 问题

插件配置与只读 Loader 清单各自注册了一个顶层 `settings.section`。两者描述同一个“插件”领域，却占据两行导航，把搜索与配置拆成互不相关的页面，也没有给 Settings 外壳一个有原则的聚合方式。若直接合并两者的组件，则会让一个功能插件 import 并拥有另一个功能的数据生命周期。

## 决策

`@deepseek-ai/dsh-client-ui-settings-plugins` 拥有唯一一个 id 为 `plugins` 的 `settings.section` 贡献。它渲染共享标题和紧凑标签栏，声明根级列表 slot `settings.plugins.tab`，并把该记录中的 id、order 与跟随语言的 label 投影成标签页。该 slot 的规范类型位于 `ui-settings`，因此标签页贡献方依赖设置领域约定，而不是依赖另一个功能插件。

分区拥有方贡献 `configurable` 标签页，由它声明既有的嵌套 `settings.plugin.item` 列表。配置卡片原有的命名空间绑定、草稿状态、校验与写入均保持不变。`@deepseek-ai/dsh-client-ui-settings-plugin-inventory` 向 `settings.plugins.tab` 贡献 `all` 标签页；它的 Host Loader 观察器、生成的 Remote 命名空间、DTO 与搜索语义保持不变。已停用的清单条目会在摘要和详情中省略重复的“未挂载”运行状态，已启用条目仍显示其 Cordis 阶段。

默认选择顺序中的第一个标签页。某个标签页只有首次被选择时才挂载，之后在“插件”分区保持挂载期间只隐藏而不卸载。这样会把清单 RPC 延迟到用户打开**插件列表**时，并在切换标签页时保留草稿、搜索文本、折叠状态和已读取的快照。关闭 Settings 会卸载该分区，因此再次打开后，重新选择该标签页时会取得新的清单快照。

两项注册都使用 `ctx.slots.inject()`。分区声明方卸载时，标签 slot 及其全部贡献随之折叠；重新声明后，每项功能都能重新注册，无需静态 import，也不依赖激活顺序。

## 备选方案

**保留两行 Settings 导航，只改名称。** 否决，因为重复是结构问题，而非文案问题：两个页面仍然代表同一个“插件”领域，并继续争夺导航空间。

**把清单组件 import 进 `ui-settings-plugins`。** 否决，因为配置插件会因此拥有另一个插件的 Remote 依赖与生命周期，也会把可选的浏览器贡献变成包级依赖。

**在分区拥有方硬编码两个标签页的名称和组件。** 否决，因为第三项功能需要修改拥有方，HMR teardown 也可能留下已不存在贡献的界面框架。slot 记录已经提供标识、顺序、本地化与级联语义。

**把“插件”聚合移入 `ui-settings-general`。** 否决，因为 Settings 外壳拥有通用导航与模态界面框架，而不拥有功能内容。把“插件”专属标签页放在那里，会让今后每一种“插件”视图都需要修改外壳。

## 影响

Settings 只有一行“插件”导航，排在“Agent 预设”之前，包含**插件配置**与**插件列表**两个标签页。“Agent 预设”仍是独立分区，因为它编辑每个会话的 agent 组装，而非实时 Host Loader 树。

功能所有权保持明确：`ui-settings-plugins` 拥有“插件”页面与可编辑卡片，`ui-settings-plugin-inventory` 拥有只读清单视图，Host／RPC 路径不变。新的“插件”视图只需注册一个 `settings.plugins.tab` 贡献即可加入。

该聚合依赖分区拥有方被组装：没有 `ui-settings-plugins` 时，`ui-settings-plugin-inventory` 会等待标签 slot 的声明且不渲染任何内容。这是通过 slot 注册表承载的有意组合依赖，而不是静态包 import。
