# Agent Note: 文档站导航与仓库 chrome

Status: implemented

[English](2026-08-12-documentation-site-navigation-and-chrome.md) | 中文

## 问题

参考侧边栏把 43 个子系统页排在了所有其他分组之前：VitePress 配置中的 `sectionOrder` 既没有为子系统分组、也没有为承载 Python SDK 页的分组声明位置，`indexOf` 返回 `-1`，于是它们排到了所有已排序分区的前面。点击 `参考` 导航项落在架构页，而该页自己的侧边栏条目是 62 条中的第 44 条，位于 2478px 侧边栏的 1549px 处——在视口之外。四个子系统页所用的 `order` 值已被同一分区内的其他页占用，只靠 `Array.prototype.sort` 的稳定性和 manifest 数组恰好的拼接顺序才没有错乱。

顶栏把 `入门` 指向 `/guide/`，而 manifest 已把入门首页发布在 `guide/quickstart.md`，该导航项因此返回 404：写死的导航目标会与 manifest 实际发布的路由脱节。

另外，每个规范页面都带有写给 GitHub 读者的行——标题下的语言切换行，部分页面还有仓库徽章——站点原样投影了它们，尽管其导航栏已经提供了这两者。

## 决定

[website/docs.ts](../../../../website/docs.ts) 拥有分区位置。`sections` 按 locale 声明各分组，`sectionSpec(locale, label)` 返回分组的位置与折叠行为，当某 locale 未为该 label 声明位置时抛错。未出现在声明中的分组现在会让构建失败，而不是静默排到最前。位置按 locale 声明，是因为两侧侧边栏各自命名分组，而两侧共用的标签 `SDK` 无法同时相对 `入门` 和相对 `Guide` 取同一位次。

子系统页按关注点分组——总览、内核与作用域、会话与持久化、模型与上下文、执行与工具、策略与交互、平台与接入——其中六个主题组保持折叠，直到某一组包含正在阅读的页面。这些分组排在参考侧边栏的最后：展开时它们的数量超过其余所有分组之和，因此排在它们之后的任何内容都只能靠滚过整个列表才能到达。页面 `order` 由数组位置推导，不再手写数字。

`landingLink(locale, collection)` 依据 `orderedPages`——即侧边栏所用的同一套排序——推导每个导航项的目标，因此导航项始终打开该分区已发布的首个页面。

[scripts/project-doc-site.ts](../../../../scripts/project-doc-site.ts) 中的 `projectedPageContent` 会丢弃语言切换行和仓库徽章。切换行的匹配被限制在前八行内，因此展示该约定的教程仍能渲染出它的示例。

导航栏标题是内联进 `siteTitle` 的 DeepSeek 字标，VitePress 会将其按 HTML 渲染。内联正是让字标的 `currentColor` 填充跟随当前主题的原因；`themeConfig.logo` 渲染为 `<img>`，会把字标固定为文件声明的颜色，并且需要为每套主题各准备一份资源。侧边栏滚动条平时不可见，滚动时出现，通过 `data-` 属性而非 class 标记，因为 Vue 在 patch 该元素时会整体重写 `class`。

## 考虑过的替代方案

**为中文查询定制搜索分词器。** 已实现并撤回。其前提——MiniSearch 会把中文散文留作无法切分的整句——是用一个语料中根本不存在的词（`子代理`）验证的；中文页面写的是 `Subagent` 和 `子 agent`。在未改动的索引上实测，`插件配置` 返回 120 条命中、`会话持久化` 85 条、`工作流` 28 条、`沙箱` 12 条，且各自的页面均排在首位：`prefix: true` 已经能通过标点切出的短 token 命中中文词。相邻字符二元组把中文索引从 1.23MB 增至 2.12MB，却没有带来收益。该尝试还暴露出一个值得保留的陷阱：VitePress 通过 `Function.prototype.toString` 把搜索选项中的函数送到浏览器，再用 `new Function` 重建，因此任何闭包引用了模块级常量的此类函数都会在空作用域中抛错，并静默地返回零结果。

**把子系统分组直接放在 `概念` 之后。** 已否决：这样能让架构页回到顶部，但生成参考、Cordis API 和开发手册仍处在 43 行之下。

**在投影时重写文件名链接文字。** 子系统索引表写的是 `[core.md](core.md)`，在站点上读起来像仓库文件索引。`scripts/project-doc-site.spec.ts` 断言了该行的确切格式，因此这些文件名是刻意的约定而非疏漏；要改变站点显示的内容，就要连同该约定及其门禁一起改，而不是在投影器里绕开它们。

## 影响

在所有子系统分组折叠时，参考侧边栏高度为 1452px，此前为 2478px，且架构页是它的第一个条目。分区位置与折叠行为声明在同一份 manifest 中，不再分散于 manifest 与配置之间；`scripts/project-doc-site.spec.ts` 固定了三条不变式：每个拥有侧边栏的页面都能解析到位置、未声明的分区会被拒绝、同一分区内没有两个页面共用 `order`。

剥离 chrome 不改动规范 Markdown——切换行与徽章仍服务于 GitHub 读者。代价是投影器现在知晓源语料的两项呈现约定，而采用不同切换行措辞的页面将不会被匹配到。

字标是同一图形的第二份副本，另两份位于 `apps/web/public/favicon.svg` 和 `packages/client/ui-primitives/src/FishLogo.tsx`，各自承载自己的呈现方式。DeepSeek 字标的变更只有通过更新这份副本才能到达文档站。
