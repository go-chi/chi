# settings/ — user-settings capability family

English | [中文](README.zh.md)

This family resolves user-editable configuration through registered namespaces and swappable storage providers.

| Package | Role | ctx key |
|---|---|---|
| [`settings/`](settings/README.md) | Defines namespace registration, layered resolution, and commits | `ctx.settings` |
| [`settings-file/`](settings-file/README.md) | Stores settings in a local file and observes external edits | registers on `ctx.settings` |

The subsystem reference — namespaces, owner scopes, resolution order, hot commits — is [docs/subsystems/settings.md](../../docs/subsystems/settings.md).
