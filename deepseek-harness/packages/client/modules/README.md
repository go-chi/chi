# @deepseek-ai/dsh-client-modules

English | [中文](README.zh.md)

Client module system: the browser peer of Node's internal ESM loader, built as a lazy CJS table. The web shell mounts the vendored cordis Loader for entry governance (fiber lifecycle, inject waiting, update/refresh) and injects this package's `ClientModuleLoader` through its `internal` contract — the vendored side's only consumption point is `EntryTree.import`, so replacing `internal` replaces exactly "how plugin code arrives" and nothing else.

Lazy CJS model (web2): executing a plugin bundle only REGISTERS its factory (`window.__ModuleLoader__.load({id, factory})`); every module body side effect — CSS injection included — lives in the factory closure and runs at materialization (`factory(require)` → exports, memoized in `loadCache`), not at script execution. A factory that requires another registered-but-unmaterialized module materializes it recursively, so load order needs no external sequencing; require cycles throw (factory-form CJS cannot deliver partial exports). `<id>/client` and the bare id resolve to the same exports (a plugin bundle IS its package's client half).

Resolution branch order (`import(specifier)`): platform seed word → shell instance; memoized record → surface; shell-own static registry (`registerStatic`, app-shell) → module; registered factory → materialize; graph row (`window.__DSH_BOOT__`) → load its external classic script + materialize; anything else throws — the runtime mirror of the build-time bundle purity gate. The synchronous `require` handed to factories walks the same order minus the asynchronous load branch and records observed edges into the module record. `prefetch` is the stage-one arrival hook (script load and factory registration only; concurrent calls share one in-flight task); `invalidate` drops the factory and materialized record so the next prefetch/import reloads the script (the HMR hook).

The Node half scans enabled Loader entries for web `dsh.client` packages, resolves each `exports["./client"]`, hashes the built bundle into the boot graph, and serves it with its source map under `/plugins`. Source launch maps host imports to TypeScript source but still consumes this built client export; missing files share one build instruction followed by a package/path list, while unrelated filesystem errors remain separate failures.

## Model Experience

None, as the module loader is browser-side kernel machinery; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Flat module graph by design** — every bundle is one module node whose edges point only at table leaves; the interface (`loadCache`/`edges`/`invalidate`) already supports a general module graph, so the externalization granularity can change without an interface change.
- **No unload bookkeeping of its own** — style removal and fiber teardown ordering live with the HMR driver (`@deepseek-ai/dsh-client-hmr`); the loader only inventories owned style tag ids per record.
