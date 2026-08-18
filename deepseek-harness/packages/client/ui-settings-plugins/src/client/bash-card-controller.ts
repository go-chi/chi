/** The shell card's staged form over the `bash` settings namespace. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { CardForm, numberField, type CardActions, type CardFieldState, type CardShell } from './card-form.ts'

/**
 * Namespace of the shell capability. Spelled here rather than imported: a
 * client package must not depend on a Host package, and the executor families
 * that own it spell the same value.
 */
export const SHELL_NS = 'shell'

/** The shell fields this card edits — a subset of the served schema by design. */
export interface BashSettings {
  /** Foreground command timeout in milliseconds. */
  timeoutMs?: number
  /** Per-stream in-memory output cap in bytes. */
  maxOutputBytes?: number
}

/** What the shell card renders. */
export interface BashCardState extends CardShell {
  /** Command timeout in milliseconds. */
  timeoutMs: CardFieldState
  /** Per-stream output cap in bytes. */
  maxOutputBytes: CardFieldState
}

/** The registration-side face the shell card's slot entry injects. */
export interface BashCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useBashCard. */
    bashCard: SnapshotStore<BashCardState>
  }
}

/** Bridges the `bash` scope onto the shell card's staged form. */
export class BashCardController {
  private readonly form: CardForm<BashSettings>
  private readonly store: SnapshotStore<BashCardState>

  /** @param scope - the bound settings scope for the `bash` namespace. */
  constructor(scope: SettingsScope<BashSettings>) {
    this.form = new CardForm(scope, [numberField('timeoutMs'), numberField('maxOutputBytes')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): BashCardState {
    return {
      ...this.form.shell(),
      timeoutMs: this.form.field('timeoutMs'),
      maxOutputBytes: this.form.field('maxOutputBytes'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): BashCardFace {
    return { hooks: { bashCard: this.store }, ...this.form.actions() }
  }
}
