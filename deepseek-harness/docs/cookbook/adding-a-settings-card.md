# Cookbook: adding a settings card

English | [中文](adding-a-settings-card.zh.md)

How a plugin puts its own configuration on the web settings page. Nothing in this path needs a change inside this repository: the Host serves every registered settings namespace, and the **Plugins** section keys its cards on the namespace they edit, so a plugin that registers both halves is paired up automatically.

The two halves live in one package — the Host half under `src/`, the browser half under `src/client/`, exported as `./client` and declared with `dsh.client`. [`packages/client/ui-theme`](../../packages/client/ui-theme) is a worked example of that packaging; the cards this section ships live in [`packages/client/ui-settings-plugins`](../../packages/client/ui-settings-plugins).

## 1. Register the namespace (Host half)

The namespace is the join key, so pick it once and spell it in both halves. A consumer that already has a `cordis.yml` entry should register through `installSettingsSection`, which layers the entry under the user document and keeps working when no settings provider is mounted:

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

`role('secret')` on a field keeps its value off every response; the card writes such a field into an `update`/`mutate` payload, or addresses a credential reference through the `credentials` domain instead. `applies: 'restart'` tells a configuration surface the owner acts on a change only at the next start.

## 2. Register the card (browser half)

The card registers into `settings.plugin.item` under its namespace and owns everything inside it — chrome, controls, and copy. It reads and writes through `ctx.settingsScope`, which fences each write with the revision it read:

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

The scope snapshot carries what a form needs: the resolved `value`, the composition `base`, and the raw `user` layer, whose key **presence** — not its value — is what marks a field overridden. `scope.set(field, value)` stores one field and `scope.unset(field)` clears it back to the composition layer.

## 3. What the tab does with it

The **Plugin configuration** tab reads which namespaces the Host serves and dispatches one slot key per namespace. A card is rendered when the Host serves its key and skipped when it does not, so a deployment that never composed the Host half shows no trace of the card. A served namespace no card claims renders nothing — that is how the namespaces owned by other pages (`ui-theme`, `permission`, `llm-*`) stay off this tab.

Cards appear in the order they registered into the slot; a keyed entry declares no `order` of its own.

## Packaging

The browser half is served to the page by the [client module system](../../packages/client/modules), which scans the enabled Loader entries for packages declaring `dsh.client` and serves each one's built `./client` export. So the plugin appears on the page as soon as a `cordis.yml` mounts it — no rebuild of the web application.

```jsonc
{
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings-plugins"] } }
}
```

The bundle must be the loader's lazy-CJS factory artifact. Inside this repository `tsdown.config.ts` is three lines over the shared preset:

```ts ignore-check
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-my-plugin', ['lib/types/index.js', 'lib/types/invariant.js'])
```

That preset is not published today, so a package outside this repository has to reproduce the same output format itself. The bundle-purity gate also rejects value imports across plugins, so a card cannot import this section's card chrome or its staged-form model — it renders its own, and owns its own staging and revision fencing. Both limits are recorded under [the section's known limitations](../../packages/client/ui-settings-plugins/README.md#known-limitations-and-deferred-work).
