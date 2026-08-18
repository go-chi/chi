# Agent Note: Run CI examples from built lib

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-17-run-ci-examples-from-built-lib.zh.md)

## Problem

CI boots examples and Cordis-backed test projects through `node --import tsx` and the root tsconfig `paths` map. This adds TypeScript transformation cost and changes package resolution: imports resolve to workspace source instead of following package `exports` into built `lib/`.

These runs therefore do not test the same code or resolution behavior as an installed consumer. A package can pass CI while its built export graph is incomplete or resolves differently.

## Decision

Execution has two modes. `src` is the default local-development mode and uses tsx; `lib` is the strict CI mode and starts built bins with plain Node, without tsx or tsconfig path mapping.

- CI subprocesses that boot an example or a checked-in `cordis.yml` use `lib` mode.
- TypeScript fixtures that only implement an ACP or MCP peer and do not load Cordis run directly with Node. An explicit source-path regression may remain in `src` mode.

### Resolution topology

Every test Cordis config must resolve its bare modules by walking upward from the config directory.

- `examples/` is one pnpm workspace member and provides the shared `examples/node_modules` resolution root.
- Every checked-in test Cordis config, including snapshot configs and package-owned fixtures, lives under its corresponding `examples/<agent>/` tree. A config owned by `packages/<group>/<package>/` maps to `examples/<agent>/tests/fixtures/<group>/<package>/cordis.yml`; the test driver and assertions remain package-local.
- Every package named by an example Cordis config is declared in both `examples/package.json` for `lib` resolution and the root `tsconfig.json` references for `src` mode.

### Launch policy

The shared Loader test harness selects `src` or `lib` from `DSH_EXAMPLE_MODE`. CI builds first and selects `lib`; an unset mode keeps the fast local source loop.

## Alternatives considered

- **Keep CI on tsx** — rejected because it preserves transformation overhead and source-only resolution behavior.
- **Use lib everywhere** — rejected because local development would require a build before every run. Dual mode keeps that cost out of the development loop.
- **Build a private `node_modules` tree per test** — rejected because it duplicates consumer scaffolding. The `examples/` workspace root gives every Cordis config one real and declared resolution path.

## Consequences

- CI validates built package exports without tsx changing module resolution; local development retains the no-build source loop.
- CI must build before these tests, and manual `lib` runs can observe stale local artifacts.
- Cordis config dependencies are not visible to normal TypeScript import analysis, so `examples/package.json` and the root tsconfig references must stay synchronized with the configs.
