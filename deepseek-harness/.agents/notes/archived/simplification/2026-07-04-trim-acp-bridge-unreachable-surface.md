# Agent Note: Trim unreachable ACP bridge surface — the branding knobs and the kind-sniffing fallback

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-04-trim-acp-bridge-unreachable-surface.zh.md)

> The handshake-identity simplification remains current. The generic-card fallback was removed when [ACP became automation-only](2026-07-23-acp-automation-only-protocol.md); UI transports retain the provider-neutral presentation contract.

## Problem

Two pieces of `dsh-acp` surface were unreachable from any shipped configuration:

1. **`AcpConfig.agentName` / `agentVersion`** (`packages/acp/acp/src/index.ts`). The shipped app package hands the bridge only its agent target (`packages/examples/acp-demo/src/index.ts`), so no leaf `cordis.yml` — the only production config surface — could set the knobs at all; they were settable solely by direct-mounting the bridge, which only a unit test did. Every snapshot expected output — the hook-matrix scenarios included — pins the schema defaults (`deepseek-harness-acp` / `0.0.1`). The pair also carried a live `TODO(double-default)`: the literals existed twice (schema `.default(...)` plus `??` fallbacks), with the TODO asking to pick one home.
2. **The `toolKindFor` name heuristic** (same file) special-cased `bash*`/`read*`/`write`/`edit*` tool names in the generic-fallback path. Since the [render-intent union](../architecture/2026-07-02-tool-render-intent-union.md), every first-party tool those arms matched ships its own `presentCall` carrying its kind, and the presenter-less production tools (`subagent`, `subagent_fork`) fell through to `other` anyway. The arms were production-reachable only when a tool declined to present its own call — a `presentCall` that THROWS (the containment fallback), or model arguments that fail the tool's schema so `defineTool`'s `presentCall` wrapper returns `undefined` (e.g. a `bash` call missing the required `description`) — and the bridge's own module doc states the design rule the heuristic violated: "the bridge never special-cases tool names".

## Decision

Hardcode the existing handshake identity `{ name: 'deepseek-harness-acp', version: '0.0.1' }` at initialization and remove the unreachable config fields and duplicate defaults. The original implementation also replaced `toolKindFor` with neutral `'other'` at both presenter fallbacks; ACP no longer projects tool cards, so that fallback has left the transport entirely. Initialize tests and snapshots pin the handshake.

## Alternatives considered

### Why not keep them?

Branding can return when the app package exposes it to deployments. Inferring presentation from unknown tool names violates the render-intent contract; neutral fallback cards also preserve raw input for malformed calls and broken presenters.

## Consequences

The bridge exposes no branding knobs. UI transports own generic presentation fallback without tool-name inference, while ACP carries no tool-card surface.
