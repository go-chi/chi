/**
 * Which preset a session ran is a question about its LOG, not its header: the
 * header records the creation-time choice, and a switch made during the blank
 * window is an event. Every reconstruction — the list row, the header label,
 * resume, fork — goes through this resolver, so a resolver that read the header
 * alone would rebuild a switched session under a composition its own history
 * contradicts.
 */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { resolveSessionPreset } from '../src/session.ts'

/** A header carrying the creation-time preset, if any. */
function header(agentPreset?: string): SessionHeader {
  return {
    version: 0,
    id: SessionId('s'),
    createdAt: 1,
    delegationDepth: 0,
    ...agentPreset === undefined ? {} : { agentPreset },
  }
}

/** One logged selection, as `agentPreset.select` appends it. */
function selected(agentPreset: string, seq: number): SessionEvent {
  return { type: 'agent-preset/selected', seq, time: seq, data: { agentPreset } }
}

describe('resolving which preset a session ran', () => {
  it('reads the creation-time value when nothing was switched', () => {
    expect(resolveSessionPreset({ header: header('standard'), events: [] })).toBe('standard')
  })

  it('prefers a logged switch over the header', () => {
    // The switch's effect outlives the blank window it was made in: the turns
    // that follow run under the newer composition.
    expect(resolveSessionPreset({ header: header('standard'), events: [selected('minimal', 0)] }))
      .toBe('minimal')
  })

  it('takes the last switch when a session was moved twice', () => {
    expect(resolveSessionPreset({
      header: header('standard'),
      events: [selected('minimal', 0), selected('cordis', 1)],
    })).toBe('cordis')
  })

  it('finds a switch behind later events', () => {
    const later = { type: 'turn/end', seq: 2, time: 2, data: { turn: 1 } } as SessionEvent

    expect(resolveSessionPreset({ header: header(), events: [selected('minimal', 0), later] }))
      .toBe('minimal')
  })

  it('reports none when the deployment composes no presets', () => {
    // A valid deployment: every session shares the host composition, and no
    // surface should invent a preset name for it.
    expect(resolveSessionPreset({ header: header(), events: [] })).toBeUndefined()
  })
})
