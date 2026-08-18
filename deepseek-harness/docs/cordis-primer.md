# Cordis Primer

English | [中文](cordis-primer.zh.md)

Cordis is the vendored plugin framework underneath DeepSeek Harness. This primer teaches the Cordis ideas a harness plugin author needs before reading the generated service/event reference on the [subsystem pages](subsystems/core.md); the [Cordis tutorial](cordis-tutorial/index.md) walks the same ideas hands-on. The vendored source and sync procedure live in [vendor/README.md](../vendor/README.md).

## Cordis In Five Ideas

- **A plugin is a object that implements Service.** It can be a function with optional `inject` and `apply(ctx)` fields, or a `Service` subclass whose lifecycle Cordis mounts into the current context.
- **A context is a repository of services.** A service claims a stable `ctx.<key>` such as `ctx.tools`, `ctx.llm`, or `ctx.sessions` from a context; other plugins find services via key instead of importing a concrete implementation.
- **Declare service dependency via `inject`.** A plugin that names required services waits until those services exist, so load order is expressed through service requirements rather than manual boot sequencing.
- **Typed Events for communication.** Services declare event names through TypeScript declaration merging, then dispatch them as `emit`, `waterfall`, `parallel`, or `serial` depending on whether listeners observe, wrap, fan out, or run in order.
- **Registrations are reversible effects.** Prompt sections, tool schemas, adapters, providers, and listeners are installed through `ctx.effect()` or `ctx.on()` so reload and teardown unwind them predictably.

## Dispatch Modes

Every event can have one of the following dispatch mode and can only be dispatched by these methods accordingly.

| Mode | Awaited? | Dispatch Order | Has Return Value? |
|---|---|---|---|
| `emit` | No | listeners observe in registration order | No |
| `waterfall` | No | listeners observe in registration order | Yes |
| `parallel` | Yes | all listeners observe the event in parallel | No |
| `serial` | Yes | listeners observe in registration order | Yes |

The dispatch mode is part of the event's public contract. New harness events document it with an `@mode` tag so the generated catalog can check declarations against dispatch sites.

## Cordis Waterfall Semantics

`ctx.waterfall` is around-middleware. A listener receives `(...args, next)`. Call `next()` to delegate the possibly wrapped result to the next service; return without `next()` to short-circuit. Values propagate through `next()`'s return value.

Cooperative listeners usually mutate a shared request or decision object and then delegate. A listener can also choose to replace the result entirely and downstream listeners will only see the result after replacement. Use `prepend: true` only when the listener must run before ordinary registrations.

For single-decision events, short-circuiting is the design. A policy listener can return without `next()` when it owns the decision, while a listener that only annotates or observes must delegate.

## Loader Configuration

`@deepseek-ai/cordis-plugin-include` parses `!!js` into expression nodes. Loader interpolates an entry's `config` (after declared injections activate, against that plugin context — `ctx.serviceName`) and its `disabled` field (at every mount decision, against the loader context); Include preserves nested row expressions until target activation. Other entry metadata stays literal. Use overlays when the environment selects plugins.

## Practical Rules

Encapsulate behavior into plugins: a tool pipeline event belongs to `ctx.tools`, model streaming belongs to `ctx.llm`, and live agent coordination belongs to `ctx.agents`. Prefer events for interception and policy; prefer service methods for direct capability calls.

Every registration should have a disposer, either by returning one from `ctx.effect()` or using a Cordis helper that does it for you. If teardown order matters, keep the related work in one effect so disposal unwinds in the intended sequence.
