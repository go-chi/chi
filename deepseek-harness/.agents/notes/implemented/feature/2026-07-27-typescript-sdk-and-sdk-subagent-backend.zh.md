# Agent Note: TypeScript SDK 客户端与 SDK subagent 后端

Status: implemented

[English](2026-07-27-typescript-sdk-and-sdk-subagent-backend.md) | 中文

## 问题

stdio JSON-RPC 对外服务接口（`@deepseek-ai/dsh-sdk-jsonrpc-server`，见[单文件可执行 Agent Note](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md)）当时只有一个客户端：Python SDK。想要同样「把 harness 作为子进程驱动」能力的 TypeScript 消费方——仓库测试、自动化，尤其是一个其子进程是*完整 harness 运行时*（而非通用 ACP agent（智能体））的 subagent 后端——没有可导入的内容：请求/通知载荷形状只以匿名对象字面量存在于服务器内部，传输类也躺在服务器插件包里。

## 决策

三个包，分层与既有 Python 栈完全一致，外加一个 Service Provider 注册：

- **`@deepseek-ai/dsh-sdk-protocol`**（`packages/sdk/protocol/`）—— 把线协议做成共享且具名。`JsonRpcLineTransport` 从 `dsh-sdk-jsonrpc-server` 原样移入（后者现在导入它），`types.ts` 为服务器所说的每个载荷命名：`InitializeParams/Result`、`SessionPromptParams/Result`、四个通知载荷，以及 `HarnessSdkRequestMap`/`HarnessSdkNotificationMap` 索引。该包根显式导出这一完整接口，且不提供指向源模块的深层导入。服务器的 `notify()` 调用点以这些具名载荷标注类型，服务器漂移会先破坏编译而不是破坏客户端。一处行为变化：错误响应现在以携带线上 `code`/`data` 的 `JsonRpcResponseError` 拒绝（Python 客户端本就保留这些；旧传输只抛携带消息的裸 `Error`）。
- **`@deepseek-ai/dsh-sdk-client`**（`packages/sdk/client/`）—— `python/sdk` 的 TypeScript 孪生：`HarnessClient`（spawn、分帧、通知扇出、有类型的错误表面、经共享 dispose（资源释放）阶梯关闭至完全停稳）之上是 `DeepSeekHarness`/`HarnessSession`（惰性启动、记忆化 `initialize`、`run()` 把一个 `session/prompt` 与其 `session.finished` 配对）。其包根消费方接口显式导出两层客户端、面向调用方的类型，以及协议包所拥有的 `JsonRpcResponseError`；源模块、规范化辅助函数和通知投递端都保留为内部实现。`TurnResult.events` 只包含根会话的类型化事件，而 `notifications` 则保留根会话及从 `subagent.started` 发现的后代各自的会话 id；基于 `subagent.started` 血缘边的会话树范围限定在客户端完成，镜像 `client.py`。与 Python 的刻意不对称：启动规格是显式 `command`/`args`（无捆绑运行时解析——那是尚无 TS 消费方的发行问题）；`env` 整体替换而非合并（凭据策略归调用方；subprocess seam 的 `scrubbedParentEnv` 一个 import 即得）；`TurnResult` 携带结构化 `reason`（Python 只暴露 `status`）；拆除走私有的 stdin-EOF → SIGTERM → SIGKILL 阶梯直到真正退出（客户端运行在任何 harness 上下文之外，无法搭乘 `ctx.subprocess`）。
- **`@deepseek-ai/dsh-subagent-dsh-sdk`**（`packages/subagent/subagent-dsh-sdk/`）—— 第二个进程外 `SubagentProvider`，采用与 `subagent-acp` 对等的结构：同样的全 false 能力与 `inheritsParentContext: false`，同样的握手后发布所有权事务，同样通过 `onError` sink 将结果归一为绝不拒绝，同样的父命名空间 run id。子答案从流式 `session.event` 读取——最后一条完整 `assistant/message`，否则累积的 `text-delta` 块，部分答案在取消时得以保留。停止原因由子进程的结构化 `TurnEndReason` 映射（`completed`/`max-tokens`/`aborted` 直通；其余一切、包括未运行任何轮次便已结束的子进程，都是 `error`）。其 `provider`/`model` 配置喂给子进程的 `initialize`；`env` 是部署传入子进程自有密钥与 `DSH_CORDIS_CONFIG` 的地方。
- **subagent seam 新增 `out-of-process.ts`**：两个进程外后端共享的 provider 侧词汇——`NO_START_CAPABILITIES`、时限校验、子进程 cwd 解析（配置覆盖、否则发起委托的父会话工作区）、绝不拒绝的 `settleRunResult`、以及 `subprocessRunHandle` 发布。进程机制（spawn、环境清理、进程树清理）属于 `dsh-subprocess` seam；`subagent-acp` 经 `ctx.subprocess` spawn 子进程，本后端则经 SDK 客户端 spawn 子进程（subprocess README 记载的 SDK 托管传输例外）并自行应用该 seam 的 `scrubbedParentEnv()`。

`dsh-sdk-jsonrpc-server` 的服务不变（协议字节完全一致）；`dsh-jsonrpc-agent-pkg`（Python 运行时闭包）增加 `dsh-sdk-protocol` 一行依赖。

## 测试

四层，依[测试政策](../../../../docs/testing.md)：

