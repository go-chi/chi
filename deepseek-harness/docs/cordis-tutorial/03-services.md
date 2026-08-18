# 3. Services

English | [中文](03-services.zh.md)

A **service** is a named capability one plugin provides and other plugins consume through `ctx`. In the harness, `ctx.tools`, `ctx.llm`, and `ctx.agents` are services. A consumer names the capability, such as `'tools'`, rather than importing its provider, so configuration can select a provider without changing the consumer.

## Provide a service

Create `greeter.ts` in `tmp/cordis-tutorial`:

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService
  }
}

export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')
  }

  greet(who: string) {
    return `Hello, ${who}!`
  }
}

export const name = 'greeter'

export function apply(ctx: Context) {
  ctx.plugin(GreeterService)
}
```

Two pieces work together:

- **Runtime**: `super(ctx, 'greeter')` registers the instance under the name `greeter`. From then on, any plugin can reach it as `ctx.greeter`. The registration is an effect — unloading the provider removes the service.
- **Compile time**: the `declare module '@deepseek-ai/cordis'` block is TypeScript declaration merging. It adds `greeter` to the `Context` interface so `ctx.greeter` typechecks everywhere. It generates no code; without it the service still works at runtime, but consumers lose type safety.

A `Service` subclass is itself a plugin (the class form from chapter 1), so `ctx.plugin(GreeterService)` mounts it like any other.

## Consume a service with `inject`

Create `consumer.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'consumer'
export const inject = ['greeter']

export function apply(ctx: Context) {
  console.log(ctx.greeter.greet('world'))
}
```

`inject` lists the services this plugin requires. Cordis holds the plugin in PENDING until every listed service exists, so inside `apply`, `ctx.greeter` is guaranteed ready. Load order in `cordis.yml` does not matter — dependencies, not file order, decide when plugins start.

Compose and run:

```yaml
- name: './greeter.ts'
- name: './consumer.ts'
```

```
Hello, world!
```

Swap the two lines in `cordis.yml` and rerun: same output. Try removing `./greeter.ts` entirely: the consumer stays PENDING and prints nothing — no crash, no partial run. A PENDING fiber does not keep Node's event loop alive either, so a composition with nothing else running exits 0 silently. [Chapter 6](06-composition-and-hmr.md) shows how to diagnose that state.

## Dependencies are tracked after load

`inject` is not a one-shot boot check. If a required service disappears while the app runs — its provider was unloaded or hot-replaced — every dependent plugin is unloaded too, and loads again when the service returns. Combined with effects ([chapter 2](02-lifecycle-and-effects.md)), this prevents a running consumer from retaining a reference to an unavailable service: its own registrations are unwound when the dependency disappears.

This is also why service replacement works in config: unload the `dsh-bash-local` entry, mount a different `shell` provider, and every plugin injecting `'shell'` cleanly restarts against the new implementation.

## Optional dependencies

`inject` is for hard requirements. For a capability the plugin can live without, skip `inject` and probe at the use site:

```ts ignore-check
export function apply(ctx: Context) {
  // undefined when no provider is loaded; the plugin still runs.
  const greeter = ctx.get('greeter')
  console.log(greeter?.greet('maybe') ?? 'no greeter available')
}
```

## Naming

Service names live in one flat namespace per application. Prefix or namespace your own services distinctively (the harness claims plain names like `tools` and `llm`); the generated `cordis-surface` regions on the [subsystem pages](../subsystems/core.md) list every name the harness registers.

Next: [Events](04-events.md) — communication without a shared service.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
