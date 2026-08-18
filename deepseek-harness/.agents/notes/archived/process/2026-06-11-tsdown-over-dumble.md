# Agent Note: tsdown for JS bundling instead of dumble

Status: implemented
Archived: 2026-07-27

English | [中文](2026-06-11-tsdown-over-dumble.zh.md)

## Problem

The initial build used **dumble**, the cordiverse zero-config esbuild wrapper that upstream Cordis itself builds with — maximum alignment with the vendored packages' conventions (it reads each package.json and infers entries/formats from the `exports` field). But dumble is a liability as a load-bearing tool in this repo: v0.2.x, ~530 npm downloads/week, effectively one maintainer, and we were invoking it through a custom orchestration script (`scripts/build.ts`) because it has no workspace mode.

Build output currently matters only for `pnpm run build` + publint (nothing publishes yet; dev/test/demo run unbuilt via tsx), so the switching cost is at its lowest now and only grows once packages publish.

## Decision

Replace dumble with **tsdown** (rolldown-based, ~2.5M downloads/week, VoidZero-backed, actively released):

- Root `tsdown.config.ts` with `workspace: ['vendor/*', 'packages/*/*']` (explicit globs keep bundling to vendored Cordis and the TypeScript package tree; `workspace: true` would also discover example manifests and non-bundled workspace members).
- Shared shape: entry `lib/types/index.js`, `outDir: 'lib'`, ESM, `platform: node`, `target: es2024`, `fixedExtension: false` (keeps `.js` for `"type": "module"` packages), `dts: false` (tsc -b owns declarations), `clean: false` (lib/ also holds TSC's `lib/types` intermediate tree). The entry was originally `src/index.ts`; the [TSC-first build Agent Note](2026-06-17-ts-build-config.md) later moved tsdown to bundling TSC-emitted JS so TypeScript transform behavior comes from one compiler.
- Two per-package overrides in vendor/ (ours, like the regenerated tsconfigs; logged in vendor/README.md): schemastery (dual `.mjs`/`.cjs` via `outExtensions`), logger-console (two single-entry passes so the shared base class is inlined into each entry instead of a hash-named chunk, matching upstream's published shape).
- `scripts/build.ts` deleted; `pnpm run build` = `tsc -b && tsdown` (the root solution owns the emit graph).

## Alternatives considered

- **A direct esbuild script** — the most established engine and zero wrapper risk, but hand-maintains the per-package spec table tsdown's workspace mode gives us.
- **pkgroll** — the closest drop-in philosophically, but 78k downloads/week and Rollup-based: strictly weaker maintenance story than tsdown.
- **Keep dumble** — perfect upstream alignment, unacceptable bus factor.

## Consequences

Runtime bundle outputs still follow the dumble-era public entry shape (`lib/index.js`, plus package-specific variants such as `schemastery`'s `lib/index.mjs`/`lib/index.cjs` and `logger-console`'s `lib/browser.js`); declarations now live under `lib/types` per the [TSC-first build Agent Note](2026-06-17-ts-build-config.md). Externals still come from each package's dependencies/peerDependencies. We give up dumble's exports-field inference — new packages with non-default shapes need a per-package `tsdown.config.ts` instead of just package.json fields. Future option: tsdown could also absorb declaration bundling (isolatedDeclarations) if `tsc -b` ever becomes the bottleneck; that would be a new Agent Note.
