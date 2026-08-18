# @deepseek-ai/dsh-skill

English | [中文](README.zh.md)

Pure agent skill provider registry.

This package owns the `ctx.skills` interface. It does not know whether skills come from local files, embedded plugin data, HTTP, or another backend; providers register those sources with `ctx.skills.registerProvider(...)`. The shipped local implementation is [`@deepseek-ai/dsh-skill-filesystem`](../skill-filesystem).

The registry is host+per-scope layered over [`@deepseek-ai/dsh-scope`](../../core/scope), the shape the tools registry established: a registration files into the layer of its calling context's scope — host rows and repository plugins land in the global layer, a plugin mounted by an agent preset's standing composition lands in that preset's layer — and a read merges the global layer with the viewing scope's chain, the nearest layer winning a duplicate name outright while rank decides duplicates only within one layer.

## Service: `SkillRegistry` (ctx key: `skills`)

### Public API

- `ctx.skills.registerProvider(create): () => void` Calls a synchronous provider factory with `{ signal, invalidate }`, then registers its readonly result by `provider.name`, unique within the calling context's layer. Duplicate names in one layer throw, `runtime` is reserved, and failed registration aborts the signal. The exact Cordis disposer unregisters the provider, aborts the signal, and preserves ordered composite teardown.
- `ctx.skills.snapshot({ cwd?, signal?, scope? })` Returns the invocation-neutral `{ skills, complete }` observation for the viewing scope's merged layers. `complete` is false when any provider rejects or explicitly reports incomplete discovery, or when a second catalog revision races the bounded retry; candidates supplied by that observation remain in this result, which is never cached.
- `ctx.skills.list({ cwd?, signal?, scope? })` Borrows the readonly view options, then returns every winning summary for the current workspace, merged across the global layer and the viewing scope's chain and sorted by name. Consumers apply `isModelInvocable(skill)` or `isUserInvocable(skill)` at their own boundary.
- `ctx.skills.get(name, { cwd?, signal?, scope? })` Uses the same readonly options and winning candidate for discovery and loading, rechecks cancellation after discovery or a cache hit, races provider loading against the signal, validates the loaded definition, then returns it regardless of invocation policy.
- `ctx.skills.register(skill): () => void` Registers a readonly runtime embedded skill into the calling context's layer, adding the all-invocable policy and `provider: "runtime"` when omitted. Same-name runtime registrations in one layer are first-wins: a duplicate logs a warning and gets a no-op disposer. Successful registrations return the exact Cordis disposer for ordered composite teardown.

### Events

- `skills/change` is an unfiltered invalidation notification emitted after a provider or runtime contribution is registered or disposed and after an active provider's registration control invalidates. It carries no catalog or diff: each consumer refetches `snapshot()` with its own lookup options. Listener throws and rejected promises are logged and cannot veto the registry mutation or starve later listeners.

### Config

| Field | Default | Meaning |
|---|---|---|
| `collectCacheMaxEntries` | `128` | Maximum completed cwd/provider catalogs kept in memory. |

### Invocation policy

`SkillSummary.invocation` is a required typed policy object whose positive booleans `modelInvocable` and `userInvocable` describe the two surfaces independently. Providers return this resolved shape on every candidate and definition; only the `SkillRegistration` input may omit it, in which case `register()` supplies `{ modelInvocable: true, userInvocable: true }`. The registry keeps all four combinations so one discovery result can serve model-facing tools, human-facing commands, and trusted internal callers without conflating their catalogs.

| Policy | Model | User |
|---|---|---|
| `{ modelInvocable: true, userInvocable: true }` | included | included |
| `{ modelInvocable: true, userInvocable: false }` | included | excluded |
| `{ modelInvocable: false, userInvocable: true }` | excluded | included |
| `{ modelInvocable: false, userInvocable: false }` | excluded | excluded |

### Shared model-facing rendering

