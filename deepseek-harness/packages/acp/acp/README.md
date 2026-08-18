# @deepseek-ai/dsh-acp

English | [中文](README.zh.md)

Automation-only [Agent Client Protocol](https://agentclientprotocol.com) server over JSON-RPC stdio. Programmatic clients create fresh harness agents, send text/image prompts, collect committed assistant text/images, resolve one-shot permission requests by policy, and cancel work. The primary in-repository client is [`dsh-subagent-acp`](../../subagent/subagent-acp/README.md).

This package is a transport adapter, not a UI integration or a capability seam. It does not expose editor navigation, transcript replay, commands, modes, configuration pickers, elicitation, reasoning, plans, titles, or tool presentation. Interactive rendering and human questions belong to the Web host and client modules.

## Plugin

`apply(ctx, config)` opens an `AgentSideConnection` on stdin/stdout and drives `ctx.agents`. Stdout is reserved for protocol frames.

| Config | Default | Meaning |
|---|---|---|
| `provider` | — | Initial provider route for every created agent. |
| `model` | — | Initial model for every created agent. |

Both fields are optional so another agent/request listener may supply the target. The runnable ACP composition requires both.

## Protocol contract

| Method | Behavior |
|---|---|
| `initialize` | Negotiates the supported version. Image prompts are advertised only when a durable attachment store is mounted and the configured exact provider/model resolves with explicit image input; audio and embedded context stay false. No session, editor, terminal, filesystem, or MCP capability is advertised. |
| `authenticate` | No-op because the server advertises no authentication methods. |
| `session/new` | Creates a fresh agent with an absolute primary `cwd`; empty `additionalDirectories` and `mcpServers` are accepted, non-empty values reject. |
| `session/prompt` | Preserves ordered text and supported inline image blocks, renders resource links as bracketed textual references, and rejects audio, embedded resources, malformed/empty input, or an image when capability was not advertised. It validates the whole image batch and rechecks the session's latest exact route before any save, commits every image before the user event, permits one in-flight request per session, and waits for admission plus, once queued, whole-Agent idle and ordered output delivery. Normal quiescence reports `end_turn`; explicit ACP cancellation, disposal, or a prompt whose admission was discarded (a turnless slot) reports `cancelled`. |
| `session/cancel` | Marks and aborts any in-progress admission without cancelling or waiting for unrelated Agent work; once this prompt has entered the Agent inbox, it cancels the addressed Agent and waits for the owned interval to quiesce. No late user message is published and the prompt settles as `cancelled`. With no in-flight prompt it cancels autonomous work; unknown ids are no-ops. |
| `session/update` | Emits one `agent_message_chunk` per non-empty text or image block in a committed `assistant/message`, preserving order. Images are re-read and integrity-verified before inline base64 delivery. Raw deltas and non-message events are omitted. |
| `session/request_permission` | Offers one-shot allow/reject choices for bridge-owned approval requests carrying a tool call id. Clients may answer automatically. |

One connection may own several sessions. The bridge keys records by branded session id and checks exact agent identity before routing events or permission requests. Each session has an independent prompt slot, workspace, cancellation path, and disposer.

Committed-message output intentionally trades token-by-token latency for a clean automation result. Uncommitted provider chunks and retry attempts cannot leak partial text or images; reasoning and tool activity remain in the session log for observability through other interfaces. Per-session delivery is serialized because attachment reads are asynchronous, and a missing or corrupt committed image fails the prompt response instead of emitting a placeholder.

## Lifecycle

Client disconnect and Cordis disposal share one memoized teardown. The bridge first rejects new sessions and prompts, cancels and quiesces prompt admission, agent activity, and ordered output delivery, then drains continuable descendants only below this connection's exact owned Agents before disposing those handles in parallel and awaiting every result before reporting any failure. Other frontends sharing the Context retain their continuable forests and admission. An ACP-only plugin reload therefore leaves no orphan agent.

ACP requires each prompt response to carry a `stopReason`, but the bridge does not claim a prompt-specific turn outcome. The operation interval starts when the prompt enters the Agent inbox and ends after admission, whole-Agent idle, and ordered output delivery all quiesce; failures from unrelated Agent work before that inbox receipt are not attributed to the prompt. Committed assistant messages stream across the owned interval, and steering or injected work may contribute before idle. Settlement precedence is explicit cancellation, output-delivery failure, interval-wide Agent failure, then the correlated turn ending. Token-limit endings settle as `end_turn`; a correlated model error rejects only at the same quiescence boundary.

## Running

`pnpm --dir /path/to/deepseek-harness run demo:acp` boots the repository's automation server composition. A parent harness can spawn it through [`@deepseek-ai/dsh-subagent-acp`](../../subagent/subagent-acp/README.md); other ACP clients need only the core methods above.

## Model Experience

### Prompt text and images

#### What the model sees

`session/prompt` preserves text/image order in one user message; adjacent text is concatenated, and a resource link appears as a bracketed `[resource_link name=… uri=…]` reference the model may open with its own tools. Inline image base64 is discarded after batch admission, so the durable message contains only verified attachment references. Protocol metadata, client capabilities, permission choices, and session ids never enter the model request.

#### Token effect

Prompt tokens and image charges are data-dependent and remain in that session's history until compaction. Concurrent ACP sessions retain independent contexts.

#### KV Cache effect

Append-only; the new user message follows the reusable request prefix and does not invalidate prior cache entries.

### Permission decisions

#### What the model sees

Nothing directly. The owning tool records its allowed, rejected, cancelled, or unavailable outcome through the normal tool-result path.

#### Token effect

Only the owning tool result contributes tokens.

#### KV Cache effect

Append-only through the owning tool result.

## Known Limitations and Deferred Work

- **Fresh sessions only** — load, list, resume, delete, and fork are unsupported.
- **Raster images and one workspace only** — image prompts require a durable store plus an exact route that declares image input; only PNG, JPEG, WebP, and GIF are accepted. Audio, embedded resources, non-empty additional directories, and MCP servers reject; resource links flatten to textual references rather than fetched content.
- **Committed answers only** — live progress, reasoning, tool activity, plans, titles, and usage stay off the wire.
- **Connection-owned lifetime** — one connection releases all of its sessions; per-session close is not implemented.
