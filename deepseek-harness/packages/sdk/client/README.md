# @deepseek-ai/dsh-sdk-client

English | [中文](README.zh.md)

The TypeScript client SDK for driving a DeepSeek Harness runtime as a subprocess over stdio JSON-RPC — the design twin of the [Python SDK](../../../python/README.md) (`deepseek-harness`), sharing the same runtime peer, protocol, and layering: `DeepSeekHarness` is the high-level owned-run API, `HarnessClient` the lower-level protocol client. The package root enumerates the consumer interface: the two client layers, caller-facing types, and `JsonRpcResponseError`; source modules, normalization helpers, and subscription-delivery machinery are not consumer imports. A pure library: it registers nothing on a Cordis context; the runtime process it spawns is a complete harness whose composition its own `cordis.yml` decides.

Unlike the Python SDK, the launch spec is fully explicit (`command`/`args`): this package is for repo-adjacent TypeScript consumers — including the [`dsh-subagent-dsh-sdk`](../../subagent/subagent-dsh-sdk/README.md) backend and automation — that know which runtime they are launching. Bundled-runtime resolution (finding a packaged executable) remains the Python distribution's concern.

## DeepSeekHarness

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

await using harness = new DeepSeekHarness({
  launch: { command: 'node', args: ['lib/bin.js', 'cordis.yml'] },
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  maxTokens: 49_152,
})
const result = await harness.run('say hi')
console.log(result.finalResponse)
```

The subprocess starts lazily on first use and stays owned by the instance across `run()` calls; `close()` (or `await using`) is required so the child is always reaped. `start()` memoizes the `initialize` handshake (the workspace cwd — resolved absolute before it crosses the wire — plus the provider/model route and optional positive `maxTokens` output cap); a failed handshake reaps the runtime and swaps in a fresh client, so a later call retries with a new subprocess (until `close()`, which is terminal). The cap applies to each root-agent request and is inherited by in-process descendants; compaction plugins own their separate summary limits. `session(id?)` opens a named or fresh session handle.

`run(input, { sessionId?, onNotification? })` owns one activity interval: it queues the prompt, waits until its `MessageId` appears in a durable `agent/inbox/spliced` receipt, then collects through the next whole-agent `idle`. It returns `RunResult { sessionId, finalResponse, events, notifications }`. `finalResponse` is the last committed root-session assistant text in that interval, not a response causally assigned to the prompt; steering, injected context, and other queued work may contribute before idle. `events` contains root-session events, while `notifications` also contains descendants discovered from `subagent.started`, all in wire order. The result carries no prompt-level status or turn reason. Transport loss, timeout, and protocol violations reject; model outcomes remain observable in the event stream without being attributed to one input.

## HarnessClient

The protocol client under the owned-run API: explicit `start()`/`initialize()`/`prompt()`/`request()`/`close()`, plus notification subscriptions. `prompt()` returns the queued message id as soon as the runtime accepts it; it never waits for agent activity. `subscribe(filter?)` returns a `NotificationSubscription` (awaitable `next()`, non-blocking `tryNext()`, async iteration); `subscribeSessionTree(id)` scopes to one session and the descendants discovered from `subagent.started` lineage edges — the runtime notifies for every session in its context, and scoping is client-side, exactly like the Python SDK. Error surfaces are typed and exported from this package: `JsonRpcResponseError` (wire error response, code/data preserved), `RequestTimeoutError` (a configured bound elapsed), `SdkProtocolError` (a response outside the documented protocol), `TransportClosedError` (the runtime is gone — message carries the exit code and a bounded stderr tail).

`close()` requests protocol `shutdown` (bounded by `shutdownTimeoutMs`, default 1000 ms), then walks a stdin-EOF → SIGTERM → SIGKILL ladder (`disposeEofGraceMs` default 6000, `disposeGraceMs` default 3000) until the process has actually exited. The ladder is private to this client: it runs outside any harness context, so it cannot ride the [`dsh-subprocess`](../../subprocess/README.md) service — the seam's documented exception for SDK-managed transports. It is idempotent, and a closed client refuses reuse.

`HarnessClientOptions.env` replaces the child environment entirely when given (`undefined` inherits the parent's); callers own credential policy — `scrubbedParentEnv` from `dsh-subprocess` is the shared scrub base for isolation-minded launches.

## Model Experience

None, as this is a client-process library; the model runs in the spawned runtime, whose experience is owned by the plugins its `cordis.yml` composes.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No bundled-runtime resolution** — callers name the runtime executable explicitly; packaged-executable discovery stays Python-side until a TypeScript distribution consumer exists.
- **No mid-turn cancel** — the wire has no prompt-cancel method; abandoning a turn means closing the runtime (see the protocol's [Known Limitations](../protocol/README.md)).
- **No per-prompt result or cancel** — low-level `prompt()` returns only an enqueue receipt; high-level `run()` owns receipt-to-idle collection, and abandoning it means closing the runtime.
- **Client→server notifications and server→client requests are unimplemented** on both wire ends; the transport carries them for future approval flows.
