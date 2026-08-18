# 插件配置

[English](config.md) | 中文

让你的插件接受用户在 `cordis.yml` 中传入的配置。

## 定义 Config 类型

在插件中导出一个 `Config` 类型和同名的 Schemastery schema；默认值直接写在 schema 中：

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'my-plugin'

export interface Config {
  greeting: string
  maxRetries: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  console.log(config.greeting)  // User value or schema default.
}
```

在 `scratch-plugin/cordis.yml` 新插入的本地插件行中添加配置：

```yaml
- insert:
    - id: hello
      name: './src/my-plugin.ts'
      config:
        greeting: 'Hi there'
        maxRetries: 5
```

插件加载时，Cordis 会通过导出的 schema 校验配置，并填充未提供字段的默认值。不要导出普通对象作为 `Config`，因为它不满足 Cordis 要求的 Standard Schema 接口。

## Schema 校验

对于需要严格校验的场景，使用 Schemastery 定义 schema：

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'validated-plugin'

export interface Config {
  apiKey: string
  timeout: number
  mode: 'fast' | 'accurate'
}

export const Config = Schema.object({
  apiKey: Schema.string().required(),
  timeout: Schema.number().default(30000),
  mode: Schema.union(['fast', 'accurate']).default('fast'),
})

export function apply(ctx: Context, config: Config) {
  // config is validated and type-safe.
}
```

Schema 在插件加载时执行校验。如果配置不合法，插件会加载失败并给出明确错误信息。

## 设计原则

### 无硬编码可调参数

Harness 的约定：**凡是不同部署可能需要采用不同值的参数，都必须定义为配置字段**。

```ts
// Wrong: hardcoded timeout.
const TIMEOUT = 30000

// Correct: configurable.
export interface Config {
  timeoutMs: number  // Defaults to 30000.
}
```

检验标准：能否在 `cordis.yml` 中改变这个值，而不需要修改代码？

### 配置错误要响亮

在 schema 中表达自身完备的约束，使无效配置在插件加载时失败。对服务或已注册资源的引用需要依赖注入；[服务教程](../framework/service.md) 会介绍这项约定。

## 配合 HMR

配置变更会触发插件热替换：修改 `cordis.yml` 中某个插件的 `config` 后，框架会卸载旧实例并加载新实例。由于注册都属于 effect 并会自动清理，替换后不会保留旧实例的注册。

## 下一步

- [打包与安装插件](./publish.md) — 把插件以可安装包的形式交付
- [插件与生命周期](../framework/) — 深入了解插件的完整生命周期
- [服务与依赖](../framework/service.md) — 让你的插件对外提供服务
