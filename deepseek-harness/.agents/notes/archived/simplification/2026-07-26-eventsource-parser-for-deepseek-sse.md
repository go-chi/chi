# Agent Note: Replace the hand-rolled SSE parser in llm-deepseek with eventsource-parser

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-26-eventsource-parser-for-deepseek-sse.zh.md)

## Problem

`packages/llm/llm-deepseek/src/sse.ts` hand-implemented Server-Sent Events parsing: a streaming `TextDecoder`, event-block splitting on `\r?\n\r?\n`, `data:` payload extraction and joining, comment/field skipping, the `[DONE]` sentinel, a `STREAM_CLOSED` error on EOF without it, and a flush of a final unterminated event block. The file was ~67 lines with ~108 lines of dedicated tests (`tests/sse.spec.ts`) re-proving SSE spec behavior — UTF-8 split across chunks, CRLF handling, multi-`data:` joining, no-space-after-colon — that a maintained parser already guarantees. Its only consumer is `adapter.ts` (`yield* translate(parseSse(response.body))`).

This is exactly the surface `eventsource-parser` owns: the de-facto standard SSE parser (it underlies the Vercel AI SDK and the MCP SDK), zero-dependency, actively maintained, and already present in this repo's lockfile transitively via `@modelcontextprotocol/sdk` — so adopting it directly adds no new supply-chain surface in practice.

## Decision

`sse.ts` delegates SSE framing to `EventSourceParserStream` from `eventsource-parser/stream`: `parseSse` pipes the response body through `new TextDecoderStream()` then `new EventSourceParserStream()` and keeps only the DeepSeek protocol shim — yield each event's `data`, terminate on `[DONE]`, and throw `LlmError('STREAM_CLOSED')` when the stream ends without the sentinel. All required builtins (`TextDecoderStream`, `pipeThrough`, async-iterable `ReadableStream`) exist at the Node ^22.19 engine floor. The spec-conformance tests are gone; `tests/sse.spec.ts` pins only the `[DONE]`/`STREAM_CLOSED`/EOF contract. `eventsource-parser` is `llm-deepseek`'s second runtime dependency after schemastery. The [twin-adapters note](../architecture/2026-06-13-twin-llm-adapters.md) and the `dsh-llm` JSDoc that branded this adapter "hand-rolled fetch + SSE parsing" now describe it as direct fetch with library-framed SSE.

The library also strips a leading BOM (the hand-rolled parser would fail to match `data:` after one) and offers `maxBufferSize` hardening the hand-rolled parser lacked.

## Alternatives considered

- **Keep the hand-rolled parser.** Defensible under the [twin-adapters decision](../architecture/2026-06-13-twin-llm-adapters.md): the adapter is deliberately the hand-rolled design-verification twin of the pi-ai adapter. But that note's load-bearing distinction is owning the fetch/translate internals versus delegating to a full provider SDK; a ~700-byte SSE micro-parser is transport plumbing, not the design under verification. The twin-adapters note now states that reading explicitly.
- **`createParser({onEvent})` callback API instead of the stream.** Works fed by a manual `TextDecoder` loop, but the `pipeThrough` composition deletes more of the hand-rolled code.

## Consequences

- The remaining shim only encodes the DeepSeek `[DONE]`/`STREAM_CLOSED` protocol; SSE framing edge cases are eventsource-parser's contract and are no longer re-proven here.
- One deliberate robustness deviation is dropped: the hand-rolled parser flushed a final event block that lacked its terminating blank line, so a trailing `data: [DONE]` without `\n\n` still yielded DONE. eventsource-parser is spec-strict and only dispatches on the blank line, so that shape is now `STREAM_CLOSED`. Real providers and `dsh-llm-mock-server` always terminate events properly — the flush was a robustness nicety, not an observed provider shape — and `tests/sse.spec.ts` pins the new truncation verdict for that tail.
- The documented "hand-rolled" identity of the twin adapter narrows to the fetch/translate internals; the twin-adapters note was updated in the same change rather than leaving the claim stale.
