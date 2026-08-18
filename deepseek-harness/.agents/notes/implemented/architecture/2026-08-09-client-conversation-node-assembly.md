# Agent Note: Client Conversation business-node assembly and keyed Chat snapshots

Status: implemented

English | [中文](2026-08-09-client-conversation-node-assembly.zh.md)

## Problem

Client Session owned transport windows, connection state, and pending interactions while also interpreting Assistant, Tool, message, command, compaction, retry, and turn-tail events in a centralized transcript fold. Adding one business node required changes to Session switches, history replay, indexes, caches, and React grouping; business identity, state evolution, and final presentation had no independent owner.

The old path also placed running Assistant and Tool values outside the finalized flow. They entered the log-ordered node list only after settlement, so their React parent changed and remounted them even when the business ID and `key` remained stable. Full history loads, older prepends, live appends, and token streaming used separate update paths, leaving reference stability and local recomputation dependent on specialized caches spread across the client.

Business events also use different correlation models. Tool has call IDs, Assistant correlates by turn and step, Compaction has its own lifecycle and checkpoint, and an Inbox splice represents one instantaneous state in a sequence. Keeping all these distinctions in one fold would make every business change pass through a global lookup and invalidate unrelated caches.

## Decision

Client Runtime provides a target-neutral Conversation Node assembly engine. Business plugins register Event Definitions, and view plugins register per-Session View Builders. `ui-conversation` registers the first built-in Definitions and the `chat` builder; Session only submits the current contiguous Event window to the engine and publishes its snapshot instead of interpreting individual conversation businesses.

This Note retains the derivation, business-by-business validation, responsibilities, algorithms, and trade-offs that remain relevant after implementation.

### Responsibility layers

| Layer | Durable responsibility | Explicitly does not own |
|---|---|---|
| Session | Maintain the contiguous Event window, distinguish replace, prepend, and append, and schedule snapshot notifications | Interpret Tool, Assistant, Compaction, or other business events |
| Event Registry | Retain the unique-`kind` Definitions and sole fallback under Cordis lifecycles | Store one Session's Context or State |
| Assembler | Match Events and maintain Contexts, Locations, dependencies, and the publication dirty set | Interpret business State fields or Chat ordering |
| Node Definition | Define one business object's identity, State transitions, Location data, and target Node | Create Contexts, mutate another business's State, or scan all Contexts |
| View Builder | Incrementally organize final target Nodes into that view's snapshot | Reinterpret raw Session Events |
| React renderer | Render renderer-owned data by the final Node's `kind` and read business data from the current Node's Location | Pair business Events, scan global Nodes, or decide business lifecycle state |

Registry contributions are Cordis effects. Removing a Definition causes a low-frequency registry rebuild for existing Sessions; ordinary business Events do not change the Registry or rebuild every business type.

### Overall `ConversationNodeDefinition` contract

Each [`ConversationNodeDefinition`](../../../../packages/client/runtime/src/client/contract/conversation.ts) independently owns one business object's conversion from Events to State and final view Nodes. A Definition's `kind` is its unique Registry name and the namespace for its business IDs.

One Event may be claimed by several ordinary Definitions. For example, an Assistant Event updates both the Assistant Node and Turn Tail, while a Retry Event updates Retry, Assistant, and Turn Error. The Assembler asks the fallback only when every ordinary Definition returns `null`.

A Definition holds no mutable business data across Sessions. Each Session's Assembler isolates that Session's Contexts, State, dependencies, and View Builders.

#### `kind`, business ID, and Context key

The `id` returned by `match()` only needs to be stable within its Definition. A Tool ID can be a call ID, an Assistant ID can be `turn:step`, and an Inbox ID can be the splice Event seq.

The Assembler uses `conversationContextKey(kind, id)` to make a collision-free key. Definitions that return the same `id` still do not share a Context. The final view Node must retain this engine-owned key and cannot use `seq` or render position as identity.

Each `(kind, id)` has at most one start Match. A second start fails immediately; a Definition must return a new ID to represent a new lifecycle.

#### `match(event)`

`match(event)` reads only the current raw `SessionEvent` and returns `{ id, role: 'start' | 'update' }` or `null`. It cannot access a Context, history, a Reader, a Location, or the view envelope.

This restriction makes one Event's routing cost depend only on the number of registered Definitions. The Assembler never scans a Definition's historical Contexts to decide which one owns an update.

Start, result, resource, checkpoint, and business-owned terminal Events must carry or directly imply the same ID. If one Event cannot yield that ID, its producer extends the Event protocol; the Client does not guess from the "nearest unfinished object."

