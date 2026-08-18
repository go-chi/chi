# skill/ — skill capability family

English | [中文](README.zh.md)

This family discovers reusable agent instructions and exposes them to the model through a provider-neutral catalog and loader.

| Package | Role | ctx key |
|---|---|---|
| [`skill/`](skill/README.md) | Defines skill provider registration and lookup | `ctx.skills` |
| [`skill-badge/`](skill-badge/README.md) | Contributes the optional bundled dsh badge skill | registers on `ctx.skills` |
| [`skill-filesystem/`](skill-filesystem/README.md) | Discovers skills from local filesystems | registers on `ctx.skills` |
| [`tool-skill/`](tool-skill/README.md) | Publishes the skill catalog and model-facing loader | registers on `ctx.tools` |

This capability remains outside the core control spine and can use local, embedded, or remote providers without changing the model-facing contract.

The subsystem reference — discovery priority, catalog snapshots, the `skill` loader — is [docs/subsystems/skills.md](../../docs/subsystems/skills.md).
