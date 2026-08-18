# Agent Note: Prune unused web seam fields

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-12-prune-unused-web-seam-fields.zh.md)

## Problem

The web capability carries request/result/status values that every shipped implementation populates but no production consumer reads. `WebSearchResult.providerId` and `query` and `WebFetchResult.providerId` are result echoes; `tool-web` formats only content/sources/truncation or final URL/status/body/truncation, and no other runtime reads them. Search providers return `WebProviderStatus.reason`, but resolution checks only `available` and intentionally emits a generic unavailable diagnostic.

`WebFetchRequest.timeoutMs` is likewise never set by a production caller. `tool-web` supplies only the URL, uses the tool definition's timeout plus `exec.signal` for the caller deadline, and relies on the local provider's configured default as a backstop. The unused per-request override forces `web-fetch-local` to expose `maxTimeoutMs`, clamp two timeout sources, and document/test precedence no product path can select. `WebExecContext` is another one-field wrapper: every caller allocates `{ signal }` and every provider immediately unwraps `exec?.signal`; no second execution-control field exists.

## Decision

The web seam omits the search/fetch `providerId` result echoes and search `query` echo; callers already own the request and provider selection. Providers expose availability as a boolean-returning method. Fetch requests have no per-request timeout or `maxTimeoutMs` clamp; the local provider retains its configurable default timeout and the tool retains its own deadline. Provider methods receive a direct optional `AbortSignal` instead of a one-field `WebExecContext` wrapper.

All web implementations and the model-facing tool use the smaller contract. The interface/implementation/consumer package split, provider selection, source citations, final-URL/status data, truncation reporting, and safety limits remain.

## Alternatives considered

**Keep self-describing results, per-request deadlines, and an extensible execution-context object.** Result echoes can help generic telemetry, a request timeout can help trusted programmatic callers, and the wrapper leaves room for future controls. No such consumer/second field exists; carrying duplicate identity, a second deadline policy, and wrap/unwrap plumbing through every provider makes the current contract harder to implement and explain. If telemetry or per-call budget control arrives, it should define which deadline wins, where provider identity is observed, and whether multiple controls justify a context object.

## Consequences

Every retained web request/result field is consumed by production code or required to execute the provider request. Tool-visible search/fetch output, provider fallback, abort behavior, the configured timeout backstop, truncation, and citations remain covered without a request-timeout precedence branch or execution-context wrapper.

Pre-release programmatic callers lose result provenance echoes and per-request fetch deadlines. The provider still has a deployment-configurable timeout and respects cancellation, so the simplification removes configurability rather than a safety bound.
