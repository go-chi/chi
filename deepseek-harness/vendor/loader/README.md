# @cordisjs/plugin-loader

Runtime plugin loader for Cordis. The loader owns an `EntryTree`, imports plugin
modules by name, applies their config, and keeps the running plugin graph in
sync with entry updates.

## Usage

```ts
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'

const root = new Context()
await root.plugin(Loader, { baseUrl: import.meta.url })

const id = await root.loader.create({
  name: './plugins/example',
  config: { enabled: true },
})

await root.loader.await()
root.loader.update(id, { config: { enabled: false } })
```

## Entry Options

| Field | Description |
| --- | --- |
| `id` | Stable id for resolving, updating, and removing the entry. |
| `name` | Module specifier imported by the loader. |
| `config` | Config passed to the plugin. |
| `group` | Marks the entry as a group whose `config` is a child entry list. |
| `disabled` | Stops the entry and prevents it from starting. |
| `inject` | Adds required services or intercept config for this entry. |

## API

| API | Description |
| --- | --- |
| `loader.create(options, parent?, position?)` | Add and start an entry. |
| `loader.update(id, options, parent?, position?)` | Update, move, and restart an entry. |
| `loader.remove(id)` | Stop and delete an entry. |
| `loader.resolve(id)` | Resolve an entry by id, including nested `a:b` ids. |
| `loader.resolveGroup(id)` | Resolve the root group or a nested group. |
| `loader.await()` | Wait for pending entry imports and fiber reloads. |
| `loader.locate(fiber?)` | Return the loader entry id that owns a fiber. |

For file-backed trees, use `@cordisjs/plugin-include`.
