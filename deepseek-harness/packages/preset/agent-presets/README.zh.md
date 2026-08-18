# dsh-agent-presets

[English](README.md) | 中文

按 preset 组装 agent（智能体）。**preset** 是一个目录，其中放置一份 `agent.cordis.yml`；roster 在整个进程内只把它挂载一次（常驻 scope），命名它的每个会话通过把自己 agent 的 scope key 认父到该挂载（`dsh-scope` 的父链）来加入。挂载的工具、提示词段落与投影单元只存在一份，覆盖所有已加入的 agent——其插件本就按 Session/Agent 分键存状态，会话在共享实例内互不串扰——而完全没有 agent 的宿主读取方（冷读记录）也能按 preset id 解析到同一份常驻注册。

其机制是两条 seam。entry 上下文沿原型链连到子树被挂载时所在的上下文，而 [`dsh-tools`](../../core/tools/README.md) 与 [`dsh-system-prompt`](../../core/system-prompt/README.md) 本就按调用方上下文的 scope 分层归档注册——因此常驻挂载的贡献落在 **preset 的分层**里。把它们送达每个会话的是 `dsh-scope` 的父链：agent 的视图按 `agent → preset → global` 解析（近者遮蔽远者），挂载的监听器对认父到它的每个 agent 放行，而兄弟 preset 的监听器保持失聪。

## 服务：`AgentPresets`（ctx 键：`agentPresets`）

发现过程不做缓存：`list()` 与 `resolve()` 每次调用都重新读取各个根目录，因此进程运行期间新写的 preset 立即可见，被删除的 preset 也会在下一次读取时消失。发现过程同时负责 preset 的**健康**：组装文件缺失或不可加载（YAML 无法解析——用加载器自己的方言检查，含 `!!js`——或不是由具名插件行组成的列表）的目录会作为携带 `broken` 原因的行列出而不是被跳过，因为被跳过的目录仍在磁盘上占着它的 id，而各个界面却没有任何可删的东西。目录名不是可用 preset id（`[a-z0-9][a-z0-9-]*`）的目录才被直接跳过：复制永远不可能占用那种名字。

- `ctx.agentPresets.defaultId: string` 调用方未指定时挂载的 preset id。
- `ctx.agentPresets.list(): Promise<AgentPreset[]>` 当前各根目录提供的全部 preset；id 重复时靠前的根目录胜出；损坏的 preset 也在其中，各自携带原因。
- `ctx.agentPresets.resolve(id?): Promise<AgentPreset>` 按 id 取一个 preset，缺省取 `defaultId`。没有任何根目录提供该 id 时抛错，并列出可用 id。损坏的 preset 照样解析——删除、读取与上报都需要这一行。
- `ctx.agentPresets.mount(agentCtx, id?): Promise<AgentPreset>` 用一个 preset 组装一个 agent——确保其常驻挂载（并发去重）并把 agent 的 scope key 认父到它——返回该 preset 供调用方记录。对损坏的 preset 直接以发现时记下的原因拒绝，所以每种不可加载的形态都在加载器介入之前以同一方式失败。
- `ctx.agentPresets.composeFrom(agentCtx, parentCtx): string | undefined` 让一个 agent 加入另一个 agent 已在运行的常驻组装，返回所加入的 preset id——父方未加入任何 preset 时返回 `undefined`，那是无 roster 的部署，不是错误。这是认父而非挂载，因此同步、且自身没有组装失败模式；调用方用错（上下文无 scope、agent 已加入过）仍会拒绝。
- `ctx.agentPresets.composedPreset(agentCtx): string | undefined` 某个**活着的** agent 正在运行的 preset，从其 scope 链读取而不是从其会话读取——对于持久化 header 尚在构建中的 agent，这是唯一能拿到的答案。
- `ctx.agentPresets.recompose(agentCtx, id): Promise<AgentPreset>` 把一个 agent 重链到另一个 preset 的常驻组装。仅在该 agent 尚无任何产出时合法——**由调用方负责该检查**；新挂载在链移动之前确保完成，失败时 agent 原封不动。与 `mount()` 一样拒绝损坏的 preset。
- `ctx.agentPresets.standingKeyFor(id?): Promise<ScopeKey>` 没有 agent 的宿主读取方（冷读记录）解析 preset 注册所用的常驻 scope key；确保挂载而不启动任何 agent、会话或轮次。与 `mount()` 一样拒绝损坏的 preset。
- `ctx.agentPresets.roots: readonly PresetRoot[]` 本 roster 实际扫描的根目录——全部已配置根目录按序在前，随后是推导出的 harness home 根目录。它不是 `config.roots`：判断「是否已组装 roster」应读它，从而由同一处推导决定。
- `ctx.agentPresets.authorable: boolean` 上述根目录中是否有任一具备 `user` 信任级别，因而 preset 是否可创建。
- `ctx.agentPresets.read(id): Promise<string>` 某个 preset 的组装文本，与存储内容逐字一致。
- `ctx.agentPresets.copy(from, id, name?): Promise<void>` 通过整目录复制一个既有 preset 来创建本地创作的 preset——唯一的创作写入。组装文本不经过这道接缝，因此副本与其来源同等可加载；复制出的元数据保留来源的描述、但绝不保留其名称与 roster 排序，`name`（或回退到 id）才是区分两行的依据。
- `ctx.agentPresets.remove(id): Promise<void>` 删除一个本地创作的 preset；已加入的会话保留其常驻挂载。若用户默认值恰好指向刚删除的 preset 则一并清除：存一个尚不存在的默认值是刻意的，但本次删除的这个再也不会有人提供，留着会让所有未显式指定的新会话无法启动。

