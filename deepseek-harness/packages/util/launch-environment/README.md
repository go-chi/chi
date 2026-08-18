# dsh-launch-environment

English | [中文](README.zh.md)

This run's environment as one immutable snapshot that remembers **which layer supplied each value**. Consumers resolve user-facing values against it instead of `process.env`, because the layers are not equally trusted and a flattened view cannot tell them apart.

| Layer | Source id | What it is |
|---|---|---|
| Inherited process environment | `process` | What the launching shell, CI job, or container passed in — this run's explicit intent |
| `<invocation cwd>/.env` | `project-env` | The project the harness was launched in, which the product trusts to configure its own agent |
| `$DSH_HOME/.env` | `user-env` | The user's own machine-level defaults |

Values do also reach `process.env` — a user's `--config` tree and third-party libraries read it — but that flattened view is not the authority for anything the harness resolves.

## Resolving

`get(name)` searches every layer, most trusted first. `getFrom(name, sources)` searches only the named layers without changing that trust order.

**Omitting a layer is a refusal, not a demotion** — a caller that must never accept a layer leaves it out of the list, so no future reordering can let it back in. The provider adapters name all three, because the product trusts the project it runs in; the mechanism exists for the decisions where that is not true.

Names match the way the platform matches them: exactly on POSIX, case-insensitively on Windows. A case-sensitive lookup there would rank the wrong layer — a shell's `deepseek_api_key` and a project `.env`'s `DEEPSEEK_API_KEY` are one variable to the OS, and treating them as two would let the project win.

```ts
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

declare const ctx: Context
const endpoint = launchEnvironmentOf(ctx).get('DEEPSEEK_BASE_URL')?.value
```

`launchEnvironmentOf(ctx)` returns the launcher's snapshot when the product CLI booted the tree, and otherwise the inherited environment as the only layer. That fallback does not weaken the rules: an SDK host or a bare `cordis.yml` discovered no files, so everything it has really is the environment it was launched with.

## Known Limitations and Deferred Work

- **The snapshot is not a subprocess boundary** — every layer is also materialized into `process.env`, so ordinary project variables reach child processes under [`dsh-subprocess`](../../subprocess/subprocess/README.md)'s scrub. The product launcher's [`.env` contract](../../boot/app-boot/README.md#profiles) rejects bootstrap variables before materialization.
- **No per-workspace layer** — the project layer is the *invoking* directory, fixed at launch. A workspace selected later in the Web UI contributes nothing, deliberately: following it would let a model's own workspace change the harness environment mid-session.
