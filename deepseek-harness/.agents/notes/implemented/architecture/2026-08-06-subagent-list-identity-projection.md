# Agent Note: Subagent list identity via the projection unit

Status: implemented

English | [中文](2026-08-06-subagent-list-identity-projection.zh.md)

## Problem

Before the rewrite, `SubagentRuntime.listChildren` ran two full-log materializations — `listEvents` plus `readEvent` — on every listing for each direct child with `header.origin === 'subagent'`, each materialization accompanied by a full-log structuredClone, all to fold two fields, mode and label, out of the descriptor event. The descriptor's position in the log is not fixed — the fork prefix is arbitrarily long, and zstd-compressed frames carry no seq index — so there is no shortcut to locating it; this path had no cache whatsoever, and its cost amplifies with transcript length × child count × listing frequency. It also dragged session-query in as a hard dependency of listing: in a deployment without a query backend, `list_agents` rejects wholesale with `SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE`, even though enumeration needs nothing but header facts.

The same root cause has a second symptom: on every Agent-bound RPC's owner check, the host-side `hasSubagentDescriptor()` scans the target session's own suffix, even though `SessionHeader.origin` already answers the vast majority of the same question.

The root cause is that the [durable-subagent-catalog decision](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md) made the descriptor event (`subagent/descriptor`) the catalog's sole durable authority yet paired descriptor reads with no cache layer, and explicitly accepted the per-child double read as the "no-index correctness baseline". [Web subagent conversations](../feature/2026-07-27-web-subagent-conversations.md) (#1569) already put "is this a subagent" into the header (`SessionHeader.origin`), so identity determination no longer reads the log; mode and label still had to be scanned.

## Decision

mode and label are folded by the new `subagent` projection unit (pure identity, two arms), and the unit is the sole authority over the fold rules; `listChildren` no longer depends on session-query — enumeration is a subagent-owned live-preferred merge, and value retrieval walks a three-rung compute-and-discard ladder: a live child synchronously reads the registry's existing watermark cache (zero log reads); a cold child first asks the optional `sessionProjectionCache` checkpoint, and a served identity that passes the seq gate is final; otherwise it pays one full `persistence.inspect` read plus one `registry.restore` fold. No index, no cache of its own, no write-back.

There are three families of escape from the per-child scan: promote mode/label into the header (the write path pays); build a durable derivation for the projection (a checkpoint ladder, or values landed during query-index rebuild with read-side reconciliation); or compute at read time (live from the watermark cache, cold from one full read). This note takes the third. "Values landed with the query index" was retired wholesale: query infrastructure was forced to learn domain vocabulary while the sole consumer is satisfied by read-time computation — the live child's zero reads come for free from session-projection's existing watermark cache, and the cold child's single full read is explicitly accepted as compute-and-discard. The first two routes and the retirement rationale are detailed under Alternatives considered.

Key points:

- **The subagent list does not depend on session-query**: enumeration is completed by a subagent-owned live-preferred merge, and mode/label is retrieved through `ctx.sessionProjections`; deployments without a query backend list as usual.
- **Value retrieval is a three-rung compute-and-discard ladder**: a live child reads `sessionProjections.snapshot()` (the registry's existing watermark cache, zero log reads); a cold child first reads the optional `sessionProjectionCache.cachedSnapshot(header)`, using the value directly when a non-null `subagent` identity passing the seq gate (`seq >= seedLength ?? 0`) is among its values; otherwise it pays one full `persistence.inspect` read plus one `registry.restore({}, events, 0)` fold; beyond that, absent is absent — no cache of its own, no write-back, no index.
- **The `subagent` projection unit is the sole authority over the fold rules**: the live snapshot, the cold restore, and GUI history's detached fold all compute through the registry; no second copy of descriptor-interpretation logic exists.
- **The header, the descriptor (v2), session-persistence, session-projection(-cache), and session-query(-sqlite) are all untouched**; pre-existing data acquires exact values through one `inspect` computation the first time it is listed — no degraded unknown state, no migration.

Relationship to existing notes:

- This note supersedes two designs on the list read path in [durable-subagent-catalog](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md): enumeration through `sessionQuery.traceSession`, and per-child descriptor-event reads (the `listEvents`-plus-exact-`readEvent` double read with in-place diagnostic classification). The diagnostic row semantics is retained, with classification now derived by the list from projection-value absence and activity; the descriptor event remains the sole durable authority for mode/label and the fold input, and the resume authorization and Activation contracts are untouched. This is partial supersession; the two notes stay cross-linked.
- The [session-projection RFC](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md)'s registry contract (`ProjectionDefinition`, `snapshot`, `restore`) is untouched; this note only adds one registration to it — the `subagent` identity unit — and becomes another consumer instance of the two existing reads, snapshot (live) and restore (cold) — GUI history's cold read is already the same shape. The fold rules are registered with the registry exactly once; every consuming surface computes through the registry, and no second copy of the fold logic exists.

### `subagent` projection unit

It hangs beside the existing `subagentTiming` ([projection.ts](../../../../packages/subagent/subagent/src/projection.ts), [projection-types.ts](../../../../packages/subagent/subagent/src/projection-types.ts)), under key `subagent`:

```ts ignore-check
export type SubagentIdentityProjection =
  | { mode: 'one-shot'; label?: string; seq: number }
  | { mode: 'continuable'; label: string; seq: number }

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    subagent: SubagentIdentityProjection | null
  }
}
```

- The projection is pure identity, and **the projection system has no failure channel**: a unit never throws; a corrupt payload or an unrecognized version folds exactly like a log with no descriptor at all — the result is a **serializable null sentinel**: the map entry is `SubagentIdentityProjection | null`, non-optional, never undefined or an absent key. The reason: the registry's onChanged push goes through JSON serialization, where an undefined field is dropped by stringify, the client's frame validation rejects the frame, and a consumer's stored old identity would never update; null passes frames intact, and consumers replace the old identity with the sentinel. The judging discipline: consuming surfaces treat null and undefined (which only a JSON boundary dropping the key can produce) alike as no value. How "computed to nothing" is presented is the consumer's own business (see the `listChildren` four-state mapping below).
- Label strength is decided by the descriptor schema: a continuable's label is mandatory at parse, a one-shot's was always optional; the mode/label discriminant matches the child row's strong contract below exactly (the row carries no `seq` — it is the projection's internal own-suffix proof).
- The identity carries `seq`: the seq of the `subagent/descriptor` event it was folded from, mandatory on both arms and absent on the null sentinel — `seq >= header.seedLength ?? 0` proves the identity was folded from the child's own suffix rather than a fork seed's replayed ancestor descriptor. The state gaining `seq` bumps the unit's `stateVersion` to 2, and existing checkpoint rows are invalidated by version mismatch per the registry contract, falling to the authoritative refold.
- Fold rule: `subagent/descriptor` is last-wins, under the same descriptor-reset discipline as `subagentTiming` — ancestor descriptors in the fork prefix are overridden by the session's own descriptor. A corrupt or unrecognized-version payload is last-wins all the same: it resets to the null sentinel rather than keeping the prior identity, so a fork of a healthy ancestor does not inherit an identity its own descriptor cannot stand up.

### Enumeration: subagent-owned live-preferred merge

`listChildren`'s ([list-children.ts](../../../../packages/subagent/subagent/src/list-children.ts)) enumeration goes through no query service: the two sources `ctx.sessions.list()` and `ctx.get('sessionPersistence')?.list()` merge by id, with a live record overriding the same-id persisted record wholesale and no header consistency check. Everything enumeration needs is header facts:

- Filtering: `header.origin === 'subagent' && header.parentSession === parentSessionId`.
- `hasChildren`: the same merged material, looked at one level down — a direct descendant exists with `origin === 'subagent'` whose `parentSession` is that child.
- `activity`: a live record is `running`; one present only in persistence is `inactive`.
- Ordering: `createdAt` ascending, then child id ascending (matching the old contract).
- **Absent persistence degrades to live-only enumeration, not an error**: in a deployment without persistence, a cold child could not be resumed anyway, and listing live children remains meaningful. (Contrast: the old implementation rejected wholesale when sessionQuery was missing.)
- A persistence listing failure fails the whole enumeration; per-child isolation applies only to the per-child cold reads.