`AgentPreset` 携带 `id`（目录名）、`trust`（`system` 或 `user`，取自它所在的根目录）、`path`（组装文件的绝对路径），以及——仅当该 preset 无法组装会话时——`broken`（一条人类可读的原因，名单界面原样展示）。

### 应在何处调用 `mount()`

agent 工厂的 `setup(agentCtx)` 钩子是唯一受支持的调用点。只有在那里，认父是在 agent 尚未发布时完成的，因此组装被拒绝会让整次创建回滚，而不会留下一个组装到一半的会话。常驻子树归 roster 服务自己的 fiber 所有——刻意用其未追踪的上下文，因为从被追踪的 `this.ctx` 派生的子树会经调用方的 shadow fiber 解析一切服务、无视各 entry 自己的 inject store——所以它比任何 agent 都活得久，只随整棵树卸载。每个代际记录其组装文件的 stamp（mtime 与大小）：发现 stamp 过期的会话会开启下一个代际，而所有已加入的会话保持各自正在运行的那个——正在运行的会话所加入的组装在其文件被修改或删除后继续存活；文件是唯一的组装编辑器，stamp 正是把编辑送达后续会话的机制。

### 组装子 agent

subagent 的子 agent 通过 `composeFrom()` 加入其父方的常驻组装，绝不走 `mount()`。所有面向模型的行都在 agent 平面，工具注册表的全局层是空的，因此没有加入任何组装的子 agent 抵达模型时既没有任何工具，也没有父方的任何提示段。

按 id 重新挂载父方的 preset 与认父有两处差别，且两处都要紧。父方启动后被编辑过的组装文件会把与父方历史所产出时**不同**的一个代际交给子 agent；而此后被删除的 preset 会让子 agent 直接失败，尽管其父方仍在正常运行。认父还是同步的，这正是进程内 subagent 驱动能够使用它的前提——它们在同步的创建窗口里组装子 agent。

子 agent 会把所加入的 id 记在自己的持久化 header 上（见 [`dsh-subagent`](../../subagent/subagent/README.md)），因此冷读子 agent 的历史时重建的是它实际运行过的组装，而不是部署默认值。

### 会话实际运行的是哪个 preset

创建头部记录的是会话**以什么开始**，`resolveSessionPreset(session)` 给出的才是它**实际运行的**。空白会话一旦切换过，两者就不同，因此所有重建路径——选择器读取的摘要、resume、fork——都走解析，而非直接读头部。

