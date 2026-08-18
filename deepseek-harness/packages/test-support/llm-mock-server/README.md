# `@deepseek-ai/dsh-llm-mock-server`

English | [中文](README.zh.md)

A scriptable OpenAI-compatible HTTP/SSE server for exercising real LLM adapters, the agent loop, and recovery policy without a provider key. It accepts `POST /chat/completions` and `POST /v1/chat/completions`; each accepted request consumes one configured behavior in arrival order. Invalid methods, paths, bearer tokens, and JSON do not consume the script.

The library entry exports `startMockLlmServer(options)`, behavior and telemetry types, the default random stress weights, the accepted Node timer bound, and a running handle with the bound `baseURL`, generated or configured `randomSeed`, captured requests, and idempotent `close()`. Closing force-terminates stalled connections.

## Standalone use

Run the source entry from this repository:

```sh
pnpm run mock:llm -- \
  --port 8000 \
  --api-key mock-key \
  --sequence partial_disconnect,success \
  --partial-text "discard this half"
```

Point the shipping DeepSeek adapter at the server; it appends `/chat/completions` to the configured base:

```sh
DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1 \
DEEPSEEK_API_KEY=mock-key \
pnpm dsh --profile headless "test provider recovery"
```

The repository script writes JSONL to stdout: a `ready` record carries the `/v1` base URL and random seed, followed by request/result records that name both the scripted behavior and the concrete selected behavior. The private support package exposes no installable binary.

## Behavior script

`--sequence` is a comma-separated FIFO. Exhaustion returns a structured HTTP 500; `--repeat-last` explicitly reuses the last entry.

| Behavior | Wire result |
|---|---|
| `connection_reset` | Destroy the socket before HTTP headers |
| `stream_disconnect` | Send SSE headers, then reset before the first event |
| `partial_disconnect` | Send text deltas, then reset the socket |
| `stall` | Send SSE headers and remain idle until client/server cancellation |
| `empty` | Send a valid content-less stop and `[DONE]` |
| `empty_body` / `stream_eof` / `partial_eof` | End cleanly without the required `[DONE]` boundary |
| `malformed_json` / `malformed_event` | Send invalid SSE JSON or an invalid provider chunk shape |
| `rate_limit` / `server_error` / `service_unavailable` | Return retry-oriented 429/500/503 JSON errors |
| `auth_error` / `invalid_request` / `context_overflow` / `quota_exceeded` | Return terminal or separately recovered provider errors |
| `success` / `slow_success` / `reasoning_success` | Stream a complete text response, optionally delayed or preceded by reasoning |
| `tool_call_success` / `max_tokens` | Complete with a tool call or `length` finish |
| `wrong_content_type` | Send a valid SSE body under `application/json` |
| `random` | Select a concrete request behavior from weighted seeded randomness |

`connection_refused` is CLI-only and must be the first entry. It delays binding a caller-specified nonzero port, so requests during `--listen-delay-ms` receive a real TCP refusal; the remaining entries begin after the listener starts.

## Random mode

Use a repeating `random` entry for an open-ended mixed run:

```sh
pnpm run mock:llm -- \
  --port 8000 \
  --sequence random \
  --repeat-last \
  --seed 42 \
  --random-weights 'success=60,slow_success=10,connection_reset=5,stream_disconnect=5,partial_disconnect=10,empty=5,server_error=5'
```

Omitting `--seed` generates one and prints it in the `ready` record. `--random-weights` accepts non-negative relative `behavior=weight` entries and requires at least one positive concrete behavior. The exported default is a success-heavy stress profile containing reset, disconnect, partial output, empty completion, stall, 429/5xx, clean truncation, and malformed JSON; it is test pressure, not an estimate of production incident frequency. `connection_refused` is excluded because a bound request handler cannot produce a true refusal.

When random weights include `stall`, configure the client under test with a short stream-idle timeout so the scenario terminates promptly.

## Timing and content controls

The CLI exposes `--success-text`, `--partial-text`, `--reasoning-text`, `--chunk-size`, `--chunk-delay-ms`, `--disconnect-delay-ms`, `--retry-after-ms`, `--request-id`, `--tool-name`, and `--tool-arguments`. Millisecond delays are bounded integers within Node's timer range; `retryAfterMs` must also be positive. The library accepts the same camel-case options. An optional exact `apiKey` validates `Authorization: Bearer <token>`; omission accepts any token.

## Model Experience

None, as this test server substitutes provider wire behavior without invoking a real model.

#### KV Cache effect

None; requests terminate locally and never reach a provider cache.

## Known Limitations and Deferred Work

- **Random weights model test pressure, not production incidence** — callers that want an environment-specific distribution must provide measured weights and record the emitted seed.
- **Request scripts are arrival-ordered** — concurrent callers share one cursor, so deterministic per-session fault assignment requires separate server instances.
- **True connection refusal is a listener lifecycle phase** — the CLI delay must overlap the client attempt; request-level random selection can only reset an accepted connection.
