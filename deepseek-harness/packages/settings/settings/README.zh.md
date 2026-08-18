# @deepseek-ai/dsh-settings

[English](README.md) | 中文

用户设置 Service Definition（`ctx.settings`）。一个提供方持有按 namespace 分节的原始文档；插件注册 namespace schema 并读取分层解析值：schema 默认值，然后注册方的组合 `base`（其 cordis.yml entry 配置子集），最后用户文档分节。不挂载提供方时消费方行为不变：仍只按 entry 配置解析，因此任何组合有无 settings 都能工作。

## 服务 API

- `documentPath` — 提供方拥有用户可编辑文件时，该字段是文件的绝对路径；非文件提供方保留 `undefined`。Host 配置适配器据此派生可用性，而浏览器协议只暴露一个布尔能力，绝不暴露文件系统目标。
- `prepareDocument()` — 让文档做好供原生编辑器打开的准备后返回该路径。基类实现返回 `documentPath`；文件提供方可先创建缺失的文档。
- `register(ns, schema, { base?, applies? })` — 返回 owner 的 `SettingsScope`（`get`/`watch`/`update`）。注册是调用方插件 fiber 上的 effect：dispose（资源释放）该 fiber 即移除 namespace 及其观察者。schema 拒绝的存量分节会使注册本身失败；重复 namespace 立即报错。
- `describe(options?)` — 每个 namespace 一条描述（`schema.toJSON()` 封装、解析值、分离出的 `base`/`user` 层、`applies`），供配置界面使用；字段出现在 `user` 中即标记其被用户覆盖。`describe({ redactSecrets: true })` 从每一层剥离 `role('secret')` 字段，并附加 `secrets` slot 列表（`{ path, set }`）；每个协议接口都必须传入它，纯遍历器 `redactSecrets(schema, value)` 已导出，供其他 wire 使用。
- `get(ns)` — 解析值；未注册时为 `undefined`。
- `update(ns, patch)` — 把普通对象 patch 深合并进用户分节（绝不合并进 `base`），校验解析候选值，经提供方持久化后提交。patch 只能包含与 JSON 兼容的数据：Date、Map、BigInt、非有限数或循环引用会在任何内容持久化前被拒绝，并给出以 `$` 为根的路径（YAML/JSON 存储在重载时会静默改变这类值）。校验失败在持久化前拒绝；只读提供方（`writable: false`）拒绝一切写入。同一 namespace 的写入按调用顺序串行。
- `replace(ns, section)` — 整体替换用户分节：这是刻意的重置（`replace({})` 重新继承 `base` 与 schema 默认值）。
- `mutate(ns, ops)` — 在写入排到队首那一刻的分节上，按序施加 `{ op: 'set' | 'unset', path }` 编辑。这是任何持有**不完整**视图的调用方的删除路径：配置 UI 读到的是脱敏后的 descriptor，据此重建分节再整体替换，会把 wire 从未回传的每个机密都删掉，而一条 op 只点名它真正要改的那个字段。
- 每次写入都可携带可选的 `expectedRevision`。每个 descriptor 都带有该 namespace 的 `revision`——一个针对其**原始**分节的单调计数器；期望值不再匹配的写入会以 `SettingsConflictError`（`code: 'SETTINGS_CONFLICT'`，并附上两个 revision）被拒绝，而不是覆盖先完成写入的写入方。写队列只保证写入的先后次序，它本身分辨不出持有新鲜快照的写入方与持有陈旧快照的写入方。
- 解析值是深冻结快照。每次提交后观察者收到 `(next, prev)`：同一回调的调用异步、逐次、按提交顺序执行（慢的旧调用绝不会晚于较新的调用生效），异常——同步抛出与异步拒绝——均被隔离。watch 的 disposer 返回后不再启动新的调用（已排队的那一次会被跳过）；已启动的调用仍会结算。`settings/updated` 事件逐监听器扇出，一个抛错的 listener 不会饿死其余 listener；异步 listener 的拒绝会被隔离并记入日志，这正是 `INVARIANT` 编码的失败只从同步 listener 重新抛出的原因。
- 服务卸载先拒绝新写入与观察者调用的启动，再排干全部排队写入与已启动的观察者调用后才完成；registrant fiber 在写入途中被 dispose 时，该写入仍到达存储，但不会提交，也不会通知任何人。

## 提供方约定

子类实现 `writable`、`load()`、`persist(ns, section)`，可选择为一个本地用户可编辑文件重写 `documentPath` 与 `prepareDocument()`，并通过受保护的 `publish(doc)` 推入外部观察到的文档。基类服务 init 在服务可注入前加载并发布一次文档；拥有自有 init（watcher、连接）的提供方会先通过 `yield* super[Service.init]()` 委托给基类。publish 时每个已注册 namespace 独立重解析：非法分节保留该 namespace 的最后可用值并告警——热重载绝不拖垮进程；启动期与注册期校验则立即报错。

## 事件

`settings/updated (ns, next, prev, source)` 在每次提交后触发；`source` 为 `update`（进程内写入）或 `provider`（外部变更）。解析值深相等时绝不触发——它面向消费方，而消费方只关心自己的值有没有变。

`settings/document-updated (ns, revision)` 在**原始**用户分节发生变化时触发，无论解析值是否随之改变。配置界面需要的是这一个：存入一个与组合 `base` 相同的覆盖值不会改变解析值，却改变了文档的说法（该字段从继承变成了覆盖），也推进了每个已打开编辑器所持有的 revision。监听器的异常隔离方式与 `settings/updated` 相同。

两条声明都住在 client-safe 的 `./types` 子路径出口，与其签名点名的 `SettingsNamespace`、`SettingsUpdateSource` 类型同处一处；包根继续 re-export 这些类型。于是 Host 编译面之外的消费方读到的正是 Host 发射的那一份签名，而不必再写一遍。

## 模型体验

间接生效：消费方插件从各自 namespace 解析影响模型的值（例如默认模型路由）；效果由各消费方自己的接口文档说明。

#### KV Cache 影响

无直接失效；把设置值纳入请求前缀的消费方负责该变更。

## 已知限制与暂缓事项

- **单一用户层** — 解析只认识 schema 默认值、一个组合 `base` 与一个用户文档；它尚未记录每个解析值由哪一层提供。
- **`redactSecrets` 并非一条可被证明的协议边界**：walker 只跟随 `object`/`dict`/`array`，因此只能经由 union、intersection 或 transform 抵达的 `role('secret')` 会被**原样**返回，且 `secrets` 列表为空；而 `schema.toJSON()` 会把 secret 字段的 `.default(...)` 一并带给每个客户端。这两种情况都不会被拒绝；机密无法经由被遍历的容器抵达的 schema，绝不可注册到暴露于协议的 namespace 上。真正的答案是一个 fail-closed 的 `describeForWire()`——它拒绝自己无法证明安全的 schema，并对序列化封装与错误文本做净化——此项暂缓。
- **跨进程并发由提供方定义** — seam 仅在进程内按 namespace 串行化写入；跨进程并发按提供方行为收敛（本地文件提供方在写锁下读-改-写，因此 namespace 在并发写入者下不会丢失，同 namespace 冲突按后写胜出解决）。