头部保持冻结，因为它是创建期事实。切换以 `agent-preset/selected` 会话事件记录，在替换提交之后追加；这正是 model-visible ⟺ logged 规则的要求：preset 决定模型看到的工具 schema 与提示词段落，因此必须能从日志重建。服务会把这项已提交事实重新发为不带 scope 的 cordis 事件 `agent-preset/selected(sessionId, agentPreset)`，其声明位于 client-safe 的 `./types` 出口，使远端消费方无需导入 Host 运行时类型即可让会话派生状态失效。只读头部会让切换过的会话按创建时的组装重建，从而重放新工具集无法执行的历史——这正是「仅空白可切」那道锁要防的危险。

### 切换空白 agent

`recompose()` 先卸载已装入的子树、再装入新的，因为两份组装无法共存——它们会把相同的工具名注册进同一个层。挂载失败会恢复先前的组装，而不是让 agent 一无所有；未知 id 则在任何东西被拆除之前就被拒绝。

"仅限尚未产出任何内容的 agent"是一条产品规则而非机制约束：在对话进行中调换工具，会留下新组装无法执行的、已被记录的工具调用。该规则由网关在传输层执行（[`dsh-apiproxy`](../../host/apiproxy/README.md) 返回 `agent-preset-locked`），因为会话历史在那里才拿得到。

## 创作

创作即复制。新 preset 是某个既有 preset 的整目录副本——组装、元数据、skill 目录、附带资产——落在首个 `user` 根目录之下；输入只有两个由服务对照自身根目录解析的 id 加一个可选显示名，因此调用方从不提供组装文本，一次复制不会授予 roster 尚未携带的任何能力。创建之后的一切都发生在 preset 自己的文件里。`copy()` 在任何内容落盘之前拒绝三种情况：

- **不符合 `[a-z0-9][a-z0-9-]*` 的 id。** id 会成为目录名，因此约束是 id 自身的性质，而非事后再做一次路径检查——`../escape`、`a/b` 与绝对路径都作为 id 被拒绝。
- **已被占用的 id。** 复制从不覆写：任一根目录已提供该 id 即拒绝（与随附 preset 同名的用户目录只会被它遮蔽），磁盘上占着该名字的目录同样拒绝。发现过程会把这样的目录列为损坏的 preset，所以这条拒绝的出路——删掉它——就在报告它的同一页面上。
- **未知的来源。** 来源可以是任何信任级别——复制随附 preset 正是主要用途——但必须存在；复制失败会回滚做到一半的目录，而不是留下一个 discovery 看不见的目录。

复制出的目录树被收紧为仅属主可用（文件 `0o600` 并保留属主执行位，目录 `0o700`），符号链接被解引用以保证副本自包含，且根目录在首次复制时创建——部署配置了尚不存在的用户根目录，正是首次运行的正常状态。复制出的 `preset.yml` 会被重写：保留来源的描述供作者就地编辑，但丢弃其名称与 roster `order`——副本若与来源呈现得一模一样、或按随附集合声明的顺序排序，roster 就不再能区分它们。`remove()` 拒绝随部署提供的 preset；随附集合正是副本的已知良好起点。

### preset 的各行如何解析

行的**包名**从宿主组装解析，而非从 preset 目录解析。Loader 通常按 entry 所属树的 `baseUrl` 解析，而对 preset 而言那就是组装文件所在之处；本地创作的 preset 位于用户主目录之下，Node 向上查找 `node_modules` 永远够不到 harness，因此每一个 `@deepseek-ai/dsh-*` 行都会导入失败。挂载在插入子树之前先记录宿主的基址，并把裸标识符送往那里。

**相对**路径仍从 preset 自身的目录解析，因此 preset 自带的插件文件与 skill 目录会随它一同迁移。

**绝对**文件系统路径则保留其自身位置。挂载会先将它转换为 `file:` URL 再交给 ESM 导入，从而使 POSIX 路径和 Windows 盘符或 UNC 路径都采用 Node 能够接受的说明符。

### 展示用元信息

preset 可以在组装文件旁的可选 `preset.yml` 里发布展示文本：

