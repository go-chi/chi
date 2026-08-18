# @deepseek-ai/dsh-tool-skill

English | [中文](README.zh.md)

The model-facing skill catalog and `skill` tool.

Requires `ctx.agents`, `ctx.tools`, and `ctx.skills` (`inject: ['agents', 'tools', 'skills']`).

## Catalog lifecycle

At every eligible `agent/pre-step`, the plugin calls `ctx.skills.snapshot()` for the calling session's cwd, forwards the pre-step abort signal to discovery, applies exact `skill` tool visibility, and renders the ordered `name` and `description` entries. When no prior catalog exists and that view is non-empty, it adds an initial durable user-role `<system-reminder>` to a downstream `enter` decision. Catalog messages contain only those summaries; skill bodies, paths, sources, providers, and `whenToUse` hints remain outside the catalog.

Every catalog message carries the `skill-catalog` source: a `catalog`-form context whose `entries` record exactly the `name` and `description` pairs it published, plus `update` on a replacement. The digest covers those durable entries, not the rendered prose, so the surrounding `<system-reminder>` framing cannot decide whether a republish is needed and consumers never re-parse the `<available_skills>` block. The plugin scans durable session events backwards without copying them and derives the comparison baseline from the newest visible `skill-catalog` message it can read; unreadable and foreign records are skipped. When the digest changes, the downstream `enter` decision receives a durable user-role message containing the complete replacement catalog; an empty replacement explicitly retires earlier names. If no catalog remains visible but a recognizable historical catalog exists, compaction hid it and the next complete observation re-establishes the current catalog. An incomplete provider snapshot emits nothing and preserves the last-good model view for retry at the next pre-step. If no prior catalog exists and the current view is empty, no tombstone is necessary.

The catalog is omitted when no model-invocable skills are initially available, and also when that agent's tool view restricts away the shipped `skill` tool or resolves a same-name scoped shadow instead. Identity is compared against the definition this plugin registered rather than a lookup of its own name, so the plugin works mounted globally or inside one agent's composition, where `register()` files into that agent's layer alone. Visibility changes participate in the digest, keeping prompt guidance, model-visible schema, and executable dispatch aligned.

`catalogDescriptionMaxLength` controls normalized catalog descriptions; rendering XML-escapes them. Its default is `500` and values must be integers of at least `3`, which reserves room for a truncation ellipsis. The [skill catalog hot-refresh Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-skill-catalog-hot-refresh.md) owns the durable initial catalog and replacement lifecycle.

## Tool: `skill`

| Arg | Type | Notes |
|---|---|---|
| `name` | string (required) | Exact kebab-case skill name from the available skills listing. |

Execution uses the calling agent's `session.header.cwd` so workspace-sensitive providers resolve the winning skill. A successful call returns canonical `{ name, provider, resourceBase?, content }`, excluding catalog ranking and provider-internal machinery; its Native renderer produces one text result containing `<skill_content name="...">`, `<skill_resources>`, and `<skill_instructions>`.

Resource guidance resolves only paths or URLs explicitly referenced by the instructions against `resourceBase`; scripts, references, and assets load on demand, and the result does not enumerate a skill directory. Local providers may supply a directory, while remote or embedded providers may supply a URL or opaque loading guidance.

An unresolved name reports that the skill is unknown or no longer available. Invalid names and skills whose `invocation.modelInvocable` is `false` produce distinct error results. `invocation.userInvocable` does not restrict this model-facing tool.

Tool execution does not add a synthetic context message. Its freshly loaded result is already recorded as the tool result and becomes available to the next model step without duplicating the body. Only the catalog projection adds replacement summaries.

## Model Experience

### Session catalog

#### What the model sees

If model-invocable skills exist and this exact `skill` tool is visible, the agent receives the catalog template below as a durable user-role message before the first request, with one data-dependent entry per sorted skill. Later membership, description, or visibility changes append a complete replacement using the same `<available_skills>` envelope; deleting every skill appends an empty envelope with an explicit instruction not to use older names. The template's closing sentence is the rule against double-loading: the user-explicit gesture boundary (the pre-step listener below) injects the same `renderSkillContent` output (shared from `@deepseek-ai/dsh-skill`) inline, and the catalog tells the model to follow that block instead of re-loading the skill through the tool; the replacement-catalog template carries the same sentence in both arms, including the emptied catalog.

