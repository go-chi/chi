# jobs/ — background-job capability family

English | [中文](README.zh.md)

This family gives long-running tools one owner-isolated background-job protocol for observation, cancellation, waiting, and completion notices.

| Package | Role | ctx key |
|---|---|---|
| [`jobs/`](jobs/README.md) | Defines the job registry and lifecycle contract | `ctx.jobs` |
| [`jobs-local/`](jobs-local/README.md) | Implements the process-local job registry | registers on `ctx.jobs` |
| [`tool-jobs/`](tool-jobs/README.md) | Exposes job control and completion notices to the model | registers on `ctx.tools` |

See the [background-job runtime](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md) and [job-registry](../../.agents/notes/implemented/architecture/2026-07-26-job-registry-seam.md) decisions.

The subsystem reference — the id scheme, the owner-fenced contract, snapshots — is [docs/subsystems/jobs.md](../../docs/subsystems/jobs.md); design in the [background-job runtime](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md) and [job-registry contract](../../.agents/notes/implemented/architecture/2026-07-26-job-registry-seam.md) Agent Notes.
