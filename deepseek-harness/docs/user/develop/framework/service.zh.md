# 服务与依赖

[English](service.md) | 中文

服务是一个插件向其他插件公开的能力。inject 声明插件需要哪些服务。

## 什么是服务

在 Harness 中，`tools`、`llm`、`agents` 都是服务。服务是挂载在 `ctx` 上的命名能力：

```ts ignore-check
ctx.tools    // ToolRuntime service
ctx.llm      // LLM service
ctx.agents   // Agent service
```

任何插件都可以提供服务，供其他插件使用。

## 使用服务

声明 `inject` 来使用已有服务：

```ts ignore-check
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools exists and is ready here.
  ctx.tools.register(/* ... */)
}
```

框架保证：在 `apply` 执行时，`inject` 声明的服务已经全部就绪。如果服务还没准备好，你的插件会等着，不会执行。

## 提供服务

### 使用 Service 基类

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

加载这个插件后，消费方就可以通过 `ctx.metrics` 访问它：

```ts ignore-check
export const inject = ['metrics']

export function apply(ctx: Context) {
  ctx.metrics.record('tool_call', 1)
}
```

### 类型声明

使用 TypeScript 声明合并让 `ctx.metrics` 有正确类型：

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

## 依赖的行为

### 必需依赖与可选依赖

```ts ignore-check
// Required: the plugin does not load while the service is absent.
export const inject = ['tools']

// Optional: omit inject and query with ctx.get() at the use site.
export function apply(ctx: Context) {
  const metrics = ctx.get('metrics')
  metrics?.record('plugin_loaded', 1)
}
```

### 服务消失时的行为

如果应用运行期间某项必需服务消失（例如其提供方卸载）：

1. 依赖它的插件会自动 dispose（资源释放）
2. 当服务重新出现时，插件自动重新加载

这可以防止插件调用已不存在的服务。

<a id="service-isolation"></a>

## 服务隔离

`cordis.yml` 支持服务隔离——同一个服务可以有多个实例，不同插件组看到不同实例：

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

`plugin-a` 和 `plugin-b` 各自看到自己组内的 Bash 实例，互不影响。

## Harness 内置服务

服务名、公开方法和源码位置由仓库自动生成到各服务的[子系统页面](../../../subsystems/core.md)。开发插件时应以这些生成区块和服务的 TypeScript 接口为准，不要维护另一份静态清单。

## 下一步

- [事件系统](./events.md) — 插件间松耦合通信
- [能力分层](../practice/) — 将服务用作能力接口
