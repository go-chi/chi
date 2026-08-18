# DeepSeek Harness Runtime Wheel

English | [中文](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk-runtime/README.zh.md)

Runtime carrier package for the Python SDK (dist `deepseek-harness-runtime-bin`, module `deepseek_harness_runtime`): it locates the bundled runtime binaries the `deepseek-harness-sdk` client spawns, and ships the default configuration behind zero-config runs.

## Runtime carriers

Two carriers coexist under `src/deepseek_harness_runtime/runtime/`, both injected by the repo's `scripts/build-exe-for-python-sdk.ts` build and both gitignored:

- **exe (production)** — a single-file Node executable `dsh-jsonrpc-agent-pkg-<platform>-<arch>` (platform: `linux`/`macos`; arch: `x64`/`arm64`). macOS builds also ship the native `-spawn-helper` sibling that `node-pty` uses there. No Node installation is needed on the target machine. This is the only carrier that ships in wheel distributions; this package does not publish sdists.
- **node (dev-only)** — the full deploy closure under `runtime/node/` (`package.json` + `node_modules/`), executed as `node runtime/node/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js` on a system Node >= 22.19. It is the current checkout's source build, meant for repo-local development and verification only; it is never selected automatically and is excluded from distributions.

Both carriers hold the same content, defined once: the [package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk-runtime/package.json) at this package's root is the deploy root of the single-exe pipeline — a pure dependency manifest (no code of its own) whose dependency closure IS both the plugin set compiled into the exe and the tree materialized into `runtime/node/`. Adding a plugin to the distribution means adding one dependency line there and rebuilding.

A missing exe raises `FileNotFoundError` naming both acquisition routes: build via `scripts/build-exe-for-python-sdk.ts` in a deepseek-harness checkout, or install the matching platform runtime wheel produced by the `build-exe-for-python-sdk` CI workflow. A missing dev-only node carrier names its sole route, the build script. The workflow retains wheels rather than standalone executable archives. Acquisition strategy is deliberately separate from the lookup interface, so an on-demand download can replace it later without touching callers.

Each wheel contains exactly one runtime executable. The macOS wheel also contains its matching native spawn helper; a missing sidecar makes that installation incomplete and is a hard startup error, even for a selected Cordis composition that does not use PTY tools. Linux wheels contain no spawn helper because `node-pty` uses the staged `pty.node` addon directly. The fixed tags are `py3-none-manylinux_2_28_x86_64`, `py3-none-manylinux_2_28_aarch64`, and `py3-none-macosx_14_0_arm64`; the macOS tag conservatively matches the bundled Node 24 executable's macOS 13.5 deployment target. This package's `platforms.json` owns the fixed tag and executable-name pairs used by both the repository release builder and the isolated build hook. The build hook rejects `py3-none-any`, absent or multiple runtime files, non-executable files, and unsupported platform tags. The repository root `package.json` supplies the shared version for this package and the SDK, and a `python-v<repository-version>` release tag must match it.

## Resolution API

- `resolve_bundled_launch_args(mode=None) -> tuple[str, ...]` — the argv tuple that launches the bundled runtime: `(exe_path,)` in exe mode, `(node_path, bin_js_path)` in node mode. Mode selection: explicit argument > `DSH_RUNTIME_MODE` env var (`exe` | `node`) > automatic. Automatic resolution finds the production exe ONLY — the dev-only node carrier must be opted into explicitly so a production deployment can never silently ride on a source build.
- `bundled_runtime_path() -> Path` — the platform exe path (exe carrier only; on macOS it validates that the required sibling `-spawn-helper` is also installed). The node carrier has no single-path equivalent and launches via the argv tuple above.
- `bundled_default_config_path() -> Path` — the checked-in default config (see below).
- `bundled_package_dir() -> Path` — the installed package data root.

## Zero-config design

The runtime binary always demands an explicit config (`$DSH_CORDIS_CONFIG`, or a config path as an argv positional argument) and exits loudly without one — that hard semantic is part of the runtime's design and this package does not soften it. The bin (`dsh-jsonrpc-agent`) boots only the plugins the config lists; the serving interface (the stdio JSON-RPC server) is itself one of its entries (`@deepseek-ai/dsh-sdk-jsonrpc-server`), and without it the booted agent has no channel to the outside. This package checks in `runtime/cordis.yml` with the JSON-RPC serving entry, agent core, a preloaded DeepSeek adapter, JSONL persistence, the explicitly composed semantic checkpoint policy, local bash, and a local filesystem provider for bounded workspace-instruction loading. The persistence backend owns durable storage while the separate policy selects request-, tool-dispatch-, and completed-step checkpoints. The adapter reads `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL`, while persistence, bash, and the filesystem provider use `DSH_SESSION_ROOT` and `DSH_CWD` with manual-run fallbacks. When the caller uses no explicit config channel, the `deepseek_harness` client injects that file's path via `DSH_CORDIS_CONFIG` (injection conditions: [sdk README](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.md)). Zero-config is thus an explicit, visible parameter pass in the wrapper, not a hidden fallback in the runtime.
