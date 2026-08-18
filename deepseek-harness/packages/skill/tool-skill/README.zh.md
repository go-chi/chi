# @deepseek-ai/dsh-tool-skill

[English](README.md) | 中文

面向模型的 skill（技能）目录和 `skill` 工具。

需要 `ctx.agents`、`ctx.tools` 和 `ctx.skills`（`inject: ['agents', 'tools', 'skills']`）。

## 目录生命周期

每次符合条件的 `agent/pre-step`，该插件都会使用调用会话的 cwd 调用 `ctx.skills.snapshot()`，将 pre-step 中止信号转发到发现流程，应用 `skill` 工具的精确可见性，并按顺序渲染 `name` 和 `description` 条目。如果先前不存在目录且该视图非空，插件会向下游 `enter` 决策添加初始的持久用户角色 `<system-reminder>`。目录消息只包含这些摘要；skill 正文、路径、来源、提供方和 `whenToUse` 提示仍位于目录之外。

每条目录消息都携带 `skill-catalog` 来源，也就是 `catalog` 形态的上下文。它的 `entries` 精确记录本次发布的 `name` 与 `description` 对，替换目录另带 `update`。digest 覆盖这些持久条目，而不是渲染后的正文，因此 `<system-reminder>` 包装不会影响是否需要重新发布，消费方也不需要重新解析 `<available_skills>` 块。插件从后向前扫描持久会话事件且不复制，并以最新一条仍可见且可读的 `skill-catalog` 消息作为比较基线；不可读和外来的记录都会跳过。digest 变化时，下游 `enter` 决策会收到一条包含完整替换目录的持久用户角色消息；空替换会显式停用较早的名称。如果已无目录可见，但历史中存在可识别目录，则说明压缩（compaction）已将其遮蔽，下一次完整观察会重新建立当前目录。提供方快照不完整时，插件不会发送任何内容，并会保留最后一次完整的模型视图，在下一次 pre-step 重试。若不存在先前目录且当前视图为空，则不需要 tombstone。

如果最初没有模型可调用 skill，则省略目录；如果该 agent（智能体）的工具视图排除了随附的 `skill` 工具，或解析出同名的作用域内遮蔽项，也会省略目录。身份比对针对本插件所注册的那个定义，而非按自身名字回查，因此本插件既可全局挂载，也可挂在单个 agent 的组装内——在后者中 `register()` 只注册到该 agent 的层中。可见性变更参与 digest 计算，使提示词指引、模型可见 schema 和可执行分派保持对齐。

`catalogDescriptionMaxLength` 控制规范化后的目录描述，渲染时会对其执行 XML 转义。其默认值是 `500`，且必须是不小于 `3` 的整数，以便为截断省略号保留空间。[skill 目录热刷新 Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-skill-catalog-hot-refresh.md) 负责定义持久初始目录和替换目录的生命周期。

## 工具：`skill`

| 参数 | 类型 | 说明 |
|---|---|---|
| `name` | string（必填） | 可用 skill 列表中精确的 kebab-case skill 名称。 |

执行使用调用 agent 的 `session.header.cwd`，使结果随工作区变化的提供方能够解析出胜出的 skill。成功调用返回规范形式的 `{ name, provider, resourceBase?, content }`，其中不包含目录排名和提供方内部机制；其 Native 渲染器会生成一个文本结果，其中包含 `<skill_content name="...">`、`<skill_resources>` 和 `<skill_instructions>`。

资源指引只会根据 `resourceBase` 解析指令显式引用的路径或 URL；脚本、参考资料和资源文件按需加载，结果不会列举 skill 目录。本地提供方可以提供目录，而远程或嵌入式提供方可以提供 URL 或不透明加载指引。

无法解析的名称会报告 skill 未知或已不可用。无效名称和 `invocation.modelInvocable` 为 `false` 的 skill 会产生不同的错误结果。`invocation.userInvocable` 不限制这个面向模型的接口。

工具执行不会添加合成上下文消息。新加载的结果已作为工具结果记录，并在下一个模型步骤可用，无需重复正文。只有目录投影会添加替换摘要。

## 模型体验

### 会话目录

#### 模型看到的内容

如果存在模型可调用 skill，且可见的正是这个 `skill` 工具，agent 会在第一个请求之前收到下方目录模板，其中包含每个已排序 skill 的一条随数据而定的条目。该目录是一条持久的用户角色消息。后续成员关系、描述或可见性的变化会使用同一个 `<available_skills>` 信封追加完整替换；删除所有 skill 时，会追加一个空信封，并明确指示不得使用旧名称。模板的结尾一句是防止双重加载的规则：用户显式的手势边界（下文的 pre-step 监听器）会把同一份 `renderSkillContent` 输出（共享自 `@deepseek-ai/dsh-skill`）内联注入，目录则告诉模型遵循该块，而不是再经工具重新加载该 skill；替换目录模板的两个分支——包括清空后的目录——都携带同一句话。