The `role` describes the State lifecycle, not visibility. A start may produce a terminal Node immediately, while an update may enter a pending Context before its start has loaded.

#### `ConversationMatch`

After a successful match, the Assembler combines the raw Event, optional wire presentation view, `role`, and engine-computed `location` into a read-only `ConversationMatch`.

A Context's `matches` always remain in ascending Event `seq` order, not network arrival or pagination ingestion order. If a tail page supplies a result before an older page supplies its call, the final Match order still places the call before the result.

Location can change when prepend fills a boundary or append closes one. The Assembler replaces the affected Matches' read-only Locations and replays the Context; business code does not retain an old Location copy as authority.

#### `ConversationNodeContext`

| Field | Owner | Semantics visible to the Definition |
|---|---|---|
| `key` | Assembler | Stable final identity derived from `kind + id` |
| `kind` / `id` | Definition + Assembler | Current business namespace and business ID |
| `matches` | Assembler | Complete business evidence loaded in the current window and sorted by `seq` |
| `start` | Assembler | Unique start Match, or `undefined` before it loads |
| `state` | Returned by Definition, held by Assembler | Most recent `start`/`update` return value, or `undefined` before initialization |
| `current` | Assembler | Most recently materialized Node or `null` for each target |

Read-only Context fields do not require deeply immutable business State. A Definition may return a new object or mutate the old object in place and return the same reference.

The Assembler adopts only the returned value. Returning `undefined` from `start()` or `update()` is a contract error and fails immediately; mutating an object without returning it is likewise invalid.

A Definition may inspect all `matches` to help construct State or a fallback Node, but it cannot add or remove Matches, replace Context fields, or mutate another Context.

#### `start(context, match, reader)`

`start()` is the sole State initialization entry point. The Assembler invokes it when the unique start first appears and adopts its returned State.

When an older page changes Match order, the Reader's predecessor answer, or Location facts, the Assembler recomputes from `start()` instead of applying a reverse-direction patch to old State.

The Context may already contain updates after the start when `start()` runs. After `start()` returns initial State, the Assembler still invokes `update()` for every post-start Match in ascending log order, so ingestion direction cannot change the final fold.

The `reader` is available only in `start()`. Initialization can read the nearest active Context of a specified `kind` strictly before the current start seq, but business code receives no general interface for scanning internal engine Maps.

Each new `start()` invocation replaces the Reader dependencies recorded by the prior invocation, so a Definition that changes its query branch retains no stale edges.

#### `reader.previous(kind)`

`reader.previous(kind)` finds the nearest Context whose `candidate.startSeq < current.startSeq` and whose State is initialized. It never returns a Context at the same seq, a future Context, or a pending Context without State.

The result contains the predecessor's key, kind, ID, start seq, read-only State, and Matches. The consumer interprets that State itself; the provider only maintains its State correctly and need not register a specialized query method.

Each Reader query records a `{ key, revision, windowGap }` dependency. A matched predecessor's revision change replays the consumer; a miss while older history remains records a window gap for a later prepend.

When the window already reaches the Session beginning, a miss is a definitive `undefined`. When `hasMore` is true, the Definition sees the same `undefined`, but the Assembler remembers that the result is provisional.

Dependencies point strictly from earlier starts to later starts, so transitive replay cannot form a temporal cycle. Both the Inbox instantaneous-state chain and Message reads of Inbox use this constraint.

#### `update(context, match)`

`update()` handles a post-start Match that `match()` has already routed exactly to the current `(kind, id)`. It does not decide which Context owns the Event.

The Assembler invokes `update()` in ascending `seq` order. A live tail update can apply incrementally; any non-tail insertion, newly loaded start, or invalidated dependency causes a complete replay from `start()`.

When no business data changes, `update()` returns the existing State. When data changes, it may return an immutable replacement or mutate the existing object and return that object.

The Assembler does not use State reference equality to decide publication or propagation. Every accepted update increments the Context revision, marks it dirty, and causes direct or transitive Reader consumers to be reevaluated.

#### `publication(match)`

`publication()` controls when the latest State materializes as a view Node; it does not delay the synchronous execution of `match()`, `start()`, or `update()`.

| Return value | Behavior |
|---|---|
| `immediate` | Request a notification and flush in the current microtask |
| `animation-frame` | Coalesce high-frequency updates into materialization on the next frame |
| `none` | Do not schedule a flush for this Match; retain its State and dirty marker |

Omitting `publication()` means `immediate`. Assistant token deltas use `animation-frame`, invisible Inbox Contexts use `none`, and finals, dependency replays, and Location boundaries publish the latest result through an immediate path.

