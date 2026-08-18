# 2. 生命周期与 effect

[English](02-lifecycle-and-effects.md) | 中文

Cordis 插件可能因修改配置、热重载、显式资源释放或所需服务消失而卸载。通过 Cordis API 建立的注册属于 effect，会在所属插件卸载时撤销；在这些 API 之外管理的资源必须包装在 `ctx.effect()` 中。

## Effect

对于 Cordis 尚未管理的资源，例如定时器、连接或 watcher，应将其包装在 `ctx.effect()` 中并返回 disposer（资源释放函数）：

创建 `lifecycle.ts`，将它放在 `tmp/cordis-tutorial` 中：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'lifecycle-demo'

function heartbeat(ctx: Context) {
  console.log('heartbeat plugin loading')
  ctx.effect(() => {
    const timer = setInterval(() => console.log('tick'), 200)
    return () => {
      clearInterval(timer)
      console.log('heartbeat cleaned up')
    }
  })
}

export function apply(ctx: Context) {
  // Mount a child plugin and keep its fiber to dispose it later.
  const fiber = ctx.plugin(heartbeat)
  // The demo timer is itself an effect: if THIS plugin is unloaded first,
  // the pending callback is cancelled instead of firing on a dead app.
  ctx.effect(() => {
    const timer = setTimeout(async () => {
      await fiber.dispose()
      console.log('disposed')
      process.exit(0)
    }, 700)
    return () => clearTimeout(timer)
  })
}
```

让 `cordis.yml` 指向该文件：

```yaml
- name: './lifecycle.ts'
```

运行（`node --import tsx ../../vendor/cordis/bin.js`）后会得到：

```
heartbeat plugin loading
tick
tick
tick
heartbeat cleaned up
disposed
```

请留意三点：

- `ctx.plugin(heartbeat)` 会把一个**来自代码**的函数挂载为插件，这与 YAML loader 为每个配置项执行的操作相同。函数插件不需要 `apply` 方法：Cordis 会直接调用该函数，其名称只用于诊断。只有对象形态才要求 `apply` 方法，例如 `ctx.plugin({ apply(ctx) { /* ... */ } })`。调用会返回一个 **fiber**，即一个已加载插件实例的运行时句柄。
- effect 主体在加载期间运行；它返回的 disposer 在卸载期间运行。对于生命周期与插件一致的资源，你绝不需要自行调用 disposer。
- `fiber.dispose()` 会等该插件的所有清理工作（包括异步 disposer）完成后才结束，并递归卸载它挂载的所有子插件。

## Fiber 状态机

每个已加载插件实例都拥有一个 fiber，并在以下状态之间转换：

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

- **PENDING**：已经声明，但所需服务（第 3 章）尚不可用。
- **LOADING / ACTIVE**：`apply` 正在运行／已经完成。
- **FAILED**：`apply` 或配置校验抛出异常。
- **UNLOADING / DISPOSED**：disposer 正在运行／一切均已拆除。

你会在[第 6 章](06-composition-and-hmr.md)再次遇到 PENDING，它通常就是「为什么我的插件没有输出」的答案。

## 已经属于 effect 的操作

你很少需要亲自编写 `ctx.effect()`，因为内置注册 API 本身已经是 effect：

- `ctx.on(event, listener)`：监听器会在卸载时移除（[第 4 章](04-events.md)）。
- `ctx.plugin(child)`：子插件会随父插件一同 dispose（资源释放）。
- 服务注册属于 effect。`ctx.tools.register(...)` 等 harness 注册表也会把返回的 disposer 附着到调用插件上，因此会自动撤销（[第 7 章](07-into-the-harness.md)）。

对于 Cordis 不管理的资源，应在 `ctx.effect()` 内获取它，并返回用于释放资源的 disposer。此后 Cordis 会在卸载期间调用该释放逻辑，热重载时也不例外。

有一项顺序注意事项：disposer 会按注册顺序的逆序启动，但多个**异步** disposer 会并发运行。如果拆除步骤必须按顺序执行，请把它们放在同一个 disposer 中，并在其中依次等待每步完成。

下一章：[服务](03-services.md)：插件如何共享功能。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
