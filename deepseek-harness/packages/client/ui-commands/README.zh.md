# @deepseek-ai/dsh-client-ui-commands

[English](README.md) | 中文

客户端命令 API（`ctx.commandUi`）：以会话为 key 的命令目录缓存、带 `matchSpace`／`matchEnter` 决策钩子的 `/` 命令 source、三类派发（`execute`／`popupSelect`／`leadingInput`），以及面向业务包的 popupSelect 注册。[Web 命令 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-25-web-command-surfaces-and-assembly.zh.md) 记录了这项决策。

`src/client/contract.ts` 是固定的业务 API 约定：`CommandUiContract.register(name, spec)` 与 `decorate(name, spec)` 是业务包消费的全部内容；`CommandUiSpec{options, onSelect}` 自己提供 popup 数据——外层组件归本包所有，业务包永远见不到它。贡献项是客户端自有命令（与 host 命令同名时会明确报错）；装饰项则为**已存在的** host 命令添加裸调用 popup。host 保留目录行、带参 claim（空格／带参数的 Enter）与生命周期记账，被装饰的名字若在会话目录中无 host 行，则永不触发。命令类型按每次派发派生，绝不在注册时定型：带 `input` 的 host descriptor 是 `leadingInput`，注册了 `CommandUiSpec` 的是 `popupSelect`，其余全部是 `execute`。

`CommandDirectory`（`src/client/directory.ts`）是唯一的 wire 派生缓存，以会话为 key。普通会话通过 `command.list({sessionId})` 拉取，source 的 scope 出生 `warm` 钩子会预热该会话的缓存项。由目录寻址的可继续子代理会在客户端解析为空命令目录：`command.list` 绑定 Agent，若预热它，就会仅因查看持久化历史而激活子代理。缓存项由转发的 owner 事件 `commands/change` 软失效（重拉在途期间旧快照继续服务），也由转发的 `agent-preset/selected` 对该会话单独软失效（重组 agent 不产生任何注册，注册表级信号不会为它触发），由 `connection/reset` 硬失效，并以 epoch 把关，被取代的旧拉取永远无法覆盖更新的结果。`matchSpace` 只凭该缓存同步应答；`matchEnter` 在 SubmitAttempt 信号上强等缓存，预热失败即拒绝——`/` 开头的一行绝不会被静默降级为普通提示词。

`command.execute` 返回已匹配的命令结果后，当前浏览器会发布本地 `command/executed(sessionId, name, result)`。其他客户端只会通过 Host 事件流收到持久命令节点，不会收到这条确认，因此浏览器专属副作用可以筛选由实际提交命令的客户端收到的成功结果，而不会把 Session 回放当成操作请求。监听器失败会逐项记录并隔离，不会改变已经准入的命令结果，也不会阻止后续监听器运行。

菜单查询会按顺序且不区分大小写地模糊匹配命令名的子序列。前缀排名最高；其余匹配项按分隔符边界优先、相邻字符优先、间隔越短越优先的规则排序，若仍同分，则以目录顺序和贡献项顺序打破平局。此行为只影响命令发现：space 和 Enter 仍要求命令名精确匹配。原理：[Web 斜杠命令模糊发现](../../../.agents/notes/implemented/feature/2026-08-04-web-slash-command-fuzzy-discovery.md)。

`PopupSelectController`（`src/client/popup.ts`）是不含界面的外壳状态：`PopupSelectView` 自行注册进 `conversation.input.overlay`（SlotMap key 归 ui-conversation 所有；本包只以 type-only 导入引入该声明——没有运行时依赖边）。壳是打开期间持有焦点的瞬态层；onSelect 之后的 token 片段消费在两条分支上都经 `consumeTokenSegment` 执行（菜单路径做 span CAS，回车路径做裸 token 相等比较），作用于接线层经 `bindDraft` 绑定的草稿表层。

`/client` 入口导出插件主体（`apply`／`inject`）、`CommandUiRuntime`、目录类和 popup 类及其状态类型，以及固定的约定类型；外层组件本身是 overlay 注册的内部实现。

## 模型体验

间接影响，途径是本包的派发与 `claim.submit` 路径触发的 host `command.execute` RPC：匹配命中的命令，其 handler 会修改 host 领域状态，其他包再把该状态投影进下一个请求（`/plan` 的 handler 翻转 plan 模式，其归属包注入 `plan:policy` 系统提示词 section），而命令行本身、detached result 与所有菜单／notice 渲染都留在客户端，永不进入会话日志。

#### KV Cache 影响

无直接影响；该包既不组装也不发送提供方请求。它触发的命令 handler 可能改变归属 host 包对下一个请求系统提示词的贡献（某个 section 的出现或消失会替换较早的请求 token，并使提供方前缀从该点起失效），但这一影响由各命令的 host 包拥有并记录。

## 已知限制与暂缓事项

- **脱离会话后，detached result 的 notice 回退到 console**：fire-and-forget 路径经 `SessionInput.notify` 把结果送到触发会话的 composer；会话销毁后，console 输出行是仅剩的呈现面。
