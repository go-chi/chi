# @deepseek-ai/dsh-client-ui-settings

English | [中文](README.zh.md)

The settings domain's base layer, with two roles and no presentation of its own. It provides `ctx.settingsScope`, the Host transport every preference row binds its durable namespace section through, and it declares the settings slot types registrants fill: `settings.trigger` / `settings.header` / `settings.close` (chrome content), `settings.action` (ordered content-header actions), `settings.section` (one page per feature), `settings.plugins.tab` (feature-owned pages inside the Plugins section), and `settings.onboarding` (ordered feature-owned pages). It depends on no `ui-*` presentation package, so any feature that owns a preference can reach it; the settings SHELL — the `sidebar.settings` occupant, its navigation, and the chrome — lives in ui-settings-general, because a shell dependency on ui-sidebar would close a reference graph cycle through ui-layout and ui-theme. The shell's own contract types live beside the shell for the same reason.

The plugin injects nothing and waits for nothing: `ctx.settingsScope.bind(spec)` resolves the wire face through the CALLER's context at call time, so the bound scope's disposer belongs to the calling fiber, and the caller injects `connection` for the transport and `remote` for the invalidation. Listeners exist before the first background read starts, so a row's activation never blocks on the settings transport. A bound scope reloads on the forwarded `settings/document-updated` event for its own namespace and on `connection/reset`. Writes carry one field path and the last known namespace revision as `expectedRevision`; a rejected or failed write re-reads unless a newer write already superseded it, and a stale read never publishes over a newer one. Without a `decode` in the spec, a section that is not a plain object, fails its rehydrated schema, or carries a schema envelope this client cannot rehydrate publishes no value at all, so a row renders its own absent state instead of a half-decoded one.

## Model Experience

None, as the settings domain base serves browser preference storage and slot declarations; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Remote browsers get no durable settings** — the settings RPCs are loopback-only, so a scope bound in a non-loopback browser starts `unavailable` and never crosses the wire; every row it backs is inert there.
- **One field per write** — `set` sends a single `set` op, so a row that must move two fields together has no transaction and publishes two revisions.
