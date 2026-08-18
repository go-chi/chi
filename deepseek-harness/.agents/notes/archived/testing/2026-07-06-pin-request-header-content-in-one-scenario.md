# Agent Note: Pin request-header content in one snapshot scenario

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-06-pin-request-header-content-in-one-scenario.zh.md)

## Problem

An ACP snapshot suite needs to prove the exact composed system prompt and tool-schema list sent in each `request/header`, but duplicating that content inside every `session.jsonl` makes a prompt or schema edit rewrite dozens of giant one-line JSON records. Keeping one raw header avoids the duplication but still makes prompt review poor: prose is JSON-escaped onto one line and mixed with thousands of characters of tool schemas.

## Decision

Exactly one scenario per header-composition class is flagged `pinsHeader`. Its directory splits the pin by review format: `system-prompt.expected.md` contains the normalized full prompt sequence as ordinary Markdown, `tool-schemas.expected.json` contains the corresponding complete schema sequence as structured JSON, and `session.jsonl` retains config, reason, and any model-visible prefix while storing `header.system` and `header.tools` as `"{{system}}"` / `"{{tools}}"`. Every other JSONL uses the same prompt and tool tokens and also tokenizes session-prefix content. The pin mechanics live in [`dsh-acp-snapshot`](../../../../packages/support/acp-snapshot/README.md), whose suite factory enforces one pin per class.

The pure `scrubSystemPrompts` and `scrubToolSchemas` normalizers independently tokenize every stored full header. `scrubRequestHeaders` also tokenizes session-prefix content for non-pinning scenarios while retaining header count, field presence, config, reason, and prefix message count. Record and refresh write-back apply the appropriate scrub before writing JSONL and regenerate both sidecars from the normalized live full-header sequence, so neither path can reintroduce prompt/schema bulk into JSONL or leave a review artifact stale.

Guards make the split self-enforcing. On disk, every `session*.jsonl` is a fixed point of both prompt and schema scrubbers, only non-pinning fixtures must be fixed points of the full header scrub, both sidecars exist exactly beside pinning fixtures in canonical newline-terminated formats, and each class has one pin. Live, every `request/header` produced by a parent, spawn child, fork child, initial request, resume, or in-instance change must match the reconstructed class sequence after volatile-value normalization. A header without a string prompt, without an array-valued tool list, or beyond the pin's declared changed-header count fails loud.

One pin covers the whole suite because every session — parent, spawn child, fork child — composes the identical tool list and the identical prompt modulo cwd, and the uniformity guard fails the suite the moment that stops holding. If header composition ever becomes session-dependent by design (a restricted subagent toolset, say), the divergent shape gets its own pinning scenario.

## Alternatives considered

- **Re-record or hand-edit every fixture per change** — preserves exact headers but buries behavioral diffs under duplicated prompt and schema content.
- **Scrub at compare time only, keeping fixtures raw** — lets compares pass while committed fixtures retain stale duplicate content and rewrite wholesale on the next recording. Stored tokens state honestly what each JSONL does not pin.
- **Scrub everywhere, pin nowhere** — loses the only end-to-end record of the composed header as actually sent (prompt assembly, registered-tool order, full schemas). The generated tool catalog documents each tool in isolation; only a real fixture pins the composed set.
- **Keep the one full pin entirely in JSONL** — removes suite-wide duplication but leaves prompt and schema changes as one escaped line. Markdown and structured JSON give each surface its natural review format without weakening the reconstructed-header assertion.
- **Slim the session log itself (log a content digest, store the header elsewhere)** — violates the reconstructability contract: the product log must reproduce each request bit-for-bit ([reconstructable-requests Agent Note](../architecture/2026-07-05-reconstructable-requests.md)). Header bulk is a test-artifact concern, solved in test normalization; the live log is untouched.

## Verification

The suite replays every scenario against the split pins. Unit coverage exercises the independent and full scrubbers, both full-header sidecar formats, record/refresh regeneration, normalized prompt/schema extraction, fixed-point enforcement, required-file symmetry, reconstructed-header uniformity, and changed-header count rejection.

## Consequences

A system-prompt change produces a line-oriented Markdown diff in one file per affected composition class; a tool-description change produces a structured JSON diff in one file per class; ordinary behavioral fixtures remain untouched. Session fixtures display tokens for omitted content, and the live uniformity guard makes each split pin authoritative for every session in its class. Each pinning scenario carries two generated, newline-canonicalized sidecars.
