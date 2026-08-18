# @deepseek-ai/dsh-acp-demo

[English](README.md) | 中文

ACP（Agent Client Protocol）自动化服务器应用：默认 agent（智能体）主干、客户端通过 [`@deepseek-ai/dsh-acp`](../../acp/acp/README.md) 创建的 agent、JSONL 持久化，以及语义检查点机制，并通过一个 JSON-RPC stdio bin 对外提供服务。程序化客户端创建新会话；此包不挂载人工交互 UI。

## 组合

| 插件 | 角色 |
|---|---|
| `@deepseek-ai/dsh-agent-spine-demo` | 不含提供方且不预创建 agent 的 agent 主干；`session/new` 创建每个 agent。 |
| `@deepseek-ai/dsh-session-persistence-jsonl` | 检查点、可观测性和快照回放所使用的持久会话日志。 |
| `@deepseek-ai/dsh-session-checkpoint-policy` | 在模型调用和顶层工具 effect 前建立持久性屏障，并为已完成步骤建立检查点。 |
| `@deepseek-ai/dsh-session-query-sqlite` | 派生的精确／FTS 会话查询服务；先于 ACP 传输打开，使叶节点消费方在首次模型请求前就绪。 |
| `@deepseek-ai/dsh-acp` | 通过 stdin／stdout 提供的纯自动化 ACP 传输。 |

应用不安装命令、用户交互、会话导航、配置选择器或 stdout logger。它通过一个有序 effect 拥有这些插件，因此查询服务会在 ACP 接受工作前就绪，而 ACP 会话会在检查点与持久化插件卸载前完全停稳。叶节点配置负责提供 LLM（大语言模型）、执行器、沙箱、审批、文件系统和面向模型的工具插件。

## 配置

| 键 | 默认值 | 路由目标 |
|---|---|---|
| `provider` | 必填 | 每个由 ACP 创建的 agent 所用的提供方路由。 |
| `model` | 必填 | 每个由 ACP 创建的 agent 所用的模型。 |
| `maxParallelToolCalls` | agent loop（智能体循环）默认值 | 正整数工具调用并发上限；`1` 表示串行。 |
| `persona` | 无 | 供 `dsh-system-prompt` 使用的部署 persona 模板。 |
| `toolOrder` | 字典序 | 供 `dsh-system-prompt` 使用的显式面向模型工具顺序。 |
| `tools` | `{ mode: 'native' }` | Native、Code Mode 或组合式模型工具传输。 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | bash 与本地 skill（技能）发现共享的 harness 主目录。 |
| `sessionTitle` | 主干示例限制 | 持久后备标题限制；标题仍不会进入 ACP wire。 |
| `persistenceRoot` | `./.sessions` | JSONL 后端根目录，以及派生 `session-query.db` 索引的父目录。 |
| `packChunks` | `true` | 在存储中打包连续的增量分片事件。 |
| `persistenceCompression` | `zstd` | 带校验和的 Zstandard 帧，或原始 `none`。 |
| `workspaceContext` | 必填 | 工作区指令字节预算／配置，或 `false`。 |
| `skills` | 拥有者默认值 | skill 注册表、本地提供方和面向模型的 skill 工具。 |
| `toolBash` | 拥有者默认值 | 面向模型的 bash 工具配置。 |
| `jobs` | `{ maxConcurrentJobsPerOwner: 10 }` | 进程内按 owner 限制活动任务的准入配置。 |
| `toolJobs` | 拥有者默认值 | 通用后台任务控制配置，或 `false`。 |
| `goals` | 拥有者默认值 | 持久化的同会话目标领域与模型工具，或 `false`。 |

已交付的 [`examples/acp-agent/cordis.yml`](../../../examples/acp-agent/cordis.yml) 添加 DeepSeek 适配器、沙箱化 bash 与文件系统提供方、一次性审批策略、压缩（compaction）、subagent、工作流、钩子，以及面向模型的工具。应用提供派生会话查询索引，而面向模型的查询消费方仍由叶节点显式选用。快照 overlay 只替换非确定性提供方或策略值。

## Bin

`dsh-acp-demo [--config path-to-cordis.yml]`（短形式 `-c`；默认为 `./cordis.yml`）会加载 gitignore 排除的 `.env`，回放模式除外；`DSH_SNAPSHOT=replay` 选择同级 `cordis.snapshot.yml`；stdin EOF 会在退出前 dispose（资源释放）上下文并刷新会话。Loader 已安装的可选对等依赖（peer dependency）`node-addon-require-builtin` 使纯 Node 下构建后的 bin 可以解析裸插件说明符。诊断使用 stderr，因为 stdout 是 ACP wire。

## 模型体验

模型体验由 `dsh-agent-spine-demo` 和叶节点的面向模型插件间接提供。ACP 提示词文本会成为普通的已记录用户消息；协议元数据与权限选择不会进入模型请求。

#### KV Cache 影响

每个会话仅追加；应用本身不添加请求前缀内容。

## 已知限制与暂缓事项

- **JSONL 持久化固定不变**：使用其他后端需要另一种组合。
- **同级插件可能破坏 stdout**：应用无法阻止另一个 Cordis 配置项写入非协议字节。
- **只支持新建自动化会话**：恢复和人工交互属于其他运行入口。
