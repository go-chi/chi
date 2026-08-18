# @deepseek-ai/dsh-typert-loader

English | [中文](README.zh.md)

Node-only Loader integration for generated Typert artifacts. The plugin requires `ctx.loader` and `ctx.typert`; it does not provide the registry itself.

During activation it scans existing Loader entries. It then follows Cordis `internal/plugin` lifecycle notifications, resolves each entry package's `package.json`, imports `./typert` when exported, validates its `TYPERT` manifest, and registers the contribution until the entry or this plugin unmounts. An import that settles after either owner is gone is discarded.

`packages` lists additional package artifacts to register for plugins nested behind another Loader entry. Cordis fibers do not retain those nested plugins' npm specifiers, so this boundary is explicit; every configured package must resolve from the config tree and export `./typert`.

Packages without the export are skipped. Package resolution and imported manifests are cached for the process lifetime, so adding an export requires a restart. A malformed artifact fails activation when already mounted; a later failure is logged without preventing unrelated packages from registering.

## Model Experience

None, as the loader only feeds [`ctx.typert`](../registry/README.md); consumers own any model-visible projection.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

- Discovery imports only the host face; client runtimes need a separate composition owner before equivalent discovery is added.
- Loader entries are discovered automatically. Nested or non-Loader plugins require an explicit `packages` entry or direct `ctx.typert.register()` ownership.
