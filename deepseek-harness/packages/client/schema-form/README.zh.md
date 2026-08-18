# @deepseek-ai/dsh-client-schema-form

[English](README.md) | 中文

面向 settings 编辑器的 schema／草稿模型层。wire 侧的 `settings.describe` 携带每个 namespace 的序列化 schemastery schema（`schema.toJSON()` 的 ref 封装）；`rehydrateSchema` 用 `new Schema(json)` 将其还原（rehydrate）为活的校验器——在宿主上校验分节的那份 schema 对象，就是在浏览器里校验草稿的那份对象，因此客户端校验绝不会偏离 Service Definition 的校验。编辑器各自渲染自己的控件（Models 页围绕它在此探测到的字段手写自己的卡片）；该包不含任何 React，也不做任何渲染。

## 约定

编辑的单元是**用户分节草稿**：一个以不可变方式编辑的普通对象（`setPath` 会物化中间对象，`deletePath` 即逐字段重置——去掉该键，解析值便回退到组合 base 与 schema 默认值）。字段只要出现在草稿中就被标记为**已覆盖**（`hasPath`）——判定采用存在性语义而非值比较，与 settings seam 的分层方式严格对应。`nodeAtPath` 解析可配置提供方目录 `settingsPath` 所寻址的 schema 节点（object 属性按名称解析，dict 条目经由 `inner`），编辑器因此可以在决定渲染什么之前，先探测某提供方的 profile 携带哪些字段（及其 `meta.role`）；无法解析的路径返回 `undefined`，调用方因此会明确进入降级路径，而不是渲染出错误的子树。`validateDraft(schema, draft)` 运行还原出的校验器并返回其失败消息，页面因此可以在写入前拒绝无效草稿。

## 模型体验

无。该包支撑的是浏览器配置编辑器；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **重建 schema 会执行所收到的封装**——`rehydrateSchema` 会重建一个活的 schemastery 校验器，而 schemastery 通过 `new Function` 复活序列化过的回调函数，因此 schema 信封是可执行内容，而不是不可执行数据。只有该封装来自提供该页面的同一受信任宿主时才安全；该协议没有跨信任边界使用的不可执行表示。
- **校验是草稿级的，而非逐字段**——`validateDraft` 报告 schemastery 的第一条失败消息及其 `$.path`；它不会把错误映射到各个控件。
- **没有通用渲染器**——消费方在这些辅助函数上构建功能专用表单。[Web 配置面 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.md) 记录该权衡。
