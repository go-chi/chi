# `@deepseek-ai/dsh-acp-snapshot`

[English](README.md) | 中文

ACP（Agent Client Protocol）快照套件工具包：无密钥快照层（`pnpm run test:snapshot`，见[测试策略](../../../docs/testing.md)）背后的共享机制。示例只需场景表和 fixture（测试前置数据）目录就能获得完整快照套件；每项比较/保护机制都位于此处，受每文件覆盖率门禁约束，而不是在每个示例中复制。

四层可单独导入：

- **`launchAcpTestAgent`（启动器）**：从指定 cwd 在 tsx 下启动源 agent（智能体），或在普通 Node 下启动已构建 `lib` agent；通过原始字节 stdout tee 连接 SDK 客户端，收集会话更新和 stderr，在启动阶段报告异步 spawn 失败，默认拒绝未处理的权限请求，并负责优雅或带信号关闭。关闭会等待进程退出、继承 stdio 关闭和 ACP parser 耗尽，然后才完成关闭或传播子级错误，使捕获内容完整，且调用方可在任一结果后移除自有路径。当 Windows 接受强制终止但异步发布退出标记时，关闭会给该标记有界宽限，然后才将回退拒绝视为第二次失败。快照和普通 e2e 套件共享该进程边界；测试只需提供 agent 路径、cwd、环境覆盖和任何权限策略。
- **`runScenario`（harness）**：通过启动器从确定性 `input.json` 脚本驱动 ACP JSON-RPC stdio，将原始 stdout tee 给预期输出和纯度检查，并在优雅 stdin EOF 后收集每个持久化原始 JSONL 会话日志（父会话和 subagent 子会话，主会话优先）。`AgentUnderTest` 提供绝对 `binScript`、可选 `libBinScript`、`configPath` 和 `tsconfigPath` 路径，因为子进程 cwd 位于仓库外。当生成子级 cwd 的授权本身是测试对象时，`workspaceParent` 可以将它从平台临时目录移出。启动失败会在拒绝诊断中保留已捕获 agent stderr。
- **规范化器**：将已捕获内容转换为稳定文本或可移植 fixture 的纯函数：`normalizeStdout`（JSON-RPC id → 首次出现序列；UUID 以及生成 cwd 的每种原生／JavaScript 文件系统写法 → token，按最长优先；根据 cwd 的分隔符选择规范 `/` 或宿主原生形式；同时作为 stdout 纯度检查）、`normalizeSessionLog`（时间归零、保留 `seq`、使用同一 cwd 路径策略）、`tokenizeSessionFixtureCwd`（生成的 workspace 及其文件系统别名，包括已进行 token 化的 macOS `/private` 别名 → 单一规范 `{{cwd}}`；手工编写的临时路径保持不变）、`scrubSystemPrompts`（提示词文本 → `{{system}}`）、`scrubToolSchemas`（schema bulk → `{{tools}}`）、`scrubRequestHeaders`（每个 pin 之外的所有 header bulk → `{{system}}`/`{{tools}}`/`{{messagePrefix}}`，保留结构；见[header 固定 Agent Note](../../../.agents/notes/archived/testing/2026-07-06-pin-request-header-content-in-one-scenario.md)）和 `stabilizeFixtureMessageIds`（针对任意录制器已准备写入 fixture 的父级/子级日志，通过结构化方式仅改写 surface 和持久 inbox 中完整消息的 ID 字段，将已提交 UUID 带入未变化且双向唯一匹配的消息）。
- **`defineAcpSnapshotSuite`（工厂）**：为场景表注册完整 describe/it 树：每场景预期输出与重新持久化日志比较、录制/刷新 fixture 回写、拒绝结构化 `UNKNOWN_TOOL` 结果、每个 header 类别一个 token 化 pin（由可独立共享的 `system-prompt.expected.md` 和 `tool-schemas.expected.json` 伴随文件组合而成），以及实时一致性保护。其 fixture 保护会拒绝遗留场景目录、缺失文件、一个类别包含多个 pin、重复的伴随文件内容、带非规范 macOS 前缀的 cwd token、未擦除的 JSONL header，以及格式错误的 pin header。在录制或刷新模式写入 fixture 前，仅当一条未变化完整消息的 ID 及其去除身份后的指纹在场景可写入 fixture 的父级/子级日志中均唯一时，该消息才会保留已提交的 UUID；会话包的权威 surface 类型谓词负责选择 surface 载体，与其关联的 `agent/inbox/spliced` 副本也纳入同一映射，且仅改写这些载体中通过验证的 `id` 字段。新增、发生变化、格式错误以及图关系存在歧义的消息保留本次生成的 UUID。刷新会使用收集所得本次运行的 id、cwd 及全部 cwd 别名评估本次生成的叶值；只有完整逻辑记录布局对齐且易变字符串替换形成双射时，才会复用归一化后等价的叶值；surface 或 inbox 载体中的完整消息 ID 不参与此路径，因为后续结构化处理负责这些 ID；有歧义的日志保留本次生成的字符串，而本次生成的语义值仍为权威数据。它还会在对齐事件时间前展开打包时序 envelope，因此切换打包/非打包布局无法移动后续记录。新插入的 `session/title` 使用前一个事件的时间，因此功能驱动的插入不会扰动 fixture 余下部分。每个场景目录的 `session.jsonl` 和连续 `session.<n>.jsonl` 同级文件构成有序的主会话／子会话清单；场景表不重复其数量。必须在 vitest 收集时调用。

