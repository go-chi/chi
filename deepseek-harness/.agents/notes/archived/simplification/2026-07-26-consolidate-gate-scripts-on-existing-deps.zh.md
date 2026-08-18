# Agent Note: 把门禁脚本统一到已有依赖与内置模块上

Status: implemented
Archived: 2026-07-27

[English](2026-07-26-consolidate-gate-scripts-on-existing-deps.md) | 中文

## 问题

`scripts/` 下的门禁大多本已在用正确的工具（15 个以上的门禁使用 `node:fs` 的 `globSync`，markdown 门禁使用 mdast/micromark），但少数几个掉队的脚本曾手写同类门禁早已用既有依赖或内置模块完成的事情：

- **重复的围栏扫描器。**`scripts/md-fences.ts`（约 55 行，由 `doc-typecheck.ts` 消费）和 `scripts/verify-type-equiv.ts` 中的 `extractEquivBlocks`（约 39 行）曾是同一个围栏代码块正则行扫描器的两份拷贝，而 `scripts/verify-mermaid.ts` 早已通过访问 mdast `code` 节点来提取代码围栏；`scripts/markdown.ts` 自己的 `markdownProseLines` 也曾先解析成 mdast，再用第二个正则手工跟踪围栏状态。这两个正则扫描器只识别第 0 列的反引号围栏，因此在波浪线围栏和缩进围栏上与基于 mdast 的门禁悄悄不一致。
- **手写的 argv 解析。**`scripts/publint-all.ts` 中的 `parseOptions` 和 `scripts/verify-built-package-invariants.mjs` 中与之几乎相同的拷贝（约 26 行）曾手工推进 argv 下标，而同类脚本（`verify-runtime-closure.ts`、`build-exe-for-python-sdk.ts`、`packages/sdk/scripts/src/args.ts`）早已在使用 `node:util` 的内置 `parseArgs`。
- **手写的目录遍历。**五处代码曾各自重写 `globSync` 已覆盖的嵌套 `readdirSync` 遍历：`verify-runtime-closure.ts` 对 packages 与 vendor manifest（元数据清单）的扫描、`dev-web.ts` 的 `discoverPluginDirs`、`verify-package-paths.ts` 的 `realPackageNames`、`verify-client-domain-graph.ts` 的 `listSources`，以及 `publint-all.ts` 的 `addPath`（合计约 55–65 行）。`scripts/package-invariants.ts` 展示了一行式的 `globSync` 模板。

所有替换都不需要引入新依赖；每一处替换用的都是既有的 devDependency 或 Node 内置模块。

## 决策

- `scripts/markdown.ts` 中的共享 mdast 围栏辅助函数 `markdownFences` 访问 `code` 节点，读取语言、完整 info string、块体以及以 1 起始的开围栏行号；`doc-typecheck.ts` 和 `verify-type-equiv.ts` 通过它提取代码围栏。`md-fences.ts` 和重复的 `extractEquivBlocks` 扫描器已删除，`markdownProseLines` 也改为从解析出的 `code` 节点位置推导围栏内的行，而不再用第二个正则。
- 两个 CLI 都改用 `parseArgs` 解析 argv；未知选项和缺失取值仍然大声失败，只是错误文案换成了 `parseArgs` 自带的文本，而非原先手写的用法字符串。
- 那五处掉队的目录遍历改用 `globSync`。`check-workspace-constraints.ts` 和 `clean.ts` 中的遍历保留：它们需要 dirent 级别的细节来诊断结构异常的目录树，按模式匹配的 glob 报告不了这些信息。

## 曾考虑的替代方案

- **新的 glob/目录遍历依赖（`tinyglobby`、`fdir`）。**不予采纳：内置模块已在全仓库范围内胜出；这几处只是掉队者，不是能力缺口。
- **用 `p-map` 替换 `publint-all.ts` 中约 19 行的有序 worker 池。**刻意未纳入：为一次小删除引入一个新 devDependency，正处在[依赖策略](../process/2026-07-26-dependencies-over-hand-rolling.md)门槛的边缘，而且该池的需求（worker 数量有界、确定性顺序、环境变量覆盖）已记录在[并行 pre-push 门禁决策记录](../process/2026-07-06-parallel-pre-push-gates.md)中。仅当 `p-map` 赢得第二个消费方时再顺带纳入。
- **保留这两个围栏扫描器。**不予采纳：在第三个正确实现旁边放着两份逐渐漂移的解析器拷贝，正是共享的 `markdown.ts` 辅助函数要防止的那种重复；「只认第 0 列反引号」的限制也是同类门禁之间的潜在不一致。

## 后果

- 只剩一个围栏解析器：所有 markdown 门禁现在都经由 mdast 归类代码围栏，因此波浪线围栏、缩进围栏和四反引号容器围栏在各处的行为完全一致。文档树中不存在正则扫描器处理有误的围栏形态，所以在落地这次替换的代码树上门禁结果不变：`pnpm run doc-sync` 及每个被改写的门禁在改动前后各跑一遍，输出逐字节相同（`doc-typecheck` 的块数/opt-out 计数、`verify-type-equiv` 的匹配计数、`publint`、`verify-built-package-invariants`、`verify-runtime-closure`、`verify-package-paths`、`verify-client-domain-graph`，以及两个包 README 散文门禁）。
- `verify-type-equiv` 仍然拒绝未闭合的类型等价围栏：mdast 会在文件末尾静默闭合未闭合的代码块（其比较随后可能通过），因此共享辅助函数会报告闭合定界符是否存在，门禁在块未闭合时报错，保留了被删扫描器的这条拒绝路径。`doc-typecheck` 的扫描器本来就没有这条错误路径。
- `parseArgs` 对重复出现的选项保留最后一个值而不报错——一个测试未固定的开发工具边缘用例，作为删除两份手写解析器的交换被接受。（严格模式下，需要取值处遇到以 `--` 开头的 token 仍会拒绝，与被替换的解析器行为一致。）
