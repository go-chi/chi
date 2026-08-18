# Agent Note: 用 turndown 替换 tool-web 的正则 HTML 转 markdown 转换器

Status: implemented
Archived: 2026-08-07

[English](2026-07-26-turndown-for-tool-web-html-markdown.md) | 中文

## 问题

`dsh-tool-web` 的 `src/html.ts`（约 86 行，另有约 40 行专属测试；已由本变更删除）曾用正则表达式把抓取到的 HTML 转成 markdown：剥离 script、style、noscript 标签与注释，转换 `<a>`/`<h1-6>`/`<li>`，解码数字实体外加一张 12 项的命名实体表，并折叠空白。该模块自身的 JSDoc 写明「A richer converter can replace it without changing the seam or tool schema」，README 的 Known Limitations 章节也把它记载为「a minimal regex converter, not an HTML parser — tables, images, and nested formatting are lost」。[web 能力 seam 决策记录](../architecture/2026-06-24-web-capability-seam.md)把 HTML 转 markdown 作为呈现职责划归本包，因此替换点恰好就在这里。每个抓取到的 HTML 页面上，该转换器的输出都对模型可见；此前没有任何无密钥快照执行到 `web_fetch`，因此没有预期输出固定它的行为。

## 决策

`packages/web/tool-web/src/fetch.ts` 持有一个模块级 [`turndown`](https://github.com/mixmark-io/turndown) 实例（`headingStyle: 'atx'`、`codeBlockStyle: 'fenced'`、`bulletListMarker: '-'`——固定的面向模型呈现方式，不是部署可调项），配合 `@joplin/turndown-plugin-gfm` 的组合 `gfm` 插件提供表格／删除线支持，并用 `remove(['script', 'style', 'noscript'])` 替代旧实现的整体剥离。`formatFetchOutput` 通过 `fetchMaxOutputChars`（默认 200,000）同时限制同步转换的源前缀和完整渲染输出，因此自定义提供方无法在输出上限生效前造成无界的转换工作。随后，HTML 分支对转换做双重防护：保守的线性词法扫描会保守处理注释内容，跳过原始文本元素的内容，正确处理标签内的引号文本，并在栈深超过 512 层时将主体作为原始 HTML 直接透传；当 turndown 拒绝守卫无法建模的标记时，try/catch 同样回退为原始 HTML。GFM 单元格规则被覆写为忽略 `colspan`；Markdown 无法表示它，这也避免了不受信任的数值属性凭空合成任意数量的空单元格。`html.ts` 及其转换测试已删除；源／输出上限、回退以及状态头／截断页脚格式化均在 `tests/tool-web.spec.ts` 中有测试覆盖，README 的 Known Limitations 用有界降级情形替换了正则转换器警示。gfm 插件不带类型声明；`src/turndown-plugin-gfm.d.ts` 基于 `@types/turndown`（devDependency）声明了唯一被导入的导出。

提案标记的依赖体积问题的裁决结果支持替换：`@deepseek-ai/dsh-tool-web` 在单文件可执行文件闭包内（[single-exe 决策记录](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md)），可执行文件的资产 glob 会把这三个包按发布原样打入约 7.9 MB——但其中约 6 MB 是 `@mixmark-io/domino` 的测试语料（`test/**`），运行时 `lib/` 仅约 550 KB，相对约 174 MB 的产物，两种口径都不到 0.5%。

## 快照覆盖

此前缺失的无密钥 `web_fetch` 快照随本变更以 acp-agent 场景 `web-fetch` 落地：`examples/acp-agent/web.cordis.yml` 组合了 web seam、真实的 `dsh-web-fetch-local` 提供方、`search: false` 的 `tool-web`，以及 `web-fetch-fixture-server.mjs`——一个固定端口（抓取的 URL 是录制 transcript（文本记录）的一部分）上的回环 HTTP fixture（测试前置数据），提供包含命名实体、GFM 表格与嵌套格式的确定性 HTML。录制与无密钥回放都驱动真实的 HTTP 抓取与转换；固定住的工具结果就是 turndown 的输出，该场景同时固定 `web` header 类（`web_fetch` 的 schema 与指引）。

## 曾考虑的替代方案

- **`@mozilla/readability` 加一个 DOM。** 它解决的是另一个问题（内容提取，而非格式转换），还会拖入更重的 DOM 依赖；这个 seam 只要求把抓取返回的内容渲染成 markdown。
- **保留正则转换器。** 按其自身 JSDoc 的说法，它本来就是明确的 v1 占位实现；保留它意味着模型可见的质量（表格、图片、嵌套格式）继续缺失，代价还是维护一套自制实体表。
- **仅引入 `entities` 的最小变体。** 提案中的退守方案：只用零依赖的 `entities` 包替换 `html.ts` 中的实体解码部分，删得更少但完全避开依赖体积问题。未采纳：上述闭包测算表明体积无关紧要，而完整替换能删掉整个手写转换器及其记录在案的质量缺口。
- **用原版 `turndown-plugin-gfm` 而非 `@joplin/turndown-plugin-gfm`。** 原版已无人维护（最后发布于 2018 年）；Joplin 分叉与 turndown 7 保持同步并持续发布。

## 后果

- **收益**：基于标准的模型可见 markdown——普通表格、图片、删除线、嵌套强调、围栏代码块以及完整的命名实体集——并删除了自制转换器及其实体表。
- **代价**：两个运行时依赖（`turndown` → `@mixmark-io/domino`）进入 tool-web 进而进入可执行文件闭包（如上实测约 550 KB 运行时代码）；超长输入只转换有界前缀，病态嵌套回退为原始 HTML，跨列表格单元格会被展平，因为 GFM 没有对应语法。
- 每个抓取到的 HTML 页面上模型可见的输出都已变化；旧输出本无任何固定，新快照固定了新输出。

## 测试

- `packages/web/tool-web/tests/tool-web.spec.ts` 覆盖 turndown 转换面（实体、链接、表格、嵌套、script/style/noscript 移除）、被忽略的表格跨列、源前缀与完整输出上限、深层或带欺骗性闭合嵌套的快速原始 HTML 透传、畸形标签的线性处理、残余的转换器抛错回退，以及恰好达到上限和极小的输出预算；该包 src 的逐文件覆盖率为 100%。
- acp-agent 的 `web-fetch` 快照无密钥地端到端固定组装后的行为（真实 Loader 组合、真实 HTTP 抓取、真实转换）。
