# @deepseek-ai/dsh-storage-domain

English | [中文](README.zh.md)

Domain data form for the DeepSeek Harness storage hub: exposes the injectable `ctx.storageDomain` service and the matching `ctx.storage.domain` projection after every configured backend is registered. A domain is declared once with `defineDomain` (zod record schemas, `z.infer`-derived types), opened through `DomainFacility.open`, and served from authoritative in-memory state — reads are synchronous, writes serialize on one per-domain chain, reach durability on the routed backend first, then update memory and emit `domain/changed`. The opening consumer owns the handle's lifecycle and releases it with `Domain.close()` (idempotent; typically its own `ctx.effect` disposer); domains still open when the plugin unmounts are closed by the facility.

Design rationale, open semantics, and the storage/domain layer split live in the [Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md).

## Configuration

| key | meaning |
| --- | --- |
| `backend` | Default backend name for every domain (required; no universally correct medium exists). |
| `routes` | Per-domain overrides: domain name → backend name. |

## Model Experience

### Durable domain state

#### What the model sees

Nothing. The package registers no tools, injects no prompts, and appends no session events; it stores non-session data (workspace records, future session sidecars) behind `ctx.storageDomain` and emits only the in-process `domain/changed` event, which reaches a model only if a Consumer package renders it through its own documented surface.

#### Token effect

Zero. No text from this package enters any model request.

#### KV Cache effect

Independent: domain reads and writes never touch request prefixes, so nothing here can invalidate provider cache reuse.

## Known Limitations and Deferred Work

- **Single-process change visibility** — `domain/changed` is an in-process event; a second host process or a reconnecting GUI observes no changes until the cross-process revision pattern deferred in the Agent Note lands.
- **No cross-table transactions, secondary indexes, or multi-segment keys** — each write touches one record; triggers and rework points for these extensions are tabled in the Agent Note's deferred-work list.
