# Agent Note: 将 ACP 快照套件提取为支持包

Status: implemented
Archived: 2026-07-27

[English](2026-07-08-shared-acp-snapshot-package.md) | 中文

## 问题

ACP（Agent Client Protocol）快照层（[快照 Agent Note（agent 决策记录）](2026-06-19-acp-snapshot-tests.md)）由位于一个示例测试目录内的三个模块构建：`snapshot-harness.ts`（启动真实 bin 子进程，通过 ACP JSON-RPC 驱动它，采集持久化日志）、`snapshot-normalize.ts`（纯预期输出规范化器），以及 `acp.snapshot.ts` 中约 150 行的场景主体与 fixture（测试前置数据）守卫（记录/回放模式、stdout 预期输出与日志比较、固定请求头一致性守卫、孤立项/必需文件/单一固定项元测试）。

第二个希望获得快照覆盖的 ACP 示例——直接消费方是沙箱/approval 组合——只能复制这些模块，恰好分叉了绝不能漂移的逻辑：记录写回、请求头清理、子会话采集顺序。spawn/client 胶水也在 `acp.e2e.ts`、`hooks.e2e.ts` 和 harness 中重复三份。文件位置决定了测试严格度：逐文件 100% 覆盖率门禁只测量 `packages/*/*/src`，因此这些机制完全未被测量——正是同一种缺口，曾推动 `dsh-llm-replay` 从 `examples/` 移入 [packages/support](../../../../packages/support/README.md)。此外，harness 的 ACP client 硬编码 `requestPermission → cancelled`，因此 approval 往返——沙箱组合的主打行为——完全无法在快照层表达。

## 决策

这些机制位于 [`packages/support/acp-snapshot`](../../../../packages/support/acp-snapshot/README.md)（`@deepseek-ai/dsh-acp-snapshot`）；示例的 `*.snapshot.ts` 只包含场景表、agent 路径和一次工厂调用，依赖自己的 `snapshots/` fixture 与 `cordis.snapshot.yml` overlay（[单源回放配置](../../archived/testing/2026-07-04-single-source-acp-replay-config.md)）。读取 `DSH_SNAPSHOT` 留在边缘层——库接收的是已解析的 `mode`。

**`src/launcher.ts`**——`launchAcpTestAgent` 拥有通用的未构建进程边界：绝对 tsx loader 解析、`TSX_TSCONFIG_PATH`、隔离的 harness home、stdio 接线、原始字节 stdout tee、stderr 与更新捕获、失败关闭的权限后备、更新 waiter，以及优雅或信号式关闭。快照场景和普通 e2e 套件提供相同的 `AgentUnderTest`（`binScript`、`configPath`、`tsconfigPath`）；扮演用户的测试只提供其权限 handler。ACP 与钩子 e2e 套件以及沙箱/approval e2e 套件都使用该 launcher，而不再重新构建 SDK client 边界。

**`src/harness.ts`**——`runScenario` 和输入脚本/结果类型在 launcher 之上叠加确定性步骤、临时 workspace、快照环境和持久化日志采集。其 `session/request_permission` handler 消费可选的 `InputScript.permissionAnswers` FIFO 队列，每个条目按选项**类型**进行选择（id 是 agent 生成的随机值，已提交脚本无法预知；类型是 ACP 稳定词汇，会在回答时映射到已提供的 `optionId`）；队列不存在或耗尽时回答 `cancelled`，若请求从未提供某种类型则拒绝该次运行——agent 自身收到的回答是 `cancelled`，因此场景 bug 会使 harness 失败，而不会被吸收为 agent 侧拒绝。由此，approval 套件可以根据 `input.json` 确定性地驱动允许/拒绝往返。

**`src/normalize.ts`** 是纯规范化器，按策略不含钩子：当未来某个事件携带新的易变字段（例如审批耗时），共享规范化器在同一个变更中学会它，保持「规范化」的含义只有一个归属，而非各套件各自扩展清洗逻辑。