签入仓库的会话 fixture 使用规范打包行；[临时仓库迁移器](../../../scripts/migrate-packed-session-fixtures.ts)（`pnpm run migrate:packed-session-fixtures`）会改写较旧的 fixture 布局，由其[移除提案](../../../.agents/notes/proposed/process/2026-07-26-remove-packed-session-fixture-migrator.md)负责删除该迁移器。

消费方 `*.snapshot.ts` 就是场景表加一次工厂调用：

```ts
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defineAcpSnapshotSuite,
  type Scenario,
  type SnapshotSuiteOptions,
} from '@deepseek-ai/dsh-acp-snapshot'

function snapshotMode(value: string | undefined): SnapshotSuiteOptions['mode'] {
  switch (value) {
    case undefined:
    case '':
    case 'replay': return 'replay'
    case 'record': return 'record'
    case 'refresh': return 'refresh'
    default: throw new Error(`unknown DSH_SNAPSHOT mode: ${value}`)
  }
}

const SCENARIOS: Scenario[] = [
  { name: 'text-turn', hasModelTurn: true, recorded: true, pinsHeader: true },
]

defineAcpSnapshotSuite({
  agent: { // absolute paths, resolved from the suite's own location
    binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
    configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
  },
  snapshotsDir: join(dirname(fileURLToPath(import.meta.url)), 'snapshots'),
  scenarios: SCENARIOS, // exactly one entry per header class sets pinsHeader
  mode: snapshotMode(process.env.DSH_SNAPSHOT),
})
```

启动不同组合树的场景会设置自己的 `configPath`（一个 basename 仍以 `cordis.yml` 结尾的 overlay，使 bin 的回放交换可找到同级 `*cordis.snapshot.yml`）；当该组合改变请求 header 时，还会设置自己的 `headerClass` 和 pin 场景，acp-agent 示例的 Code Mode 与文件系统场景是模板。默认生成的 workspace 在会话 fixture 中存储为 `{{cwd}}`，使平台临时根目录和随机 basename 不影响录制结果；当临时目录授权自身待测时，`workspaceParent` 将生成 cwd 移出平台临时区域，在 fixture 中保留该显式路径，并仍归父级所有，而 harness 只移除生成的子级。场景签入的 `workspace/` 会先复制到该子级，随后 `prepareWorkspace` 在 agent 启动前针对生成 cwd 运行。此 hook 仅用于 Git 无法跨平台表示的 fixture；普通种子应留在 `workspace/` 中，而生成路径在 Windows 上无效时还必须搭配 `posixOnly`。

每个 pin 默认拥有其生成的 `system-prompt.expected.md` 或 `tool-schemas.expected.json`；当完整的对应序列相同时，`systemPromptSource` 和 `toolSchemasSource` 指定另一个 pin 作为来源，因此每个不同版本只提交一次。该 pin 的 `session.jsonl` 存储 `"system":"{{system}}","tools":"{{tools}}"`，同时保留配置、原因和任何模型可见前缀。具有合法运行中 header 变更的 pin 声明 `expectedHeaderChanges`；共享来源必须声明相同的 header 变更数量，录制/刷新会拒绝生成不同字节的共享引用方。

