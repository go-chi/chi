# @deepseek-ai/dsh-tool-bash-persistent

[English](README.md) | 中文

模型可见的 `bash(command)`，底层复用一个按所有者隔离的 `ctx.terminals` shell。该包拥有工具约定和 shell 复用；PTY 后端与沙箱策略由部署选择。

## 配置

| 键 | 默认值 | 含义 |
|---|---:|---|
| `backendType` | `shell` | 每个 Agent shell 使用的已注册 PTY 后端。 |
| `timeoutMs` | `300000` | 单条命令的墙钟时间上限；超时会关闭 shell。 |
| `maxOutputChars` | `16000` | 命令输出最多保留的字符数；固定诊断会在此后追加。 |
| `description` | 持久 shell 描述 | 面向模型的环境约定。 |

## 模型体验

### 工具 schema

#### 模型所见

生成的 [`bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash-persistent)，其中包含配置的 `description`。本插件不贡献独立系统提示词段；persona 与环境指导由部署负责。

#### Token 影响

`bash` 可见时产生固定的 schema 成本。

#### KV Cache 影响

配置的描述与 schema 不变时前缀稳定。

### 工具结果

#### 模型所见

每个 Agent 的命令共享一个 shell，因此 cwd、导出的环境变量、已激活环境、函数和后台任务会跨调用保留。结果不包含私有完成标记。当 shell 在未打印完成标记的情况下再次读取 stdin 时——例如 `exec`、中断，或提供方能证明其 stdin 等待的交互式前台子进程——调用返回已捕获的部分输出，其末尾可能带有后端自己的提示符文本。经封装的命令以非零状态结束时，结果会追加 `[exit code: N]`；若 shell 在报告该状态前退出，则改为追加 `[shell exited: code N]`、`[shell killed by signal: SIG]`，或在后端既未提供退出码也未提供信号时追加 `[shell exited]`；随后重置 shell，并告知模型下次调用从新 shell 开始。长输出保留仍可读取的最早前缀并追加截断提示；若 PTY 已丢弃真正的开头，结果会明确说明，而不是把尾部伪装成完整输出。超时返回有界的部分输出、关闭状态不确定的 shell，并报告该重置。

#### Token 影响

随数据变化。`maxOutputChars` 限制保留的命令输出；固定的截断、前缀丢失、状态、超时与重置诊断可能使结果更长。

#### KV Cache 影响

工具结果以追加方式位于可复用请求前缀之后。

## 已知限制与延后工作

- 工具需要拥有它的 Agent 和真实 PTY 后端。
- 交互式前台子进程（例如 REPL）只有在进程管理提供方能证明其 stdin 等待时才会提前返回部分输出；否则调用会一直运行到 `timeoutMs`。
- 显式 `exit` 与超时会丢弃 shell 状态。取消同样会重置 shell 并丢弃结果，即使已经能观察到完整状态标记也是如此；下次调用创建新 shell。
- 网络访问、软件包镜像等环境事实应写入配置的 `description`，而非包默认描述。