Every delta within a frame still executes update. Only `buildViewNode()`, View Builder work, and React snapshot notification are coalesced; no tokens are lost.

#### `buildLocationData(context, scope)`

`buildLocationData()` lets a Definition publish a read-only value derived from its State onto an engine-owned Step or Turn without exposing another business's mutable State. The Assembler always materializes `step` before `turn`, so Turn-level aggregation can read Step data updated in the same flush; it calls `buildViewNode()` only after all Location data is ready.

A Definition receives the `step` and `turn` scopes separately and may return one value or `null` in either phase. A value must identify the exact turn/step coordinates and use the Definition's `kind` as its key. The Assembler owns replacement and removal and rejects another Context that claims the same Location key.

`ConversationStepDataMap` and `ConversationTurnDataMap` use declaration merging to constrain keys and values. A Location exposes only a stable `data.get(key)` reader; consumers cannot obtain the provider Context or mutate its State.

#### `buildViewNode(context, target)`

`buildViewNode()` reads the latest Context during publication and directly produces the final business Node for the named target. The Assembler adds no generic activity, tail-candidate, or layout business layer afterward.

`null` means this Context has not yet materialized for the target. On the ordinary incremental path, a Context that has returned a non-null Node cannot later return `null`; temporary absence retains the same-key Node and uses the target's visibility representation.

The Assembler verifies `node.key === context.key` and `node.target === target`. Business code may change `anchorSeq`, data, Location, or visibility, but cannot change identity within one lifecycle.

`current` lets a Definition distinguish "never materialized" from "already materialized and now hidden." Assistant retry and Turn Error suppression use it to avoid illegal Node withdrawal.

A Definition owns at most one view target; state-only Definitions omit both `target` and `buildViewNode()`. Chat and Trajectory register separate business Definitions even when they recognize the same durable Event family, while the shared Assembler supplies the same matching, replay, Location, and publication mechanics to both targets.

#### No generic `end()`

The engine exposes no fixed `end()` lifecycle. A single-Event business completes in `start()`, a multi-Event business records completion in its own update, and a long-lived instantaneous-state business creates a new Context for every Event.

Step and Turn closure are external Location facts and do not mutate business State. A boundary change replays and builds affected Contexts; each business combines its own completion State with whether its Location is closed to produce normal, running, or interrupted presentation.

IDs are never reused. Completed Contexts remain in the current window, providing stable render identity and possible predecessor evidence for later Readers.

### Location is a first-class engine fact

[`ConversationLocationIndex`](../../../../packages/client/runtime/src/client/sessions/conversation-location-index.ts) maps Events to Locations from `turn/start`, `step/start`, explicit turn and step payloads, `step/end`, and `turn/end`.

Location has four shapes: `session`, `turn`, `step`, and `unresolved`. Turns and Steps each carry `open`, `closed`, or `unknown` status plus any loaded start and end Events.

Each Turn and Step also carries a reference-stable Location data store. A Definition update replaces only its owned key; the same store identity can acquire new values through append or prepend, allowing Contexts, View Builders, and React renderers to share resolved hierarchy-level business facts without copying or scanning the global Node array.

`unresolved` means the current history window lacks sufficient preceding boundaries; it does not mean session-level. When older prepend supplies those boundaries, the index corrects Match Locations and replays only Contexts that own those seqs.

An appended ordinary Event only inherits current coordinates, while an appended boundary recalculates only its owning Turn. Prepend rebuilds Location facts from the expanded contiguous window, but reference-stability logic retains unchanged Turn and Step objects.

The Assembler also passes a reference-stable timeline to each View Builder. Businesses do not separately maintain turn order, step lists, last-step values, or boundary Maps.

## Three Event-window paths

"Backward history scanning" describes the UI loading pages from the newest tail toward the Session beginning; it does not mean a Definition executes `update()` in reverse. Regardless of history API order or page-loading direction, the Assembler canonicalizes each current window and each fresh page in ascending `seq` order.

| Scenario | Input range | Context and State handling | View Builder |
|---|---|---|---|
| Initial history tail or resync | Current complete contiguous window | Clear and rebuild all Contexts in ascending `seq` order | `replace()` |
| Load one older-history page | Only deduplicated fresh Events before the window | Retain existing Context identity, then add Matches, Locations, dependencies, and local replays | `apply(upserts)` |
| Live append | One contiguous tail Event | Match Definitions and update only the exact IDs; boundaries affect only their owning Turn | `apply(upserts)` |

### Initial history tail and logical backward scanning