##### Skill 目录模板

```markdown
<system-reminder>
A skill is a reusable set of task-specific instructions. The following skills are available in this session:

<available_skills>
- `<name>`: <normalized-and-capped-description>
</available_skills>

If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.
</system-reminder>
```

#### Token 影响

重复输入成本随 skill 数量和 `catalogDescriptionMaxLength` 增长；当列表为空或工具被隐藏或遮蔽时，不会发送初始目录 token。每次实际目录变更都会添加一条保留的完整替换消息。

#### KV Cache 影响

初始持久目录追加在现有可重用前缀之后。动态变更作为该目录之后的仅追加历史，因此较早的可重用 token 保持不变，每条新追加的目录和后续轮次都会形成新的后缀。新建或恢复的实例如果 digest 发生变化，可能会从新追加的目录位置起影响缓存重用。

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`skill` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-skill)。

#### Token 影响

工具可见时，每次请求都有固定的 schema token 开销。

#### KV Cache 影响

工具定义和可见性不变时，前缀稳定。遮蔽、限制或插件生命周期变更可能从该 schema 起使重用失效。

### 工具结果

#### 模型看到的内容

成功调用使用下方结果模板，以及提供方管理的资源指引、目录资源指引、URL 资源指引或不透明资源指引。

##### Skill 结果模板

```markdown
<skill_content name="<escaped-name>">
<skill_resources>
<resource-guidance>
</skill_resources>

<skill_instructions>
<provider-owned-instruction-body>
</skill_instructions>
</skill_content>
```

##### 提供方管理的资源指引

```markdown
Resources for this skill are managed by provider "<provider>".
Load referenced resources only as needed.
```

##### 目录资源指引

```markdown
Base directory for this skill: <path>
Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
```

##### URL 资源指引

```markdown
Base URL for this skill: <url>
Resolve relative URLs mentioned by this skill against the base URL before using them. Load referenced resources only as needed.
```

##### 不透明资源指引

```markdown
Resources for this skill: <description>
Load referenced resources only as needed.
```

#### Token 影响

已加载指令是取决于数据的工具结果 token，并在后续步骤中重新发送，直到压缩；不会制作重复的 `agent.inject()` 副本。

#### KV Cache 影响

仅追加；新可见内容位于可重用请求前缀之后，不会使现有 KV Cache 条目失效。

### 工具错误

#### 模型看到的内容

无效或陈旧选择会精确返回 `Error: invalid skill name "<name>"`、`Error: skill "<name>" is unknown or no longer available` 或 `Error: skill "<name>" is not available for model invocation`。提供方抛出的查找文本取决于数据，并套用同一个 `Error: <message>` 包装层。

#### Token 影响

只有失败调用会添加这些已保留 token。

#### KV Cache 影响

仅追加；新可见内容位于可重用请求前缀之后，不会使现有 KV Cache 条目失效。

### 用户显式调用注入

#### 模型看到的内容

已认领用户消息中任意位置、以空白为界、指名工作区目录中某个用户可调用 skill 的 `/name` token，会把该 skill 的完整 `<skill_content>` 渲染（与上文结果模板完全相同的形态）作为 `user` 角色的指令上下文注入，追加在该步骤所有其他注入之后——背景在前，模型要着手处理的材料在最后。只扫描直接的用户输入，检查在已加载定义上进行，未知名称和用户不可调用的名称保持为普通行文。这是 `disable-model-invocation` skill 唯一的入口，目录和 `skill` 工具永不暴露这类 skill；目录的结尾一句会告诉模型遵循注入块，而不是重新加载它。

#### Token 影响

每次手势会把一份渲染后的 skill 正文作为注入上下文加进该轮次——尺寸与同一 skill 的工具结果相同，该成本会随用户请求必然产生，而非由模型自行决定。同一步骤内对同一 skill 的重复手势只注入一次。

#### KV Cache 影响

仅追加；注入落在该步骤的消息批次中、可重用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **目录省略 `whenToUse`、来源和提供方元数据**：路由只基于名称和有长度上限的描述；`whenToUse` 仍是提供方元数据，加载后的包装层也不渲染它。
- **已加载指令正文没有大小上限**：提供方可返回足以占用大量下一步上下文的 skill；只有目录描述会被截断。
- **资源是指引，而非附件**：工具报告基础目录/URL/不透明提示，但既不列举也不为模型获取引用文件。
- **加载是一次性文本**：远程提供方缓慢或 skill 正文很大时，不提供部分内容、流式输出或缓存内容句柄。
- **目录替换采用全量列表**：一个名称或描述发生变化，就会追加当前所有可见摘要；这样能显式停用陈旧名称，但 token 成本与目录大小成正比。
- **正文不做版本化**：仅修改正文不会改变目录 digest，也不会通知模型；后续工具调用会读取提供方的当前内容，而先前工具结果仍是历史事实。