##### Skill catalog template

```markdown
<system-reminder>
A skill is a reusable set of task-specific instructions. The following skills are available in this session:

<available_skills>
- `<name>`: <normalized-and-capped-description>
</available_skills>

If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.
</system-reminder>
```

#### Token effect

Repeated input cost scales with skill count and `catalogDescriptionMaxLength`; no initial catalog tokens are sent when the list is empty or the tool is hidden or shadowed. Each actual catalog change adds one retained complete replacement message.

#### KV Cache effect

The initial durable catalog is appended after the existing reusable prefix. Dynamic changes are append-only history after that catalog, so earlier reusable tokens stay intact while each newly appended catalog and later turns form a new suffix. A new or resumed instance with a changed digest may affect cache reuse from the newly appended catalog position.

### Tool schema

#### What the model sees

The model sees the generated [`skill` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-skill).

#### Token effect

Fixed schema cost per request where the tool is visible.

#### KV Cache effect

Prefix-stable while the tool definition and visibility are unchanged. Shadowing, restrictions, or plugin lifecycle changes may invalidate reuse from this schema.

### Tool result

#### What the model sees

A successful call uses the result template and the provider-managed, directory, URL, or opaque resource guidance below.

##### Skill result template

```markdown
<skill_content name="<escaped-name>">
<skill_resources>
<resource-guidance>
</skill_resources>

<skill_instructions>
<provider-owned-instruction-body>
</skill_instructions>
</skill_content>
```

##### Provider-managed resource guidance

```markdown
Resources for this skill are managed by provider "<provider>".
Load referenced resources only as needed.
```

##### Directory resource guidance

```markdown
Base directory for this skill: <path>
Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
```

##### URL resource guidance

```markdown
Base URL for this skill: <url>
Resolve relative URLs mentioned by this skill against the base URL before using them. Load referenced resources only as needed.
```

##### Opaque resource guidance

```markdown
Resources for this skill: <description>
Load referenced resources only as needed.
```

#### Token effect

Loaded instructions are data-dependent tool-result tokens, resent on later steps until compaction; no duplicate `agent.inject()` copy is made.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool errors

#### What the model sees

Invalid or stale selections return exactly `Error: invalid skill name "<name>"`, `Error: skill "<name>" is unknown or no longer available`, or `Error: skill "<name>" is not available for model invocation`. Provider-thrown lookup text is data-dependent and receives the same `Error: <message>` wrapper.

#### Token effect

Only a failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### User-explicit invocation injection

#### What the model sees

A whitespace-bounded `/name` token anywhere in a claimed user message, naming a user-invocable skill in the workspace catalog, injects that skill's full `<skill_content>` rendering (the exact result-template shape above) as a `user`-role instructions context appended after every other injection of that step — background first, the material to act on last. Only direct user input is scanned, the check runs on the loaded definition, and unknown or user-disabled names stay ordinary prose. This is the sole entry point for `disable-model-invocation` skills, which the catalog and the `skill` tool never expose; the catalog's closing sentence tells the model to follow the injected block instead of re-loading it.

#### Token effect

Each gesture adds one rendered skill body to that turn as injected context — the same size as the tool result for the same skill, paid deterministically at the user's request instead of at the model's discretion. Repeated gestures for one skill within one step inject once.

#### KV Cache effect

Append-only; the injection lands after the reusable request prefix inside the step's message batch and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The catalog omits `whenToUse`, source, and provider metadata** — routing is based only on name and a capped description; `whenToUse` remains provider metadata and is not rendered by the loaded wrapper either.
- **Loaded instruction bodies have no size cap** — a provider can return a skill large enough to consume substantial next-step context; only catalog descriptions are truncated.
- **Resources are guidance, not attachments** — the tool reports a base directory/URL/opaque hint but neither enumerates nor fetches referenced files for the model.
- **Loading is one-shot text** — there is no partial, streaming, or cached-content handle when a remote provider is slow or a skill body is large.
- **Catalog replacement is whole-list** — one changed name or description appends every currently visible summary; this keeps stale-name retirement explicit but costs tokens proportional to the catalog.
- **Bodies are not versioned** — body-only edits do not change the catalog digest or notify the model; a later tool call reads the current provider content while earlier tool results remain historical facts.
