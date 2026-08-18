# dsh-agent-presets

English | [中文](README.zh.md)

Per-preset agent composition. A **preset** is a directory holding one `agent.cordis.yml`; the roster mounts it ONCE per process under a standing scope, and each session that names it joins by having its agent scope key parented to the mount's (`dsh-scope`'s parent chain). The mount's tools, prompt sections, and projection units exist exactly once and cover every joined agent — its plugins key their state by Session/Agent, so sessions stay apart inside one shared instance — and a host reader with no agent at all (a cold transcript read) resolves the same standing registrations by preset id.

The mechanism is two seams. Entry contexts chain to the context a subtree was plugged into, and both [`dsh-tools`](../../core/tools/README.md) and [`dsh-system-prompt`](../../core/system-prompt/README.md) file registrations into the calling context's scope layer — so the standing mount's contributions land in the PRESET's layer. What carries them to each session is `dsh-scope`'s parent chain: an agent's views resolve `agent → preset → global` (nearest shadowing farthest), and the mount's listeners are admitted for every agent parented under it while a sibling preset's stay deaf.

## Service: `AgentPresets` (ctx key: `agentPresets`)

Discovery is unmemoized: `list()` and `resolve()` re-read the roots on every call, so a preset authored while the process runs is visible immediately and a deleted one disappears from the next read. Discovery also owns preset **health**: a directory whose composition is missing or unloadable (unparsable YAML — checked with the loader's own dialect, `!!js` included — or not a list of named plugin rows) is listed with a `broken` reason rather than skipped, because a skipped directory would still occupy its id on disk while every surface shows nothing to delete. A directory whose name is not a usable preset id (`[a-z0-9][a-z0-9-]*`) is skipped outright: no copy could ever claim it.

- `ctx.agentPresets.defaultId: string` The preset id mounted when a caller names none.
- `ctx.agentPresets.list(): Promise<AgentPreset[]>` Every preset the configured roots currently supply, earlier root winning a duplicate id; broken presets included, each carrying its reason.
- `ctx.agentPresets.resolve(id?): Promise<AgentPreset>` One preset by id, defaulting to `defaultId`. Throws naming the available ids when no root supplies it. A broken preset resolves — deleting, reading, and reporting one all need the row.
- `ctx.agentPresets.mount(agentCtx, id?): Promise<AgentPreset>` Compose one agent from a preset — ensure its standing mount (single-flight) and parent the agent's scope key to it — returning the preset for the caller to record. Refuses a broken preset up front with its discovery-reported reason, so every unloadable shape fails the same way before the loader is involved.
- `ctx.agentPresets.composeFrom(agentCtx, parentCtx): string | undefined` Join one agent to the standing composition another already runs on, returning the preset id joined — `undefined` when the parent joined none, which is the rosterless deployment and not an error. A bind rather than a mount, so it is synchronous and has no composition failure mode; it still rejects a caller error (an unscoped context, or an agent that already joined).
- `ctx.agentPresets.composedPreset(agentCtx): string | undefined` The preset one LIVE agent runs on, read from its scope chain rather than from its session — the only answer available for an agent whose durable header is still being built.
- `ctx.agentPresets.recompose(agentCtx, id): Promise<AgentPreset>` Re-link one agent to a different preset's standing composition. Valid only while the agent has produced nothing — **the caller owns that check**; the new mount is ensured before the link moves, so a failure leaves the agent as it was. Refuses a broken preset like `mount()`.
- `ctx.agentPresets.standingKeyFor(id?): Promise<ScopeKey>` The standing scope key a host reader with no agent (a cold transcript read) resolves preset registrations in; ensures the mount without starting an agent, session, or turn. Refuses a broken preset like `mount()`.
- `ctx.agentPresets.roots: readonly PresetRoot[]` The roots this roster scans — every configured root in order, then the derived harness-home root. Not `config.roots`: read this to answer whether a roster is composed at all, so one derivation decides it.
- `ctx.agentPresets.authorable: boolean` Whether any of those roots has `user` trust, and therefore whether a preset can be created at all.
- `ctx.agentPresets.read(id): Promise<string>` One preset's composition text, exactly as stored.
- `ctx.agentPresets.copy(from, id, name?): Promise<void>` Create a locally authored preset by copying an existing one's whole directory — the only authoring write. No composition text crosses this seam, so a copy is exactly as loadable as its source; the copied metadata keeps the source's description but never its name or roster order, and `name` (or the id fallback) is what distinguishes the rows.
- `ctx.agentPresets.remove(id): Promise<void>` Delete a locally authored preset; joined sessions keep their standing mount. Clears the user default when it named the preset just deleted: storing a default that does not exist yet is deliberate, but one this call removed will never be supplied again and would fail every session created without an explicit pick.

`AgentPreset` carries `id` (the directory name), `trust` (`system` or `user`, from the root it was found under), `path` (the absolute composition file), and — only when the preset cannot compose a session — `broken` (one human-readable reason, shown verbatim on roster surfaces).

### Where to call `mount()`

The agent factory's `setup(agentCtx)` hook is the one supported call site. Only there is the join installed while the agent is still unpublished, so a rejected composition rolls the whole creation back rather than leaving a half-composed session. The standing subtree is owned by the roster service's own fiber — deliberately its UNTRACED context, because a subtree minted from a traced `this.ctx` resolves every service through the caller's shadow fiber instead of each entry's own inject store — so it survives every agent and unwinds only with the whole tree. Each generation records its composition file's stamp (mtime and size): a session that finds the stamp stale starts the next generation, while every session already joined keeps the one it runs on — the composition a running session joined outlives its file changing or disappearing underneath it, and files are the only composition editor, so the stamp is what carries an edit to later sessions.

### Composing a child agent

A subagent's child joins its parent's standing composition through `composeFrom()`, never through `mount()`. Every model-facing row lives on the agent plane, so the tool registry's global layer is empty and a child that joins nothing reaches the model with no tools at all and none of its parent's prompt sections.

Re-mounting the parent's preset by id would differ from the bind in two ways that both matter. A composition file edited since the parent started would hand the child a DIFFERENT generation than the one its parent's history was produced under, and a preset deleted since would fail the child outright while its parent keeps running. The bind is also synchronous, which is what lets the in-process subagent drivers use it at all — they compose their children inside a synchronous creation window.

The child records the joined id on its own durable header ([`dsh-subagent`](../../subagent/subagent/README.md)), so a cold read of the child's history rebuilds the composition it actually ran under rather than the deployment default.

### Which preset a session runs

The creation header names the preset a session STARTED with; `resolveSessionPreset(session)` names the one it RUNS. They differ whenever a blank session switched, so every reconstruction path — the summary a picker reads, a resume, a fork — resolves rather than reading the header.

The header stays frozen because it is a creation fact. A switch is an `agent-preset/selected` session event appended after the swap commits, which is what the model-visible ⟺ logged rule requires: the preset decides the tool schemas and prompt sections the model sees, so it has to be reconstructable from the log. The service re-emits that committed fact as the non-scoped cordis event `agent-preset/selected(sessionId, agentPreset)` declared by the client-safe `./types` export, allowing remote consumers to invalidate session-derived state without importing Host runtime types. Reading the header alone would rebuild a switched session under the composition it was created with, replaying history the new tool set cannot act on — the exact hazard the blank-only lock exists to prevent.

### Switching a blank agent

`recompose()` unmounts the installed subtree and mounts the new one, because two compositions cannot coexist — both would register the same tool names into one layer. A failed mount restores the previous composition rather than leaving the agent with nothing, and an unknown id is rejected before anything is torn down.

The restriction to a produced-nothing agent is a product rule, not a mechanical one: swapping tools mid-conversation would leave logged tool calls the new composition cannot make. The gateway enforces it at the wire ([`dsh-apiproxy`](../../host/apiproxy/README.md) answers `agent-preset-locked`), which is where session history is in hand.

## Authoring

Authoring is copy-only. A new preset is a whole-directory copy of an existing one — composition, metadata, skill directories, assets — landed under the first `user` root; the inputs are two ids the service resolves against its own roots plus an optional display name, so no caller ever supplies composition text and a copy grants nothing the roster did not already carry. Everything after creation happens in the preset's own files. `copy()` refuses three things before anything lands:

- **An id that is not `[a-z0-9][a-z0-9-]*`.** The id becomes a directory name, so containment is a property of the id itself rather than of a path check after the fact — `../escape`, `a/b`, and an absolute path are all rejected as ids.
- **An id that is already taken.** A copy never overwrites: any root supplying the id refuses it (a user directory named like a shipped preset would be shadowed by it), and a directory occupying the name on disk refuses it too. Discovery lists such a directory as a broken preset, so the refusal's way out — delete it — is on the same page that reported it.
- **An unknown source.** The source may be any trust — copying a shipped preset is the primary case — but it must exist; a failed copy rolls its half-made directory back rather than leaving one discovery cannot see.

The copied tree is re-tightened to owner-only (`0o600` files keeping their owner-execute bit, `0o700` directories), symlinks are dereferenced so the copy is self-contained, and the root is created on first copy — a deployment configuring a user root that does not exist yet is the normal first-run state. The copied `preset.yml` is rewritten: the source's description is kept for the author to edit in place, but its name and roster `order` are dropped — a copy presenting itself identically to its source, or sorted into the shipped set's declared order, would make the roster stop distinguishing them. `remove()` refuses a preset that ships with the deployment; the shipped set is the known-good compositions copies start from.

### How a preset's rows resolve

A row's **package name** resolves from the host composition, not from the preset directory. The Loader normally resolves an entry against its own tree's `baseUrl`, which for a preset is wherever the composition file sits; a locally authored preset lives under the user's home, where Node's upward `node_modules` walk never reaches the harness, so every `@deepseek-ai/dsh-*` row would fail to import. The mount records the host base before plugging the subtree and sends bare specifiers there.

A **relative** path still resolves from the preset's own directory, so a preset's own plugin files and skill directories travel with it.

An **absolute** filesystem path keeps its own location. The mount converts it to a `file:` URL before ESM import so POSIX paths and Windows drive-letter or UNC paths use a specifier Node accepts.

### Display metadata

A preset may publish display text in an optional `preset.yml` beside its composition:

```yaml
name: 极简模式
description: 仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。
```

It carries display text ONLY. `id` is the directory name and `trust` comes from the root the preset was discovered under, so neither is writable here — otherwise a locally authored preset could name itself into the shipped set. It is a separate file because the composition is a top-level list of plugin rows: YAML cannot carry sibling keys beside it, and a fake metadata row would hand the Loader something to load.

Every read failure degrades to no metadata — absent, malformed, wrongly typed, or blank all mean the same thing, and a picker falls back to the id. Presentation is not capability: a preset with a broken name still mounts.

## Config

| Field | Default | Meaning |
|---|---|---|
| `default` | required | Preset id mounted when a caller names none |
| `roots` | `[]` | Scanned directories in precedence order; each supplies `path` (a leading `~` expands) and `trust` (defaults to `user`) |
| `includeUserRoot` | `true` | Append `<dshHome>/.agent-presets` as a `user` root, after every configured root |

An absent root supplies no presets rather than failing: the user root does not exist until the first locally authored preset, and naming a default no root supplies already fails loud at resolution.

### The writable root is this package's, the shipped root is the app's

`<dshHome>/.agent-presets` is where a person's own presets live, the way `<dshHome>/skills` is where their own skills live ([`dsh-skill-filesystem`](../../skill/skill-filesystem/README.md)), so the roster derives it rather than waiting for a deployment to remember it — a launcher that configures nothing still finds and authors presets. It is appended AFTER every configured root, which keeps an earlier root winning a duplicate id: a shipped `standard` still shadows a home directory that claimed the name, and `copy()` refuses that id rather than landing a preset nothing would resolve.

The roots are resolved once, when the service is constructed. A root set that changed between a `list()` and the `copy()` acting on its answer would author into a directory the caller never saw.

`includeUserRoot: false` mounts a roster over `roots` alone. A deployment that confines presets to its own directories needs it, and so does any test pinning an exact roster — otherwise the machine's real `<dshHome>` decides what the roster contains.

The SHIPPED root stays an assembly fact: it sits beside the installed app's own config, a path only that app can resolve.

### The default preset is a user setting

When a settings provider is composed, this plugin registers the `agent-presets` namespace with `config.default` as its composition base, so the user document layers over the deployment's engineering default:

```yaml
agent-presets:
  default: minimal
```

The value is read per resolution rather than snapshotted, so a hot-reloaded document takes effect on the next session created and every running session stays on the preset it was composed from. Clearing the user field re-inherits the composition default. A default naming a preset no root supplies is stored without complaint and fails at the next `resolve()` — the roster is a live directory, so a name absent now may exist by the time a session asks for it.

## What a mount rejects

A directly-plugged subtree is absent from `ctx.loader.entries()`, so no boot audit covers it. `mount()` therefore proves the result usable itself, and rejects three things.

**An unscoped target.** Mounting into a context that carries no agent scope would register the preset's tools globally, for every agent in the process.

**A row that never became usable.** The loader already rejects a row whose module failed to import or whose plugin threw; what remains is a row still waiting for a service the composition never supplies, which the audit names.

**A row that published a service into the root realm.** Such a service is process-global, so the second preset publishing the same name collides with the first, and a host reader would resolve one preset's instance for every session. A preset that genuinely owns a service puts it behind an `isolate` realm — entry-local realms keep two presets' same-named services apart exactly as they once kept two sessions' apart — or the service belongs in the host composition instead.

The package invariant re-checks that last rule on every service notification, because a row that publishes from a timer or an asynchronous continuation would escape the one-shot audit.

## A preset file is an input, never a persistence target

The Loader writes a tree back to its source file whenever it decides the config changed, and a row disposing its own fiber is enough to decide that: the entry is marked `disabled` and the tree is written. Inherited, that would burn one session's runtime state into a file every session shares — comments stripped by the YAML round trip, and a `writeFile` rejection inside a `setTimeout` for a read-only shipped preset.

The mounted subtree therefore overrides `write()` as a no-op. Nothing in this package writes a composition; authoring one is a separate, explicit operation.

## Trust

Presets are compositions, so a preset is exactly as privileged as the plugins it names. A `user` preset — authored by a person or by an agent — carries the same trust as shell access; the `trust` field exists so consumers can present that difference, not to enforce it.

## Model Experience

Indirectly, through the plugins a standing composition registers, which own every tool schema and prompt section the preset makes visible to the agents joined to it.

#### KV Cache effect

Prefix-stable for the life of an agent: a composition is installed once, before the agent is published and therefore before its first request, and is never re-read while the agent runs. Choosing a different preset for a new session establishes a different prefix for that session alone and cannot invalidate reuse for any session already running.

## Known Limitations and Deferred Work

- **A preset outside the writable root is discoverable but not deletable** — `remove()` refuses anything that does not live under the FIRST `user` root, so a deployment that configures its own writable root while leaving `includeUserRoot` on lists the harness-home presets, mounts them, and then answers "it does not live under the writable preset root" for every delete. The roster carries one writable root by design; a deployment that wants only its own sets `includeUserRoot: false`.
- **A preset cannot be changed once a session has produced anything** — `recompose` re-links a BLANK session's parent scope to another standing mount, and only a blank one: switching a composition that already ran would strand tools the model has called. Changing the default affects only sessions created afterwards.
- **A generation is keyed on the composition file alone** — the stamp check notices `agent.cordis.yml` changing, not an edit to a skill file or asset beside it; those reach new sessions only once the composition file itself moves or the process restarts.
- **A superseded generation is never reclaimed** — sessions already joined keep the generation they run on, and the roster holds no join count that could tell when the last one left, so the whole subtree stays mounted until the process ends. The cost is per generation rather than per session, but it is not free: `dsh-skill-filesystem` watches its roots by default, so each edit-then-create cycle adds a live watcher set. Bounded by how often compositions are edited — which the settings-page authoring flow makes a per-save event rather than a per-deploy one. Reclaiming one needs a joined-agent count on the standing mount; see the `TODO` at `ensureStanding`.
- **A copy is never mounted to validate** — it is byte-identical to its source, so a source broken on disk yields a copy exactly as broken as the source; discovery's health check marks both rows on the next roster read rather than deferring the failure to a session start.
- **Health is a shape check, not a mount** — discovery proves the composition parses in the loader dialect and holds named rows, not that every row's module resolves or activates; a row naming an absent package still fails at the first session, which rolls the creation back.
- **A copy is a snapshot that drifts** — upgrading the deployment does not update copies of shipped presets, and there is no patch semantics at this layer to express "standard plus one change" (that is the bundle layer's `cordis.patch.yml`); the shipped set itself accepts the same cost — `cordis` and `code` are full copies of `standard` — so the whole assembly stays readable in one file.
- **Root scans are not watched** — every read hits the filesystem instead, which keeps the roster fresh but puts one `readdir` per root on each `list()`.
