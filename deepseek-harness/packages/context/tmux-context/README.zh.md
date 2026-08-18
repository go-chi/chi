# @deepseek-ai/dsh-tmux-context

[English](README.md) | 中文

可选启用的持久上下文，记录本 agent（智能体）进程所在的 tmux session、window、pane，以及该 window 的 pane 树布局。在准备模型请求时每轮采样一次；随附 Web／无头组合不包含它。决策记录见：[tmux-context Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-tmux-location-context.md)。

## 配置

```yaml
- id: tmux-context
  name: '@deepseek-ai/dsh-tmux-context'
  config:
    refreshIntervalMs: 60000 # optional; omit or set to 0 to inject on every changed turn
```

`refreshIntervalMs` 必须是非负安全整数。省略或 `0` 表示只要 tmux 状态自上次注入以来发生变化就注入。正值会额外抑制距最近一次注入不足该毫秒数的注入。

## 如何读取 tmux

插件前置注册一个 `agent/pre-step` 监听器，仅在每轮的第一个步骤运行。当需要注入时，它通过 `ctx.shell` 执行器服务运行一条只读命令：

```sh
[ -n "$TMUX_PANE" ] || exit 1
self_tty=$(ps -o tty= -p <pid> | tr -d ' ')
pane_tty=$(tmux display-message -t "$TMUX_PANE" -p '#{pane_tty}') || exit 1
[ "$pane_tty" = "/dev/$self_tty" ] || exit 1
exec tmux display-message -t "$TMUX_PANE" -p '<format>'
```

仅凭 `$TMUX_PANE` 并不足够：从 tmux shell 启动的终端（VS Code 集成终端、桌面启动器）会从该祖先进程**继承** `$TMUX` 与 `$TMUX_PANE`，因此即使进程并不位于那个 pane 中，这些变量依然存在。为此该命令还会把 pane 的 `#{pane_tty}` 与本进程自己的控制终端（对其 pid 执行 `ps -o tty=`）作比较：真正的 pane 拥有本进程的 tty，而继承而来的环境指向的是另一个 pane 的 tty。通过 `ctx.shell` 运行会应用部署方的沙箱与策略；插件不拥有任何子进程代码。当 `ctx.shell` 缺失、进程不在真实的 tmux pane 内（`$TMUX_PANE` 未设置，或 tty 不匹配 ⇒ 非零退出）或读取结果格式非法时，本次尝试为空操作，绝不报错。由于位置信息是可选的，执行器的拒绝——`resolve()` 的策略拒绝或 `run()` 的基础设施故障——会被兜住并记录为警告，而不会使该轮失败。

状态在每个符合条件的轮次拉取——pane 被移动、改名或重新布局都会被感知，无需任何 tmux hook 或后台进程。插件仅在渲染出的 tmux 状态与上次注入不同时才重新注入，因此位置不变时不会新增任何内容。

## 时序语义

该插件会前置一个 `agent/pre-step` 监听器。需要注入且下游决策进入拟议步骤时，它会向返回的批次前置添加一条带来源的 `UserMessage`。AgentLoop 会在 `step/start` 之后记录该上下文，其来源为 `{ kind: 'plugin', plugin: 'tmux-context' }`。变化抑制与间隔调度会扫描原始持久会话事件中该来源的最近一次注入，因此调度可跨压缩（compaction）与恢复的进程存续，无需进程内缓存状态；各会话独立调度。下游在步骤前运行的监听器拒绝或失败时，该读数不会被记录。

## 模型体验

### 准备期 tmux 位置

#### 模型看到的内容

在 tmux 状态发生变化的每一轮，注入一条带来源标记、含以下三行的上下文消息。`<window-layout>` 是 tmux 紧凑的 pane 树描述；pane 与 window 的像素尺寸有意省略，相邻 pane 的内容从不采集。

##### 变化轮次读数

```markdown
tmux location (turn <turn>):
session <session>, window <index> "<name>", pane <index> <pane-id>
window active=<0|1>, pane active=<0|1>, layout <window-layout>
```

#### Token 影响

每条两行读数会累积，直到压缩将其遮蔽。位置未变化以及间隔抑制不会新增内容。

#### KV Cache 影响

仅追加；新增可见内容位于可复用的请求前缀之后，不会使已有 KV Cache 条目失效。

## 已知限制与后续工作

- **仅第一个步骤**——轮次中途移动或缩放的 pane 会在下一轮反映，而非在步骤之间。
- **仅自身位置**——插件从不采集相邻 pane 的可见文本。
- **只有布局，没有尺寸**——省略 pane/window 像素尺寸；仅报告布局树与活动标志。
- **制表符分隔字段**——若 tmux window 名称包含字面两字符序列 `\t`，会使读数分割错误并作为非法读数跳过；常规名称不受影响。
- **基于 tty 的 pane 判定**——只有当进程的控制终端与 `$TMUX_PANE` 的 `#{pane_tty}` 一致时，才视为「位于 tmux 中」。这会有意排除从 tmux 祖先进程继承 `$TMUX`／`$TMUX_PANE` 的终端（如 VS Code 集成终端）。`ps -o tty=` 属于 POSIX；在其或 `#{pane_tty}` 不可用的环境中，该检查即为空操作。
