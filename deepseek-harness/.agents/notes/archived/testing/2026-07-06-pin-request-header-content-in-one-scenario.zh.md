# Agent Note: 在单个快照场景中固定请求头内容

Status: implemented
Archived: 2026-07-26

[English](2026-07-06-pin-request-header-content-in-one-scenario.md) | 中文

## 问题

一个 ACP（Agent Client Protocol）快照测试套件需要证明每个 `request/header` 中实际发送的组合系统提示词与工具 schema 列表，但如果在每个 `session.jsonl` 中重复这些内容，一次提示词或 schema 编辑就会改写数十条巨大的单行 JSON 记录。保留一份原始 header 可以避免重复，但提示词的评审体验仍然很差：行文被 JSON 转义到一行中，与数千字符的工具 schema 混在一起。

## 决策

每种请求头组合类别恰好有一个场景标记为 `pinsHeader`。其目录按评审格式拆分固定内容：`system-prompt.expected.md` 以普通 Markdown 包含规范化的完整提示词序列；`tool-schemas.expected.json` 以结构化 JSON 包含对应的完整 schema 序列；`session.jsonl` 保留 config、reason 和所有模型可见前缀，同时将 `header.system` 与 `header.tools` 存为 `"{{system}}"` / `"{{tools}}"`。其他每份 JSONL 都使用相同的提示词与工具 token，并同样将会话前缀内容 token 化。固定机制位于 [`dsh-acp-snapshot`](../../../../packages/support/acp-snapshot/README.md)，其套件 factory 强制每种类别恰好有一个固定场景。

纯 `scrubSystemPrompts` 和 `scrubToolSchemas` 规范化器会分别将每个已存储完整请求头 token 化。`scrubRequestHeaders` 还会为非固定场景把会话前缀内容 token 化，同时保留请求头数量、字段存在性、config、reason 和前缀消息数量。记录与刷新写回会在写入 JSONL 前应用适当清理，并根据规范化的实时完整请求头序列重新生成两个 sidecar，因此两条路径都无法把大段提示词/schema 重新引入 JSONL，也不会留下陈旧的评审产物。

守卫使这种拆分能够自我强制。在磁盘上，每个 `session*.jsonl` 都是提示词和 schema 清理器的固定点；只有非固定 fixture（测试前置数据）必须是完整请求头清理的固定点；两个 sidecar 恰好位于固定 fixture 旁，并采用规范、以换行符结尾的格式；每种类别都有一个固定场景。在实时运行中，由父项、spawn 子项、fork 子项、初始请求、恢复或实例内变化产生的每个 `request/header`，都必须在易变值规范化后与重建的类别序列匹配。请求头若没有字符串提示词、没有数组值工具列表，或超过固定场景声明的变更请求头数量，就会响亮失败。

一个固定场景覆盖整个套件，因为每个会话（parent、spawn 子会话、fork 子会话）组合出的工具列表完全相同、提示词除 cwd 外完全相同，而一致性守卫会在这一前提不再成立时立即使套件失败。如果 header 组合将来在设计上变为会话相关的（例如受限的 subagent 工具集），那么分歧的形态将获得自己的固定场景。

## 曾考虑的替代方案

- **每次变更重新录制或手动编辑所有 fixture**：保留了精确的 header，但行为差异被重复的提示词和 schema 内容淹没。
- **仅在比较时 scrub，fixture 保持原始内容**：比较能通过，但已提交的 fixture 保留着陈旧的重复内容，下次录制时会整体重写。存储 token 诚实地表明每个 JSONL 没有固定什么。
- **全部 scrub，不做任何固定**：丢失了组合 header 实际发送内容（提示词组装、已注册工具顺序、完整 schema）的唯一端到端记录。生成的工具目录只孤立地记录每个工具；只有真实 fixture 才能固定组合后的完整集合。
- **将完整固定内容全部保留在 JSONL 中**：消除了套件范围的重复，但提示词和 schema 变更仍然是一行转义文本。Markdown 和结构化 JSON 为每种内容提供其自然的评审格式，同时不削弱重建 header 的断言。
- **收窄会话日志本身（记录内容 digest，把请求头存到其他位置）**——违反可重建性契约：产品日志必须逐 bit 复现每个请求（[可重建请求 Agent Note（agent 决策记录）](../architecture/2026-07-05-reconstructable-requests.md)）。请求头体积是测试产物问题，应在测试规范化中解决；实时日志保持不变。

## 验证

该套件针对拆分后的固定内容回放每个场景。单元覆盖率会覆盖独立与完整清理器、两种完整请求头 sidecar 格式、记录/刷新重新生成、规范化提示词/schema 提取、固定点强制、必需文件对称性、重建请求头一致性，以及变更请求头数量拒绝。

## 后果

系统提示词变更在每个受影响的组合类别中产生一个面向行的 Markdown diff；工具描述变更在每个类别中产生一个结构化 JSON diff；普通行为 fixture 不受影响。会话 fixture 对省略的内容显示 token，运行时一致性守卫使每个拆分固定场景对其类别内的所有会话具有权威性。每个固定场景携带两个生成的、换行规范化的 sidecar 文件。
