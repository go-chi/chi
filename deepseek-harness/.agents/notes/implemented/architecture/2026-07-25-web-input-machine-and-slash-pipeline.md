# Agent Note: Web input state machine, composer slots, and the slash pipeline (ui-conversation input / ui-input-trigger)

Status: implemented

English | [中文](2026-07-25-web-input-machine-and-slash-pipeline.zh.md)

> Scope: the input state machine (the occurrence table + claim watch + the submit transaction), the hub/facade and send orchestration, the three scoped bail events for cross-plugin input rewrites, `/` and `@` trigger detection and the menu pipeline (ui-input-trigger), and the slot system around the composer. It depends on the [session scope note](2026-07-25-web-client-session-scope-and-provide-channel.md)'s sctx / provide / session-maybe and blank entity model; command knowledge (the three kinds, the directory, popups) is untouched here — that is the [command surfaces note](2026-07-25-web-command-surfaces-and-assembly.md)'s territory.

## Problem

Two composers, each a law unto itself: hero (EmptyState, the controlled chain writing straight into the Session) and the in-conversation InputBar (a plain controlled textarea) — behavior, draft ownership, and send path all inconsistent. To bring the three trigger families — `/` commands, skill references, `@` references — onto the input surface, these had to be answered:

- How the three trigger families layer, and who holds knowledge of "commands" versus who stays zero-knowledge;
- How the input box expresses "command mode" — derived from the draft text or explicit state? What do backspace, enter, space, and pasting a whole line each mean;
- Submission is an asynchronous transaction (an RPC round trip) — how are stale-result backwash, session switching, and React concurrent replay defended;
- How reference chips are represented on a plain textarea, and who owns undo / clipboard / paste matching / model serialization;
- How cross-plugin input rewrites (menu backfill, reference insertion, token consumption) achieve dependency inversion;
- Which React shells must be reused across no session → blank session, and which strict-session input bodies may be replaced.

Hard constraints: components mount through slots only; presentation artifacts never enter the session log; the keyboard path is IME-safe throughout.

## Decision

### The input state machine (`InputMachine`)

A pure state machine, events in / effects out, clock injected. Four phases (plain / adjudicating / claimed / submitting). Command mode is **never derived from the draft**; the pick paths establish it explicitly at discrete moments; the claim is watched by `draft.startsWith(token)`, with a backspace break releasing automatically; the claim shape is `{token, hint?}` (hint feeds ghost text).

The event surface (`dispatch(ev)` is the single write entry; one transaction per event):

- `draft-changed {draft, editRange?}` — the textarea's full draft; editRange narrows the occurrence-shift computation, defaulting to a shared prefix/suffix scan.
- `newline {selection}` — the Ctrl+Enter line break (not via the browser's execCommand: under self-managed undo a browser write forks two histories).
- `begin-command {claim, span}` / `insert-ref {reference, span}` / `consume-token {guard}` — the machine side of the three bail events; span CAS = draftRev equality.
- `set-invalid {invalidIds}` — the style bit for owner-resolution results (not a transaction).
- `undo` / `redo` — the self-managed transaction log (a ring of 100; single-character typing merges within injected-clock windows; a successful submit clears the log).
- `paste-begin {text, selection, components?, generation?}` — the paste plus hot-snapshot synchronously matched components in one transaction (one Undo returns to before the paste); opens a PasteMatchAttempt.
- `paste-upgrade {attemptId, span, reference}` — an asynchronous match upgrade as its own transaction (Undo in two steps); the attempt stays current, and insertedRange shrinks with each upgrade.
- `invalidate-paste` — attempt-ending gestures observed at the DOM layer (caret/selection operations and the like).
- `enter {mode}` / `adjudicated` / `adjudication-failed` / `submit-settled` / `release` — the submit-transaction plane: a SubmitAttempt (seq + AbortSignal) blocks backwash; success commits and clears the draft; failure rolls back under the drift guard (the enter-time snapshot is backfilled only while the live draft still equals it; if the user has typed again, only a notice fires).

The effect surface (executed by the shell): `adjudicate` (calls InputTriggerController.adjudicate), `begin-submit` (the claim.submit transaction), `default-sink` (ordinary messages, hub-orchestrated), `notice`.

The occurrence table and the chip's three projections:

- Each reference occupies one `U+FFFC` in the draft; a table entry is `{occurrenceId, source, ref, offset, label, clipboardText, invalid?}`; same-named chips stay independent through occurrenceId.
- Every edit updates the draft and the table in one transaction: ranges shift; a deletion/replacement intersecting a placeholder acts on the whole chip.
- The single-character placeholder makes keyboard atomicity mostly hold natively (the caret has no interior position; Backspace / arrow keys / Shift extension natively take the whole chip); a mouse click on a chip goes backdrop hit → whole-chip setSelectionRange.
- The visual projection = label: the backdrop renders the chip at the placeholder offset (the textarea glyph is invisible), with invalid taking the invalid style.
- The clipboard/persistence projection = clipboardText: copy/cut expands placeholders inside the selection; the draft-persistence mirror writes the same projection (the chat store always holds plain text; the refresh seed semantics = select-all copy → reopen → paste, with chips degrading to text across a refresh).
- The model projection = generated per chip at submit through the source's `codec.serialize` (owned by the submit attempt's signal and stale guard; a missing owner / failure / cancel means no send, never a downgrade to `/name`).

