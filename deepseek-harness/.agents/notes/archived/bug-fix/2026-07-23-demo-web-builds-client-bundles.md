# Agent Note: demo:web builds the client plugin bundles

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-23-demo-web-builds-client-bundles.zh.md)

## Problem

`dsh web` serves each web-client plugin's bundle from `GET /plugins/<id>/client.js`, resolving the path from the package's `exports["./client"]` (`lib/client.js`). Those bundles are produced only by the root `pnpm run build` (`tsc -b` then the per-package `tsdown.client.ts` configs); the Vite `build:web` step builds the frontend shell alone. `demo:web` and the README's Web UI instructions ran only `build:web`, so on a checkout without a prior full build every plugin bundle 404s, the client loader marks every plugin failed, and the boot screen shows "Failed to load plugins". The frontend shell built fine, hiding the missing artifact behind a runtime browser failure.

## Decision

`demo:web` runs `npm run build` before `npm run build:web`, so the plugin `lib/client.js` bundles exist before `dsh web` serves them. The README's Web UI section runs `pnpm run build && pnpm run build:web` for the installed `~/.dsh/source` checkout, which the installer never builds.

## Verification

After the full build, all eight `/plugins/<id>/client.js` endpoints return 200 and a headless Chromium load of `http://127.0.0.1:3080` renders the shell with no "Failed to load plugins" state.

## Alternatives considered

**Build the bundles inside `dsh web` at startup.** The app runs from source via tsx and owns no build step; folding an artifact build into the server boot crosses the source/artifact separation and slows every launch.

**Widen the tsdown root config to emit client bundles from `pnpm run build:web`.** `build:web` is the Vite frontend build; the client bundles are a separate tsdown pass over `lib/types`. Merging the two conflates the shell build with the package build and still leaves the root `build` as the only producer.

## Consequences

`demo:web` now pays the full `tsc -b && tsdown` cost on every invocation instead of only the Vite build. That is the price of a runnable web demo from a clean tree; a caller who already built can invoke `dsh web` directly.
