# @deepseek-ai/dsh-session-title-llm

English | [中文](README.zh.md)

Shared implementation policy for model-backed session-title providers. It resolves the auxiliary route, frames exact selected human messages as JSON, records the exact dispatchable request, applies a language-aware title instruction, enforces input and output budgets, composes timeout and caller cancellation, assembles the stream, and returns normalized text with exact source seqs plus the provider/model route used to generate it.

This package is a library, not a Cordis plugin. The provider plugins call `registerSessionTitleLlmProvider()` with their cadence and message selector; it validates shared config and delegates each revision to `generateSessionTitleWithLlm()`, so registration, route, prompt, cancellation, and validation behavior cannot drift between them.

## Route and failure contract

`provider` and `model` overrides are optional but must be supplied together as non-empty strings. Without that pair, the helper uses the exact provider/model route captured from the current session's logged `request/header`; an explicit refresh before any route exists therefore needs overrides. The helper measures the final JSON-framed user prompt, including seq fields, wrappers, and JSON escaping, against `maxInputBytes` before logging or dispatch instead of truncating it. Timeout and caller cancellation are rechecked while consuming the stream and after it completes, so a late successful result cannot be accepted even if an interceptor or adapter ignores abort. Malformed or empty output, tool calls, and non-stop finish reasons also reject; the session-title service decides whether that rejection is an automatic warning or an explicit caller failure.

After route and input validation, the helper appends a log-only `session/title-llm-request` event directly through `Session` before model dispatch. It contains the title-provider id, exact source seqs, route, system prompt, message list, and output-token cap used by the call. Persistence observes the record eagerly; the append does not need a title-specific marker, cast, settlement queue, or flush. The dispatched envelope is deep-frozen, carries `purpose: 'session-title'`, and deliberately lacks dsh-agent-loop's process-local request identity. Interceptors stay aligned with the record while loop-only reconstruction observers do not compare it with the conversation header. The DeepSeek adapter maps that purpose to thinking-disabled so the small output budget is reserved for visible title text; other adapters own their purpose-specific behavior. A later model failure leaves the request record intact; validation failures that never become dispatchable requests do not create one. The event stays outside derived model history.

## Configuration

Every field is required except the paired route override; there are no library defaults.

| Key | Contract |
|---|---|
| `targetWords` | Positive target word count for non-CJK titles. |
| `targetCjkCharacters` | Positive target character count for Chinese, Japanese, or Korean titles. |
| `maxInputBytes` | Positive UTF-8 byte ceiling for the final JSON-framed user prompt. |
| `maxOutputTokens` | Positive auxiliary generation token cap. |
| `timeoutMs` | Positive end-to-end deadline within the runtime timer limit. |
| `provider`, `model` | Optional explicit route; both or neither. |

## Model Experience

### Auxiliary title request

#### What the model sees

The title model receives a fixed system instruction to return one concise unadorned title in the input language, including the configured word and CJK-character targets. Its one user message contains a JSON array of the exact selected human messages and their seqs.

#### Token effect

The auxiliary request consumes tokens according to selected input size and `maxOutputTokens`. It is separate from the main agent request and does not add title text or framing to agent history. DeepSeek title calls disable thinking; the main conversation retains its configured thinking mode.

#### KV Cache effect

No main-request invalidation. Auxiliary cache reuse is provider-specific; the fixed instruction is reusable while the JSON message array changes with each revision.

## Known Limitations and Deferred Work

- The helper accepts text output only and rejects tool calls; structured-output adapters and provider-specific prompt variants are not exposed.
- It enforces a byte ceiling for the whole framed user prompt rather than clipping individual messages or applying a retention policy.
