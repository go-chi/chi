# Agent Note: TUI skill slash command

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-21-tui-skill-slash-command.zh.md)

## Problem

The [skill system](2026-07-05-skill-system.md) shipped with model-initiated loading as its only path: the `skill({ name })` tool lets the model pull a skill body into a turn, but a person driving the TUI could not load a skill on demand. Other coding agents expose a `/skill:<name>` slash command for exactly this — the user, not the model, decides a task matches a skill and injects its instructions. The skill-system note listed direct user invocation as deferred work, and the interactive front door is where it belongs.

## Decision

The [`@deepseek-ai/dsh-tui`](../../../../packages/ui/tui/README.md) front door owns a `/skill:<name> [instructions]` command. On submit it loads the named skill and delivers one text block as a user turn — sent with `agent.send()` while idle and `agent.steer()` while running, the same rule as ordinary editor input. The block is `renderSkillInvocation(skill, instructions)`: a `<skill name="…">` element wrapping the skill body, preceded by one resource-base line when the provider exposes one, with the user's trailing text appended after a blank line. The command is a TUI-only affordance; it adds no model-facing tool. Its visibility and loading policy comes from the shared [independent model and user skill invocation policy](2026-07-28-skill-invocation-policy.md).

The TUI reads the skill service through `ctx.get('skills')`, not a declared injection, because skills mount conditionally: a deployment without the registry keeps a working front door, and `/skill:` there reports that skills are unavailable rather than failing to mount. `createTuiChat` is synchronous while `ctx.skills.list()` is async, so autocomplete seeds the static slash commands immediately and rebuilds the provider with `skill:<name>` entries once the catalog resolves; a resolution that arrives after disposal is dropped, and a rejected lookup keeps the base commands.

Autocomplete filters the invocation-neutral `list()` result with `isUserInvocable`, and manual submission applies the same predicate after trusted `get()` resolves the definition. A user-only skill can therefore appear and load even when model invocation is disabled, while a user-disabled skill is neither advertised nor loadable by exact name. Each completion entry is labeled with its winning source's scope — `(project)` for the `project-` sources, `(user)` for every other source — in the slash-command argument-hint slot, which the menu shows but selection never inserts, so trailing instructions still follow the completed name. An unknown name, an empty name after the prefix, a user-disabled name, and a lookup failure each surface as a transcript notice without sending anything.

`renderSkillInvocation` and the resource-base line are the TUI's own, deliberately not reused from `dsh-tool-skill`'s `skill` tool result. The tool wraps a body in `<skill_content>`/`<skill_resources>`/`<skill_instructions>` for a *tool result*; a manual invocation is a *user turn*, and coupling the two renderers would force one model-facing shape to serve both surfaces. The cost is two renderers that both format a skill body; the benefit is that each surface's model-facing text evolves independently, and each is pinned where it is produced.

## Alternatives considered

**Add a `user-invocable` frontmatter field only inside the original TUI change.** Rejected there because a TUI-only field would have changed the registry, provider, and tool contract without a shared invocation model. The later [independent invocation-policy decision](2026-07-28-skill-invocation-policy.md) adds it across every relevant consumer and preserves `get()` as a trusted primitive.

**Declare `skills` as a TUI injection.** Rejected because skills mount conditionally; a declared injection would make the front door require the registry and refuse to mount without it, contradicting the package's optional-service stance. `ctx.get('skills')` reads the global store and tolerates absence.

**Reuse `dsh-tool-skill`'s renderer.** Rejected because its output is a tool-result shape (`<skill_content>` and siblings) written for the model's tool channel, while a slash invocation is a user message. Sharing it would either leak tool-result vocabulary into a user turn or fork the shared renderer on a `surface` flag — more coupling than two small formatters.

**Route submissions through the model's `skill` tool.** Rejected because the user has already decided; a tool call would spend a model round-trip to fetch a body the front door can load directly, and would not work while the agent is mid-turn.

## Consequences

Manual invocation always reloads the full skill body: the TUI does not detect a skill already present in the conversation, so a repeated `/skill:` appends its instructions again — acceptable because re-injection is sometimes the intent, and documented under the package README's Known Limitations. The two-renderer duplication is a standing maintenance cost accepted above. The `<skill name="…">` wrapper is stable model-visible text and is pinned verbatim in package tests against a real `SkillService`; the package semantic matrix pins the help-panel line. Autocomplete population, user-only discovery, delivery to idle and running agents, and the disposed-lookup and failed-lookup branches are covered by package tests that mount the real registry or a controllable service. The removed product TUI's keyless PTY smoke formerly covered the assembled Loader path; a future terminal deployment owns that application-level scenario.