```yaml
name: 极简模式
description: 仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。
```

它**只**承载展示文本。`id` 是目录名，`trust` 取自 preset 被发现时所在的根目录，两者都不可写在这里——否则本地创作的 preset 就能把自己命名进随附集合。之所以是独立文件：组装是插件行的顶层列表，YAML 无法在其旁携带同级键，而伪造一个元信息行等于递给 Loader 一个要加载的东西。

任何读取失败都退化为「没有元信息」——缺失、格式错误、类型不对、内容为空，含义相同，选择器回退到 id。展示不是能力：名字坏掉的 preset 依然能挂载。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `default` | 必填 | 调用方未指定时挂载的 preset id |
| `roots` | `[]` | 按优先级排列的扫描目录；每项提供 `path`（开头的 `~` 会展开）与 `trust`（默认为 `user`） |
| `includeUserRoot` | `true` | 在全部已配置根目录之后，追加 `<dshHome>/.agent-presets` 作为 `user` 根目录 |

根目录不存在时视为不提供任何 preset，而非失败：用户根目录在写出第一个本地 preset 之前并不存在，而指定了没有任何根目录提供的默认值，在解析时本就会明确报错。

### 可写根目录属于本包，随附根目录属于 app

`<dshHome>/.agent-presets` 是个人自有 preset 的所在，正如 `<dshHome>/skills` 是其自有 skill 的所在（[`dsh-skill-filesystem`](../../skill/skill-filesystem/README.md)），因此 roster 自行推导它，而不等某个部署记得配置——一个什么都没配的启动器同样能发现并创作 preset。它追加在全部已配置根目录**之后**，从而保持靠前的根目录赢得重复 id：随附的 `standard` 仍然遮蔽一个占用该名字的家目录目录，而 `copy()` 会拒绝该 id，不会落下一个无人解析得到的 preset。

根目录在服务构造时解析一次。若根目录集合在一次 `list()` 与依据其答案执行的 `copy()` 之间发生变化，写入的将是调用方从未见过的目录。

`includeUserRoot: false` 使 roster 只覆盖 `roots`。把 preset 限制在自有目录内的部署需要它，任何钉住确切 roster 的测试同样需要——否则将由这台机器真实的 `<dshHome>` 决定 roster 的内容。

随附根目录仍然是装配事实：它位于已安装 app 自身配置的旁边，那个路径只有该 app 能解析。

### 默认 preset 是一项用户设置

当组装中存在 settings 提供方时，本插件会注册 `agent-presets` 命名空间，并以 `config.default` 作为其组装 base，因此用户文档会层叠覆盖部署方的工程默认值：

```yaml
agent-presets:
  default: minimal
```

该值在每次解析时读取而非快照，因此热重载的文档对**此后创建**的会话生效，而每个运行中的会话仍停留在它当初据以组装的 preset 上。清空用户字段即重新继承组装默认值。若默认值指向没有任何根目录提供的 preset，写入时不会报错，而在下一次 `resolve()` 时失败——名单是一个活动目录，此刻不存在的名字，等到某个会话真正索取时可能已经存在。

## 挂载会拒绝什么

直接挂载的子树不会出现在 `ctx.loader.entries()` 中，因此没有任何启动审计能覆盖它。`mount()` 因此自行校验结果可用，并拒绝三种情况。

**目标上下文没有 scope。** 挂载到不带 agent scope 的上下文，会把该 preset 的工具注册成全局的，作用于进程内每一个 agent。

**某一行始终未进入可用状态。** 模块导入失败或插件抛错的行，loader 已经会拒绝；剩下的情况是某一行仍在等待该组装从未提供的服务，审计会指名这种情况。

**某一行把服务发布进了根 realm。** 这类服务是进程级全局的，因此第二个发布同名服务的 preset 会与第一个相撞，宿主读取方也会把某一个 preset 的实例当成所有会话的。确实需要自带服务的 preset，应把它放在 `isolate` realm 之后——entry 本地 realm 让两个 preset 的同名服务互不相干，正如它从前隔开两个会话——否则该服务应改放进宿主组装。

