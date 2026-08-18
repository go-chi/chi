/**
 * Frozen input-machine contract. Types
 * only. Three-tier visibility: business packages see InputState via the
 * InputZone currency; the scoped input events carry the mutation verbs; the
 * conversation wiring layer alone sees the full SessionInput. InputMachine
 * (machine.ts) is package-private and never exported.
 */
import type { ClientContext, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  ArbitrateKey, ArbitrateOutcome, CommandClaim, ConsumeTokenRequest, PickOutcome,
  ReferenceInsert, SubmitOutcome, TokenSpan,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { QueueRow } from '../contract/queue.ts'
import type { InputSubmitMode } from '../contract/composer-submission.ts'

/** Browser-runtime identity of one unsent image draft. */
export type DraftAttachmentId = Branded<'DraftAttachmentId'>

/**
 * The scoped-event application verbs: the hub's bail listeners call these,
 * and the boolean answer IS the event's bail value (true ⟺ the machine
 * accepted after phase and span/bare-token guards).
 */
export interface InputTarget {
  /** Replace the trigger span with claim.token and enter claimed (span-CAS'd). */
  beginCommand(claim: CommandClaim, span: TokenSpan): boolean
  /** Replace the trigger span with one reference occurrence (span-CAS'd). */
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean
}

/** Per-session input facade owned by the conversation wiring layer. */
export interface SessionInput extends InputTarget {
  /** Single write path for draft text (all mutation rides machine events). */
  setDraft(text: string): void
  /** Append ordered browser-owned image ids; busy admission phases refuse. */
  addImages(ids: readonly DraftAttachmentId[]): boolean
  /** Remove one browser-owned image id. */
  removeImage(id: DraftAttachmentId): void
  /** Drop ids whose browser-owned objects no longer exist. */
  pruneImages(ids: readonly DraftAttachmentId[]): void
  /**
   * THE complexity sink: enter adjudication, submit transaction, and the default sink live inside.
   * @param mode - delivery intent retained through asynchronous adjudication and serialization.
   */
  submit(mode?: InputSubmitMode): void
  /**
   * Surface a notice outside the machine's own effect stream: detached
   * command results and business notifications render through here.
   * Session-routed — resolving the facade via SessionInputResolver.for(actx) lands
   * the notice on that session's composer, so a result arriving after a
   * session switch still reaches its own session.
   * @param level - severity tier.
   * @param text - notice body.
   */
  notify(level: 'info' | 'error', text: string): void
  /** Input state store (InputZone currency + decorations read here). */
  readonly state: SnapshotStore<InputState>
}

/** Session-addressed access to the per-session input facade. */
export interface SessionInputResolver {
  /** Resolve the facade for one session-scope ctx. */
  for(actx: ClientContext): SessionInput
}

/**
 * The public input action face provided to every session-scope slot
 * component: two stable-identity void callbacks, mirroring the
 * useStore+actions convention. Command-style handles (track/arbitrate/space/
 * undo/paste/…) stay InputBar-private and never ride this face.
 */
export interface InputActions {
  /** Single public draft write path (full next draft; occurrence math via diff scan). */
  setDraft(text: string): void
  /** Append ordered browser-owned image ids; busy admission phases refuse. */
  addImages(ids: readonly DraftAttachmentId[]): boolean
  /** Remove one browser-owned image id. */
  removeImage(id: DraftAttachmentId): void
  /** Drop ids whose browser-owned objects no longer exist. */
  pruneImages(ids: readonly DraftAttachmentId[]): void
  /** Enter submission (adjudication / claim transaction / default sink inside). */
  submit(): void
}

/** One surfaced notice (command results, adjudication failures). seq keys re-render of repeats. */
export interface InputNotice {
  readonly level: 'info' | 'error'
  readonly text: string
  readonly seq: number
}

/**
 * The InputBar-exclusive keyboard/DOM command face: synchronous
 * returns and event-handler semantics that must not enter the public provide
 * channel. Handed to the composer-bar entry through its own inject —
 * package-internal, never across a plugin boundary. The session shell
 * satisfies it structurally.
 */
export interface ComposerKeyboard {
  /** Live machine state for event-handler reads (render reads go through useInput). */
  readonly snapshot: InputState
  /** Draft write with the DOM-observed edit shape (narrows occurrence math). */
  setDraft(text: string, editRange?: EditRange): void
  /** Submit with an explicit delivery mode resolved by the keyboard policy. */
  submit(mode: InputSubmitMode): void
  /**
   * Steer every still-pending queued message into the running turn (the
   * empty-draft accelerated-Enter gesture; the queue dock's per-row steer
   * button is the same operation applied to the whole queue).
   */
  steerQueue(): void
  undo(): void
  redo(): void
  /** Paste over the selection (sync components ride the same transaction). */
  pasteBegin(text: string, selection: EditSelection, components?: readonly PasteComponent[], generation?: number): void
  /** Caret/selection gestures the machine cannot observe end the paste attempt. */
  invalidatePaste(): void
  /** Feed a draft/caret change through trigger detection (guard derived from phase). */
  track(draft: string, caret: number): void
  /** Keyboard arbitration while the menu is open ('pass' when no pipeline). */
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome
  /** Space adjudication; true = the input applied a claim — caller preventDefaults. */
  space(): boolean
  /** Dismiss the popupSelect shell (any interaction outside the box). */
  dismissPopup(): void
}

/** One independently addressable row projected from the transient queue snapshot. */
export type QueuedMessage = QueueRow

/** Guard union of the scoped consume-token event, checked by the machine. */
export type ConsumeTokenGuard = ConsumeTokenRequest['guard']

/** Half-open [start, end) range/selection in draft character coordinates. */
export interface EditSelection {
  readonly start: number
  readonly end: number
}

/**
 * One edit applied to the previous draft: [start, end) in the PREVIOUS
 * draft's coordinates was replaced by insertedLength characters. Supplied by
 * the wiring layer when the DOM event exposes the edit shape; absent, the
 * machine recovers it with a prefix/suffix common-scan diff.
 */
export interface EditRange extends EditSelection {
  readonly insertedLength: number
}

/**
 * One reference chip occurrence, backing exactly one U+FFFC placeholder in
 * the draft. Identity is occurrenceId — same-named
 * references stay independently addressable. label/clipboardText are the
 * owner's insert-time projections, cached so the chip survives owner loss
 * (invalid flips instead of dropping the occurrence).
 */
export interface Occurrence {
  /** Machine-minted stable identity (monotonic per machine). */
  readonly occurrenceId: number
  /** Owning source name (serializer routing key). */
  readonly source: string
  /** Owner-scoped reference id. */
  readonly ref: string
  /** Placeholder offset in the draft; the occurrence occupies exactly [offset, offset+1). */
  readonly offset: number
  /** Chip display label (insert-time cache). */
  readonly label: string
  /** Clipboard / persistence projection, e.g. `/name` (insert-time cache, never the model form). */
  readonly clipboardText: string
  /** Owner-resolution failure flag: chip renders invalid; serialization must fail. */
  readonly invalid?: boolean
}

/** One sync-matched paste component; start/end are relative to the pasted text. */
export interface PasteComponent extends EditSelection {
  readonly reference: ReferenceInsert
}

/**
 * Live paste-match attempt published while async matching may still upgrade
 * pasted tokens (the clipboard round-trip). Any non-paste transaction,
 * submit start, invalidate-paste, or release ends it; a paste-upgrade keeps
 * it current (later tokens re-CAS against the advanced draftRev).
 */
export interface PasteAttemptState {
  /** Machine-minted attempt identity (paste-upgrade must match it). */
  readonly attemptId: number
  /** Pasted range in the draft as of the paste transaction. */
  readonly insertedRange: EditSelection
  /** Caller-supplied projection generation echoed back (the controller drops cross-generation results). */
  readonly generation: number
}

/**
 * InputMachine construction knobs. The machine never reads an ambient clock:
 * `now` is the only time source, injected by the shell (tests inject a
 * fake). The default clock is constant, i.e. consecutive single-char typing
 * always coalesces until a non-typing transaction intervenes.
 */
export interface InputMachineOptions {
  /** Single-char typing undo-merge window in ms (default 1000). */
  readonly mergeWindowMs?: number
  /** Monotonic clock for typing-merge decisions (default: constant 0). */
  readonly now?: () => number
}

/** Published input state (the currency; per-session). */
export interface InputState {
  readonly draft: string
  /** Ordered runtime-only image ids; bytes and URLs stay in ConversationController. */
  readonly imageIds: readonly DraftAttachmentId[]
  /** Monotonic draft revision (span CAS compares against this). */
  readonly draftRev: number
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  /** Present exactly while claimed/submitting (claim snapshot during flight; submit closure withheld). */
  readonly claim?: { readonly token: string; readonly hint?: string }
  /** Chip occurrence table, sorted by offset (one U+FFFC per entry). */
  readonly occurrences: readonly Occurrence[]
  /** Live paste-match attempt (absent when no paste is matchable). */
  readonly paste?: PasteAttemptState
  /** Read-only transient inbox projection (`session/queue`, including pending steering). */
  readonly queue: readonly QueuedMessage[]
}

/**
 * One in-flight submission attempt: the ONLY id concept in the submit plane.
 * Created on enter; carried by adjudicated/submit-settled events; stale
 * attempts are dropped (anti-backwash). release/session teardown aborts the
 * current attempt, keeping the promise bounded.
 */
export interface SubmitAttempt {
  readonly seq: number
  readonly signal: AbortSignal
  /** Draft at enter time; rollback restores it only while the live draft still equals it. */
  readonly draftSnapshot: string
  /** Default-message delivery intent retained while slash adjudication is pending. */
  readonly mode: InputSubmitMode
}

/**
 * InputMachine input events (the machine's single write path). Every draft
 * mutation is one transaction: draft edit, occurrence reconciliation, and
 * undo-log push are atomic inside dispatch(). Events carrying `at` stamp the
 * injected clock reading; only single-char typing coalescing reads it.
 */
export type InputEvent =
  /** Full next draft from the textarea; editRange narrows the occurrence math (absent → diff scan). */
  | { readonly type: 'draft-changed'; readonly draft: string; readonly editRange?: EditRange }
  | { readonly type: 'begin-command'; readonly claim: CommandClaim; readonly span: TokenSpan }
  /** Place one U+FFFC at the span and mint the occurrence (scoped insert-reference event payload). */
  | { readonly type: 'insert-ref'; readonly reference: ReferenceInsert; readonly span: TokenSpan }
  /** Delete a settled command token; success is observable as a draftRev advance. */
  | { readonly type: 'consume-token'; readonly guard: ConsumeTokenGuard }
  /** Owner-resolution result: exactly the listed occurrences are invalid (style bit; not a transaction). */
  | { readonly type: 'set-invalid'; readonly invalidIds: readonly number[] }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  /**
   * Paste text replacing the selection, one transaction. Hot-snapshot sync
   * matches ride in as components (chips minted inside the SAME transaction:
   * one undo returns to pre-paste); a PasteMatchAttempt opens for the async
   * remainder. Component ranges must be disjoint and inside the pasted text.
   */
  | { readonly type: 'paste-begin'; readonly text: string; readonly selection: EditSelection; readonly components?: readonly PasteComponent[]; readonly generation?: number }
  /** Async match landed: upgrade one pasted token to a chip as an INDEPENDENT transaction (undo #1 → text, undo #2 → pre-paste). */
  | { readonly type: 'paste-upgrade'; readonly attemptId: number; readonly span: TokenSpan; readonly reference: ReferenceInsert }
  /** Shell-observed attempt killers the machine cannot see itself (caret/selection ops, Slash interaction updates). */
  | { readonly type: 'invalidate-paste' }
  | { readonly type: 'enter'; readonly mode: InputSubmitMode }
  | { readonly type: 'adjudicated'; readonly attempt: SubmitAttempt; readonly outcome: PickOutcome }
  | { readonly type: 'adjudication-failed'; readonly attempt: SubmitAttempt; readonly message: string }
  | { readonly type: 'submit-settled'; readonly attempt: SubmitAttempt; readonly ok: boolean; readonly outcome?: SubmitOutcome; readonly message?: string }
  /**
   * An ordinary (default-sink) send was accepted: clear the draft as a COMMIT —
   * undo must not resurrect sent content (mirrors submit-settled's success arm).
   */
  | { readonly type: 'send-committed' }
  | { readonly type: 'release' }

/**
 * InputMachine output effects (executed by the SessionInput shell; the
 * machine stays pure). Draft/occurrence mutations carry no effect — the
 * shell publishes the state store after every dispatch.
 */
export type InputEffect =
  | { readonly type: 'adjudicate'; readonly attempt: SubmitAttempt; readonly draft: string }
  | { readonly type: 'begin-submit'; readonly attempt: SubmitAttempt; readonly claim: CommandClaim; readonly args: string }
  | { readonly type: 'default-sink'; readonly draft: string; readonly mode: InputSubmitMode }
  | { readonly type: 'notice'; readonly level: 'info' | 'error'; readonly text: string }
