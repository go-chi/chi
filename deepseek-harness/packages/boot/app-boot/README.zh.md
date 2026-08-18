# `@deepseek-ai/dsh-app-boot`

[English](README.md) | 中文

供 app bin（[`dsh`](../../../apps/cli/README.md) 与 [`dsh-acp-demo`](../../examples/acp-demo/README.md)）共用的启动粘合层：每个 bin 都是在这些辅助函数之上构建的精简自执行组合，并以自身诊断前缀参数化。这样，Loader 故障行为只由一处负责，不会在已发布产物之间逐渐分化。

| 导出 | 职责 |
|---|---|
| `resolveConfigPath(path, snapshotMode, cwd?)` | 生成绝对配置路径；当 `snapshotMode === 'replay'` 时，把 basename 为 `cordis.yml`/`.yaml` 的文件替换为同级 `cordis.snapshot.yml` |
| `loadEnv(binName, dir?, warn?)` | 加载已被 git 忽略的 `.env`（Node `process.loadEnvFile`）；文件不存在不影响启动，文件无法加载时输出一行带标签的警告（默认写入 stderr） |
| `loadLayeredEnv(binName, cwd?, warn?)` | 构建产品 CLI（命令行界面）冻结的「继承环境 > 项目 `.env` > 用户 `.env`」快照，拒绝文件中的 bootstrap-only 变量，并在不替换继承值的前提下物化其余文件值 |
| `installFailLoud(binName, proc?, release?)` | 将启动期或后续未处理的 Loader 拒绝转换为一行带标签的 stderr 消息并执行 `exit(1)`；两者之间会等待可选的 `release` 清理钩子（以 `FAIL_LOUD_RELEASE_TIMEOUT_MS` 为上限），使持有终端的界面能在退出前恢复终端；返回卸载函数 |
| `FAIL_LOUD_RELEASE_TIMEOUT_MS` | `installFailLoud` 等待其 `release` 回调的时长；卡死的 disposer 只会延迟致命退出，而不会取消它 |
| `assertEntriesLoaded(ctx, binName)` | 树结算后，如果其中存在已启用但没有 fiber 的条目，则抛出异常，并以 Cordis 启动故障的形式报告每个未解析插件的名称 |
| `assertEntriesActivated(ctx, binName)` | 先执行 `assertEntriesLoaded` 检查，再在 Loader 结算后等待每个已启用配置项；抛出的错误包含每个失败插件的原始错误堆栈，或每个等待中插件尚未解析的服务 |
| `loadOptionalPatches(binName, file)` | 解析一份可选的 patch 列表文件（即 profile 的 `cordis.patch.yml`）：其顶层是一个 YAML 数组，内容为 include 的 `PatchOptions`（按 id 定位的配置覆盖、`insert` 列表，允许 `!!js`）；文件不存在时返回 `undefined`，文件不可读、不可解析或内容不是数组时抛出异常 |
| `loadOverlayPatches(binName, file)` | 解析必需的顶层 YAML 数组，其中包含与上文相同的 include `PatchOptions` 条目；文件缺失也会抛出异常，因为该文件是调用方指名的 |
| `mountRootInclude(ctx, absoluteConfigPath, patches?, bareModuleBaseUrl?)` | 注册静态导入的 `cordis:include` 与 `cordis:group` builtin，挂载 include，并保留用户 patch 层 HMR（热模块替换）使用的确切根配置项；可选模块基准会把裸包名锚定到已安装宿主，而相对名称仍以配置目录为基准 |
| `watchUserPatches(ctx, options)` | 向现有 Cordis HMR 服务注册指名的 patch 文件；每次新增、变更或移除都会通过调用方的 `compose` 闭包（应用自有层围绕当前用户层）以事务方式重新组合完整 patch 列表，并返回异步 disposer |
| `resolveProfileDir` / `initProfile` / `loadProfile` / `readProfileManifest` / `writeProfileManifest` / `resolveBundleDir` / `composeEntries` / `healProfilesModuleFallback` / `PROFILE_TEMPLATES` / `DEFAULT_PROFILE_BUNDLES` / `PROFILES_DIR` / `PROFILE_PATCH_FILENAME` | Profile 机制（见 [Profile](#profiles)） |
| `boot(binName, absoluteConfigPath, patches?, prepare?, bareModuleBaseUrl?)` | 创建根上下文，向 Loader `!!js` 配置表达式暴露 `dshHomePath(...segments)` 并安装 Loader，在配置树条目挂载前执行可选的宿主准备操作（`prepare` 可以使用 Loader，也可以提供由启动器拥有的上下文插槽），再挂载并等待 include 树结算，断言所有条目均已加载并激活，最后返回根上下文——失败时 dispose（资源释放）部分构造的上下文，并以带标签的错误 reject；可选模块基准与 `mountRootInclude` 的解析语义相同 |
| `renderConfigDump(binName, absoluteConfigPath, layers, warn?)` | 使用 include 自己的解析器和补丁算法（`entryListSchema`/`applyEntryPatches`）离线合成基础配置与带标签的覆盖层，使结果与 `boot()` 挂载的内容一致，再渲染为 YAML，并原样保留 `!!js` 表达式；每段来源于同一文件且由相同补丁层修改的连续行之前都有一条 `# ==` 注释，标明该文件和这些补丁层，输出仍是一份可加载的文档；未匹配到行的补丁连同其层标签交给 `warn`（默认：一行 stderr），读取、解析或字段验证失败则抛出 |
| `addHarnessSourceSection(ctx, sourceRoot)` | 添加全局 `harness:source` 提示词段落（顺序紧随 harness 身份、位于 persona 之前），告知 agent（智能体）DSH 实现代码 checkout 的磁盘路径，同时提醒它不得据此推断当前工作目录，而应使用 `pwd`；如果已启动树没有此项服务，则不执行操作并返回 `undefined`。这里的服务是 `systemPrompt`；该段落注册到它的 fiber，因此开发环境 HMR 重新加载系统提示词后，它会消失直至下次启动 |
| `HARNESS_SOURCE_SECTION` | `'harness:source'` 段落名称，供 `addHarnessSourceSection` 注册使用 |

Loader 结算会在导入或生命周期失败时返回拒绝结果，并携带失败的配置项与阶段；`boot()` 会 dispose 部分构造的上下文，并用 bin 名称包装该失败。结算后遗留的配置项由独立审计处理：`assertEntriesLoaded` 将已启用却没有 fiber 的配置项转换为 rejection 并列出每个未解析插件；`assertEntriesActivated` 会显式等待每个失败的 fiber，把原始错误堆栈写入启动 rejection，并列出每个等待中配置项尚未解析的服务。抛出错误前，审计会通过一个进程级检查点标记这些 rejection 的确切原因，从而让 `installFailLoud` 将 Loader 的重复通知合并为一次，而所有无关的未处理 rejection 仍然致命。

Loader 并发挂载各个条目，因此当其他环节失败时，某个界面可能已经持有终端：此时不经过整棵树自身的拆卸就退出，会把 raw 模式、bracketed paste 和键盘协议残留在用户的 shell 上，而尚未返回的终端查询响应会在下一个提示符处显示为字面文本。配置树失败会经 `boot()` 结算：它先 dispose 部分构建的上下文（从而执行该界面自身的 shutdown），再抛出带标签的 rejection。对于 `boot()` 看不到的 rejection（插件游离的异步工作在挂载期间或挂载完成后失败），持有终端的 bin 会传入 `release`，在提交退出前 dispose 整棵树；`dsh` 在 `boot()` 的 `prepare` 回调中捕获根上下文，而不是取其返回值，使该回调覆盖整个挂载窗口。release 执行期间，处理函数保持注册并处于锁定状态：被报告的始终是第一个 rejection，后续拒绝（包括拆卸自身产生的拒绝）会被忽略，而不会变成未捕获错误、在拆卸中途杀死进程。

`cordis:group` 与 `cordis:include` 一并注册，使一份组装能把一个提供方与它的消费方放进同一个 `isolate` realm。两者都通过宿主的模块管线加载，而非被包含树自身的说明符解析，这正是让本工作区之外的组装——放在 harness home 下的 agent preset——能够使用 group 行的原因。

配置中的裸插件 specifier（`@deepseek-ai/dsh-*`、npm 包）通过 Cordis Loader 的内部模块 loader 解析。默认情况下，它们从配置目录解析；封闭运行时会向 `boot` 或 `mountRootInclude` 传入 `bareModuleBaseUrl`，使已安装包树保持权威，即使配置位于另一个 Node 项目中也不受遮蔽。相对 specifier 始终以配置目录为基准解析。仓库 bin 会安装 Loader 的可选对等依赖（peer dependency） `node-addon-require-builtin`；外部调用方必须提供该组件，或者把插件安装到普通 Node import 解析可以找到的位置。构建后的 `dsh-app-boot` 产物内嵌静态挂载的 Include 实现，但仍将 Loader 保持为外部依赖，因此 include 树与宿主会绑定到同一个 Loader peer。`pnpm dsh` 源码路径还会将 manifest（元数据清单）声明的 workspace 包映射到其 TypeScript 源码；其配置门禁要求每个随附的原始／Web 裸插件都出现在解析所用 manifest 的 `dependencies` 中。

此包不包含 loader 钩子，也不提供开发模式接口。[`dsh` 应用](../../../apps/cli/README.md) 持有自己的 Node 源码启动钩子，并在启动序列中使用这些 helper；构建后的消费方仍使用普通 Node 包解析。

## Profiles

profile 是位于 `$DSH_HOME/profiles/<name>` 下的目录（harness home 由 [`resolveDshHome`](../../util/home-paths/README.md) 解析：先取 `$DSH_HOME`，否则取 `~/.dsh`），其中包含一个 `package.json`（树外插件 `dependencies`，加上 profile manifest `dsh.profile` 及其有序的 `bundles` 层列表）和用户自己的 `cordis.patch.yml`。组合包是在 manifest 中声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的 npm 包；`loadProfile` 以双锚点解析每个 `dsh.profile.bundles` 名称（先从 dsh 安装目录，再从 profile 目录），列出的包若没有组合包声明则明确报错。`composeEntries` 通过 include 自己的 `applyEntryPatches` 在空条目列表之上应用各 patch 层，因此组合、标志推导和配置 dump 绝不会与实际启动内容发生偏离。`healProfilesModuleFallback` 维护扁平的 `$DSH_HOME/profiles/node_modules` 目录（安装目录的应用与各组合包依赖的每个包对应一个符号链接），使任意 profile 中的裸插件名都能经 Node 常规的逐级向上查找解析，而无需由 pnpm 管理随安装内置的包。`PROFILE_TEMPLATES`（`web`、`headless`）在首次使用时自动初始化；其他名称在 `initProfile` 创建之前都会明确报错（即 `dsh plugin` 路径）。`loadProfile` 会将与安装自有组合包元组完全一致的列表规范化为随发行版交付的模板，同时保留 manifest 中其他所有字段；一旦条目有任何额外、缺失或重排，该列表就归用户所有并保持不变。

用户级的机器本地偏好同样位于 harness home 中：

- **`.env`**：产品 CLI 的普通环境层；调用目录的文件优先于 harness home 的文件，两者都低于继承环境。`loadLayeredEnv` 记录每个值的来源，按不区分大小写的方式拒绝 [bootstrap-only 文件变量](../../../.agents/notes/implemented/architecture/2026-08-04-configuration-source-ownership.md#decision)，并把其余值物化进 `process.env`，供 Loader 表达式和第三方库使用。受管凭据另存于 [`.credentials.yaml`](../../credentials/credentials-local/README.md)；留在任一 `.env` 中的凭据仍是低优先级后备值。
- **`cordis.patch.yml`**（home 级）与 **`profiles/<name>/cordis.patch.yml`**：用户 patch 层，应用在所有组合包层之后（先应用逐 profile 的文件，再应用 home 级文件，因此后者优先级更高）：按 id 定位的 patch 会替换对应条目的整个 `config`（未改字段也要重述），`insert` 会添加条目，`!!js` 表达式则在挂载时插值。如果 patch 指定的条目 id 不在组合后的树中，则输出一条 stderr 警告。空文件或仅含注释的文件会抛出异常（其解析结果为空，而不是列表）；如需禁用该层，请使用 `[]`。

每次 profile 启动都由 `watchUserPatches` 持续应用 `cordis.patch.yml` 的变更（一次性 surface 经由有界关闭 dispose 监视器）。即使该文件或其直接父目录不存在，监视器仍会监视确切路径；它会串行处理突发变更，并按调用方的层次顺序重新组合用户 patch（组合包层在下、overlay 在上）。读取失败、解析失败或 Loader 候选被拒时，最后一个可用树会继续运行；HMR 服务记录错误后广播 `hmr/config-update-failed(filename, Error)`，并隔离观察方的失败。上下文 dispose 时会关闭 watcher，并等待进行中的刷新结束。

## 模型体验

模型通过此包加载的插件树间接受到影响；该树决定最终应用中的提示词、schema、消息和模型适配器。唯一贡献模型可见文本的导出 `addHarnessSourceSection`，也只有在消费方启动后调用它时才会产生影响。

#### KV Cache 影响

`boot()` 不会直接使缓存失效；消费方调用 `addHarnessSourceSection` 时，会在系统提示词靠前位置、逐请求内容之前添加一行短文本，因此不会使跨轮次缓存失效。请求前缀的其他任何变化均由相应的具名消费方负责。

## 已知限制与暂缓事项

- **裸包 specifier 依赖 Loader 内部机制**：生产 bin 需要 Loader 的可选原生辅助组件；没有该辅助组件的进程内调用方必须使用可解析的相对／file specifier，或提供自己的模块解析钩子。
- **快照回放替换仅识别特定 basename**：只有以 `cordis.yml` 或 `cordis.yaml` 结尾的配置会映射到同级 `cordis.snapshot.yml`；自定义配置名称需要调用方自行选择。
- **环境发现以启动为界**：`loadLayeredEnv` 只读取一次调用目录与 harness home 中的 `.env`；它不搜索父目录，也不跟随之后选择的 workspace。`loadEnv` 仍是非产品 bin 使用的单目录 helper。
- **用户 patch 会替换匹配到的整个配置**：按 id 定位的 patch 不做深度合并，因此 profile 覆盖必须重述需要保留的组合包字段。
