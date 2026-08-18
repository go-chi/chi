# Plugin configuration

English | [中文](config.zh.md)

Accept configuration supplied through `cordis.yml`.

## Define the Config type

Export a `Config` type and a same-named Schemastery schema. Put defaults directly on the schema fields:

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

Add the configuration to the inserted local plugin row in `scratch-plugin/cordis.yml`:

```yaml
- insert:
    - id: hello
      name: './src/my-plugin.ts'
      config:
        greeting: 'Hi there'
        maxRetries: 5
```

When loading the plugin, Cordis uses the exported schema to validate configuration and fill defaults. Do not export a plain object as `Config`; it does not implement the Standard Schema interface required by Cordis.

## Schema validation

Use Schemastery to express stricter validation:

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

The schema runs while the plugin loads. Invalid configuration fails the load with an actionable error.

## Design principles

### Do not hardcode tunable values

Harness requires **anything that two deployments may want to set differently to be a configuration field**.

```ts
// Wrong: hardcoded timeout.
const TIMEOUT = 30000

// Correct: configurable.
export interface Config {
  timeoutMs: number  // Defaults to 30000.
}
```

The test is whether `cordis.yml` can change the value without a code edit.

### Fail loudly on invalid configuration

Express self-contained constraints in the schema so invalid configuration fails while the plugin loads. References to services or registered resources require dependency injection; the [services tutorial](../framework/service.md) introduces that contract.

## Work with HMR

A configuration edit hot-replaces the plugin: the framework unloads the old instance and loads a new one. Because registrations are effects and clean themselves up, replacement does not retain the old instance's registrations.

## Next steps

- [Package and install a plugin](./publish.md) — ship the plugin as an installable package
- [Plugins and lifecycle](../framework/) — understand the full plugin lifecycle
- [Services and dependencies](../framework/service.md) — provide a service to other plugins
