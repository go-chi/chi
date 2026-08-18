# @deepseek-ai/dsh-llm-replay

English | [中文](README.zh.md)

A replay LLM plugin for keyless snapshot tests. It yields model streams reconstructed from a recorded **session JSONL** fixture, so a test can boot the real agent against a fixed model transcript with no API key. With `providers` configured it registers a replay-only adapter whose catalog is available to scenarios that exercise model discovery; without `providers` it installs the catch-all `llm/stream` waterfall used by tests that do not need discovery.

Its consumers are the ACP and headless `stream-json` snapshot suites plus the Web browser e2e lane. Loader-driven suites mount this plugin in place of a real LLM adapter; the Web lane installs it directly to retain the teardown consumption handle.

## How the fixture works

The fixture IS the persisted session log (`<scenario>/session.jsonl`). Its `assistant/chunk` events carry every `StreamChunk`, so grouping them by `(turn, step)` reconstructs each agent-loop `stream()` call's chunk sequence. A successful compaction summarizer is logged differently: when `compaction/summary` carries `llmStreamCall: true` and its complete `rawOutput`, replay reconstructs a canonical successful stream at that event's position using one `block-start`/`block-end` pair per block, the recorded usage when present, and a terminal `stop`. Exact provider delta partitioning is not part of the durable compaction result. `rawOutput` without the marker does not imply a local LLM call because template and remote summarizers may retain complete output without using this context's adapter.

Recording is therefore "run the real agent once and harvest the `.jsonl`", done by the snapshot harness — this plugin does not record. A fixture may carry its `request/header` content tokenized to `{{system}}`/`{{tools}}` (the harness pins that content in one scenario and scrubs the rest); replay is indifferent — derivation reads only `assistant/chunk` and `compaction/summary` events plus the line-0 session header.

Two failure modes are not reconstructable from `assistant/chunk` alone — a pure throw before any chunk (e.g. an HTTP 401, where the log holds only a `turn/end {error}` and no chunks) and a cancel/hang (timing, not chunk content). A scenario that needs those supplies an optional sidecar (`<scenario>/replay.override.json`) that either replaces the derived script (a bare `ReplayEntry[]`) or augments it (`{ patches: [{ at, entry }] }`: keep every JSONL-derived call and swap the named 0-based call indexes; `at` equal to the derived length appends the retry attempt after an injected transient throw). Patch indexes must be unique. The override document, each patch and entry, and every chunk discriminant are validated when the file loads. A `hang` entry may name `readyFile`; replay writes that empty marker after its prefix chunks reach the loop and before it waits for cancellation, so an external driver can cancel deterministically without observing a presentation update.

A scripted string may embed `{{fromRequest:<regex>}}` to fill a value no static sidecar can know — for example a randomly minted goal id the model must echo back into `update_goal`. At stream time every placeholder resolves against the live request: the corpus is every string leaf of the request messages joined by newlines, the pattern's LAST corpus match wins, and its first capture group (or the whole match without one) substitutes in place. A pattern that matches nothing, an invalid pattern, and an unterminated placeholder each fail loud. The last two braces of a consecutive `}` run terminate the placeholder, so a pattern may end with a brace quantifier (`[0-9a-f]{4}`) but cannot contain `}}` followed by further pattern content. Resolution applies to every scripted entry, including ones derived from the recorded JSONL — a recorded fixture whose text legitimately contains the literal marker must be expressed through a sidecar without it.

## Nested agents: per-session keying

A scenario where a parent agent delegates to in-process subagents records more than one log: the parent (`session.jsonl`) plus one per child (`session.1.jsonl`, …). Each agent runs as its own `Session` on the same context, so replay must serve each one its own script.

Replay keys every call by its calling session id (`GenerateOptions.sessionId`, stamped by the agent loop). Live session ids are freshly random each run and never equal the recorded ones, so a live session binds to a recorded script by **first-call order**: scripts are ordered by header `createdAt` (parent first — it streams before it can delegate), and the first live session to make any call claims the first script, the next new session the next, and so on. Each session then advances its own cursor. A call with no `sessionId` is one anonymous session bound to the primary script. More distinct live sessions than recorded scripts fails loud.

## Config