### Cross-plugin input rewrites: three scoped bail events

The contract is declared in ui-input-trigger (the bottom of the dependency chain); producers dispatch via `sctx.bail(sctx, ...)`, and the only consuming side is the three listeners the hub hangs on the sctx when building the shell; returning `true` ⟺ the machine passed the phase and CAS guards and actually rewrote (emitting the event ≠ a successful modification; whether Space gets `preventDefault` follows the return value):

- `slash/input-begin-command` `{claim, span}` — backfill of the command claim adjudicated from a menu pick / Space (dispatched by the InputTriggerController).
- `slash/input-insert-reference` `{reference, span}` — reference chip insertion (dispatched by the InputTriggerController).
- `slash/input-consume-token` `{guard: span | bare-token}` — consuming the command token after business success (dispatched by the downstream command surfaces).

Calls that stay un-evented (registry registration → explicit call → await): Input's own draft/submit, asynchronous Enter adjudication, the reference serializer, the asynchronous paste matcher. `@mode bail` has entered the JSDoc parser and the cordis catalog gate (scripts/jsdoc.ts).

### The slash pipeline (ui-input-trigger: a root `InputTriggerService` + a per-session `InputTriggerController`)

A trigger/menu/pick pipeline with zero knowledge of "commands":

- The service holds only the source registry (`InputTriggerSource{trigger: '/'|'@', name, order?, candidates, onPick, matchSpace?, matchEnter?}`; (trigger,name) unique; the optional `order` sorts the roster — lower first, default 0, ties keep registration order — and that sorted roster is both group order and polling order) and `sessionOf(sctx)`. Implementing a match hook IS the declaration of participation in space/enter adjudication; the pipeline polls in roster order, the first non-undefined answer wins, and no claimant means the default sink. matchSpace is synchronous (space fires mid-keystroke; hot cache only); matchEnter is asynchronous (it may await the source's own warmup, and a warmup failure rejects).
- The controller holds the single authoritative hit (span included; retained for Space after the menu closes), the per-session menu store, the candidate-fetch generation, keyboard arbitration (combobox mode: focus stays in the textarea, ↑↓/Enter/Escape are intercepted and all pass the IME composition guard, with the single exception Shift+Enter unconditionally going first), and pick orchestration (outcome → self-dispatched bail events). `toggleSource(name, syntheticHit)` is the chrome-launch path: it seeds only that registered source over the caller's textarea selection and publishes `launcher = name` until close; ordinary typed tracking clears the launcher and restores the full trigger roster. Both paths render the same MenuView and execute the same `onPick` chain. A `dismiss()` verb backs MenuView's injected `onDismiss` (a pointer down outside both the menu and the surrounding composer card closes the menu; MenuView also localizes group titles through the `slash.menu` locale namespace and clamps its height to the viewport space above the composer via ui-primitives' `useAnchoredMaxHeight`); at each session scope's birth it runs `warm(projection)` once over the source roster — within that scope the projection holds only the stable sessionId, with no published/capability transitions; the scope disposer tears down the controller.
- Trigger-detection word boundaries (`user@host` and URL `/` never trigger) and the guard tiers (plain: `/` everywhere + `@` inline / claimed: `/` suppressed, `@` live / frozen: none) are the frozen pure core.

### hub / facade: the resident shell and the strict-session input body

- The hub (trigger/decoration registries + send orchestration) takes the slash/command services as optional `ctx.get()` dependencies: without ui-input-trigger or the command surfaces, input still sends and receives normally — graceful degradation.
- Each materialized Session has exactly one `SessionInputShell` (the facade), created and torn down with the session scope; with no session, no input machine is built. `ConversationRoot` is itself the `session-maybe` resident shell, holding HeroShell, the Workspace picker, the composer stack, and the chain-fallback frame. It always owns the same scrollport and composer seat; separate strict-session header and body outlets fill those fixed regions after a Session appears.
- The composer bar is one `session-maybe` slot entry rendered unconditionally: with no session the same InputBar renders inert (machine faces absent, `disabled` owner prop), and once `connectWorkspace` returns a blank session the same instance goes live — the textarea DOM survives the no-session → blank transition and every later phase flip; `ConversationRoot`, the Hero, and the layout skeleton hold throughout.
- ConversationRoot's Hero criterion is `sessionId === undefined || (composerPhase === 'blank' && (openState === 'open' || summaryBlank === true))`: a summary-proven blank Session remains Hero in every open state, while an unproven Session settles during loading. The first submit enters engaging synchronously, and a failure keeps the composer and the error context rather than falling back to the blank Hero; the sidebar's blank bit flips false only after a prompt is successfully accepted.
- Sending unifies in the hub defaultSink: after an optimistic draft clear it goes only through `session.prompt` with `mode:'queue'` (the Web UI has no steer entry; host-wire `mode:'steer'` remains outside this machine); backfill happens only when it fails and the live draft is still empty — a user who has kept typing is never overwritten. No Draft materialize or attach transaction exists.
- When the blank Hero re-picks the Workspace, the shell calls `connectWorkspace`; if the target session differs, the non-empty draft moves from the current shell to the target shell before the new id is opened, and the old blank session survives but is no longer current.
- The Notifier's two-bit contract: `dirty` (snapshot freshness, clearable by an `ensureFresh` pull) and `notifyPending` (notification debt, cleared only by a flush) are mutually independent — a pull must not swallow a push, and object-layer push subscribers (watchTransaction) depend on this guarantee.

### Plain-text references: text outcomes and lexicon decoration

skill/@subagent references skip the placeholder + occurrence identity chain — the plain-text-reference decision: a pick inserts the literal `/name ` `@name ` text straight into the draft, with the chip visual purely derived:

- PickOutcome gains a `{text}` arm; the new scoped bail event `slash/input-insert-text` `{text, span}` (the same contract as the other three: draftRev CAS, returning true ⟺ an actual rewrite); facade.insertText goes through setDraft concatenation — zero machine changes.
- Sources get an optional `lexicon?(session)` hook: a synchronous hot-snapshot name roster, with `undefined` = data not warm — zero decoration, never triggering a fetch (the render path stays synchronous and side-effect-free); the paired optional `subscribeLexicon?(session, listener)` hook is the invalidation channel for rolls that change after warm (catalog settles, children spawn/exit). The controller aggregates the rolls into its `lexicon` snapshot store (re-polling on each source notification); sources registered after scope birth are warmed and folded in via the service's live-controller broadcast.
- `decorations.scanTextRefs`: a word-boundary scan of the draft (`/name`, `@name` at line start / after whitespace; `x/name` never hits) against the roster; a hit gets the `.textRef` mark (a pure range highlight on the backdrop, same as hlToken); an edit breaking the match shape simply disappears on the next scan.
- Sending is the literal text (no more `<skill>` serialization); on the bubble side MessageItem decorates both shapes (the legacy `<skill>` tag + plain-text tokens).
- The old occurrence/paste/serialize chain stays on disk in full, undeleted (additive; deletion is a separate future cut). Decoration reactivity: InputBar subscribes to the shell's lexicon source (uSES), so a roll that settles after the scope-birth prewarm lights existing draft tokens up without any menu interaction or unrelated re-render.

### Per-session provide contributions and the private keyboard surface

- ui-conversation (the hub doubling as a contributor) supplies through `sessions.provide` the `'input'` hook (machine state + the queue overlay) plus the `inputActions` prop (`setDraft`/`submit`, stable void callbacks).
- The public/private boundary: the public provide carries only React-vocabulary members; the keyboard/DOM command surface (track/arbitrate/space/undo/redo/paste/dismissPopup/bindMirror — synchronous return values, disposer semantics) is InputBar-exclusive, passed privately in-package through the InputBar entry's own inject, never leaving the plugin boundary.

### The slot system

`conversation` is itself session-maybe; its session content and the composer input slots are strict session, while the Hero Workspace picker stays root. The root registration renders the header outlet above its resident scrollport and the body outlet inside it, before the resident composer seat. The child slots are all declared by ui-conversation's conversation registration:

- `conversation.session.header` (single) — strict-session breadcrumb, view tabs, and header actions above the resident scrollport.
- `conversation.session` (single) — the strict-session view ring and draft mirror inside the resident scrollport. Header and body share the same session-scoped chat store; each is rebuilt when the session id switches.
- `conversation.composer.bar` (single) — the slot for the InputBar itself: the InputBar is a true slot entry (self-registered into its own slot) and the content of the composer chain's fallback; it is not a chain entry — the chain's single election would unmount it on a takeover, breaking textarea DOM survival.
- `conversation.input.overlay` — the floating-overlay anchor inside the input card; registrants' inject resolves each one's own per-session controller by the slot sessionId.
- `conversation.input.dock` — the stacked strip above the input (QueueDock's read-only queue list lands here), ordered by `order`.
- `conversation.composer.dock` — the stats band on the composer's top edge.
- `conversation.input.left` / `conversation.input.right` — the tool-row left and right regions.
- `conversation.input.plan` / `conversation.input.model` (single) — the tool row's two named control seats; the bar passes only `locked` (owner props), each stays empty until its owning plugin registers, no placeholder fallback. The plan seat stays empty while inactive because the shared Command source owns entry; an effective plan target renders the warn-state `Plan ×` status button, whose only action is `/plan off`.
- `conversation.hero.workspace` (root scope) — the Workspace picker shared by the no-session and blank Hero; a pick reuses or creates the target blank session through `connectWorkspace`, moving the draft where necessary before switching current.

### Testing discipline

The state machine's entire behavior is covered by pure-JS unit tests (event sequences in, asserting state and effects, zero browser DOM); the interaction matrix is projection-tested row by row. This requirement is precisely what forced the pure-core + service-shell layering.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| An ActiveCommand intermediate state / a registerMode mode registry / deriving command mode from the draft | Claims are established explicitly by the pick paths — no table, no derivation |
| Direct bindTarget/bindDraft object wiring | Reverse coupling plus root-singleton cross-session mispairing; scoped bail events preserve dependency inversion with structurally correct routing |
| A unified slash/input-apply, or eventing everything | Three independent payloads cover the cross-plugin rewrites; asynchronous paths stay registry-based explicit calls |
| contenteditable / a rich-text tree | Poor compatibility; textarea + U+FFFC + the occurrence table covers the full interaction contract |
| Dual draft persistence {text, occurrences} | The mirror writing the clipboard projection adds zero new concepts; chip degradation across refresh is acceptable |
| The native textarea undo stack | Unreliable under controlled + programmatic writes; the paste two-step undo semantics can only be self-managed |
| The InputBar receiving a 16-member wiring-callback bundle | The consumption matrix proved 11 members InputBar-exclusive and 1 a dead member; the standard-kit channel lets components fetch their own, with the keyboard surface passed privately in-package |
| Space adjudication also claiming execute-kind commands | The misfire defense: after a space the whole line is an ordinary prompt; irreversible side effects keep explicit entry points only |
| A generic tokenPattern decoration mechanism | Structured occurrence records replace pattern scanning |
| A placeholder select resident in the tool row | Named seats stay empty until registration; a placeholder clashing with the real implementation is two sources of truth |
| An always-visible Plan on/off toggle | The shared Command source already owns entry; a second entry point turns a status seat into redundant mode chrome |
| A second plus-menu component/controller, or an Add/File group above Command | It would duplicate async candidates, keyboard highlight, focus retention, and pick state; the plus control is only a source-filtered launcher for the existing MenuView, and this scope has no file capability |
| All references through U+FFFC chips (the line the plain-text-reference decision replaced) | Plain text + derived decoration carries zero identity state; the literal text IS the model projection, sparing undo/clipboard any special cases; the chip chain is kept for scenarios needing indivisible atomicity |

## Consequences

- One resident conversation shell carries no-session/blank/active: no session → blank preserves ConversationRoot, Hero, the root-scoped Workspace picker, scrollport, composer seat, InputBar, and textarea; only the strict header and body outlets gain content. The same blank session → engaging/active also keeps the InputBar and textarea. EmptyState and the controlled intent chain (`sessions.updateIntent`/`updatePendingPrompt`/`workspaces.sendSession`) are deleted along with their last consumer.
- The input surface's zero knowledge of commands plus optional dependencies: pure input works without the command packages; `@` references and skill references get free reuse of the same menu/pick pipeline. The cost is that space/enter adjudication is a per-source polling protocol whose answer semantics (sync/async, the meaning of undefined) are a frozen contract.
- Transactionalized submission (attempt seq + the drift guard) makes the three defect classes — stale-result backwash, session switching, concurrent replay — structurally impossible, pinned by the matrix tests.
- Known gaps: chip fidelity across refresh (paste matching is reusable for it) has no workstream yet; the subagent reference's model representation awaits its business workstream.
