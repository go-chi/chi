# Cookbook: 新增设置卡片

[English](adding-a-settings-card.md) | 中文

插件如何把自己的配置放上 Web 设置页。这条路径上没有任何一步需要改动本仓库：Host 服务每一个已注册的 settings 命名空间，而**插件配置**分区以卡片所编辑的命名空间为键，因此同时注册了两个半侧的插件会被自动配对。

两个半侧住在同一个包里——Host 半侧在 `src/`，浏览器半侧在 `src/client/`，以 `./client` 导出并用 `dsh.client` 声明。[`packages/client/ui-theme`](../../packages/client/ui-theme) 是这种打包方式的现成例子；本分区自带的卡片在 [`packages/client/ui-settings-plugins`](../../packages/client/ui-settings-plugins)。

## 1. 注册命名空间（Host 半侧）

命名空间就是配对用的键，所以只挑一次，并在两个半侧都写出它。已经有 `cordis.yml` entry 的消费方应通过 `installSettingsSection` 注册——它把 entry 层叠在用户文档之下，并在没有挂载 settings provider 时照常工作：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

declare function assertReachable(endpoint: string | undefined): void
declare function rebuildFromSettings(config: Config): void

export const MY_PLUGIN_NS = settingsNamespace('my-plugin')

export interface Config {
  endpoint?: string
  retries?: number
}

export const Config: z<Config> = z.object({
  endpoint: z.string(),
  retries: z.number().step(1).min(0).default(3),
})

export function apply(ctx: Context, config: Config) {
  let source = () => config
  installSettingsSection(ctx, MY_PLUGIN_NS, Config, config, {
    // Constraints the schema cannot express refuse the write, not the next use.
    validate: value => void assertReachable(value.endpoint),
    setSource: (current) => { source = current },
    onChange: () => { rebuildFromSettings(source()) },
  })
}
```

字段上的 `role('secret')` 让它的值不出现在任何响应里；卡片把这类字段写进 `update`/`mutate` 载荷，或改为经 `credentials` 领域寻址一个凭据引用。`applies: 'restart'` 告诉配置表层：拥有方要到下次启动才会对变更生效。

## 2. 注册卡片（浏览器半侧）

卡片以自己的命名空间为键注册进 `settings.plugin.item`，并拥有其中的一切——外观、控件与文案。它通过 `ctx.settingsScope` 读写，后者用读取时的 revision 为每次写入设栅：

```ts ignore-check
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the keyed slot's declaration. Cross-plugin collaboration goes
// through cordis services; a value import fails the client bundle-purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const card = new MyPluginCardController(ctx.settingsScope.bind({ namespace: 'my-plugin' }))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'my-plugin',
    locale: 'settings.myPlugin',
    inject: () => card.inject(),
  }, MyPluginCard),
  )
}
```

scope 快照携带表单所需的一切：解析后的 `value`、组装层 `base`，以及原始的 `user` 层——字段是否被覆盖，取决于它在 `user` 层中是否**出现**，而非它的值。`scope.set(field, value)` 存一个字段，`scope.unset(field)` 把它清回组装层。

## 3. 标签页拿它做什么

**插件配置**标签页读取 Host 服务了哪些命名空间，并为每个命名空间派发一个 slot 键。当 Host 服务了某卡片的键时它被渲染，否则被跳过，因此从未组装过 Host 半侧的部署不会留下这张卡片的任何痕迹。被服务却无人认领的命名空间什么都不渲染——归其他页面所有的那些命名空间（`ui-theme`、`permission`、`llm-*`）正是这样留在本标签页之外的。

卡片按其注册进该 slot 的顺序出现；keyed entry 不声明自己的 `order`。

## 打包

浏览器半侧由[客户端模块系统](../../packages/client/modules)提供给页面：它扫描已启用的 Loader entries 中声明了 `dsh.client` 的包，并提供每个包构建出的 `./client` 导出。因此只要 `cordis.yml` 挂载了该插件，它就会出现在页面上——无需重新构建 Web 应用。

```jsonc
{
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings-plugins"] } }
}
```

bundle 必须是 loader 的 lazy-CJS factory 产物。在本仓库内，`tsdown.config.ts` 就是基于共享预设的三行：

```ts ignore-check
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-my-plugin', ['lib/types/index.js', 'lib/types/invariant.js'])
```

该预设目前未发布，因此本仓库之外的包得自行复刻同样的输出格式。bundle 纯净度门禁同时拒绝跨插件的值导入，所以卡片无法导入本分区的卡片外观或其暂存表单模型——它渲染自己的那一份，并自行拥有暂存与 revision 设栅。这两条限制都记在[本分区的已知限制](../../packages/client/ui-settings-plugins/README.md#known-limitations-and-deferred-work)里。
