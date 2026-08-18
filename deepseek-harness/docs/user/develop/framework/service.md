# Services and dependencies

English | [中文](service.zh.md)

A service is a capability one plugin exposes to other plugins. `inject` declares the services a plugin requires.

## What is a service?

In Harness, `tools`, `llm`, and `agents` are services. Each is a named capability mounted on `ctx`:

```ts ignore-check
ctx.tools    // ToolRuntime service
ctx.llm      // LLM service
ctx.agents   // Agent service
```

Any plugin can provide a service for other plugins to consume.

## Consume a service

Declare `inject` to use an existing service:

```ts ignore-check
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools exists and is ready here.
  ctx.tools.register(/* ... */)
}
```

When `apply` runs, every service declared by `inject` is ready. If a service is not ready, the plugin waits instead of running.

## Provide a service

### Extend Service

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MetricsService extends Service {
  static inject = ['llm']  // A service may depend on other services.

  constructor(ctx: Context) {
    super(ctx, 'metrics')  // 'metrics' is the service name.
  }

  // Public service method.
  record(event: string, value: number) {
    // ...
  }
}
```

After loading this plugin, consumers access the service as `ctx.metrics`:

```ts ignore-check
export const inject = ['metrics']

export function apply(ctx: Context) {
  ctx.metrics.record('tool_call', 1)
}
```

### Declare its type

Use TypeScript declaration merging to type `ctx.metrics`:

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number) { /* ... */ }
}
```

## Dependency behavior

### Required and optional dependencies

```ts ignore-check
// Required: the plugin does not load while the service is absent.
export const inject = ['tools']

// Optional: omit inject and query with ctx.get() at the use site.
export function apply(ctx: Context) {
  const metrics = ctx.get('metrics')
  metrics?.record('plugin_loaded', 1)
}
```

### When a service disappears

If a required service disappears while the application is running, for example because its provider unloads:

1. Dependent plugins dispose automatically.
2. They load again when the service returns.

This prevents a plugin from calling a service that no longer exists.

## Service isolation

`cordis.yml` can isolate services so separate plugin groups see separate instances of the same service:

```yaml
- id: group-a
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 5000
    - name: './src/plugin-a.ts'

- id: group-b
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 60000
    - name: './src/plugin-b.ts'
```

`plugin-a` and `plugin-b` each see the Bash instance in their own group, with no cross-group effect.

## Built-in Harness services

The repository generates the service names, public methods, and source locations into each service's [subsystem page](../../../subsystems/core.md). Use those generated regions and the service's TypeScript interface while developing a plugin; do not maintain a second static list.

## Next steps

- [Event system](./events.md) — communicate between plugins without tight coupling
- [Capability layering](../practice/) — use services as capability interfaces