| Key | Type | Default | Notes |
|---|---|---|---|
| `file` | string | `$DSH_SNAPSHOT_FILE` | Path to the primary (parent) `session.jsonl` fixture. Required (config or env). |
| `overrideFile` | string | `$DSH_SNAPSHOT_OVERRIDE` | Optional `ReplayOverrideDoc` sidecar for the primary session: a bare `ReplayEntry[]` replaces its derived script, while `{ patches }` augments it by call index. |
| `childFiles` | string[] | `$DSH_SNAPSHOT_CHILD_FILES` (path-delimited) | Recorded subagent child-session logs for a nested scenario; empty for a single-session scenario. |
| `providers` | `ReplayProviderConfig[]` | — | Optional replay-only provider and model catalog. Each provider may set `retryPolicy`, and each model may publish `contextWindow` and an `inputModalities` array containing only `text` and `image`; invalid modalities fail during plugin loading. Configured routes dispatch through the replay adapter and never perform provider I/O. |
| `paceMs` | number | — (burst) | Optional per-chunk delay in ms so downstream transports (e.g. the web SSE mux observed by a real browser) see genuinely incremental delivery. A realism knob only — tests must not depend on it for correctness. Non-negative integer; abort during a pace wait cancels the stream promptly. |

```yaml
- id: llm-replay
  name: '@deepseek-ai/dsh-llm-replay'
  config:
    providers:
      - id: deepseek-official
        name: DeepSeek
        retryPolicy:
          mode: normal
          backoff:
            initialDelayMs: 1
            maxDelayMs: 1
            jitterRatio: 0
        models:
          - id: deepseek-v4-flash
            contextWindow: 128000
          - id: deepseek-v4-pro
  # file/overrideFile/childFiles default to $DSH_SNAPSHOT_FILE /
  # $DSH_SNAPSHOT_OVERRIDE / $DSH_SNAPSHOT_CHILD_FILES, set by the snapshot
  # harness per scenario.
```

## Exports

- `installLlmReplay(ctx, config)` — install the configured replay adapter or catch-all `llm/stream` listener; returns a `ReplayHandle` (`dispose()` for HMR safety plus `assertConsumed()`, the teardown check that every recorded script bound to a live session and every bound cursor drained — turning a scenario that silently drove fewer model calls than recorded into a crisp diagnostic). Use this in tests to drive replay without the Loader or env vars.
- `loadSessionScripts(config)` — resolve the ordered `SessionScript[]` (primary + children) for a scenario, ready to bind to live sessions in first-call order.
- `loadReplayScript(config)` — resolve the `ReplayEntry[]` for the primary session only (validated sidecar replacement/patches if present, else derived from the JSONL; fail-loud if the fixture is missing).
- `deriveReplayScript(events)` / `parseSessionLog(text)` / `parseSessionHeader(text)` / `resolveScriptedEntry(entry, messages)` — the pure helpers that turn ordinary loop chunks and explicitly marked local compaction outputs in a recorded session log into a script, read its header `id`/`createdAt`, and resolve `{{fromRequest:...}}` placeholders against one live request. A derived assistant group must end in a `finish` chunk; a group without one is the fingerprint of a thrown `stream()` and must instead be expressed via an override sidecar.
- Types `ReplayEntry` / `ReplayOverrideDoc` / `ReplayOverridePatch` / `SessionScript` / `ReplayConfig` / `ReplayProviderConfig` / `ReplayModelConfig` / `ReplayHandle` / `Config`.

## Plugin export shape

Named `name` / `inject` / `Config` / `apply`, with **no default export**: the cordis Loader's `unwrapExports` does `exports.default ?? exports`, so a stray default would collapse the module to the bare function and drop the `inject` namespace (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

None, as this keyless test adapter sends no request to a provider model; it only replays recorded assistant chunks into the test loop.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **First-call-order script binding assumes sequential delegation** — a cut that runs sibling subagents concurrently would bind live sessions to recorded scripts non-deterministically; a stronger keying is deferred until such a scenario exists (`XXX(concurrent-subagents)`).
- **Only ordinary loop chunks and marked local compaction outputs are derivable** — a pure pre-chunk throw, a cancel/hang, or an unmarked external summarizer call needs the `replay.override.json` sidecar. Replacement and patch forms affect only the primary session; child scripts still derive from their logs.
