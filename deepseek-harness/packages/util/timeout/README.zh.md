# dsh-timeout

[English](README.md) | 中文

超时的**时序与分类**部分：一个零依赖纯函数库（无运行时 harness 依赖），由每个需要限制调用方超时提示、启动 deadline，并在之后区分「已超时」与「已取消」的能力共享。

它**不负责终止**。它发出的信号只会*通知*；真正停止工作仍由各能力负责，因为机制各不相同：bash 对操作系统进程组发送 SIGKILL，web 关闭 `fetch` 套接字，没有任何共享层能够承担全部终止机制。[Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) 将边界划定为：共享时序/分类，将强制终止保留在本地。

它是**库，而非服务或插件**：没有 `ctx`，不注册任何内容，不持有状态，也不发出事件。「超时服务」必须了解如何停止每项能力的工作，这正是微内核要排除在共享层之外的知识。

## 对外接口

```ts
import { clampTimeout, deadline, idleWatchdog, MAX_TIMER_DELAY_MS, timeoutOf, TimeoutReason } from '@deepseek-ai/dsh-timeout'
```

| 导出项 | 职责 |
|---|---|
| `clampTimeout(requested, def, max, name?)` | 验证调用方可选的、值为正且有限的提示，从 `def` 填充，并限制在 `max` 以内。如果提示为非正数或非有限数，则抛出错误（包含 `name`）。 |
| `deadline(upstream, timeoutMs, code)` | 将 `upstream` 取消与超时融合为一个 `AbortSignal`（`AbortSignal.any`）；超时携带 `TimeoutReason`。`[Symbol.dispose]` 清除 timer。 |
| `idleWatchdog(upstream, timeoutMs, code)` | 保持一个稳定的融合信号，并且只在受保护的异步迭代器 `next()` 尚未完成时启动 timer。完成后停止 timer；后续需求或 `pulse()` 活动会重新启动 timer；dispose（资源释放）时清除；并发需求被拒绝。 |
| `MAX_TIMER_DELAY_MS` | Node 在不将延迟限制为 1 毫秒时可调度的最大延迟（`2_147_483_647`）。负责 timer 的配置不得超过该值。 |
| `timeoutOf(signal \| { reason }, code?)` | 从已中止的信号/错误中恢复 `TimeoutReason`，否则返回 `undefined`，即超时与取消的分类器。传入 `code` 可仅匹配这个 deadline 的 timer（见下文的嵌套）。 |
| `TimeoutReason` | 标记在超时中止上的内部原因（`code` + `timeoutMs`）。它不是公开错误；提供方将其转换为自己的错误/字段。 |

## `timeoutMs <= 0` 哨兵值

`0` 是后端自有后台工作（bash `start()`）使用的**内部**「无超时」值。`deadline()` 不启动 timer，只转发 `upstream`；如果也没有 upstream，它将返回永不中止的信号和无操作 disposer，因此每个调用方都能保持同一种调用形态。外部请求提示会通过 `clampTimeout` 验证为**正有限数**，之后才进入 `deadline`，因此 `0` 绝不是面向模型/插件的「禁用超时」值。

## 使用形态

```ts
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

declare function runWork(options: { signal: AbortSignal }): Promise<unknown>

// Scope-lifetime consumer (foreground bash, one fetch): `using` disposes the timer.
export async function runWithDeadline(upstream: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
  using d = deadline(upstream, timeoutMs, 'BASH_TIMEOUT')
  const outcome = await runWork({ signal: d.signal })               // work listens on d.signal and terminates itself
  const timedOut = timeoutOf(d.signal, 'BASH_TIMEOUT') !== undefined // classify the first abort, scoped to OUR code
  const aborted = d.signal.aborted && !timedOut                     // mutually exclusive: timeout won, or cancel did
  return { outcome, timedOut, aborted }
}
```

该信号只会*通知*；调用方必须接入自己的终止机制（`d.signal.addEventListener('abort', kill)`，或将 `d.signal` 传给 `fetch`）。让 promise 与 timer 竞速，会在子进程或套接字仍在泄漏时就让工具调用完成；发出信号则会强制要求存在真正的终止路径。

将你自己的 `code` 传给 `timeoutOf`，使分类可在嵌套场景中正确组合。当 `upstream` 本身是 deadline 信号时，如果该 timer 先触发，`AbortSignal.any` 会保留它的 `TimeoutReason`。将匹配范围限定为你的 code，会把外部超时视为普通的 upstream 取消，而不会声称本地 timer 已到期。

对于流式传输，创建一个 `idleWatchdog`，将其稳定的 `signal` 传给传输层，并为提供方的每次读取调用 `watchdog.next(iterator)`。当传输活动不产生迭代器值时，调用 `watchdog.pulse()`。间隔必须为正有限数，且不得超过 `MAX_TIMER_DELAY_MS`；否则 Node 会将其限制为 1 毫秒。它只对尚未完成的读取请求计时，因此当下游代码进行渲染或在请求下一个分片前以其他方式等待时，timer 不会运行。该原语仍然只会通知，因此传输层必须观察稳定信号；DeepSeek 和 pi-ai 适配器证明，超时会关闭它们的真实响应正文或 SDK 请求。

## 哪些操作不设置超时

本地文件 `read`/`write`/`edit` 不接受 `timeoutMs`：文件 IO 不设时限地运行，因为截止时间会中止操作系统仍会完成的工作。详见[文件系统子系统页面](../../../docs/subsystems/filesystem.md)。

## 模型体验

通过 `dsh-tool-call-timeout-policy` 等消费方间接影响模型；消费方可能会将提供方结果替换为已保留的超时错误，或抑制延迟结果。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **只发出通知**：deadline 无法停止忽略其信号的工作；每项能力仍需要自己的 socket/进程/任务终止路径。
- **`timeoutMs <= 0` 是内部词汇**：只有在所属后端已解析策略后，它才会禁用本地 timer；绝不会作为面向模型/插件的公开开关。
- **第一个中止原因决定分类**：当 upstream 取消早于本地 timer 发生时，即使自己的超时之后也会到期，该层也无法再报告。
- **空闲 watchdog 不是总 deadline**：它针对每个尚未完成的迭代器需求重新启动，并刻意排除消费方的处理时间。