1. `Session.open()` loads the latest tail page and passes its contiguous History Entries to `replaceWindow(entries, hasMore)`.
2. `replaceWindow` clears old Contexts, start-seq indexes, seq reverse indexes, Reader dependencies, and the input Map.
3. It sorts every entry by Event `seq` and stores the resulting current window.
4. LocationIndex rebuilds Turn and Step facts for that window.
5. The Assembler visits Events in ascending order and invokes every ordinary Definition's `match(event)`.
6. Each result gets or creates its `(kind, id)` Context and enters that Context's ordered Match array.
7. A start runs `start()`; a tail update on initialized State runs `update()` directly.
8. If the page contains only a result or resource and omits its start, the ID still creates a Context and collects Matches, while State remains `undefined`.
9. After matching all Events, the Assembler rechecks Reader dependencies so earlier instantaneous states in the same window stabilize before later consumers read them.
10. Every Context becomes dirty, and the next flush fully rebuilds Location data in Step→Turn order before invoking `buildViewNode()` for every target.
11. Some businesses return `null` without a start; Compaction, Command, Tool result, and Turn Error can construct fallback Nodes from sufficient update evidence.
12. Each View Builder receives the complete Node set and timeline and establishes the initial snapshot through `replace()`.

This path starts from the newest page only at the pagination layer. State within the page always computes forward, so the same window does not produce different business results under a different scan direction.

A Context without a start is not an error. It is a pending aggregation container waiting for an older page; that Definition's `buildViewNode()` decides whether the evidence already makes it visible.

If an update with the same ID is genuinely earlier than the start in log order, rather than merely loaded first, replay fails with a protocol error after the start arrives. Arrival order may be reversed; business log order may not.

### Prepending a newly loaded older page

1. `Session.loadOlder()` requests the immediately preceding page using the current `baseSeq` and first verifies continuity between the page tail and current window.
2. Session prepends the raw Event and view arrays to its own window and passes only that page to `assembler.prepend(entries, hasMore)`.
3. The Assembler removes seqs that overlap the current window, then sorts the fresh page internally in ascending order.
4. Existing Contexts, State, current Nodes, and View Builder instances remain intact.
5. LocationIndex rebuilds facts over the expanded complete input and reports seqs whose Location identity actually changed.
6. Contexts owning those seqs update their Match Locations and replay from start; unrelated Contexts do not join Location replay.
7. Fresh Events run Definition matchers and enter existing or new Contexts by stable ID.
8. If the new page supplies a pending Context's start, that Context initializes from the start and then applies every already-collected update in ascending order.
9. If the page establishes a nearer Reader predecessor, changes a predecessor revision, or removes a window gap, the consumer recomputes from `start()`.
10. Reader dependencies propagate replay toward later start seqs; no Event is applied in reverse within the propagation batch.
11. An empty page that changes `hasMore` from true to false also rechecks dependencies and resolves a provisional `undefined` to definitive absence.
12. The flush republishes Step/Turn Location data and target Nodes only for dirty Contexts, then passes non-null results to View Builder `apply()` as `upserts`.

Prepend retains existing Context keys and current Node identity. A page may add historical keys at the front of Chat `order` or correct an existing Node's anchor, Location, visibility, or data, but it does not recreate unrelated business Contexts.

On a structural change, the Chat Builder recomputes visible `order` and the secondary Location index from its keyed store. That is view-index work; it neither reruns every business Definition nor replaces unchanged Node values.

Reader gap repair is the largest algorithmic difference between prepend and ordinary append. A page can both add visible historical Nodes and change later Inbox instantaneous states and the Message classifications that depend on them.

### Forward live append

1. Session accepts only a live Event immediately after the current tail seq; it deduplicates overlap and runs tail-page repair before accepting a gap.
2. A non-boundary Event enters the current Turn and Step coordinates incrementally; a boundary Event updates Location facts for its owning Turn.
3. The Assembler invokes `match()` once on every ordinary Definition for this Event and scans no Definition's Context set.
4. Each successful result directly locates one Context through `(kind, id)`.
5. A new ID creates a Context; a normal tail update for an existing ID invokes `update()` once.
6. A start or any evidence inserted before the tail uses complete `replayContext()` and retains the same forward-order semantics.
7. After a Context revision changes, only recorded Reader dependents replay.
8. Location close updates affected Matches within its owning Turn and replays those Contexts, allowing unfinished Assistant, Tool, or Retry values to acquire interrupted or cancelled presentation.
9. The Assembler takes the highest publication urgency among all matching Definitions: `immediate` outranks `animation-frame`, which outranks `none`.
10. Session routes immediate work to the microtask notifier and animation-frame work to the RAF notifier.
11. The flush updates Step/Turn Location data for dirty Contexts, then invokes `buildViewNode()` and passes this transaction's upserts and latest timeline to each View Builder.
12. The new React snapshot reuses stable Context keys; the same Tool running→settled or Assistant streaming→final value never moves across parents.

