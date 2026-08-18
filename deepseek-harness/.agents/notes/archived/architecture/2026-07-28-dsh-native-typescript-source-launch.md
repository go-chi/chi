# Agent Note: Native TypeScript source launch for dsh

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-28-dsh-native-typescript-source-launch.zh.md)

> The Node-native launch vector is superseded by [dsh source launch through the tsx ESM hook](2026-07-29-dsh-source-launch-tsx-esm.md): Node 26.0.0 removed `--experimental-transform-types`, and the paths loader described here is deleted. The Cordis-config declaration gate (`verify-cordis-config`), the app-boot fail-loud plugin diagnostic, and the vendored `import type` marks remain current.

## Problem

The `dsh` source entry point originally used `tsx` to run `apps/cli/src/bin.ts`, with the same third-party loader implicitly handling both TypeScript transformation and the root tsconfig's `paths` resolution. With Node handling TypeScript natively, it does not apply tsconfig path mappings; resolving through package exports would instead mix potentially stale or nonexistent `lib/` artifacts into the source launch.

Node's transform also does not perform type analysis. A type imported through an ordinary value import remains a runtime ESM request, and TypeScript's `export =` becomes a CommonJS assignment rather than an ESM default export. The source graph therefore has to use explicit type-only imports and native ESM exports; a resolve hook cannot repair incompatible source syntax.

Cordis configuration introduces a separate resolution boundary. Bare plugins in `cordis.yml` do not pass through TypeScript import analysis, so their resolver manifest may omit the required dependencies. The Cordis Loader logs plugin import errors and leaves an entry without a fiber, but does not fail startup itself; a typo in the configuration can therefore produce an incomplete application with exit code 0.

## Decision

The `dsh` TUI, Web, and headless source launches use `node --experimental-transform-types`; Node performs TypeScript transformation without loading `tsx` or esbuild. `bin/dsh`, the root-level `dsh`/TUI/Web demos, and Code Mode TUI enter the same `apps/cli/src/bin.ts` launch chain. Test and E2E launchers retain their existing strategies, and the built `lib/bin.js` continues to run under ordinary Node.

`scripts/tspath-loader.ts` registers only a module resolve hook. It uses `TSX_TSCONFIG_PATH` when set (resolving relative values from the invoking cwd) and otherwise reads the root `tsconfig.json`; `TsconfigPathsResolver` follows that config's `extends` chain through the repository's existing TypeScript development tool, selects exact or wildcard `paths` entries according to tsconfig rules, and maps matching workspace bare specifiers to `.ts`/`.mts`/`.cts` source files or directory index files. Node remains solely responsible for code transformation. The source-only loader is not part of the built CLI and `apps/cli` does not declare `typescript` as a runtime dependency.

Source imports are redirected only when the target package is either the nearest package manifest's own name or one of that manifest's declared runtime dependencies. The Cordis Loader uses the configuration directory URL as the import parent; the resolver then searches upward for the workspace manifest that declares the plugin, so dependency ownership for the shipped `apps/cli/config/base.cordis.yml` plus its surface overlay lies with `apps/cli/package.json`. Specifiers that do not match tsconfig paths, refer to undeclared dependencies, or are not bare all fall back to Node's default resolution.

`verify-cordis-config` performs a one-way completeness check on the resolver manifest: every bare plugin package in a configuration must appear in the corresponding manifest's `dependencies`, while the manifest may contain extra dependencies not referenced by that configuration. The root `AGENTS.md` makes updating the configuration and dependencies together a standing rule.

After the Loader settles, the shared `dsh-app-boot` checks every enabled entry that has no fiber and rejects startup with `plugin(s) failed to load: ...; Cordis startup failed because these plugin(s) could not be resolved`, listing all failed plugins. This diagnostic lives at the app layer and does not change the vendored Loader's startup behavior.

Node-compatible TypeScript is part of this source-launch contract. Vendored Cordis, Loader, Include, HMR, and Schemastery mark erased imports with `import type`. Schemastery uses a native ESM default export and declares `type: module`; its `.mjs` and `.cjs` build outputs retain the existing ESM-default and callable-`require()` behavior. These divergences are recorded in `vendor/README.md`; no runtime behavior is added to the vendored frameworks.

## Alternatives considered

**Continue using `tsx`.** Rejected because `tsx`/esbuild would continue to own TypeScript transformation, so this launch chain could not prove that Node's native transformation works.

**Load the built `lib/` through package exports from the source entry point.** Rejected because this would mix the source plane with the artifact plane; a zero-build development launch could read stale artifacts or fail outright.

**Apply the root tsconfig `paths` unconditionally.** Rejected because this would allow undeclared cross-package imports and Cordis plugins to keep resolving, hiding mismatches between the manifest and the actual runtime graph.

**Transform imports inside the custom loader.** Rejected because type-aware source rewriting would reintroduce a compiler-style transform and make the loader, rather than Node, responsible for TypeScript execution. Making the checked-in source Node-compatible keeps the launch boundary explicit.

## Consequences

- TUI/headless retain a zero-build source loop, while Web still builds its frontend artifacts before starting the CLI source entry. TypeScript syntax passes only through Node's native transform; the URL-only loader uses the checkout's root development dependencies and adds no CLI runtime dependency.
- Workspace package imports and Cordis configuration dependencies must both be declared explicitly in the resolver manifest; the static gate prevents configuration from landing before its dependencies, while extra dependencies are not errors.
- Plugin import failures no longer leave an incomplete application with exit code 0; the final error identifies both the Cordis startup failure and the specific plugin names, while the Loader's original error remains earlier in the logs.
- Vendored source in the CLI graph must remain compatible with Node's transform-types module semantics; the local-modification log makes the upstream sync obligation explicit.
- CI's `lib` mode, test/E2E launchers, and other example launchers retain their existing strategies; this native source loader covers only the `dsh` CLI application chain.
