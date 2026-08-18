# 3. 服务

[English](03-services.md) | 中文

**服务**是一个插件提供、其他插件通过 `ctx` 消费的具名能力。在 harness 中，`ctx.tools`、`ctx.llm` 和 `ctx.agents` 都是服务。消费方只指定 `'tools'` 之类的能力，而不导入其提供方，因此配置可以选择提供方，无需修改消费方。

## 提供服务

创建 `greeter.ts`，将它放在 `tmp/cordis-tutorial` 中：

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

两部分协同工作：

- **运行时**：`super(ctx, 'greeter')` 以名称 `greeter` 注册该实例。此后，任何插件都可以通过 `ctx.greeter` 访问它。注册属于 effect，卸载提供方时会移除该服务。
- **编译时**：`declare module '@deepseek-ai/cordis'` 块使用 TypeScript 声明合并，把 `greeter` 加入 `Context` 接口，使 `ctx.greeter` 在各处都能通过类型检查。它不会生成代码；没有该声明时，服务在运行时仍能工作，但消费方会失去类型安全。

`Service` 子类本身就是插件（第 1 章介绍的类形态），因此 `ctx.plugin(GreeterService)` 会像挂载其他插件一样挂载它。

## 使用 `inject` 消费服务

创建 `consumer.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'consumer'
export const inject = ['greeter']

export function apply(ctx: Context) {
  console.log(ctx.greeter.greet('world'))
}
```

`inject` 列出该插件需要的服务。Cordis 会让插件保持 PENDING，直到列出的每项服务都存在，因此在 `apply` 内可以保证 `ctx.greeter` 已经就绪。`cordis.yml` 中的加载顺序无关紧要：决定插件何时启动的是依赖关系，而不是文件顺序。

组合并运行：

```yaml
- name: './greeter.ts'
- name: './consumer.ts'
```

```
Hello, world!
```

交换 `cordis.yml` 中两行的顺序后重新运行，输出仍然相同。尝试彻底移除 `./greeter.ts`：消费方会保持 PENDING，不输出任何内容，既不崩溃，也不会只运行一部分。处于 PENDING 的 fiber 也不会让 Node 的事件循环保持活跃，因此如果组合中没有其他运行项，进程会静默地以状态码 0 退出。[第 6 章](06-composition-and-hmr.md)介绍如何诊断这种状态。

## 加载后仍会跟踪依赖关系

`inject` 并非一次性的启动检查。如果应用运行期间所需服务消失，例如提供方被卸载或热替换，每个依赖插件也会随之卸载，并在服务恢复后再次加载。结合 effect（[第 2 章](02-lifecycle-and-effects.md)），这能防止运行中的消费方保留对不可用服务的引用：依赖消失时，它自己的注册也会撤销。

这也是配置中可以替换服务的原因：卸载 Cordis 配置项 `dsh-bash-local`，挂载另一个 `shell` 提供方，所有注入 `'shell'` 的插件都会重新启动并使用新实现。

## 可选依赖

`inject` 用于硬性依赖。如果某项功能缺失时插件仍可运行，请跳过 `inject`，并在使用处探测：

```ts ignore-check
export function apply(ctx: Context) {
  // undefined when no provider is loaded; the plugin still runs.
  const greeter = ctx.get('greeter')
  console.log(greeter?.greet('maybe') ?? 'no greeter available')
}
```

## 命名

每个应用中的服务名称共用一个扁平命名空间。请为自有服务添加有辨识度的前缀或命名空间（harness 已占用 `tools` 和 `llm` 等普通名称）；[子系统页面](../subsystems/core.md)上生成的 `cordis-surface` 区块列出 harness 注册的每个名称。

下一章：[事件](04-events.md)：无需共享服务即可通信。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
