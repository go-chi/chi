# `@deepseek-ai/dsh-loader-smoke`

English | [中文](README.zh.md)

Shared subprocess harness for tests that boot an app and `cordis.yml` through the Cordis Loader. `resolveExampleLaunch` selects local `src` mode (tsx and root tsconfig paths) or CI `lib` mode (plain Node and package exports) from an explicit mode or `DSH_EXAMPLE_MODE`.

`runLoaderSmoke` accepts bin and config paths, optional complete bin arguments, environment overrides, stdin, pre-run setup, and pre-cleanup inspection. It owns the isolated cwd, DSH homes, diagnostics, deadline, termination, EOF, and cleanup; it returns both streams after a zero exit and rejects with both streams on failure.

`runFixtureTurn` drives one task through exactly one configured root agent, forwards canonical events after that task reaches the durable inbox, flushes the session, and returns the final assistant text plus accumulated usage. Example-local drivers retain configuration, rendering, and assertion ownership.

This is support-tier test infrastructure, not product API.

## Model Experience

None, as the test harness submits only the consuming test's ordinary user task and delegates prompt and tool composition to the loaded tree.

#### KV Cache effect

None beyond the loaded tree; the helper neither changes the request prefix nor retains state across runs.

## Known Limitations and Deferred Work

- **Built mode requires a prior build** — the config must also resolve every named package upward through `examples/node_modules`.
- **Captured stdout and stderr are bounded only by execa's default 100 MB `maxBuffer`** — a runaway child is terminated at that ceiling rather than at a smoke-chosen budget.
- **Timeout kills only the direct child** — a process tree spawned by a faulty fixture can outlive the smoke and needs external cleanup.
