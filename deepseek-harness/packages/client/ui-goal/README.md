# @deepseek-ai/dsh-client-ui-goal

English | [中文](README.zh.md)

Goal surface plugin, browser half: the `GoalBar` strip is the second standalone card in the `conversation.input.dock` composer-context stack (order 10, after Todo and before Queue). The live goal arrives through `useProjection('goal')` — the host-computed whole value seeded by the history tail page and updated by `session/projection` frames — so the plugin owns no domain store, refresh chain, or event listener. The slot inject face carries only the four mutation verbs (edit / pause / resume / clear through `ctx.remote.goals` — an active goal offers the pause action, a paused one resume); each reads the CAS ref from the session's current projected value at call time and surfaces the rejected Remote error inline. The strip single-flights mutations synchronously because React's pending render cannot fence same-frame clicks; after a successful clear it immediately suppresses that exact goal id while the authoritative null projection catches up. Goal creation stays on the `/goal` host command; loading, absent, completed, and successfully cleared goals render nothing.

The plugin separately projects each durable `/goal` `command/run` through its own Conversation Definition. It builds a `command-input` Chat Node before the generic command result Node and registers that Node's keyed renderer as a right-aligned 14px/22px monospace user-style bubble with the localized group name `Command input` / `命令输入` and no timestamp, copy, or branch actions. The visible non-command Node activates fresh Chat; reload reconstructs it from the run, while a history window containing only `command/done` keeps only the generic result row. This projection never creates `user/message` or a model turn.

The `/client` exports are the plugin body (`apply`/`inject`), the `GoalBar`/`GoalDock` components, and the injected verb face types.

## Model Experience

Indirectly, through the `goals/edit`, `goals/pause`, `goals/resume`, and `goals/clear` Remote methods the strip invokes: each accepted mutation commits in a durable `agent/inbox/spliced` insertion, which the goal projection folds immediately, and queues a `goal/change` context message. The model sees that context only if a later pre-step admits it; discarding the queued message does not roll back the projected state. The strip itself adds no prompt content.

#### KV Cache effect

None unless the queued goal context is admitted. An admitted context extends the history tail like any other message; an insertion discarded before admission does not affect the cache.

## Known Limitations and Deferred Work

- **Durable phase only** — the projection omits process-local activation, so the strip cannot distinguish an active-but-disarmed goal from an armed one; resume re-arms through the RPC side. There is no host-live activation channel.
