# Agent Note: A minimal read_image tool over existing seams

Status: implemented

English | [中文](2026-08-10-minimal-read-image-tool.zh.md)

## Problem

The multimodal attachment work gave user uploads a complete durable path — bytes committed to the content-addressed attachment store before the owning `user/message`, an `ImageBlock` carrying only the `sha256:` reference, and the pi-ai route re-reading verified bytes per request — but the model itself had no way to look at an image on disk. `read` rejects binary content by contract, so an agent asked about a screenshot or a rendered chart either failed or shelled out to lossy workarounds. A first standalone attempt (PR #598) solved this together with loop-level route scoping: an `agent/request-ready` extension point publishing exact-model modalities before assembly, per-route schema/guidance visibility, and a reversible `image-placeholder-v1` history projection so text routes could continue over placeholder text. That design worked but coupled a tool to new agent-loop machinery, three new session-log concepts, and per-step registration churn — far more surface than the capability needs.

## Decision

Ship the smallest tool that loads an image into the next request's context, entirely over existing seams; the withdrawn PR #598 design is the explicit counter-example this note records.

- **`read_image` lives in `dsh-tool-fs`** beside `read`/`write`/`edit`. Extension selects the declared PNG/JPEG/WebP/GIF media type; the attachment store's magic-byte and pixel validation stays authoritative. Bytes travel `ctx.fs.stat` → bounded `ctx.fs.readBytes` → `ctx.attachments.saveImage` → `fs/observed`, and the tool result is the metadata envelope plus a real `ImageBlock` — `ToolResultBlock.content` already admits image blocks, the pi-ai adapter already renders them, and the Web host's model-switch guard already scans tool results, so nothing downstream changes.
- **`FileSystem.readBytes(target, signal, maxBytes)`** is a new required provider primitive: the byte bound lives at the seam so no backend can buffer an unbounded file, with the stat-size short-circuit and a one-byte-past-cap stream guard against post-stat growth (`FS_TOO_LARGE`).
- **Registration is composition-conditional, execution is route-gated.** The tool registers only under `ctx.inject(['attachments'], …)` — no store, no tool. At execution, before any I/O, the strict gate resolves the calling route (latest `request/header` config, falling back to agent options) through `ctx.llm.resolveModelInfo` and requires `image` in `inputModalities`; unknown capability refuses. A refusal is a plain `isError` result, so a text route's durable history never acquires an image block and the session cannot brick its own route.
- **Code Mode forwards the image out-of-band**: a nested dispatch returns the canonical value (execution-local, no image block) and defers a `user`-role context message carrying the envelope and image, so the picture still reaches the next request.
- **llm-replay models may declare `inputModalities`**, which is what lets the two keyless ACP snapshots pin both sides of the gate — the sha256-referenced success on an image-capable replay route and the verbatim refusal on a text-only one.

## Alternatives considered

- **PR #598's route-scoped design** (request-ready seam, per-route schema/guidance visibility, reversible history projection) — withdrawn in favor of this note's shape. What it bought: text routes could keep running after images entered history, and the tool disappeared from prompts where it cannot succeed. What it cost: agent-loop changes, three new durable concepts (`agent/request-ready`, `messageProjection`, availability notices), and registration that churned per step. The capability itself — see an image on the next request — never needed any of it. If per-route projection becomes a real requirement, that PR's history is the reference implementation.
- **`agent.inject()` instead of the image-bearing tool result** — routes the image around the tool result as a separate injected user message. Rejected: the image *is* the tool's result; splitting them adds a second logged message with no gain, and the tool-result path already works end to end.
- **Magic-byte sniffing instead of extension declaration** — sniffing duplicates detection the attachment store already owns (sharp-backed, authoritative). The extension is only a *declaration*; a mismatch fails closed with a rename remedy rather than being silently accepted, which also keeps the model's mental map (file name ↔ content) honest.
- **Registering unconditionally and failing on a missing store** — rejected; a deployment without an attachment store cannot ever satisfy the tool, so its schema would be a standing lie. The route gate, by contrast, is per-call state and correctly lives at the execution boundary.

## Consequences

- A text-only route refuses instead of degrading: no placeholder projection means no delegated-viewing story here — that is deliberately the next PR (subagent image readback rebuilt on the current subagent seams).
- The route gate races a concurrent model switch; the Web host's image-aware switch guard covers its surface, and other front doors own their equivalent. Recorded as a tool-fs Known Limitation.
- Repeated image results accumulate request-token cost until compaction; content addressing deduplicates bytes only.
- The tool-result card renders the durable reference, not pixels; inline preview is deferred to the UI packages.
