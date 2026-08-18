# Agent Note: dsh tells the agent where its own source lives

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-21-dsh-system-prompt-source-path.zh.md)

## Problem

The `dsh` CLI is the self-referential surface: its `cordis` toolset lets the agent inspect and modify the very harness runtime it runs in. But the agent had no way to learn where that source lives on disk. `dsh` is normally symlinked onto PATH and launched from an arbitrary working directory — the project under work — so neither the cwd nor `argv` reliably points at the harness checkout. Without the path, "read your own source" is guesswork.

## Decision

The `dsh` launcher (`apps/cli/src/tui.ts`) computes the harness checkout root from its own module URL — `fileURLToPath(new URL('../../..', import.meta.url))`, three hops up from `apps/cli/{src,lib}` — so it resolves to the real source location however `dsh` is launched (a PATH symlink, an arbitrary cwd). After `boot()` settles the tree, the launcher calls the new `addHarnessSourceSection(ctx, sourceRoot)` helper from `dsh-app-boot`, which registers a global `harness:source` prompt section reading `Your own source code is the checkout at <path>; you can read it there to learn how dsh works and how to extend it.` The section orders at `-99`, just after the harness identity opener (`-100`) and before the deployment persona (`0`).

The testable logic lives in `dsh-app-boot`, not in `apps/cli`, because `apps/*` are not coverage-gated and `packages/*` are. Resolving the optional `systemPrompt` service, registering the section, and returning the disposer belong where per-file 100% coverage applies; the launcher keeps only the thin glue — compute the path, call the helper — covered by the CLI's PTY e2e. When the booted tree has no `systemPrompt` service the helper is a no-op returning `undefined`.

## Scope

Only the `dsh` CLI adds this. The demo bins (`dsh-cli-demo`, `dsh-acp-demo`) boot their committed trees verbatim and gain no source section: they are not the self-modification surface, and their checkout root is not a fact the model needs.

## HMR

The section is registered against the booted `systemPrompt` service's own fiber (through `ctx.get('systemPrompt')`), so a dev HMR reload of the system-prompt plugin drops it until the next boot. Production HMR watches the config, not the built lib, so this is a dev-only wrinkle and acceptable.

## Alternatives considered

**Register the section inside the system-prompt service constructor.** It would then appear in every deployment, not just the self-referential CLI, and the source root would have to be threaded through config to reach the constructor. The path is a launcher fact, so the launcher owns injecting it.

**Keep the whole thing in `apps/cli/src/tui.ts`.** Apps are not coverage-gated, so the registration and absent-service branches would ship untested. Extracting the tested helper into `dsh-app-boot` keeps the gate meaningful; the launcher glue is exercised by the CLI's keyless PTY smoke.

**Add a cordis.yml config field for the path.** The path is not a deployment choice — it is mechanically the launcher's own location. A config field invites a stale hand-entered path and adds a knob with no legitimate variation.

**Resolve from `process.cwd()` or `process.argv[1]`.** The cwd is the user's project, and a PATH symlink makes `argv[1]` the symlink path; `import.meta.url` is the only handle on the real source location.

## Consequences

The agent's system prompt now names its own checkout, so the `cordis` toolset can read and edit harness source with no discovery step. `dsh-app-boot` gains a type-only dependency on `dsh-system-prompt` (peer + dev, matching the acp package's side-effect type import) for the `ctx.get('systemPrompt')` declaration merge; there is no runtime dependency. The section is model-visible text, pinned verbatim in an app-boot unit test and asserted end to end through the CLI's keyless PTY smoke — which boots `dsh` against the scripted config, runs a turn, and reads the path back out of the persisted `request/header` system prompt. The line sits before per-request content, so it does not perturb the KV cache across turns.