最后一条规则由本包的运行时不变量在每次服务通知时复查，因为从定时器或异步续体中发布的行会绕过一次性审计。

## preset 文件是输入，不是持久化目标

只要 Loader 认为配置变了，它就会把树写回源文件——而一个行释放自己的 fiber 就足以让它这么认为：该 entry 被标记 `disabled`，随即触发写回。若继承该行为，一个会话的运行时状态就会被烧进所有会话共享的文件里：YAML 往返会抹掉注释，而对随附的只读 preset，`writeFile` 还会在 `setTimeout` 内抛出无人接管的 rejection。

因此被挂载的子树把 `write()` 覆写为空操作。本包不写任何组装；创作组装是另一件独立且显式的操作。

## 信任

preset 就是组装，因此一个 preset 的权限恰好等于它所引用的插件。`user` preset——无论由人还是由 agent 写出——与 shell 访问权限同级；`trust` 字段的存在是为了让消费方呈现这一差异，而不是用来强制隔离。

## 模型体验

Indirectly, through the plugins a standing composition registers, which own every tool schema and prompt section the preset makes visible to the agents joined to it.

#### KV Cache effect

在一个 agent 的整个生命周期内保持前缀稳定：组装只装入一次，发生在 agent 发布之前、因而也在它的首个请求之前，且在 agent 运行期间不再重新读取。为新会话选择不同的 preset，只会为该会话建立不同的前缀，无法让任何已在运行的会话失去缓存复用。

## 已知限制与暂缓事项

- **位于可写根目录之外的 preset 可被发现却无法删除** —— `remove()` 拒绝任何不在**第一个** `user` 根目录下的 preset，因此一个既配置了自有可写根、又保留 `includeUserRoot` 的部署，会列出并挂载 harness home 下的 preset，却对每次删除回答「它不在可写 preset 根目录之下」。roster 按设计只有一个可写根；只想要自有根的部署应设置 `includeUserRoot: false`。
- **会话一旦产出内容便无法更换 preset** —— `recompose` 把**空白**会话的父作用域重链到另一个常驻挂载，且仅限空白会话：切换已运行过的组装会抽走模型已调用的工具。更改默认值只影响此后创建的会话。
- **代际只以组装文件为键** —— stamp 检查只察觉 `agent.cordis.yml` 的变化，察觉不到旁边 skill 文件或资产的编辑；那些编辑要等组装文件本身变动或进程重启才达到新会话。
- **被替代的代际永不回收** —— 已加入的会话保持其运行所在的代际，而名单没有加入计数可以判断最后一个何时离开，因此整棵子树一直挂到进程结束。代价按代际计而非按会话计，但并非为零：`dsh-skill-filesystem` 默认监听自己的根目录，因此每一轮「编辑后建会话」都会新增一套活的 watcher。上限取决于组装被编辑的频率——而设置页的编写流程把这件事从「每次部署」变成了「每次保存」。要回收就需要给常驻挂载加上已加入 agent 的计数；见 `ensureStanding` 处的 `TODO`。
- **副本从不被实际挂载以校验** —— 它与来源逐字节相同，因此磁盘上已坏的来源会产出与来源同样损坏的副本；发现过程的健康检查会在下一次读取名单时把两行都标出来，而不是把失败推迟到会话启动。
- **健康是形状检查，不是挂载** —— 发现过程只证明组装能以加载器方言解析、由具名行组成，不证明每一行的模块都能解析并激活；引用不存在的包的行仍在第一个会话处失败，并回滚该会话的创建。
- **副本是会漂移的快照** —— 升级部署不会更新随附 preset 的副本，本层也没有表达「standard 加一处改动」的 patch 语义（那是 bundle 层 `cordis.patch.yml` 的能力）；随附集合自己也接受同样的代价——`cordis` 与 `code` 就是 `standard` 的完整副本——换来整份组装在一个文件里可读。
- **根目录扫描不做监听** —— 每次读取都实际访问文件系统，这让名单保持新鲜，但每次 `list()` 会对每个根目录产生一次 `readdir`。
