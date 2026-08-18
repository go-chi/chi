# @deepseek-ai/dsh-skill

[English](README.md) | 中文

纯 agent skill（智能体技能）提供方注册表。

该包负责 `ctx.skills` 接口。它不知道 skill 来自本地文件、嵌入式插件数据、HTTP 还是其他后端；提供方通过 `ctx.skills.registerProvider(...)` 注册这些来源。已发布的本地实现是 [`@deepseek-ai/dsh-skill-filesystem`](../skill-filesystem)。

注册表基于 [`@deepseek-ai/dsh-scope`](../../core/scope) 采用宿主 + 按 scope 的分层结构，即工具注册表确立的形态：注册落入调用方上下文 scope 对应的层——宿主行与 repository 插件落入全局层，由 agent preset 常驻组合挂载的插件落入该 preset 的层——读取时将全局层与观察 scope 的链合并，最近层直接赢得重名，rank 只在单层内裁决重名。

## 服务：`SkillRegistry`（ctx 键：`skills`）

### 公开 API

- `ctx.skills.registerProvider(create): () => void` 调用同步提供方工厂并向其传入 `{ signal, invalidate }`，随后以在调用方上下文所在层内唯一的 `provider.name` 注册其只读结果。同层重复提供方名称会抛错，`runtime` 为保留名称；注册失败会中止信号。精确的 Cordis disposer 会注销提供方、中止信号，并保持有序组合拆卸。
- `ctx.skills.snapshot({ cwd?, signal?, scope? })` 返回观察 scope 各层合并后、与调用策略无关的 `{ skills, complete }` 观测。任一提供方调用被拒绝或显式报告发现不完整，或有界重试期间又发生目录修订时，`complete` 为 false；该次观测提供的候选项仍保留在此结果中，但该结果绝不缓存。
- `ctx.skills.list({ cwd?, signal?, scope? })` 借用只读视图选项，然后返回当前工作区中的全部胜出摘要；这些摘要在全局层与观察 scope 链之间合并，并按名称排序。消费方在自身边界调用 `isModelInvocable(skill)` 或 `isUserInvocable(skill)`。
- `ctx.skills.get(name, { cwd?, signal?, scope? })` 在发现和加载中使用同一组只读选项和胜出候选项；在发现或缓存命中后重新检查取消，让提供方加载与信号竞速，验证已加载定义，然后无论调用策略如何都将其返回。
- `ctx.skills.register(skill): () => void` 将只读运行时嵌入式 skill 注册进调用方上下文所在层，省略时添加允许模型和用户调用的策略以及 `provider: "runtime"`。同层同名运行时注册使用先到先得：重复项会记录警告，并获得无操作 disposer。成功注册会返回精确的 Cordis disposer，以供有序组合拆卸。

### 事件

- `skills/change` 是一条不带过滤条件的失效通知，在提供方或运行时贡献注册或释放后，以及活动提供方的注册控制触发失效后发出。它不携带目录或 diff；每个消费方都使用自身的查找选项重新获取 `snapshot()`。监听器抛错或 Promise 拒绝会被记录，既不能否决注册表变更，也不能阻止后续监听器执行。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `collectCacheMaxEntries` | `128` | 内存中保留的最大已完成 cwd/提供方目录数。 |

### 调用策略

`SkillSummary.invocation` 是一个必填的类型化策略对象，其正向布尔字段 `modelInvocable` 和 `userInvocable` 分别描述两个接口。提供方会在每个候选项和定义中返回这一已解析形状；只有 `SkillRegistration` 输入可以省略它，此时 `register()` 会补入 `{ modelInvocable: true, userInvocable: true }`。注册表保留全部四种组合，使一次发现结果可以同时服务面向模型的工具、面向用户的命令和受信内部调用方，而不会混淆各自的目录。

| 策略 | 模型 | 用户 |
|---|---|---|
| `{ modelInvocable: true, userInvocable: true }` | 包含 | 包含 |
| `{ modelInvocable: true, userInvocable: false }` | 包含 | 排除 |
| `{ modelInvocable: false, userInvocable: true }` | 排除 | 包含 |
| `{ modelInvocable: false, userInvocable: false }` | 排除 | 排除 |

### 共享的面向模型渲染

`renderSkillContent(skill)` 把一个已加载 skill 渲染为规范的 `<skill_content>` 块（转义后的 `name` 属性、资源提示、原样正文）。它是两条加载路径的唯一真源：`dsh-tool-skill` 将其作为 `skill` 工具结果返回，并在用户显式的手势边界将其注入，因此无论加载由谁发起，模型看到的都是同一种形态。`escapeText` 随之一并导出，供要在同一标记框架中嵌入文案的消费方使用。该包还声明 `skill-invocation` 这个 `MessageSource` kind（{ name, form: 'instructions' }），用户显式注入会把它打在自己的消息上——transcript（文本记录）消费方依据这份元数据呈现该次调用，而不是重新解析正文。

