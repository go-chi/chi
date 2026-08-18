# 2. Lifecycle and effects

English | [中文](02-lifecycle-and-effects.zh.md)

A Cordis plugin can be unloaded by a config edit, hot reload, explicit disposal, or loss of a required service. Registrations made through Cordis APIs are effects and are undone when their owning plugin unloads; resources managed outside those APIs must be wrapped in `ctx.effect()`.

## Effects

For a resource Cordis does not already manage — a timer, a connection, a watcher — wrap it in `ctx.effect()` and return a disposer:

Create `lifecycle.ts` in `tmp/cordis-tutorial`:

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

Point `cordis.yml` at it:

```yaml
- name: './lifecycle.ts'
```

Run (`node --import tsx ../../vendor/cordis/bin.js`) and you get:

```
heartbeat plugin loading
tick
tick
tick
heartbeat cleaned up
disposed
```

Three things to notice:

- `ctx.plugin(heartbeat)` mounts a function **from code** as a plugin — the same operation the YAML loader performs for each config entry. A function plugin needs no `apply` method: Cordis calls the function directly and uses its name only for diagnostics. An `apply` method is required only for the object form, `ctx.plugin({ apply(ctx) { /* ... */ } })`. The call returns a **fiber**, the runtime handle for one loaded plugin instance.
- The effect body runs during load; the disposer it returns runs during unload. You never call the disposer yourself for a plugin-lifetime resource.
- `fiber.dispose()` resolves after all of the plugin's cleanup — including async disposers — has finished, and recursively unloads any child plugins it mounted.

## The fiber state machine

Every loaded plugin instance owns a fiber that moves through these states:

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

- **PENDING** — declared, but a required service (chapter 3) is not available yet.
- **LOADING / ACTIVE** — `apply` is running / has completed.
- **FAILED** — `apply` or config validation threw.
- **UNLOADING / DISPOSED** — disposers are running / everything is torn down.

You will meet PENDING again in [chapter 6](06-composition-and-hmr.md), where it is the usual answer to "why does my plugin print nothing?".

## What is already an effect

You rarely write `ctx.effect()` yourself, because the built-in registration APIs are effects already:

- `ctx.on(event, listener)` — the listener is removed on unload ([chapter 4](04-events.md)).
- `ctx.plugin(child)` — the child is disposed with its parent.
- Service registrations are effects. Harness registries such as `ctx.tools.register(...)` also attach their returned disposers to the calling plugin, so they unwind automatically ([chapter 7](07-into-the-harness.md)).

For a resource Cordis does not manage, acquire it inside `ctx.effect()` and return a disposer that releases it. Cordis then invokes that release during unloading, including hot reload.

One ordering caveat: disposers start in reverse registration order, but multiple **async** disposers run concurrently. If teardown steps must run in sequence, keep them in one disposer and await them there.

Next: [Services](03-services.md) — how plugins share capabilities.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