`renderSkillContent(skill)` renders one loaded skill as the canonical `<skill_content>` block (escaped `name` attribute, resource hints, verbatim body). It is the single truth for both loading paths: `dsh-tool-skill` returns it as the `skill` tool result and injects it at the user-explicit gesture boundary, so the model sees one shape regardless of who initiated the load. `escapeText` is exported beside it for consumers embedding prose in the same markup frame. The package also declares the `skill-invocation` `MessageSource` kind ({ name, form: 'instructions' }) that user-explicit injection stamps on its messages — transcript consumers present the invocation from this metadata instead of re-parsing the body.

`isModelInvocable(skill)` and `isUserInvocable(skill)` read the matching positive field directly. `ctx.skills.get()` remains the trusted, policy-neutral loading primitive, so every user- or model-facing consumer must enforce the predicate that matches its surface before exposing or loading a skill.

## Provider Contract

A provider factory runs synchronously and receives one registration-scoped control. `control.signal` aborts when registration fails or is disposed; `control.invalidate()` clears completed catalogs only while that exact registration remains active, so late callbacks cannot affect a replacement with the same name. Immutable providers may ignore the control. Remote setup, authentication, and discovery belong in the provider's awaited `list(options)` call. An array return is shorthand for complete discovery; a provider that collected usable candidates but could not establish an authoritative observation returns `{ candidates, complete: false }`. Provider objects, lookup options, candidates, and definitions are borrowed readonly rather than cloned or rebound. Providers should honor `options.signal`; the registry also stops awaiting uncooperative discovery or loading after cancellation.

The registry validates candidates before caching and definitions before returning them. The winning provider receives the same candidate and opaque `locator` it returned from `list()`, allowing backend-specific file, URL, id, or version handles. Callers and providers must preserve the readonly contract.

Contract violations fail fast. A rejected provider `list()` is treated as a transient source failure and omitted. An explicit incomplete observation still contributes its candidates for `list()` and `get()`, but makes the aggregate snapshot incomplete and uncacheable. A provider or runtime revision change discards an in-flight result and retries once. If the retry is also superseded, its candidates are returned incomplete and uncached so a continuously invalidating provider cannot monopolize the caller. Within one layer, duplicate names resolve by rank, provider registration order, then provider-local order; across layers the nearest scope's entry wins the name. Summaries are sorted by skill name.

Definitions remain progressively loaded. `get()` asks the winning provider for the body on every call rather than caching it in this registry. If the returned definition has a different name from the selected candidate, the stale selection is rejected and the registry internally invalidates that exact provider so the next snapshot rediscovers its catalog.

## Runtime Skills

`ctx.skills.register(...)` is a convenience for embedded runtime skills. Runtime skills use rank `250`: project providers can override them, while they override the shipped local provider's custom and user roots. Runtime definitions and nested resource metadata are borrowed readonly; the service materializes one top-level definition to supply omitted invocation and provider defaults. Registration is first-wins within runtime contributions, so a duplicate contribution cannot remove the active one through its disposer.

## Consumer boundary

The registry does not render model guidance or register model-facing tools. [`@deepseek-ai/dsh-tool-skill`](../tool-skill) consumes `ctx.skills` to provide durable session catalogs and the `skill` tool, so providers remain independent of model-facing behavior.

## Model Experience

Indirectly, through `dsh-tool-skill`, which renders provider summaries into durable initial or replacement catalog messages and loaded instructions into retained tool results.

#### KV Cache effect

No direct prompt effect. The named consumer owns the durable initial catalog and append-only replacements after invalidation.

## Known Limitations and Deferred Work

- **Invalidation is provider-driven** — the registry has no TTL and cannot infer that an arbitrary remote source changed; each mutable provider must retain and call its registration-scoped `invalidate()` capability from its own observation mechanism.
- **Providers are queried sequentially** — one slow cooperative provider delays every provider registered after it; cancellation stops the caller's wait but cannot terminate work an uncooperative provider keeps running.
- **Incomplete observations are not retained** — rejected providers are omitted and explicitly supplied candidates remain available only to the current lookup; the registry owns neither a last-good catalog nor per-provider diagnostics.
- **Duplicate resolution is first-wins** — later lower-priority candidates within a layer are logged and hidden, and a nearer layer shadows a farther one silently; there is no API to inspect all shadowed definitions.
