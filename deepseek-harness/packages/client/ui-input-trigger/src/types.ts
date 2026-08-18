/**
 * Frozen cross-package contract for the input trigger pipeline. Types only —
 * no runtime code. Sources (ui-commands / ui-skill / ui-subagent) and the
 * conversation input layer import from here; changes require main-thread
 * arbitration.
 *
 * Providers receive a {@link ClientSessionContext} projection per call —
 * never a Cordis context or the mutable Session. RPC and service access go
 * through the provider plugin's own root context captured at registration.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * The provider-facing projection of one client session. It carries stable
 * identity alone; a source that calls Agent-bound RPCs must consult its own
 * service's capability state because an addressed persisted subagent may
 * have a client scope without a live Host Agent.
 */
export interface ClientSessionContext {
  readonly sessionId: SessionId
}

/** Trigger character a source binds to. */
export type TriggerChar = '/' | '@'

/** Where the trigger token sits in the draft: leading (trimmed draft starts with it) or inline. */
export type TriggerPosition = 'leading' | 'inline'

/** Which of the three pick paths produced a pick. */
export type PickVia = 'menu' | 'space' | 'enter'

/** One menu candidate. Pure display data — zero behavior declaration. */
export interface InputTriggerCandidate {
  readonly name: string
  readonly description?: string
  readonly icon?: string
  readonly hint?: string
}

/** Pick-moment snapshot of the trigger token span. CAS: stale draftRev ⇒ the whole action no-ops. */
export interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/**
 * Command-mode entry credential. Pure data + a closure method — no class, no
 * cross-package runtime value (client bundle purity).
 */
export interface CommandClaim {
  /** Integrity-watched draft prefix, e.g. `'/goal '` — breaking startsWith releases the claim. */
  readonly token: string
  /** Ghost-text hint rendered while the claim's args are blank. */
  readonly hint?: string
  /** Enter transaction, supplied by the source as a closure. */
  submit(args: string, actx: ClientContext): Promise<SubmitOutcome>
}

/**
 * Inline reference insertion. The draft holds one U+FFFC placeholder per
 * occurrence; the owner supplies both user-facing projections at insert time
 * (the model representation is serialized on submit via the source codec).
 */
export interface ReferenceInsert {
  readonly source: string
  readonly ref: string
  /** Chip display label (fallback-cached on the occurrence). */
  readonly label: string
  /** Clipboard / persistence projection, e.g. `/name` (never the model form). */
  readonly clipboardText: string
}