Append's business-matching cost is the Definition count plus the Contexts actually updated, independent of historical Context count. Reader consumers and Location closure add replay proportional to real dependencies or the owning Turn.

A structural Chat `order` change can still reorder the current visible keys. A data-only update replaces one keyed-store Node and touches its Location index. The guarantee is that unrelated businesses do not refold and unchanged Node identity is retained, not that every view-index operation has constant complexity.

### Consistency across replace, prepend, and append

All three paths preserve the same invariants: Context Matches are seq-ordered, State folds forward from one unique start, Reader sees only strictly preceding active Contexts, Location data publishes in Step→Turn order, and Node key depends only on kind and ID.

`replaceWindow` is the low-frequency complete replacement for initial open, resync, gap repair, and registry changes; it does not implement ordinary load older. Both `prepend` and `append` retain existing Builder and Context identity.

Page size, the number of history loads, and RAF coalescing affect only when evidence arrives or publishes. They do not change final Context State and Nodes for an equal Event window.

## How built-in businesses use Definitions

### Matching, ID, and State

| Business / `kind` | Stable ID | Start Match | Update Matches | State and cross-Context reads |
|---|---|---|---|---|
| Next-turn Inbox / `inbox-next-turn` | Splice Event seq | Each `agent/inbox/spliced` targeting next-turn | None | Apply the current splice to the pending/claimed instantaneous state from `reader.previous(ownKind)` |
| Next-step Inbox / `inbox-next-step` | Splice Event seq | Each `agent/inbox/spliced` targeting next-step | None | Build the same per-instruction instantaneous state; Message reads its claimed set |
| Message / `input-message` | Message ID | Append-surface `user/message` | None | Use source for a context message, or read the nearest next-step Inbox to distinguish user from steering |
| Assistant / `assistant-step` | `turn:step` | `step/start` | `assistant/chunk`, final `assistant/message`, and same-step Retry | Aggregate blocks, usage, first-token time, final evidence, and retry-hidden state, then publish same-key Step data |
| Tool / `tool-call` | Root call ID | Root `tool/call` | Root result and Code Dispatch start/result | Aggregate the root, children, and parent Map; Dispatch Events route exactly through `rootCallId` |
| Command / `command` | Command ID | `command/run` | `command/done` and compact lifecycle/checkpoint Events carrying a source command ID | Aggregate command outcome and manual-compaction evidence |
| Automatic Compaction / `compaction` | Compaction ID | `compaction/start` without a source command ID | Summary, end, and replacement checkpoint | Aggregate summary/checkpoint; sufficient checkpoint evidence supports fallback without a start |
| Retry / `model-retry` | Retry ID | Attempt 1 `llm/retry` | Later `llm/retry` and `llm/retry-started` | Aggregate one RetryId's attempts and scheduled/started state |
| Turn Error / `turn-error` | Turn number | `turn/start` | Error `turn/end` and Retry Events for that Turn | Aggregate terminal failure and use Retry evidence to decide hiding |
| Turn Tail / `turn-tail` | Turn number | `turn/start` | Assistant, Retry, `step/end`, and `turn/end` | Retain turn end, read each Step's Assistant data, and publish Turn data; use complete Matches to choose the visual tail anchor |
| Deliverables / `deliverables` | Turn number | `turn/start` | Tool calls/results in that Turn | Aggregate successful mutation paths and publish Turn data without producing a view Node |
| Unknown fallback / `unknown-surface` | Event seq | Append-surface Event unclaimed by any ordinary Definition | None | Retain raw type/data for the JSON fallback |

### Chat Node and history/live behavior

