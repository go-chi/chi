# dsh-persona

[English](README.md) | 中文

把 agent（智能体）人设做成一个可组装的行：它既可以遮蔽部署级人设，也可以拥有完整系统提示词。

[`dsh-system-prompt`](../../core/system-prompt/README.md) 以自身配置持有部署级人设，并且无条件注册该段落，因此一个进程只有一份。[agent preset](../agent-presets/README.md) 无法自行挂载提示词注册表——若没有属于自己的行，preset 能改变 agent 的工具，却永远改不了它的身份。本包就是那一行。

## 仅限 scope 内使用

在 agent scope 之外挂载本行，会与注册表自身的 `deployment:persona` 注册相撞并明确报错。这不是需要绕开的限制：部署级人设已经有归属，而本行存在的意义正是为某一个 agent 遮蔽它。请把它挂在 preset 组装内部，由 preset 的挂载过程提供 agent scope。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `text` | 必填 | 作为 `deployment:persona` 段落渲染的人设文本 |
| `complete` | `false` | 组装后将此人设恢复为唯一的系统提示词段落 |
| `includeRuntimeContext` | `true` | 是否为此 agent 作用域包含动态 runtime-context 快照；false 会抑制所有上下文贡献，但不禁用拥有它们的服务 |

`text` 与任何提示词段落一样是模板：完整的 `{{…}}` 组在提示词**渲染**时（而非组装时）严格解析为已注册的提示词变量。空文本同样占据该槽位，因此会把部署级人设整个遮蔽掉，然后在渲染时消失。启用 `complete: true` 时，组装仍会解析上下文、工具、变量和协作式监听器，之后提示词注册表将这份确切人设恢复为唯一段落；身份、工具引导或监听器都无法追加提示词文本。启用 `includeRuntimeContext: false` 时，此作用域的上下文提供方不会被求值，组装监听器添加的上下文也会被丢弃。

## 模型体验

### 人设段落

#### What the model sees

位于 order 0 的 `deployment:persona` 段落，紧随 harness 身份开场白之后，携带本行配置的 `text`，其中的提示词变量已解析。对于其 preset 挂载了本行的 agent，它会替换部署所配置的任何人设。在完整模式下，模型只会看到这个渲染后的段落作为系统提示词。Runtime context 默认保持启用。禁用后，新建 agent 不会收到来自沙箱策略、批准策略、委派或其他 system-prompt 上下文提供方的 runtime-context 快照。

#### Token effect

对给定 preset 而言是固定的：该 agent 的每次请求都携带人设自身的 token，其他 agent 一个都不带。空文本不贡献任何 token。完整模式会移除该 agent 的其他所有系统提示词 token。

#### KV Cache effect

在一个 agent 的整个生命周期内保持前缀稳定——本行只挂载一次，发生在 agent 发布之前、因而也在它的首个请求之前，且在 agent 运行期间文本不再改变。两个使用不同 preset 的 agent 从该段落起建立各自不同的前缀，谁都无法让对方失去缓存复用。

## 已知限制与暂缓事项

- **不支持全局挂载** —— 提示词注册表拥有未加 scope 的人设槽位，因此本行只能从带 scope 的组装中使用。要改变部署级人设，应在 `system-prompt` 行自身的配置中修改。