`isModelInvocable(skill)` 和 `isUserInvocable(skill)` 分别直接读取对应的正向字段。`ctx.skills.get()` 仍是受信且与策略无关的加载原语，因此每个面向用户或模型的消费方都必须先执行与自身接口匹配的判定，再暴露或加载 skill。

## 提供方约定

提供方工厂同步运行，并接收一项注册作用域内的控制能力。注册失败或释放时，`control.signal` 会中止；仅当该精确注册仍处于活动状态时，`control.invalidate()` 才会清除已完成目录，因此延迟回调无法影响同名替代项。不可变提供方可以忽略该控制能力。远程设置、身份验证和发现应在提供方的 `list(options)` 调用中完成，该调用会被等待。返回数组是完整发现的简写形式；若提供方已收集到可用候选项，却无法建立权威观测，则返回 `{ candidates, complete: false }`。提供方对象、查找选项、候选项和定义都以只读方式借用，而不是克隆或重新绑定。提供方应遵守 `options.signal`；取消后，注册表也会停止等待不协作的发现或加载。

注册表在缓存前验证候选项，在返回前验证定义。胜出提供方会收到同一候选项和不透明 `locator`，两者都是它从 `list()` 返回的内容，从而支持后端专用文件、URL、id 或版本句柄。调用方和提供方必须保持只读约定。

违反约定时会快速失败。`list()` 返回的 Promise 被拒绝会被视为瞬时来源失败，并省略其结果。显式的不完整观测仍会为 `list()` 和 `get()` 提供其候选项，但会使聚合快照不完整且不可缓存。提供方或运行时修订发生变化时，会丢弃正在进行的结果并重试一次。如果这次重试也被后续修订取代，则返回其候选项，并将结果标为不完整且不予缓存，以免持续触发失效的提供方一直占用调用方。单层内重复名称依次按 rank、提供方注册顺序和提供方本地顺序解决冲突；跨层则由最近 scope 的条目赢得名称。摘要按 skill 名称排序。

定义仍采用渐进式加载。`get()` 每次调用都会向胜出提供方请求正文，而不是在此注册表中缓存正文。若返回定义的名称不同于所选候选项，系统会拒绝该陈旧选择，并由注册表在内部使该精确提供方失效，以便下一次快照重新发现其目录。

## 运行时 skill

`ctx.skills.register(...)` 是嵌入式运行时 skill 的便利接口。运行时 skill 使用 rank `250`：项目提供方可覆盖它们，它们则覆盖已发布本地提供方的自定义根目录和用户根目录。运行时定义和嵌套资源元数据均以只读方式借用；服务只物化一个顶层定义，以补入省略的调用策略和 `provider` 默认值。运行时贡献内的注册使用先到先得，因此重复贡献无法通过其 disposer 移除当前生效的贡献。

## 消费方边界

注册表不渲染模型指引，也不注册面向模型的工具。[`@deepseek-ai/dsh-tool-skill`](../tool-skill) 消费 `ctx.skills` 以提供持久会话目录和 `skill` 工具，因此提供方仍与模型接口独立。

## 模型体验

通过 `dsh-tool-skill` 间接影响模型；该包将提供方摘要渲染到持久的初始目录或替换目录消息中，并将已加载指令渲染到已保留工具结果中。

#### KV Cache 影响

不直接影响提示词。指定的消费方负责持久初始目录，以及失效后的仅追加式目录替换。

## 已知限制与暂缓事项

- **失效由提供方驱动**：注册表没有 TTL，无法推断任意远程来源是否已发生变化；每个可变提供方都必须保留其注册作用域内的 `invalidate()` 能力，并由自身的观测机制调用它。
- **提供方依次查询**：一个响应取消但速度缓慢的提供方会延迟之后注册的所有提供方；取消会停止调用方等待，但无法终止不响应取消的提供方持续运行的工作。
- **不保留不完整观测**：被拒绝的提供方会被省略，显式提供的候选项也仅在当前查找中可用；注册表既不负责上一份可用目录，也不负责逐提供方诊断。
- **重名项的裁决采用先到先得**：系统会记录并隐藏层内较晚出现的低优先级候选项，较近的层会静默遮蔽较远的层；不提供检查全部被遮蔽定义的 API。