- **免密钥单元**——`sdk-client` 通过真实 stdio 驱动脚本化伪运行时（`tests/fake-runtime.ts`，环境变量脚本化、纯协议——即 Python `test_client.py` 的模式）；`subagent-dsh-sdk` 经真实提供方驱动同一伪运行时。三个包全部 100% 逐文件覆盖。
- **免密钥 Loader 组合**——`subagent-dsh-sdk/tests/loader-composition.e2e.ts` 启动仅测试用 cordis.yml（`examples/jsonrpc-agent/tests/fixtures/subagent/subagent-dsh-sdk/`），其中子进程是真实的第二个 harness 运行时、带自己的 cordis.yml；断言父工具结果与子进程自己持久化的 transcript（文本记录）都携带父会话 cwd。子启动经 `resolveExampleLaunch` 解析，src/lib 两种模式都成立。
- **免密钥快照**——`examples/jsonrpc-agent/tests/sdk.snapshot.ts` 是 jsonrpc 示例的第一个快照套件：真实 `dsh-jsonrpc-agent` 运行时经真实 `dsh-sdk-client` 驱动，在新的 `cordis.snapshot.yml` 覆盖层后经 `llm-replay` 回放已录制 fixture（测试前置数据）（经 `DSH_CORDIS_CONFIG` 显式传入；jsonrpc bin 自身不做快照配置切换）。三个场景——文本轮次、bash 工具、spawn subagent——各自钉住规范化通知流、SDK 轮次结果与持久化的父+子日志。这也补上了单文件可执行 Note 的 Python 侧快照在 vitest 侧留下的协议层缺口。
- **带密钥 e2e**——快照套件的 `DSH_SNAPSHOT=record` 模式即真实 API 路径（已提交 fixture 由它产出）；组合 e2e 设计上无需密钥。

## 考虑过的替代方案

**从 `dsh-sdk-jsonrpc-server` 导入协议类型而不是提取协议包。** 会让每个 SDK 消费方（包括绝不能提供 JSON-RPC 服务的 `subagent-dsh-sdk`）依赖服务器插件及其 `dsh-agent`/`dsh-llm-deepseek` peer 集合，且通知载荷仍然匿名。能力 seam 规则（Service Definition/Service Provider/Consumer 三个包分立）已经点名了这种形态；这个传输是货真价实的双边物。

**让 `subagent-dsh-sdk` 直说裸 JSON-RPC、绕开客户端 SDK。** 会复制 SDK 存在意义所在的请求/通知配对、订阅扇出、超时与拆除逻辑；用户的要求明确是一个*使用* SDK 的后端，分层的回报是后端成为可复用客户端之上约 200 行的纯策略。

**把 SDK 后端折进 `subagent-acp`、用传输开关区分。** 两个后端共享子进程生命周期，但协议（ACP SDK 连接 vs harness JSON-RPC）、子进程约定（任意 ACP agent vs harness 运行时）、结果提取（`agent_message_chunk` 累积 vs 会话事件读取）毫无共享。配置判别字段会把两个协议埋进一个包；真正共享的提供方侧部分移入 subagent seam 的 `out-of-process.ts`，进程机制则住在 `dsh-subprocess` seam。

**给 TS SDK 与 Python 对等的捆绑运行时解析。** Python 的载体解析是为了给没有 Node 的用户发 wheel 包。TypeScript 消费方按定义就有 Node，且仓库内消费方还有工作区；为尚不存在的消费方编造发行方案违反「只实现当前需求」的规则。推迟到真实的 npm 发行消费方出现时再处理。

**导出源模块、规范化辅助函数和订阅投递端操作。** 这些都是调用方不需要的实现细节；暴露它们会让调用方不得不理解客户端如何校验与分发协议输入。各包根转而枚举受支持的客户端接口与协议接口，客户端则只重新导出调用方必须区分的那一种协议错误。

**复用 `dsh-acp-snapshot` 的 `runScenario` 做 SDK 快照。** 那个 harness 说 ACP（`ClientSideConnection`、`InputStep` 脚本）。SDK 套件的全部意义就是以 *SDK 客户端*为入口；它复用 normalize/refresh 库层（`normalizeSessionLog`、`refreshFixtureReplacements`……），不动 ACP 驱动器。

## 后果

**收益**：SDK 运行时协议现在拥有服务器与两个客户端 SDK 共享的、编译器校验的具名类型；TypeScript 消费方获得与 Python 相同的子进程驱动能力，且带类型化错误与结构化轮次原因，包根也只暴露归调用方所有的操作；subagent seam 获得一个 harness 原生的进程外后端，其子进程是完整对等体（自有配置、持久化、工具）——正是 seam Agent Note 所设想的递归组合方式；jsonrpc 示例终于有了快照覆盖，而且走的就是 SDK 路径本身。

**代价**：`sdk/` 组多了第三个包、subagent 多了第四个要保持最新的后端；SDK 后端每个子进程启动完整插件树（单次成本高于 ACP 子进程；池化与 ACP 一样留作未来工作）；协议仍无取消方法，SDK 的 `RequestTimeoutError` 与后端的 dispose 都只在本地结算、服务器侧轮次会继续运行到进程清理为止；快照 fixture 录制于 `deepseek-v4-flash`，与其他录制语料一样随模型行为漂移而重录。
