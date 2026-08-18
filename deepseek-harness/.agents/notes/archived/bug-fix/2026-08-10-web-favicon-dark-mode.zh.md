# Agent Note: 网页图标随配色方案切换

Status: implemented
Archived: 2026-08-10

[English](2026-08-10-web-favicon-dark-mode.md) | 中文

## 问题

`apps/web/public/favicon.svg` 把 DeepSeek 图标绘制为纯黑色（`fill="#000"`），而 `index.html` 只声明了这一个 SVG 图标。当操作系统或浏览器处于暗色配色方案时，标签栏同样是深色，黑色图标实际上不可见。Safari 26 之前的版本不渲染 SVG favicon，因此这些版本的 Safari 用户无论何种配色方案都看不到标签页图标。

## 决策

favicon 保持单一文件，并通过浏览器自身的配色方案信号自适应：`favicon.svg` 内嵌 `@media (prefers-color-scheme: dark) { path { fill: #fff } }`，在暗色方案下把图标切换为白色，浅色方案保持黑色。`index.html` 与 `manifest.webmanifest` 同时声明 32×32 PNG 兜底（`favicon-32x32.png`，DeepSeek 品牌蓝 `#4D6BFE`），Safari 26 之前的版本会渲染该 PNG，且它在浅色与深色标签栏上都清晰可见；这是对 [Web 安装 manifest 决策](../feature/2026-08-06-web-install-manifest.md) 的扩展。

主题信号取操作系统/浏览器方案，而不是 GUI 应用内 `dsh.theme` 开关：favicon 位于浏览器 chrome 中，其背景跟随浏览器方案，因此 `prefers-color-scheme` 是正确语义，无需任何 JavaScript。已知的浏览器怪癖——Chromium 在切换方案后可能要到刷新页面才重绘标签图标，Safari 26 之前的版本忽略 SVG 变体——均被接受，旧版 Safari 场景由 PNG 兜底覆盖。

## 曾考虑的替代方案

- **新增指向独立暗色 SVG 的第二个 `<link rel="icon" media="(prefers-color-scheme: dark)">`。** 不予采纳：语义相同却要多维护一个文件，相比文件内媒体查询没有任何收益。
- **由主题 presenter 在 `theme/change` 时替换图标 href。** 不予采纳：它会跟随应用内开关，而不是真正决定标签栏颜色的浏览器方案，并且为一个 chrome 资源引入客户端代码和 presenter。
- **不提供 PNG 兜底。** 不予采纳：Safari 26 之前的版本从不渲染 SVG favicon，兜底是这些版本获得标签图标的唯一途径。

## 后果

浅色方案仍显示黑色图标，暗色方案显示白色，Safari 26 之前的版本两种方案都显示蓝色 PNG。`apps/web/tests/pwa-manifest.e2e.ts` 固定断言 PNG 链接及其位于 SVG 之前的顺序、manifest 中的两个图标、交付 PNG 的格式与尺寸，以及交付 SVG 内部的暗色媒体查询。Chromium 的重绘怪癖仍是浏览器行为，应用无法修复。
