# @deepseek-ai/dsh-storage

English | [中文](README.zh.md)

Storage hub (`ctx.storage`) for non-session data: a named backend registry plus mounted data-form facilities. The hub performs no IO itself — backends own media, and data forms own semantics. The [storage family overview](../README.md) maps those packages; the [domain KV storage Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md) records the design rationale.

## Shape

- `ctx.storage.backend` — name → backend table. Multiple backends stay mounted side by side (`json`, `sqlite`); which backend serves a consumer is that consumer's configuration (the domain layer's route table), never a hub-global choice. `register()` returns the disposer; duplicate names and unknown lookups fail loud.
- `ctx.storage.mount(form, facility)` / `ctx.storage.form(form)` — data-form mounting. `StorageForms` is merge-extensible; the domain layer merges `domain` and is reached as `ctx.storage.domain`.
- A backend owns one medium and exposes the data-shape facets it supports. `kv` is the current facet; `src/backend.ts` owns its exact contract.

## Model Experience

### Backend and form registrations

#### What the model sees

Nothing. `ctx.storage` is a host-side registration table; the hub registers no tools, injects no prompts, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the hub never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- **`kv` is the only data shape** — backends currently have one facet to implement.
- **Forms resolve lazily** — reading `ctx.storage.domain` before the domain plugin mounts throws `form-not-mounted`; assemblies order plugins accordingly (misconfiguration fails loud rather than silently deferring).
