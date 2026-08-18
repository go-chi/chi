# @deepseek-ai/dsh-tool-ask-user

[English](README.md) | 中文

模型侧 `ask_user_question` 工具，基于 `ctx.userQuestions` 实现。当模型需要确认、选择结果或缺失的信息才能继续时，它可以借此向用户提出简明问题。

## 工具

`ask_user_question` 接受以下参数：

- `questions`：必填的非空问题对象数组。
- `id`：每个问题必填的稳定 id，会原样包含在回答中。
- `question`：每个问题必填的问题文本。
- `header`：可选的简短标题。
- `options`：可选选项，包含 `label` 和 `description`。如需推荐某个选项，请将其置于首位，并在该标签末尾追加 `(Recommended)`。
- `multi_select`：该问题是否可以返回多个选中的选项。

工具调用 `ctx.userQuestions.ask()`，并返回规范的 `{ answers: [{ id, selected, custom? }] }`。`selected` 包含选项标签；`custom` 携带自由填写的回答，对于多选题会补充 `selected`，对于单选题则会覆盖它。Native 渲染器会保留紧凑的 JSON 文本形式 `{ "answers": [{ "id": "...", "selected": ["..."], "custom": "..." }] }`。

## 职责

此包是用户交互 seam 的Consumer 包。它不渲染 UI，也不了解输入的收集方式；它只将模型参数转换为 `AskUserQuestionRequest`，并把用户回答返回给 agent loop（智能体循环）。

## 模型体验

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`ask_user_question` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ask-user)，其中包含问题 id、提示语、标题、选项和多选标志。

#### Token 影响

工具可见时，每个请求都会产生固定的 schema token 开销。

#### KV Cache 影响

只要定义和可见性保持不变，前缀即可稳定复用。插件生命周期变化或作用域限制可能会使从此 schema 起的缓存复用失效。

### 工具调用历史与结果

#### 模型看到的内容

模型提出的完整问题保留在 assistant 工具调用参数中。用户回答后，下一步会看到精确采用 `{"answers":[{"id":"<id>","selected":["<label>"],"custom":"<text>"}]}` 形式的紧凑 JSON；不使用 `custom` 时会省略该字段，`selected` 可以包含零个、一个或多个标签。调用等待期间的 UI 交互不属于模型上下文。

#### Token 影响

参数和回答 JSON 是依数据而定的保留 token；等待用户时不会产生 token 开销。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **待处理问题会阻塞工具调用，直至用户作答**：该工具未声明 `timeout-policy` 预算；取消仅沿用当前轮次的 `exec.signal`。
- **运行时中归属于其他 agent 的 subagent 不能向用户提问**：`ask_user_question` 会以 `DELEGATED_CALLER` 拒绝归属于另一个 agent 的存活子级；该子级必须在最终结果中包含尚未解决的问题或决策。持久谱系不能决定这一边界，因此带有谱系的会话恢复为运行时根后可以正常提问。
- **Native 回答渲染为 JSON 文本**：规范值仍为结构化数据，但模型侧结果使用紧凑 JSON，而非更丰富的内容块词汇。