自身作用域组合出不同请求的 child 会话按 fixture 索引单独声明：`pinsChildToolSchemas` 把该 child 的工具序列移入 `tool-schemas.<n>.expected.json`，`pinsChildSystemPrompts` 把其提示词移入 `system-prompt.<n>.expected.md`。两者都指名自己描述的 `session.<n>.jsonl` fixture，其余请求 header 字段仍归类别 pin 所有，并要求 sidecar 恰好在声明时存在。child 提示词 sidecar 还必须与其类别 pin 不同，因此冗余副本会直接失败，而不会悄悄漂移。携带作用域局部 `report` 工具及其指引 section 的可继续 child 是两者的随附用例。

每个场景都比较 `stdout.expected.jsonl`，其中以 cwd 为根的分隔符规范化为 `/`。在 Windows 上，`pinsNativeWindowsStdout` 还会在共享预期输出之后比较完整 `stdout.expected.windows.jsonl`，并且仅在启用时要求存在该伴随文件。需要非 Windows 主机的场景声明 `posixOnly`，在 Windows 上跳过运行测试，但 fixture 保护仍在所有平台覆盖其已提交文件；示例包括 POSIX 进程语义（例如取消正在运行的 bash 调用会终止一个已脱离的进程组）和 Windows 无法表示的生成路径。组合需要可用 `pwsh` 的场景声明 `pwshOnly`；调用方提供的 `hasPwsh` 探测（随附的 acp-agent 套件遵循执行器自身的解析，因此 Program Files 安装也计入）在解析不到可用 `pwsh` 时跳过运行测试，而 fixture 保护仍处处覆盖其已提交文件。

示例还发布 `cordis.snapshot.yml` 回放 overlay，位于 `cordis.yml` 旁边（bin 在 `DSH_SNAPSHOT=replay` 下交换它们，见[单源回放配置 Agent Note](../../../.agents/notes/archived/testing/2026-07-04-single-source-acp-replay-config.md)）；回放 fixture 由 [`dsh-llm-replay`](../llm-replay/README.md) 提供，本包通过为子进程设置的 `DSH_SNAPSHOT_*` env var 指向它。`pnpm run test:snapshot:record` 调用在线 LLM（大语言模型），并重写已记录场景的模型 fixture；`pnpm run test:snapshot:refresh` 保持无密钥，运行回放 overlay，并从已提交模型脚本重写 stdout、可比较会话日志预期输出，以及各 pin 自有的提示词与工具 schema 伴随文件。Fixture 角色、录制/回放/刷新语义和场景表字段记录在 `Scenario` 以及[快照 Agent Note](../../../.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md) 中。

约束：`suite.ts` 与 `harness.ts` 导入 vitest（harness 通过 `vi.waitFor` 轮询其持久边界等待），因此包入口只能在 vitest 运行中导入（启动器和规范化器没有此依赖，但从同一入口发布）。启动器和套件工厂按设计专用于 ACP，启动器使用 SDK 的 `ClientSideConnection`；规范化器是与传输无关的会话日志/文本辅助工具，还由 JSON-RPC 和 Web 快照录制器消费。输入脚本覆盖初始化、新建会话、文本提示简写、精确结构化 ACP 提示词块、取消、预期 RPC 失败和持久轮次边界等待。权限往返是选项类别选择（`allow_once`、`reject_once` 等）的 FIFO 队列，映射到 agent 发出的 `optionId`；缺少或耗尽的队列回答 `cancelled`，未提供类别会拒绝运行。

## 模型体验

无。该测试专用 harness 记录、规范化并比较 ACP transcript（文本记录），不会改变 agent 组装的模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **会话收集需要原始 JSONL mode**：`runScenario` 收集持久化 `.jsonl` 日志，因此快照配置使用 `persistenceCompression: 'none'`；压缩 JSONL 和 SQLite 组合没有快照收集路径。
- **构建 mode 需要当前产物**：先运行 `pnpm run build`，再选择 `DSH_EXAMPLE_MODE=lib`；源 mode 仍是零构建路径。
- **后端覆盖仍使用 ACP 驱动器**：保留场景为何使用该传输，见[仅自动化 ACP 决策](../../../.agents/notes/implemented/simplification/2026-07-23-acp-automation-only-protocol.md#snapshot-boundary)。
