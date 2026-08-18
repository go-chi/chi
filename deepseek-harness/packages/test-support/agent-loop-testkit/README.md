# `@deepseek-ai/dsh-agent-loop-testkit`

English | [中文](README.zh.md)

Shared prerequisite mounting for tests that exercise the concrete `AgentLoop`. `mountAgentLoopTestDependencies(ctx, options?)` installs the LLM, session, system-prompt, tool, and agent services in dependency order, then returns before the loop is mounted.

The caller registers adapters and optional plugins, mounts `AgentLoop` with the configuration under test, and disposes its own Context. System-prompt and tool-registry configuration can be forwarded through `options`; the helper does not provide test defaults beyond those owned by the services. A plugin-load failure rejects the helper call, while services activated earlier in the sequence remain owned by the caller's Context.

```ts
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'

const ctx = new Context()

await mountAgentLoopTestDependencies(ctx)
// Register the test adapter and any optional plugins here.
await ctx.plugin(AgentLoop, { agents: [] })
```

Tests of injection failures, partial topology, service load order, or service teardown mount their dependencies directly instead of using this helper.

## Model Experience

None, as this test-only composition helper neither drives nor modifies model requests.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Only the mandatory prerequisite spine is shared** — adapters, optional plugins, `AgentLoop`, agents, and Context teardown remain caller-owned so scenario-specific ordering stays visible.
