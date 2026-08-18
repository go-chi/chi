/**
 * Agent-preset preference row: the preset new sessions are composed from.
 * A running session keeps the composition it began with, so this row never
 * disturbs work in progress.
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import { PresetMenu } from './PresetMenu.tsx'
import css from './AgentPresetRow.module.css'

/** Registration-side business face for the host-backed preference. */
export interface AgentPresetRowInjected {
  hooks: {
    /** Agent-preset settings snapshot bound by the renderer as useAgentPreset. */
    agentPreset: SnapshotStore<AgentPresetSettingsState>
  }
  /** Load the roster when the row first renders. */
  load: () => Promise<void>
  /** Persist one preset as the default for later sessions. */
  select: (id: string) => Promise<void>
}

/** Full component props. */
export type AgentPresetRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetRowInjected>

/**
 * Render the new-session agent-preset selector.
 * @param props - composed slot props.
 * @returns the row, or null when the deployment composes no presets.
 */
export function AgentPresetRow({ load, select, useAgentPreset, t }: AgentPresetRowProps) {
  const state = useAgentPreset(snapshot => snapshot)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.writable && state.status !== 'unavailable') return
    setOpen(false)
  }, [state.status, state.writable])

  // A deployment that composes no presets has nothing to choose between, and
  // every session shares the host composition — the row simply does not exist.
  if (state.status === 'unavailable') return null
  const busy = state.status === 'loading' || state.status === 'saving'
  // Every preset surface applies the same display-copy rule. The id remains
  // addressing rather than a label, except where no display name exists.
  const chosen = state.options.find(option => option.id === state.currentValue)
  const chosenText = chosen === undefined ? undefined : presetDisplayText(chosen, t)
  const label = state.currentValue === '' ? t('loading') : (chosenText?.name ?? state.currentValue)
  const description: string = state.error ?? t('description')

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.desc} role={state.error === null ? undefined : 'alert'}>{description}</div>
      </div>
      <PresetMenu
        options={state.options}
        selectedId={state.currentValue}
        label={label}
        t={t}
        buttonClassName={css.selector}
        chevronClassName={css.chevron}
        disabled={busy || !state.writable || state.options.length === 0}
        open={open}
        onOpenChange={setOpen}
        onSelect={(id) => { void select(id) }}
      />
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent-preset row copy. */
    'settings.agentPreset': AgentPresetSettingsKey
  }
}
