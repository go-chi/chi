# Agent Note: Large history provenance is scanned without argument expansion

Status: implemented

English | [中文](2026-08-04-large-history-pagination-call-stack.zh.md)

## Problem

A finalized assistant message can reference hundreds of thousands of streamed chunks through `sourceEventSeqs`. History pagination found the message group's first event with `Math.min(event.seq, ...sourceEventSeqs)`, so a valid session could exceed the JavaScript engine's function-argument limit and make `session.history` fail with HTTP 500.

## Decision

Pagination scans `sourceEventSeqs` and updates the earliest sequence number one element at a time. The algorithm remains linear in the provenance size and preserves the existing page boundary: a page starts before all recorded sources of its oldest included message.

A regression test rejects multi-argument minimum calls and verifies that every provenance event remains on the page with its finalized message. This exercises the failure mechanism without making the default test suite allocate a production-sized chunk stream.

## Alternatives considered

- **Raise the JavaScript stack or argument limit** — rejected: the limit is engine- and deployment-dependent, and array expansion still makes valid history depend on an unrelated runtime ceiling.
- **Truncate `sourceEventSeqs` during pagination** — rejected: this could cut a page inside a message and violate replay grouping.
- **Cap streamed chunk count at the provider boundary** — rejected: providers may legitimately emit long streams, and pagination must handle every valid session representation.

## Consequences

- Large provenance arrays no longer make history pagination throw solely because of their length.
- Pagination semantics and wire responses are unchanged.
- This does not bound the byte size of a history page or the browser cost of replaying it; those performance concerns remain separate from the server-side call-stack failure.
