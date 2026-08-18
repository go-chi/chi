# Agent Note: 生成 Cordis 核心 API 参考文档

Status: implemented
Archived: 2026-07-27

[English](2026-07-20-generated-cordis-core-api.md) | 中文

## 问题

插件作者需要了解 `ctx`、事件派发、Fiber、插件注册和 Service 背后的详细 Cordis API。已有的 [Harness 事件与服务目录](2026-06-20-generated-cordis-catalog.md)有意只简要概括继承自 Cordis 的成员，因此无法替代方法级 Cordis 参考文档。如果在网站下维护另一份手写副本，它会与 vendored 源码产生漂移，也会让渲染器成为额外的文档所有者。

## 决策

`scripts/cordis-core-api.ts` 使用 TypeScript Compiler API，从 `vendor/cordis/src` 读取公开声明和原始 JSDoc。一个显式页面清单在 [`docs/cordis-catalog/core/`](../../../../docs/cordis-catalog/core/context.md) 下生成五个文件：Context、Events、Fiber、Registry 和 Service。`scripts/gen-cordis-catalog.ts` 将这些页面与 Harness 事件和服务目录一同写入，`verify-cordis-catalog` 会拒绝过期产物。

生成器会验证所记录的类和方法保留描述性 JSDoc，包括参数和非 void 返回值契约。它生成包含原始 JSDoc 且仅含声明的 `ts cordis-catalog` 代码围栏，再将同一份说明、参数和返回值契约渲染为便于阅读的 Markdown。源码链接指向 vendored 文件，五个页面之间相互交叉链接。Harness 目录仍是仓库声明的事件与 `ctx.*` 服务的完整清单；核心页面负责说明继承自 Cordis 的 API 如何工作。

`website/docs.ts` 将五个规范源文件发布到结构对应的 `/reference/cordis-api/` 和 `/en/reference/cordis-api/` 路由。在生成器产出翻译页面之前，两个 locale 都使用英文生成源，因此切换语言时导航结构和路由标识保持不变。

## 考虑过的替代方案

**将旧网站文件恢复为规范 Markdown。** 这能快速恢复页面，但其签名和说明可能与 vendored 实现漂移，网站也会重新成为第二个文档来源。

**直接扩充 Harness 目录中的继承层。** 这些目录回答有哪些 Harness 事件与服务。将完整的框架类参考混入同一页面会模糊这份清单的定位，并推翻继承层保持精简的既有决定。

**直接发布 vendored 源码声明。** 源文件具有权威性，但不能提供稳定的主题页面、经过筛选的公开顺序或网站导航，还会暴露不属于参考契约的实现体。

## 影响

五个 Cordis API 页面通过同一个确定性生成器跟随 vendor 更新，并复用仓库的文档新鲜度检查。网站无需复制内容即可获得独立的 Cordis API 章节，中文入口和英文入口的导航结构保持一致。

页面清单需要人工维护，因此新增公开 Cordis 核心类型时必须显式添加生成器条目。当前生成说明只有英文，且源码 JSDoc 的质量直接决定参考文档质量；中文产物需要在生成器层实现翻译，不能手工编辑生成文件。
