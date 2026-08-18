# dsh-persona

English | [中文](README.zh.md)

The agent persona as a composable row. It can either shadow the deployment persona or own the complete system prompt.

[`dsh-system-prompt`](../../core/system-prompt/README.md) owns the deployment persona as its own config and registers that section unconditionally, so a process has exactly one. An [agent preset](../agent-presets/README.md) cannot mount the prompt registry itself — without a row of its own, a preset could change an agent's tools but never its identity. This package is that row.

## Scope-only

Mounting this row outside an agent scope collides with the registry's own `deployment:persona` registration and fails loud. That is not a limitation to work around: the deployment persona already has an owner, and the whole point of this row is to shadow it for one agent. Mount it inside a preset composition, where the preset mount supplies the agent scope.

## Config

| Field | Default | Meaning |
|---|---|---|
| `text` | required | Persona prose rendered as the `deployment:persona` section |
| `complete` | `false` | Restore this persona after assembly as the only system-prompt section |
| `includeRuntimeContext` | `true` | Include dynamic runtime-context snapshots for this agent scope; false suppresses every context contribution without disabling its owning services |

`text` is a template, like any prompt section: complete `{{…}}` groups resolve strictly against registered prompt variables when the prompt renders, not when it assembles. Empty text still occupies the slot, so it shadows the deployment persona away entirely and then disappears at render. With `complete: true`, assembly still resolves contexts, tools, variables, and cooperative listeners, then the prompt registry restores this exact persona as the sole section; no identity, tool guidance, or listener can append prompt text. With `includeRuntimeContext: false`, context providers are not evaluated for this scope and contexts added by assembly listeners are discarded.

## Model Experience

### The persona section

#### What the model sees

The `deployment:persona` section at order 0, immediately after the harness identity opener, carrying exactly this row's configured `text` with prompt variables resolved. For an agent whose preset mounts this row, it replaces whatever persona the deployment configured. In complete mode, the model sees only this rendered section as its system prompt. Runtime context remains enabled by default. When disabled, a fresh agent receives no runtime-context snapshot from sandbox policy, approval policy, delegation, or another system-prompt context provider.

#### Token effect

Fixed for a given preset: the persona's own tokens on every request that agent makes, and none for any other agent. Empty text contributes nothing. Complete mode removes every other system-prompt token for that agent.

#### KV Cache effect

Prefix-stable for the life of an agent — the row mounts once, before the agent is published and therefore before its first request, and its text never changes while the agent runs. Two agents on different presets establish different prefixes from this section onward; neither can invalidate the other's reuse.

## Known Limitations and Deferred Work

- **No global mount** — the prompt registry owns the unscoped persona slot, so this row is usable only from a scoped composition. A deployment-wide persona change belongs in the `system-prompt` row's own config.