| Business | `publication()` | Chat output | History and runtime behavior |
|---|---|---|---|
| Inbox | `none` | No Node | Recompute instantaneous states along the Reader chain when prepend supplies earlier splices |
| Message | Immediate by default | `user`, `steering`, or `context` | Window-gap repair can reclassify the same message key |
| Assistant | RAF for chunks, immediate for final, none for pure usage/finish | Same-key `assistant-step` with running/settled/interrupted status | Matches support fallback without `step/start`; Location close produces interruption presentation |
| Tool | Immediate by default | One recursive `tool-call` root containing all `subCalls` | A result-only history window supports fallback; running→settled retains its key |
| Command | Immediate by default | Ordinary `command` or integrated `manual-compaction` | Checkpoint arrival may change the anchor without changing the Context key |
| Compaction | Immediate by default | `compaction` marker | A checkpoint may render before start; an older start triggers forward replay |
| Retry | Immediate by default | One `model-retry` Node containing all attempts | Multiple retries update one key; Location close presents the last scheduled attempt as cancelled |
| Turn Error | Immediate by default | Visible or hidden `turn-error` | Error end supports fallback without start; later Retry keeps the key and hides it |
| Turn Tail | Immediate only for `turn/end`; otherwise none | Independent `turn-tail` footer | Compute closing/metrics from Step Assistant data and use same-turn Matches to choose the anchor |
| Deliverables | Immediate by default | No Node | Tool settlement incrementally updates Turn data; the Turn Tail extension slot reads produced files |
| Fallback | Immediate by default | `unknown` JSON row | Covers only append-surface Events; an ordinary business that claimed but has not rendered an Event does not duplicate it |

Inbox demonstrates that every Event can be a start-only instantaneous-state Context; not every business requires a start/update pair. Reader links each state to the prior same-kind Context instead of inventing a lifecycle ID for the entire Inbox.

Assistant, Turn Tail, and Turn Error demonstrate independent claims on one Event. Each Definition updates only its own State and produces its own atomic Chat Node.

Assistant, Turn Tail, and Deliverables demonstrate layered Location data composition. Assistant writes `assistant-step` data for each Step; Turn Tail derives `turn-tail` data from those Step values; Deliverables independently maintains `deliverables` data for the same Turn. Consumers read only declaration-merged keys, do not scan another business's Nodes, and cannot obtain the provider's Context State.

Tool and Command demonstrate multi-Event aggregation: the producer supplies a shared ID, and the Context builds a tree or integrates Compaction internally instead of pushing pairing into the Chat Builder.

Compaction and historical Tool results demonstrate business fallback without a start. The engine does not impose "no start means no rendering"; each Definition decides whether current Matches are sufficient.

Retry demonstrates the State and Location split. Scheduled and started belong to Retry State, while Step and Turn closure belong to engine Location; `buildViewNode()` combines them into cancelled presentation.

Unknown fallback demonstrates Registry ownership: it handles only append-surface Events unclaimed by every ordinary matcher, and does not create a duplicate Node merely because a claimed Context temporarily returns `null`.

## View Builder and React identity

[`ConversationViewRegistry`](../../../../packages/client/runtime/src/client/conversation/view-registry.ts) creates an independent per-Session builder for each target. The Registry stores factories and shares no Session's ordering or caches.

The Assembler calls `replace({ nodes, timeline })` on low-frequency complete replacements and `apply({ upserts, timeline })` for ordinary prepend/append flushes. Builders receive only final target Nodes already constructed by Definitions.

[`ChatSnapshotBuilder`](../../../../packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts) maintains `order`, a keyed `nodes` store, the turn/step `locations` index, `timeline`, and the `legacy` slice used by StatsLine and mirrored into top-level public compatibility fields.

Only a new key or a change to `anchorSeq`, visibility, or Location identity makes a Chat update structural. An ordinary content change does not rebuild `order`; the keyed Node store replaces only that key's value.

For a structural change, the Builder computes visible order from current store values and reuses unchanged index arrays by reference. Prepend may add earlier history keys, append may add a key at the tail or its business anchor, and ordering never renames existing keys.

[`ChatView`](../../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx) only traverses `order`. Each [`ChatNodeSeat`](../../../../packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx) remains in the same parent list under its Context key and dispatches the `'conversation.chat.node'` keyed slot by `node.kind`.

[`ChatNodeDataMap`](../../../../packages/client/ui-conversation/src/client/contract/chat-nodes.ts) is a declaration-merged renderer payload registry. Each business module registers its own Definition and keyed renderer; `registerConversationNodes()` and `registerChatNodeRenderers()` only assemble those independent contributions and do not interpret business through a closed union or central switch. Built-ins still live in `ui-conversation`, but this type and registration boundary allows a business to move into an independent package without changing the Chat dispatcher.

The Chat entry in `conversation.view` registers `ChatNodeTurnDataInjected` once when it declares the `conversation.chat.node` child slot. `ChatNodeSeat` passes only the stable Node key as `hookContext`; the Slot renderer combines that key with `useSession` from the official standard props to construct `useTurnData(businessKey)`. Every keyed Chat renderer therefore reads strongly typed, read-only data from its own Node's Turn, and the Assistant renderer has no special injection authority.