/** Settled result of a command submit transaction. */
export interface SubmitOutcome {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

/**
 * Unified pick return. `undefined` = miss → default sink; `'handled'` = the
 * source dealt with it internally (e.g. opened its popup shell). The `text`
 * arm is the plain-text reference path (decision recorded in
 * .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
 * the token span is
 * replaced with literal text — no occurrence identity, no placeholder; any
 * chip visual is derived downstream by scanning the draft against the
 * source lexicons.
 */
export type PickOutcome =
  | { readonly claim: CommandClaim }
  | { readonly insert: ReferenceInsert }
  | { readonly text: string }
  | 'handled'
  | undefined

/** Candidate request passed to a source. The signal is superseded on query change / menu close. */
export interface CandidateRequest {
  readonly query: string
  readonly position: TriggerPosition
  readonly signal: AbortSignal
}

/** Everything a source receives on pick: candidate + session projection + the span snapshot for CAS. */
export interface InputTriggerPick {
  readonly candidate: InputTriggerCandidate
  readonly session: ClientSessionContext
  readonly position: TriggerPosition
  readonly via: PickVia
  readonly span: TokenSpan
}

/**
 * Reference codec owned by a source that produces {@link ReferenceInsert}
 * outcomes: the clipboard projection for copy/cut/persistence, and the model
 * serialization invoked per occurrence by the submit attempt (async, abort
 * rides the attempt signal; failure blocks the send — never a silent
 * downgrade to the clipboard text).
 */
export interface ReferenceCodec {
  /** Clipboard / persistence projection of one reference (e.g. `/name`). */
  clipboardText(ref: string): string
  /** Model serialization of one reference (e.g. `<skill>name</skill>`). */
  serialize(ref: string, signal: AbortSignal): Promise<string>
}

/**
 * One trigger source. Every callback receives the session's
 * ClientSessionContext projection; sources keep no copy across calls.
 *
 * Space/enter adjudication rides the optional match hooks: implementing one
 * IS the participation claim — the pipeline polls each implementing source
 * with the leading token; the first non-undefined answer wins (registration
 * order); no claimant → default sink. The hooks split because their timing
 * budgets differ: space fires mid-keystroke and must answer synchronously
 * from hot state, while enter may await the source's own warmup.
 */
export interface InputTriggerSource {
  readonly trigger: TriggerChar
  /** Menu group label; unique per trigger — duplicate registration throws. */
  readonly name: string
  /** Menu group display order (lower = higher in the list; default 0). */
  readonly order?: number
  candidates(session: ClientSessionContext, req: CandidateRequest): Promise<readonly InputTriggerCandidate[]>
  /** Every pick lands here; claim/insert outcomes are executed by the pipeline via the scoped input events. */
  onPick(pick: InputTriggerPick): PickOutcome
  /** Synchronous space-time adjudication over hot state only. `token` is the just-completed leading token (e.g. '/goal'). */
  matchSpace?(session: ClientSessionContext, token: string): PickOutcome
  /**
   * Enter-time adjudication; may strong-wait the source's own warmup and
   * reject on warmup failure. `line` is the full trimmed draft: the source
   * parses it and applies its own kind policy — args-tolerant kinds claim
   * with trailing text present, bare-token-only kinds answer undefined
   * unless the line is exactly the token.
   */
  matchEnter?(session: ClientSessionContext, line: string, signal: AbortSignal): Promise<PickOutcome>
  /**
   * Scope-birth prewarm hook (fire-and-forget): the per-session controller
   * calls it once when the session scope comes alive so sources can fetch
   * their backing data before the first interaction.
   */
  warm?(session: ClientSessionContext): void
  /**
   * Synchronous hot-snapshot name roll for plain-text reference decoration.
   * Implementing IS the participation claim: the render side
   * scans the draft for `<trigger><name>` tokens and decorates exact matches.
   * `undefined` = backing data not warm yet — no decoration, never a fetch
   * (the render path must stay synchronous and side-effect free).
   */
  lexicon?(session: ClientSessionContext): readonly string[] | undefined
  /**
   * Subscribe to changes of this source's {@link InputTriggerSource.lexicon} answer
   * for one session (backing data settled, invalidated, or refreshed). The
   * controller re-polls lexicon on each notification; a source whose roll
   * never changes after warm omits the hook.
   * @param session - stable session projection.
   * @param listener - invalidation callback.
   * @returns unsubscribe.
   */
  subscribeLexicon?(session: ClientSessionContext, listener: () => void): () => void
  /** Reference codec; required for sources producing insert outcomes. */
  readonly codec?: ReferenceCodec
}

/** Trigger availability tier, derived from the input phase by the wiring layer. */
export interface TriggerGuard {
  /** plain: '/' and '@' live; claimed: '/' suppressed, '@' live; frozen: none. */
  readonly tier: 'plain' | 'claimed' | 'frozen'
}

/** Keys the menu intercepts while open (all behind the IME composition guard). */
export type ArbitrateKey = 'up' | 'down' | 'enter' | 'escape'

/** consumed = key handled; pick-highlighted = enter picked the highlight; pass = let the input see it. */
export type ArbitrateOutcome = 'consumed' | 'pick-highlighted' | 'pass'

/** Request payload of the scoped begin-command input event. */
export interface BeginCommandRequest {
  readonly claim: CommandClaim
  readonly span: TokenSpan
}

/** Request payload of the scoped insert-reference input event. */
export interface InsertReferenceRequest {
  readonly reference: ReferenceInsert
  readonly span: TokenSpan
}

/** Request payload of the scoped consume-token input event. */
export interface ConsumeTokenRequest {
  readonly guard:
    | { readonly kind: 'span'; readonly span: TokenSpan }
    | { readonly kind: 'bare-token'; readonly token: string }
}

/** Request payload of the scoped insert-text input event (the plain-text reference path). */
export interface InsertTextRequest {
  /** Literal replacement for the trigger token span (e.g. `/name `). */
  readonly text: string
  readonly span: TokenSpan
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Applies one command claim to the scoped Input. Dispatched with the
     * session's scope carrier; the owning session's input listener returns
     * `true` only after the phase and span CAS checks pass and the machine
     * actually mutated — producers treat anything else as "not applied".
     * @param request - Claim and menu-time span CAS.
     * @mode bail
     */
    'slash/input-begin-command'(request: BeginCommandRequest): true | undefined
    /**
     * Inserts one reference into the scoped Input (same carrier routing and
     * applied-truth contract as begin-command).
     * @param request - Reference and menu-time span CAS.
     * @mode bail
     */
    'slash/input-insert-reference'(request: InsertReferenceRequest): true | undefined
    /**
     * Consumes one command token after business success (popup settle /
     * menu-pick execute). Same carrier routing and applied-truth contract.
     * @param request - Exact span or bare-token guard.
     * @mode bail
     */
    'slash/input-consume-token'(request: ConsumeTokenRequest): true | undefined
    /**
     * Replaces the trigger token span with literal text — the plain-text
     * reference path. Same carrier routing and applied-truth
     * contract; the draft gains ordinary characters, no occurrence entry.
     * @param request - Replacement text and menu-time span CAS.
     * @mode bail
     */
    'slash/input-insert-text'(request: InsertTextRequest): true | undefined
  }
}
