# Agent Note: 将文档根路由指向快速开始

Status: implemented

[English](2026-08-11-quickstart-documentation-home.md) | 中文

## 问题

单独的文档首页会重复产品首页所维护的产品定位和功能摘要。这些重复声明需要同步与评审，却不能帮助读者查阅技术操作说明。

## 决策

每个 locale 根路由都是重定向页面。`/` 将读者导向 `./guide/quickstart`，`/en/` 则把同一相对目标解析为 `/en/guide/quickstart`。当网站托管在源站的子路径下时，相对目标仍会保留配置的 `DOCS_BASE`。

重定向由 `docs/user/index.md` 与 `docs/user/index.zh.md` 的 VitePress frontmatter 维护。对于 locale 首页，[文档网站投影器](../process/2026-07-13-documentation-site-projection.md)只发布这段 frontmatter，因此权威 Markdown 保留中英文语言切换行，且不会渲染第二个首页。投影器测试验证两个 locale 根路由都使用相对于各自 locale 的同一快速开始目标。

文档网站不承载产品定位和功能摘要。快速开始页面仍提供指南、开发、参考、搜索和 locale 导航。

## 考虑过的替代方案

**保留文档 hero 并同步其文案。** 这样会保留一个推广入口页，但也会产生第二套产品叙事，其中的声明和术语可能与产品首页逐渐偏离。

**在根路由渲染文档索引。** 索引会重复网站已有的导航，并在读者开始首篇操作指南之前插入一次额外选择。

**把快速开始内容复制到每个 locale 根路由。** 这样会让两个公开路由同时维护同一篇教程，并需要另一套同步机制。

**使用源站绝对路径作为重定向目标。** `/guide/quickstart` 等路径会忽略 `DOCS_BASE`，当文档网站托管在源站的子路径下时将失效。

## 结果

进入任一 locale 根路由的读者都会立即到达该 locale 的快速开始教程。文档网站放弃推广型首页，产品首页则继续作为产品定位和功能摘要的唯一归属。稳定的根路由仍是有效入口，快速开始内容仍由单一权威来源维护。