Slot-level contextual Hooks and entry-owned `inject.hooks` remain independent paths. The latter continues to bind only registration-owned Observables. The former caches definitions by stable slot-inject-face identity and binds its factory and Hook per stable render occurrence. The selector inside `useTurnData()` returns only the current Node's `turn.data.get(key)`, so selector equality filters unrelated Session publications.

The standard `useSession` remains available to every session-scoped slot renderer. `useTurnData()` narrows the common read path rather than acting as a permission sandbox. Whole-window statistics or arbitrary object indexes may still read the Session snapshot explicitly, but they are not modeled as current-Node Turn data.

Assistant streaming to final and Tool running to settled update only one Seat's data and necessary ordering properties. They no longer move from a tail running container into finalized flow, so settlement does not reset component-local State.

When business logic deliberately changes a materialized Node to hidden, it leaves visible order and remounts when visible again. This is explicit business withdrawal of presentation, distinct from the stable-Seat guarantee for running→settled.

The concrete Tool renderer remains governed by the [`ui-tool ownership decision`](2026-08-08-client-tool-presentation-ownership.md). Tool Definition supplies recursive root/subcall data, and `ui-tool` dispatches concrete presentation by the Tool-name keyed slot.

Trajectory registers its own target and business Definitions against the same Assembler and Session event window as Chat. Its target builder preserves the stage-oriented read model without consuming the Chat Builder's legacy slice or running an independent history fold. The Chat Builder retains its legacy slice for StatsLine and the top-level public compatibility fields; target-specific Definitions do not change the shared Context, Reader, or Location contracts.

The target-specific Trajectory Definitions, retained stage model, Steering adaptation, complexity bounds, and presentation hot paths are owned by the [Trajectory Context assembly decision](2026-08-11-trajectory-conversation-context-assembly.md).

## Runtime and render path

```text
Session Event window
  -> ConversationNodeAssembler
       -> Definition.match(event) -> (kind, id, start/update)
       -> Context matches + State + Location
       -> Definition.buildLocationData(step -> turn)
            -> StepLocation.data / TurnLocation.data
       -> Definition.buildViewNode() for its declared target
  -> target View Builder
       -> chat: ChatSnapshotBuilder -> ChatView -> keyed ChatNodeSeat
       -> trajectory: TrajectorySnapshotBuilder -> stages/layout/table
```

## Verification

Runtime tests pin Definition lifecycle registration, exact-ID append, update-before-start collection followed by forward replay after start, prepend identity, Reader window-gap repair, transitive dependencies, Location closure, Step→Turn data phase order, Location data replacement, publication cadence, illegal withdrawal, and per-target Builders.

Conversation tests cover every built-in Chat Definition, Assistant Step data, Turn Tail and Deliverables Turn data, Chat ordering and structural sharing, selector isolation, Assistant and Tool running-to-settled identity, nested Code Dispatch, steering, Compaction, Retry, interruption, load-older anchoring, and slot dispatch. Trajectory tests cover its independently registered Message, Assistant, Tool, Compaction, Request-header, and boundary Definitions together with the preserved stage-oriented view model.

Slot type/runtime tests pin required parent-provided common inject, the `hookContext` type, Hook isolation across Node contexts, stable factory/Hook identity, and the absence of business-renderer rerenders for unrelated Session publications. Existing entry-owned Observable Hook tests continue to pin the path that does not use a contextual factory.

Assembled Web snapshots, GUI tests, and browser scenarios cover the real plugin graph. Browser evidence compares Assistant streaming→settled, Bash running→settled, and Code Mode root + nested subcalls against master layout.

History-path tests cover complete replace, non-overlapping prepend, overlapping-seq deduplication, empty-page `hasMore` convergence, and live append. Equal Event windows ingested through different paths produce equal business State and final Nodes.

## Alternatives considered

**Keep the centralized Session transcript fold and extract only helpers.** Rejected: business identity, history replay, and cache invalidation would still belong to one closed switch; moving functions would not establish independent ownership.

**Let React renderers scan Session Events.** Rejected: every view would duplicate matching and lifecycle State, React would become business authority, and paging and streaming would recompute unrelated component trees.

**Pass global Nodes or Location indexes to every business renderer.** Rejected: business components would scan and infer their current Turn/Step, and their subscription scope would grow with the window. A Definition publishes aggregates onto an engine-owned Location, and a renderer reads only its own Node's Location data.

**Call every Context of a Definition for each new Event.** Rejected: append cost would grow with history, and `update()` would combine matching with conversion. Context-free `match(event)` finds the ID first, after which only one Context updates.

