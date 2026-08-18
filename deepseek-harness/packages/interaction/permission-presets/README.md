# @deepseek-ai/dsh-permission-presets

English | [中文](README.zh.md)

User-facing permission presets through `ctx.permissionPresets` ([`PermissionPresetService`](src/index.ts)). Each configured name bundles `sandbox/mode` with `approval/policy`; the defaults are `workspace-write` (`workspace-write` + `ask`) and `danger-full-access` (`danger-full-access` + `never`). UI adapters may expose the table as one selector, while sandbox execution and approval continue to consume their own knobs.

`set(session, name)` records a changed selection in a log-only `permissionPresets/preset` event, then calls each knob's setter only when its effective value changes. The selection event precedes the knob events and preserves user intent when presets share a bundle; a net-zero selection appends nothing. `current(events)` prefers a still-matching recorded selection, then the first matching table entry, and otherwise returns `custom`. Clients may display `custom` as the current value, but cannot select it.

The service owns the `permissionPresets` Settings namespace. Its `defaultPreset` is the default for future sessions: the composition entry uses `Config.defaultPreset`, or infers the preset matching the composed sandbox and approval defaults when omitted. A committed Settings change is read when the next session is created; creation pins `permissionPresets/preset`, `sandbox/mode`, and `approval/policy` into that session, so later changes never alter an existing session. A resumed seed, including an explicitly empty one marked by `session/end-seed`, preserves its effective permission and receives only missing durable facts rather than the latest user default. Mounting the service also sweeps already-live sessions, so an HMR replacement pins any session created while the plugin was absent.

The service requires a confining `ctx.shell` executor and `ctx.approval`. A table entry named `custom` throws at load. When composition defaults match no preset, the plugin requires an explicit `defaultPreset`; an independently constructed zero-event session may still derive `custom`. See the [sandbox switching design](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md).

Two optional children ship the product surfaces over the same service: a `permissions` session-projection unit (`src/types.ts` declares the key; the unit folds the three whole-value knob events and views the select — table options plus a current-only `custom` — over the composition defaults) and the `/permissionPresets` command (bare invocation reports the current preset and the table; a preset argument switches through `set`). Each child activates only when its registry (`ctx.sessionProjections` / `ctx.commands`) is composed.

## Model Experience

Indirectly, through `dsh-user-approval` and `dsh-tool-bash`, which render the approval-policy prompt, switch notice, and sandboxed tool outcomes selected by this service's knob events; `permissionPresets/preset` itself is log-only.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Only two mechanism knobs are bundled** — presets select sandbox mode and approval policy; an agent/profile choice is not part of `PresetSpec` yet.
- **`custom` is derived-only** — callers can switch away from an unmatched knob combination but cannot target or persist a named custom preset through this service.
- **The preset table is process-level** — configuration is fixed for the plugin lifetime; changing available presets requires reloading the plugin.
- **Stored defaults must remain in the preset table** — removing the referenced preset makes Permission settings registration fail until the `permissionPresets` section in `settings.yaml` is updated or reset.