### Value retrieval: the three-rung compute-and-discard ladder

For each enumerated child, mode/label retrieval walks a three-rung ladder — compute-and-discard, no cache of its own, no write-back (the third rung is the same shape as apiproxy `session.history`'s cold read):

| Rung | Read | Cost |
| --- | --- | --- |
| 1: live child | `ctx.sessionProjections.snapshot(session).values.subagent` | Zero log reads — the registry's existing watermark cache, synchronous retrieval |
| 2: cold child, cache hit | The optional `sessionProjectionCache.cachedSnapshot(header)`, used directly only when a non-null `subagent` identity satisfies `identity.seq >= header.seedLength ?? 0` — an own descriptor is immutable once appended, and the seq gate proves the value was folded from the child's own suffix, regardless of the row's watermark | Zero log reads |
| 3: cold child, fallback | One full `persistence.inspect(id)` read + `registry.restore({}, events, 0).snapshot.values.subagent` | One full read computed per listing |

- Error contract: an unmounted `ctx.sessionProjections` is a configuration error; `listChildren` checks unconditionally before enumerating and fails loudly with `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` — a deployment with zero children fails just as deterministically, so an empty listing cannot mask the misconfiguration. The session store gets the same posture: an absent `ctx.get('sessions')` (a strict global read, never the caller-scope-bound property proxy) fails with `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE`. The two codes map differently on the wire: apiproxy gives only `PROJECTIONS_UNAVAILABLE` a dedicated wire face, and `SESSION_STORE_UNAVAILABLE` goes through the generic internal fallback — the apiproxy composition injects `sessions` itself, so that error is unreachable in its deployment, and a dedicated mapping would violate the need principle. `SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` is deleted along with the session-query dependency.
- The cache is a purely optional acceleration layer: an absent service is skipped on a null check — no error code, no part in configuration validation (in contrast to `sessionProjections`' loud contract). Anything the second rung throws (including a poisoned unit row in the cache detonating `viewCheckpoint`) silently falls to the third rung — the cache is derived data, so its faults never produce a `corrupt` verdict; the final judgment belongs to the authoritative refold. A row whose checkpoint cut predates the descriptor naturally lacks the `subagent` key and falls through automatically, with no special-casing; a null sentinel in the row does not count either — it falls to the third rung for the authoritative refold's verdict. A count/interval checkpoint inside the creation window can land a fork seed's replayed ancestor identity in the row — the ancestor's seq falls inside the seed range, the seq gate rejects it, and it likewise falls to the third rung's verdict.
- Per-child isolation: a single child's failed cold full read only turns that row into an `unavailable` diagnostic, naturally retried on the next listing, without affecting siblings (see the four-state mapping).
- The cold path's lifecycle witness: preparation's result must still point at the lifecycle that was enumerated — the witness field set is the same seven fields as the old SOURCE_CONFLICT check (version, id, createdAt, cwd, parentSession, seedLength, delegationDepth); a session deleted and republished under the same id degrades to a `corrupt` row in the old parent's catalog, leaking nothing of the new owner's child.
- Cold-read concurrency is bounded by the constant 4 — it constrains a read-only scan of local media, not deployment behavior; when a networked persistence backend appears, it is promoted to a validated `Config` field.
- The cold-read cost, recorded honestly: only with the cache unmounted or missed does a cold child pay one full read per listing, at a cost proportional to its transcript size; the settled stance is compute-and-discard, and no cache of its own is built. The full read goes through `inspect()` into the [Session preparation](2026-08-05-session-preparation.md) cold read, so short-term repeated reads of the same id can hit its LRU for reuse, but listing does not depend on this. A live child reads zero log throughout.
- Cancellation: the caller's signal is checked before and after each persistence read, and a read that settles only after abort is rejected, normalized to the stable error code `CANCELLED`.

### Authority model

- The session log is the sole authority; this design adds no derived persistence of any kind — no index values, no checkpoints of its own, no in-process memo; the `sessionProjectionCache` checkpoint the second rung reads is an existing composition item's derived data, which this design only reads and never writes. Values are computed on read and discarded, and a value's freshness is exactly the live state or persisted revision at the moment of the read (an own descriptor is immutable once appended — a cached identity past the seq gate has no staleness problem; the gate guards against seed-replayed ancestor identities).
- The Session and persistence write paths are entirely unaware of listing and projection consumption: no event-listener write-back, no fold-on-write.
- Enumeration and value retrieval constitute no second authorization source and make no unpublished child visible — the two sources see only published live records and durably written persisted records, consistent with the rule the durable-subagent-catalog note laid down for derived read surfaces.

### `listChildren` row shape and consuming surfaces

The `SubagentListEntry` **data structure is identical to before the rewrite** — the child and diagnostic arms, the `kind` discriminant, the three-valued `reason`, and the child arm's strong mode/label contract are all retained; the only change is the diagnostics' information source: the projection system has no failure channel, so diagnostics are derived by the list from projection-value absence and activity, and the list itself parses zero events. The "no value means await the hard read" rule guarantees the ladder always computes mode/label for healthy data.

```ts ignore-check
export type SubagentListEntry =
  | ({
    readonly kind: 'child'
    readonly id: SessionId
    readonly activity: 'running' | 'inactive'
    readonly hasChildren: boolean
  } & (
    | { readonly mode: 'one-shot'; readonly label?: string }
    | { readonly mode: 'continuable'; readonly label: string }
  ))
  | {
    readonly kind: 'diagnostic'
    readonly id: SessionId
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }
```

For each enumerated child, the ladder's result maps to a row through four states:

| Ladder result | Row |
| --- | --- |
| Snapshot carries a non-null `subagent` identity | child row |
| Snapshot present, `subagent` null sentinel or key absent, and the child is **inactive** | diagnostic row, reason `corrupt` (settled debris: a missing, corrupt, or unrecognized-version descriptor, no longer subdivided) |
| Snapshot present, `subagent` null sentinel or key absent, and the child is **running** | no row (creation window: the descriptor is not yet appended — the same window the old implementation omitted) |
| The cold full read fails | diagnostic row, reason `unavailable` |

- `unsupported` is no longer produced: the type and the wire enum retain the member under "data structures stay as they are", and this note records it as no longer produced.
- Descriptor-less settled debris moves from the old implementation's omit into the `corrupt` diagnostic — damaged, dead child sessions in the corpus are visible rather than silently vanishing, which is exactly the original motivation for keeping diagnostics.
- Any registered unit whose fold/schema throws on this child's log is likewise contained as that child's diagnostic row, reason `corrupt` — a deterministic data fault, aligned with the old implementation's `SESSION_QUERY_CORRUPT_SESSION`→`corrupt` mapping semantics; live and cold are treated alike, isolation is per-child, and siblings and the listing itself are unaffected. It is orthogonal to "value absent + running → omit": the creation window means "no data yet", a fold throw means "the data is bad" — a poisoned running child also gets a `corrupt` row rather than an omit.

Known boundary deviations (deliberately accepted, recorded with this note):

- A fork child that died in its publication window, with an ancestor descriptor in its seed, gets the ancestor identity from last-wins and wrongly surfaces as a child row; resume still fails against the own-suffix fold authority (`NOT_RESUMABLE`). The old implementation omitted it via `seedLength` filtering; the projection unit cannot see the header, and this debris-grade deviation is accepted (`subagentTiming` has the same kind of pre-existing exposure).
- Multiple descriptors in the own suffix: the old implementation judged corrupt; last-wins now takes the final one (the provider contract guarantees exactly one anyway).
- A live/persisted header conflict: the old implementation made it per-child corrupt; enumeration now prefers live with no consistency check, the conflict goes unnoticed, and the live record forms the row.
- A source-read failure on damaged storage (e.g. a bad surface rejected by the cold full read): the old implementation mapped it to per-child `corrupt`; it is now uniformly an `unavailable` row (the read side cannot tell the causes apart).
- An unknown parent: the old implementation threw not-found through session-query ('parent session … was not found'); the subagent-owned merge now yields an empty subset for a nonexistent parent, enumeration returns an empty list, and later operations on the wire land as child-level subagent-not-found — a silent change of semantics and wording, recorded as explicitly accepted.
- Rung 2's later-event window: a cache row lands right after the first own descriptor, the log then appends a second own descriptor (or a malformed payload setting the null sentinel), and the process crashes before the next checkpoint — from then on a cold listing's rung 2, admitted by the seq≥seedLength gate, keeps serving the row's old identity (the first own descriptor's value), diverging from the authoritative refold (last-wins, the second), and a rung-2 hit triggers no refold, so nothing notices. Three boundaries: ① the precondition is a second own descriptor on the same child, violating the establishing provider's append-exactly-once contract — corruption-class data, same family and source as the multi-descriptor deviation; ② it takes both "corruption + a crash missing every checkpoint (the two mandatory points, turn/end and disposal, and the count/interval throttle points all unmet)" at once; ③ a healthy child (exactly one own descriptor) is unaffected — what the seq gate admits is precisely the only true identity. Self-healing: any live run of that child (the turn/end mandatory checkpoint) or any moment that triggers cache.write overwrites the whole row with a fresh fold (whole-record replace), and rung 2 serves correctly from then on; the authoritative paths (the rung-3 refold, the live snapshot, the resume fold) are correct from the start, and the divergence exists only in listing reads while the child stays cold and the row is never rewritten. The mechanical fixes were not taken: gate reconciliation would need the log-end seq, unavailable to a zero-read cold path; a cache row carrying the revision is an opaque token, incomparable and a cross-domain schema change — filed as accepted under the "the cache is never authoritative" doctrine.

Consuming surfaces: diagnostic handling across wire, tool, and GUI **stays entirely as it was, zero changes** (the `list_agents` description and output schema are untouched; the plugin only narrows its load requirement — `sessionQuery` dropped from inject). The only behavioral changes are in apiproxy: on the route segment, the `hasSubagentDescriptor()` scan is deleted and `hasSubagentOwner` looks only at `header.origin` — pre-#1569 data without `origin` is no longer recognized as a subagent owner; it never entered the catalog anyway, and the pre-release stance accepts this; and `subagents.history` is aligned with `session.history`'s source — a live child served from in-memory events and the registry's watermark snapshot, a cold child from `inspectServable` reading persistence directly with a detached fold, no query service involved, the SESSION_QUERY_* error arms retired with it, and the wire shape unchanged (the `history` JSDoc wording becomes the live in-memory snapshot / cold persisted log dual arm).

### Change footprint

| Area | Files | Change |
| --- | --- | --- |
| subagent | projection.ts, projection-types.ts, index.ts | New `subagent` unit and its registration |
| subagent | list-children.ts and its types | Rewritten as subagent-owned enumeration plus the projection-ladder four-state mapping; the session-query dependency, per-child event reads, and in-place classification machinery deleted; error code `SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` replaced by `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`; new optional dependency dsh-session-projection-cache (pure read acceleration, skipped when absent) |
| host/apiproxy | api-proxy.ts | `hasSubagentDescriptor` deleted; the owner check looks only at `header.origin`; `subagents.history` shares `session.history`'s source — live from in-memory events and the registry's watermark snapshot, cold from `inspectServable` reading persistence directly with a detached fold, no query service, the SESSION_QUERY_* error arms retired with it |
| tool | tool-subagent-control/list-agents.ts | Load requirement narrowed (`sessionQuery` dropped from inject); model-visible schema, description, and rendering unchanged |
| wire/client | api/subagents.ts, runtime sessions/service.ts, GUI | Types, row shape, and diagnostic handling **unchanged**; api/subagents.ts only reworded the `history` JSDoc to the dual arm |
| core/session, session-persistence, session-projection(-cache), session-query(-sqlite) | — | **Zero changes** |

## Alternatives considered

**mode/label into SessionHeader.** The strongest zero-read guarantee — rows form from the header alone. But a header shape change propagates into both persistence backends and the header compatibility check; SQLite rejects pre-existing data outright, and JSONL pre-existing data can only degrade to unknown or be backfilled. Read-time computation's answer for pre-existing data is "one `inspect` computation on first listing", touching no durable format.

**The projection-cache ladder (`cachedSnapshot ?? coldSnapshot` plus fail-soft write-back).** The mechanism works — session-projection-cache's checkpoint ladder is designed for cold reads in the first place. But checkpoint write-back is a whole list-driven body of derived-data persistence and invalidation orchestration (floor/identity/putSoft); what was rejected is that orchestration as the primary mechanism. The settled three-rung ladder later reuses this cache opportunistically, read-only, as its second rung — no write-back, no orchestration, skipped when absent.

**A bounded-read primitive on persistence to rescue pre-existing data.** Opens a new persistence primitive for a one-time problem; superseded by the read-time `inspect` full read — the full read the first time pre-existing data is listed is itself the value retrieval.

**Optional mode/label on list rows.** Healthy data is always computable; optionality merely spills garbage-data handling complexity onto every consumer — each consuming surface has to grow filter branches and an unknown display state. The strong contract plus omit-when-uncomputable is cleaner.

**Deleting diagnostic rows outright.** Deletion turns corpus-corruption visibility into rows silently vanishing, and wire/tool/GUI would each have to absorb contract and snapshot changes; retention only asks the list side to derive the classification from projection-value absence and activity, at zero cost. That damaged, dead child sessions in the corpus must be visible is the original motivation for diagnostics' existence, and with retention the consuming surfaces stay wholly unchanged.

**A registry computation failure channel (per-unit fault tolerance plus a supplementary `failures` field).** To report corruption and unrecognized versions to consumers, the registry would catch unit exceptions and attach a per-key failure state beside the snapshot. Rejected: a failure is not a value and needs no channel — a unit never throws, absence is itself the signal, worst case the computation comes back empty, and how that is presented is the consumer's problem. An independent observation: the vendored Cordis `emit` ([vendor/cordis/src/events.ts](../../../../vendor/cordis/src/events.ts)) catches nothing a listener throws, so with the projection driver hanging off `session/event`, a unit exception would escape along emit — which adds weight to the "a unit never throws" discipline, but fixing emit fault tolerance is outside this note's scope.

**Values landed with query index preparation.** Projection values folded into session index rows during the sqlite backend's reconciliation rebuild, for zero log reads in the steady read state: the `projectionsFor` bulk read face, the invalidation reconciliation of row values stored against the `(key → stateVersion)` registration set, and the SCHEMA bump. Retired wholesale: the direction was backwards — query infrastructure was forced to learn domain vocabulary (projection columns, registration-set reconciliation) while the sole consumer, the subagent list, is satisfied by read-time computation; with consumers down to zero, this derived persistence has no reason to exist. `SESSION_QUERY_PROJECTIONS_UNAVAILABLE` was deleted along with the read face.

**Subagent hand-rolled parsing plus an in-process memo plus creation seeding.** To excise the session-query dependency, the subagent package would parse descriptor events itself, avoid repeated full reads with an in-process memo, and seed initial values at creation. Superseded by the shipped ladder: live goes through the `sessionProjections` watermark cache and cold through `registry.restore`, reusing the registry's single fold authority — no second copy of descriptor-interpretation logic appears, and no process-state cache or seeding ordering is introduced.

**DeepReadonly on the session-query output surface (a read-path overhaul experiment).** Make the public query outputs deeply readonly to pin immutable borrowing at the type level. Rejected on evidence: 3 TS2589 occurrences (excessively deep type instantiation) plus 17 sites of array-position contagion (consumers' array methods and spread sites forced to follow); deep immutability is guaranteed by core/session's runtime deep freeze, and that read-path overhaul is not part of this note.

## Verification

`packages/subagent/subagent/tests/list-children.spec.ts` is rewritten to this contract: live-only listing without persistence, query services, or the continuation runtime; with the registry absent, even zero children loudly report `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`; a live child incurs zero `inspect` throughout while a cold child incurs exactly one per listing; multiple descriptors resolve last-wins to the final one; corrupt payloads and unknown versions fold to `corrupt`; a cold-read failure maps to `unavailable` and retries on the next listing; the ancestor descriptor in a fork seed forms a row under that identity (pinning deviation one); ordinary forks and descendants without a subagent origin neither enter the list nor count toward `hasChildren`; `createdAt`-then-id ordering; an unmounted provider does not affect listing; compacted and uncompacted twins list identically; the three cases of pre-abort, persistence listing, and cold-read cancellation all normalize to `CANCELLED`; the empty list and stable error codes. A hostile-unit dual-path probe (`apply` lazily poisons, `view` detonates) proves that any registered unit's fold/schema throw on this child's log is contained as that child's `corrupt` row on both the live and the cold retrieval paths, with siblings and the listing itself unaffected. Second-rung cases: an own-seq identity used directly with zero `inspect`, a fork seed's ancestor identity (seq inside the seed range) rejected by the gate and falling through, an in-row identity absence (null sentinel or absent key) falling through, an absent cache service falling through, and a poisoned cache row silently falling through to the refold; cold-path lifecycle tampering degrades to `corrupt` field by witness field (`it.each` over the seven). The `tool-subagent-control` list-agents tests are updated for the narrowed load requirement; `optional-session-query.spec.ts` is deleted with the dependency it guarded; the existing keyless snapshots (`subagent-list-agents` among others) are unchanged, pinning that the healthy path's wire and model-visible surfaces did not move; a new keyless snapshot, `subagent-diagnostic` (examples/headless-agent), pins the four-state mapping's diagnostic classification — the model-visible changes such as descriptor-less settled debris becoming a `corrupt` row.

## Consequences

- Listing a live child reads zero log throughout; with the cache unmounted or missed, a cold child pays one full `inspect` read per listing, at a cost proportional to its transcript size and repeated with listing frequency — compute-and-discard is the settled stance: no cache of its own is built, nothing is written back, and short-term repeated full reads of the same id can hit the preparation-phase LRU, though listing does not depend on it.
- The subagent list no longer requires a query backend: both pure-live and persistence-less deployments can list; `SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` is gone, and loading the `list_agents` plugin no longer requires `sessionQuery`.
- Identity interpretation exists only in the single unit registered with the registry: the list's three-rung ladder and GUI history's cold read all use the registry's and the cache's existing reads (snapshot, cachedSnapshot, restore), and no bypass fold exists; if some future consuming surface bypasses the registry with a hand-written fold, values will drift across read faces — a discipline this design requires be maintained, not a mechanical guarantee.
- Per-child isolation is back: a single child's cold-read failure loses only that row and healthy siblings are unaffected; a persistence listing failure still fails the whole enumeration.
- The diagnostic and enumeration semantics leaves six boundary deviations (a stillborn fork surfacing under its ancestor's identity, multiple descriptors resolving to the last, header conflicts going unnoticed, damaged-source read failures shifting from `corrupt` to `unavailable`, an unknown parent yielding an empty list instead of not-found, and rung 2's later-event window); the full semantics is in the known-boundary-deviations list; the first four are display or classification deviations on debris-grade data, the unknown-parent one is a silent query-semantics change, and the rung-2 window is a self-healing cache-serving divergence under the double condition of corruption plus a crash; resume authorization is unaffected throughout, all explicitly accepted.
- Pre-#1569 data without `origin` is no longer recognized as a subagent owner; it never entered the catalog anyway, and pre-release carries no compatibility promise.

## Related

- [Durable subagent catalog and list_agents](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md) — partially superseded by this note: the descriptor remains the durable authority for mode/label and the fold input, while the list's enumeration and value retrieval move to the subagent-owned merge plus the projection ladder.
- [Session projections and command lifecycle logging](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md) — the authority for the registry contract; this note adds the `subagent` identity unit to it and becomes a consumer instance of the two existing reads, snapshot and restore.
- [Web subagent conversations](../feature/2026-07-27-web-subagent-conversations.md) — the origin of `SessionHeader.origin` (#1569), the first half of taking identity determination off the log; its history cold read (inspect prefix plus registry fold) is the same-shape precedent for this note's value ladder.
- [Reusable Session preparation before publication](2026-08-05-session-preparation.md) — the `inspect()` cold read and LRU reuse; the cold child's full-read cost model builds on it.
