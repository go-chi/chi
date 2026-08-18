# boot/ — shared app-bin boot glue

English | [中文](README.zh.md)

The channel-neutral boot library shared by `apps/cli` and the [`examples/`](../examples/README.md) demo bins.

| Package | Role | ctx key |
|---|---|---|
| `app-boot/` | Shared boot glue for the app bins: `.env` loading, fail-loud Loader guards, snapshot-aware config resolution, the settle-the-tree boot sequence | (library for the bins) |
| `cmdline/` | Launcher-to-app command-line handoff and app-owned startup parsing | `cmdlineArgs`, `appExit` |

The boot sequence and personal-config contract are documented in [`app-boot/README.md`](app-boot/README.md); app-owned command lines are documented in [`cmdline/README.md`](cmdline/README.md).
