# 5. Configuration

English | [中文](05-config.zh.md)

Each `cordis.yml` entry can carry a `config` block, and the plugin declares a schema that validates it before `apply` runs. Bad config fails the load with a precise error — the plugin never starts half-configured.

## A configurable plugin

Create `config-demo.ts` in `tmp/cordis-tutorial`:

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'config-demo'

export interface Config {
  greeting: string
  targets: string[]
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

export function apply(ctx: Context, config: Config) {
  for (const target of config.targets) {
    console.log(`${config.greeting}, ${target}!`)
  }
}
```

The exported `Config` is both a TypeScript interface and a runtime schema with the same name — consumers get the type, Cordis gets the validator. This repo uses [Schemastery](https://github.com/shigma/schemastery) for schemas; Cordis itself accepts any [Standard Schema](https://standardschema.dev/) validator, so a plain object exported as `Config` will not work.

Configure it:

```yaml
- name: './config-demo.ts'
  config:
    targets: ['alpha', 'beta']
```

Run:

```
Hello, alpha!
Hello, beta!
```

`greeting` was omitted, so the schema default filled it in — `apply` always receives complete, validated config.

## Fail loud

Now feed it something invalid:

```yaml
- name: './config-demo.ts'
  config:
    targets: 'not-an-array'
```

```
ValidationError: invalid config:
  - $.targets expected array but got not-an-array (at targets)
```

The plugin's fiber goes to FAILED, and this tutorial's launcher exits with status 1 after printing the error. A plugin should also reject schema-valid config that names an unavailable resource or provider as soon as it can resolve that reference.

## Computed config values

The loader used in this repo supports a `!!js` tag for config values that must be computed at load time:

```yaml
- name: './config-demo.ts'
  config:
    greeting: !!js process.env.DEMO_GREETING ?? 'Hello'
```

`!!js` works only inside `config` and in an entry's `disabled` field. `disabled: !!js ...` evaluates against the loader context at every mount decision (this repo's extension), so a row can gate itself on platform or environment; the other metadata (`name`, `id`, `inject`, ...) stays static, where an expression is ordinary truthy data. See [loader configuration](../cordis-primer.md#loader-configuration).

Next: [Composition and HMR](06-composition-and-hmr.md) — treating `cordis.yml` as the application.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