**Let a Definition matcher read Contexts or scan history.** Rejected: matching would depend on ingestion direction, result-first history pages could not determine ownership independently, and live append would regress to searching open objects.

**Define a reverse State fold for backward history scanning.** Rejected: every business would maintain two inverse algorithms, and deletion, non-invertible aggregation, and cross-Context dependencies would be difficult to keep equivalent. Ordered Matches followed by forward replay from start preserve one business meaning.

**Make Inbox a first-class engine concept or one window-wide Context.** Rejected: Inbox is ordinary business State and does not belong in the generic engine. Per-splice instantaneous State plus a strictly backward Reader supports prepend, append, and Message lookup together.

**Register specialized query methods for cross-business reads.** Rejected: consumers would still depend on provider APIs, and each new relationship would expand a central interface. Reader exposes a named kind's read-only predecessor Context; the provider writes useful State and the consumer interprets it.

**Let a Location-data consumer read the provider's Context State directly.** Rejected: the consumer would depend on another business's mutable internal shape and could not express which Turn/Step owns the value. Declaration-merged data maps expose only the provider-selected read-only value and engine-owned coordinates.

**Add generic `end()`, prepared, or window-reset lifecycles.** Rejected: businesses have different completion conditions, and a pagination gap is not a business lifecycle. Business Events update State, Location close triggers replay/build, and Reader dependencies own pagination invalidation.

**Reuse one Event Definition across Chat and Trajectory by branching in `buildViewNode(target)`.** Rejected: the views require different business State and intermediate records, so a shared Definition would make each package carry the other's conditions and payloads. Separate target-owned Definitions keep those choices local while sharing the Assembler's ingestion and lifecycle contracts.

**Add a generic layout model above final business Nodes.** Rejected: activity, tail candidacy, and layout enums would centralize current Chat business semantics in the engine again. Final Nodes carry renderer-required data directly and share only identity, ordering, and Location facts.

**Register the Turn-data Hook only on the Assistant renderer.** Rejected: current-Node Location access is a common capability of the `conversation.chat.node` slot, not one business renderer. The parent Chat entry registers common inject once, and every keyed renderer shares the same strongly typed contract.

**Keep running Assistant or Tool values in an independent tail container.** Rejected: settlement would move them across React parents, and a stable business key could not prevent remount. One keyed order permits data and position changes without changing Seat identity.

## Consequences

A new business node can register its matcher, State transitions, optional Location data, final target Node, and renderer locally without changing Session's business switch. `ChatNodeDataMap` and the Location data maps let a business package merge strongly typed data into the contract; every related Event must still expose a stable ID derivable from that Event alone.

Host business packages declaration-merge their durable Event members into `@deepseek-ai/dsh-session/types`, while Client Definitions type-only import the corresponding business package `/types` subpaths. Augmenting the declaring interface rather than a re-export barrel gives the independent Host and Client TypeScript programs the same Event narrowing without pulling Host runtime into the Client graph.

Initial tail, older prepend, and live append share one set of Context invariants. Missing starts, Reader window gaps, unknown Locations, and high-frequency deltas are explicit engine states and require no direction-specific business cache.

Append does not scan historical Contexts; prepend replays only Contexts whose Matches, Locations, or Reader answers actually changed. A structural Chat change may still recompute visible order and indexes, but does not rerun unrelated business folds or replace unchanged Node identity.

Separating State updates from publication cadence folds every Assistant delta while materializing at most once per animation frame. Step or Turn close and final Events can immediately publish the latest State.

Steps and Turns become stable homes for cross-business aggregates. Turn Tail and Deliverables no longer depend on renderers scanning global Nodes; slot-level `useTurnData()` narrows common reads to the current Node's Turn and uses selector equality to isolate unrelated updates.

The cost is new Runtime contracts for Registry, Assembler, Location data, dependency replay, and per-target Builders, plus parent-owned common inject and per-occurrence `hookContext` in UI Slots. Definition authors must understand stable IDs, unique starts, forward replay, Step→Turn publication order, read-only Reader access, and the prohibition on Node withdrawal.

`useTurnData()` does not revoke the standard `useSession` capability from session-scoped renderers, so this boundary relies on API guidance and tests rather than capability isolation. Registry changes remain low-frequency full rebuilds; the Chat Builder still maintains a legacy slice for StatsLine and the top-level public fields, while Trajectory owns target-specific Definitions and a Builder over the shared Session window. Built-in Definitions remain in their respective UI packages, and these compatibility boundaries do not return business interpretation to Session.