**`src/suite.ts`**——包含 `Scenario` 类型和 `defineAcpSnapshotSuite(options)`，注册各场景比较、记录/刷新 fixture 写回、带实时一致性守卫的请求头固定项，以及 fixture 守卫块（没有孤立场景目录、必需文件存在、每种类别恰好一个固定项、每份 JSONL 都是 `scrubSystemPrompts` 固定点、非固定 fixture 同时也是 `scrubRequestHeaders` 固定点）。刷新会先展开打包的计时信封，再对齐现有易变事件时间，因此在打包与未打包布局之间切换不会移动后续记录；全新的分片片段数组仍为权威，因为其边界属于回放行为。场景目录中的 `session.jsonl` 加连续的 `session.<n>.jsonl` 同级文件构成有序主项/子项清单，因此场景表可以声明策略而不重复子项数量。固定请求头契约（[固定请求头 Agent Note](../../archived/testing/2026-07-06-pin-request-header-content-in-one-scenario.md)）按套件生效：每种请求头类别恰好标记一个 `pinsHeader` 场景，其 `system-prompt.expected.md` 和 JSONL 工具列表把组合请求头拆成可评审产物；一致性守卫会将两者与该类别的每个实时请求头比较。固定场景可以声明任何合法的变更请求头数量，其 Markdown 产物记录每个完整的已变提示词。纯辅助函数（`sessionFixtureNames`、`fixtureContext`、`normalizedHeaders`、`normalizedSystemPrompts`、`formatSystemPromptSnapshot`、`headerChangeCount`）从模块导出，以便直接进行单元覆盖。

## 曾考虑的替代方案

- **把模块复制到每个示例中**——这正是本 Agent Note 要防止的分叉：记录/守卫逻辑恰好是必须在各套件间保持逐字节相同的代码，而示例位于覆盖率门禁之外，所以每份副本也都无法测量。
- **在 `examples/` 下建共享模块目录**：代码仍在覆盖率门禁之外，且需要跨示例边界的相对导入，违反包名导入约定；`examples/` 的叶子节点按设计应保持轻薄。
- **`dsh-acp-demo` 的 `/testing` 子路径导出**：将测试基础设施耦合到产品包的对外服务接口与依赖集中；`packages/support/` 的存在正是为了真实但兼容性承诺较低的开发/测试包，`dsh-llm-replay` 是先例，本包与之配套。
- **导出原始测试体函数而非套件工厂**：每个示例将重新拥有 `describe`/`it` 骨架（每套件约 80 行注册样板），却无灵活性收益；工厂使消费方只需一张场景表加一次调用，而导出的纯辅助函数在工厂设计内保留了可单元测试性。
- **使用可注入 ACP `Client` factory 代替声明式 `permissionAnswers`**——灵活性最大，但会把 SDK client 构造泄漏给每个消费方，并恰好在正在统一的层重新引入逐示例漂移；声明式队列让 `input.json` 保持为唯一脚本表面，并与预期输出规范化兼容。
- **泛化到 ACP 之外（传输无关的快照 harness）**：不存在第二种传输方式；harness 端到端都是 ACP 形态（SDK 客户端、JSON-RPC 帧、`session/update` 等待器），推测性的抽象将是一个超前于任何消费方的 seam 拆分。

## 测试

提取一致性得到机械证明：迁移后，`pnpm run test:snapshot` 的结果与基准提交匹配，`examples/acp-agent/tests/snapshots/` 下没有任何字节变化。包的 `src/` 在门禁单元运行中保持逐文件 100% 语句/分支/函数/行覆盖，并通过脚本化 fake ACP bin（`tests/fixtures/fake-acp-agent.ts`，每个场景由 fixture 旁的 `behavior.json` 编排行为）经过真实 launcher 驱动：`harness.spec.ts` 直接覆盖 launcher 默认值、捕获、更新等待、关闭以及环境/配置变体，随后覆盖每种场景步骤操作、两个 expect-error 分支、权限队列（选择、后备、不可能点击）、workspace seed，以及采集顺序/噪音/后备分支；`suite.spec.ts` 在收集时真实运行 factory——一个针对已提交合成 fixture 的回放套件和一个针对临时副本的记录套件（写回从不触及已提交树；`ACP_SNAPSHOT_SPEC_BOOTSTRAP=1` 会重新引导它）——并包含纯辅助函数的直接用例。fake bin 会把 `session/new` cwd 而非 `process.cwd()` 代入脚本化日志，与真实 bin 请求头携带的内容一致（darwin 会将 `/var/folders/…` realpath 为 `/private/var/folders/…`）。

## 后果

新示例通过场景表加 fixture 即可获得完整快照层，普通 ACP e2e 则通过一次 launcher 调用获得同一条经过测试的进程/client 边界。代价是：`suite.ts` 导入 vitest，因此包入口只能在 vitest 运行中导入——其他包都没有这种形状，其 README 已说明；每个套件还要固定自己的约 8 KB 请求头 fixture（真正不同的组合理应拥有自己的固定项；相同组合则会被该套件的一致性守卫捕获）。
