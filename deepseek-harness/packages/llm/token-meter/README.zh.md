# @deepseek-ai/dsh-token-meter

[English](README.md) | 中文

通过单例 `ctx.tokenMeter` 服务进行具备回放感知能力的 token 测量。它从持久日志为每个会话推进一个隔离 fold，因此压缩（compaction）与其他压力敏感插件可以共享计量，无需依赖 `CompactionEngine`。

## 配置

估算器没有配置项。它有意使用一项固定启发式规则：每个 token 按四个字符估算，再加上角色、块与请求 envelope 字段的结构开销。任何配置键都会被拒绝；模型容量属于拥有精确提供方／模型路由的适配器，可通过 `ctx.llm.resolveModelInfo().context` 获取。

## 测量约定

`ctx.tokenMeter` 直接公开两个操作：

- `measure(session, requestHeader?)` 在同一个已消费日志 revision 上返回请求压力与当前已计价表层。
- `estimateMessage(message)` 使用固定启发式规则为一条消息计价。

`measure()` 会同步一次，并返回一个独立且深度不可变的快照。`totalTokens` 是请求与响应压力，`surfaceTokens` 是仅表层启发式总量，等于 `nodes[].tokens` 之和。`requestHeader` 覆盖只影响压力字段；表层字段仍描述当前会话。每次调用都会克隆带位置的节点，因此测量是 O(surface)。

fold 跟踪完整请求标头快照、步骤边界、表层追加与替换、成功 assistant 消息、提供方用量，以及每条 assistant 消息引用的分片 seq。只有当最新成功调用的规范请求 envelope 与已测量 envelope 匹配，且其总量不低于该调用的完整启发式锚点时，才会复用提供方用量；后续成功会替换较早锚点。否则会对当前 envelope 与表层进行完整估算。表层变更保持相对于匹配锚点的带符号值，包括缩减替换后的负 delta。

用量计量会求和不重叠的输入、cache-read、cache-write 与输出 bucket；不会再次添加推理（reasoning）。每次成功调用都会记录一个 assistant 锚点，包括无内容调用。显式的空 `sourceEventSeqs` 列表表示已知空提供方流；遗留记录缺少该列表时，fold 会保守地将持久 assistant 输出视为提供方输出。

## 会话投影

当组合提供 `ctx.sessionProjections` 时，token-meter 会通过一个可选子 fiber 注册三个单元。

`tokenUsage` 携带完整持久日志中的 `uncachedInputTokens`、`outputTokens`、`cacheReadTokens` 和 `cacheWriteTokens`。即使请求随后失败，用量分片仍会计入；同一 `(turn, step)` 的最终 assistant 消息用量会替换该样本，而不是重复计数。推理仍是输出的一个细分项。只保留单个最新样本，依赖的是会话日志的一条顺序性质：一旦某个更晚的步骤报告了用量，合法日志就绝不会再为更早的步骤报告用量。

`contextPressure` 携带可选的 `pressureTokens`（提供方报告的最新提示词规模，为未缓存输入加缓存读取与写入之和）、可选的 `projectedTokens`，以及来自最新一条 `request/context` 记录的可选 `contextWindow`。提供方报告用量前两个数字都保持缺失；路由适配器未公布容量时容量也保持缺失。输出不计入其中，因此轮次流式输出期间 `pressureTokens` 保持不动，等到下一个请求报告用量时才前进。

`projectedTokens` 是「下一个请求的提示词要花多少」：在该样本之上，加上自取样以来表层增减部分的启发式重新计价，下界钳制为零，折叠走的是测量服务重放的同一份 `surface-fold.ts`。只有增量部分是估算的，因此这个数字既锚定在提供方读数上，又能在内容落地——或压缩遮蔽一段区间——的瞬间做出反应。最后这种情况正是该字段存在的理由：压缩通过直连的 `ctx.llm.stream()` 调用生成摘要，自身不追加任何用量，所以仅凭 `pressureTokens` 会一直报告压缩前的提示词规模，直到再完成一整个轮次为止。占用率展示读取 `projectedTokens`。

`contextBreakdown` 携带启发式的 `systemTokens`、`toolsTokens` 与 `messageTokens`，描述上下文的组成而非提供方计费规模。envelope 数字在每条 `request/header` 上按后者胜重新计价；消息数字重放 `surface-fold.ts`——也就是 `measure()` 运行的同一个带位置 fold——因此它在每个事件边界上都等于 `measure().surfaceTokens`，压缩会像缩小下一个请求那样缩小它。三个数字都使用测量服务的固定启发式规则，属于估算值：它们加起来不等于 `projectedTokens`——后者的提供方锚点所体现的恰好是这些明细行仍然带着的误差（按「4 字符 ≈ 1 token」计价，CJK 文本与 JSON schema 会被严重低估）。请把它们当作近似的**组成**呈现，而不是总量。

三个单元都使用标准的投影基线、实时帧、seq 高者胜值仓和 JSON 检查点路径。卸载 token-meter 会移除这三个键。不带投影 seam 的组合会保留测量服务的既有行为。

### 上下文占用率是刻意为之的近似值

这些占用率字段各自后者胜、彼此独立，**不是**对单个请求的一次原子观测。切换模型时，新容量会与上一路由的样本配对，直到下一个请求报告用量为止；而 `pressureTokens` 描述的是最后一个请求，不是此刻的表层——`projectedTokens` 把该样本沿表层的增减推进到当下，但它的锚点仍然是那个较早的请求。

这是刻意的选择。占用率百分比是面向用户的参考数字，既不是计费记录，也不是门控输入：harness 中没有任何环节依据它做决策，压缩改为直接读取 `measure()`。UI 用测得的压力除以为所选模型单独解析出的容量来计算占用率。

[Agent Note](../../../.agents/notes/implemented/architecture/2026-07-29-projected-token-usage-and-request-context.md) 记录了否决「让这对值保持原子」方案的那次对比。需要同一边界精确数字的消费方应在自己的请求边界调用 `measure()`，而不是读取该投影。

## 组合

```yaml
- name: '@deepseek-ai/dsh-token-meter'
- name: '@deepseek-ai/dsh-compaction-basic'
```

两个插件都有可用默认值。meter 保持与模型路由和可选压缩无关。部署会在 LLM（大语言模型）适配器上配置容量，并在 `dsh-compaction-basic` 上配置压缩策略。

## 模型体验

通过 `dsh-compaction-basic` 等消费方间接影响；该服务自身不添加提示词、消息、schema、工具或模型调用。

#### KV Cache 影响

不会直接失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **固定启发式规则是近似值**：没有可复用提供方用量的内容按字符数加结构开销计价，而不是使用精确提供方 tokenizer 或请求 serializer。
- **每次测量都会克隆当前表层**：一致且不可变的快照使读取成为 O(surface)，包括低于阈值的压力检查。
- **提供方用量只能为完全相同的规范 envelope 复用**：提示词、前缀、工具、提供方、模型或调用配置变更都会有意回退到完整启发式估算。
- **保守处理缺少源事件 seq 的遗留记录**：没有 `sourceEventSeqs` 的 assistant 消息无法区分提供方输出与 listener 改写，因此 fold 不会声称已知空流或精确分片流。
