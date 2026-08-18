import {
  useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent,
} from 'react'
import {
  indexSubagentDescendants, type SessionId, type SessionListState, type SessionProjectionMap,
  type SessionSummary, type SubagentAddress, type SubagentCatalogSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconRefreshOutline14, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import css from './SubagentCatalogAction.module.css'

type CatalogEntry = SubagentCatalogSnapshot['entries'][number]
type Catalogs = SessionListState['subagentsByParent']

/** Business actions supplied by the slot registration. */
export interface SubagentCatalogInjected {
  openChild: (address: SubagentAddress) => void
  refresh: (parentSessionId: SessionId) => void
  setCatalogOpen: (parentSessionId: SessionId, open: boolean) => void
}

/** Full props for the session-header catalog action. */
export type SubagentCatalogActionProps =
  PropsRuntime<'conversation.session.header.actions'> & SubagentCatalogInjected & PropsLocale<typeof NS>

interface CatalogRowsProps {
  parentSessionId: SessionId
  catalog: SubagentCatalogSnapshot
  catalogs: Catalogs
  summaries: Readonly<Record<SessionId, SessionSummary>>
  expanded: ReadonlySet<SessionId>
  level: number
  now: number
  openChild: (address: SubagentAddress) => void
  refresh: (parentSessionId: SessionId) => void
  toggleBranch: (childSessionId: SessionId) => void
  closeCatalog: () => void
}

function diagnosticReason(
  entry: Extract<CatalogEntry, { kind: 'diagnostic' }>,
  t: TranslateNS<typeof NS>,
): string {
  switch (entry.reason) {
    case 'corrupt': return t('diagnostic.corrupt')
    case 'unsupported': return t('diagnostic.unsupported')
    case 'unavailable': return t('diagnostic.unavailable')
  }
}

function treeItems(root: HTMLDivElement | null): HTMLElement[] {
  return root === null
    ? []
    : Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])'))
}

/** Compact token count shared in shape with the conversation stats strip. */
function formatTokens(value: number): string {
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/** Sum the four disjoint durable provider-usage buckets. */
function tokenTotal(
  usage: SessionProjectionMap['tokenUsage'] | undefined,
): number | undefined {
  return usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens
      + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Exact whole-second active-turn duration for one catalog row. */
function activityDuration(
  summary: SessionSummary | undefined,
  activity: 'running' | 'inactive',
  now: number,
): number | undefined {
  if (summary === undefined) return undefined
  const timing: SessionProjectionMap['subagentTiming'] | undefined
    = summary.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  const end = activity === 'running'
    ? now
    : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

interface DurationParts {
  seconds: number
  minutes: number
  hours: number
  days: number
  totalMinutes: number
  totalHours: number
}

function splitDuration(ms: number): DurationParts {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: Math.floor(totalHours / 24),
    totalMinutes,
    totalHours,
  }
}

/** Format a duration with decreasing visual precision at larger scales. */
function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    return months === 0
      ? t('duration.years', { years })
      : t('duration.yearsMonths', { years, months })
  }
  if (days >= 30) {
    const months = Math.floor(days / 30)
    const remainingDays = days % 30
    return remainingDays === 0
      ? t('duration.months', { months })
      : t('duration.monthsDays', { months, days: remainingDays })
  }
  if (days > 0) {
    return hours === 0
      ? t('duration.days', { days })
      : t('duration.daysHours', { days, hours })
  }
  if (totalHours > 0) {
    return t('duration.hours', {
      hours: totalHours,
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  if (totalMinutes > 0) {
    return t('duration.minutes', {
      minutes: totalMinutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  return t('duration.seconds', { seconds })
}

/** Preserve exact whole seconds for hover and accessible naming. */
function formatExactDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days } = splitDuration(ms)
  return days === 0
    ? formatDuration(ms, t)
    : t('duration.exactDays', {
      days,
      hours: String(hours).padStart(2, '0'),
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
}

const NO_DESCENDANTS = { count: 0, runningCount: 0 } as const

/** Render the known direct-child shape while its authoritative catalog hydrates. */
function CatalogLoadingRows({
  parentSessionId,
  summaries,
  level,
  t,
}: {
  parentSessionId: SessionId
  summaries: Readonly<Record<SessionId, SessionSummary>>
  level: number
  t: TranslateNS<typeof NS>
}) {
  const children = Object.values(summaries).filter(summary => (
    summary.origin === 'subagent' && summary.parentId === parentSessionId
  ))
  if (children.length === 0) return <div className={css.notice}>{t('loading.label')}</div>
  return children.map(summary => (
    <div key={summary.id} className={css.node}>
      <div
        role="treeitem"
        aria-disabled="true"
        aria-level={level}
        aria-label={t('loading.aria')}
        className={`${css.row} ${css.disabled} ${css.loadingRow}`}
      >
        <span className={css.disclosureSpace} />
        <StateDot state={summary.running ? 'ongoing' : 'done'} />
        <span className={css.content}>
          <span className={css.label}>{t('loading.label')}</span>
        </span>
      </div>
    </div>
  ))
}

/** Render one catalog level and recurse only through explicitly expanded rows. */
function CatalogRows({
  parentSessionId, catalog, catalogs, summaries, expanded, level, now,
  openChild, refresh, toggleBranch, closeCatalog, t,
}: CatalogRowsProps & { t: TranslateNS<typeof NS> }) {
  const emptyLoading = catalog.state === 'loading' && catalog.entries.length === 0
  const reserveDisclosure = catalog.entries.some(
    entry => entry.kind === 'child' && entry.hasChildren,
  )
  return (
    <>
      {emptyLoading && (
        <CatalogLoadingRows
          parentSessionId={parentSessionId}
          summaries={summaries}
          level={level}
          t={t}
        />
      )}
      {catalog.state === 'error' && (
        <div className={css.error}>
          <span>{catalog.error?.message ?? t('load.error')}</span>
          <button
            type="button"
            className={css.refresh}
            onClick={() => { refresh(parentSessionId) }}
          >
            <IconRefreshOutline14 />
            {t('retry')}
          </button>
        </div>
      )}
      {catalog.entries.map((entry) => {
        if (entry.kind === 'diagnostic') {
          const reason = diagnosticReason(entry, t)
          return (
            <div key={entry.id} className={css.node}>
              <div
                role="treeitem"
                aria-disabled="true"
                aria-level={level}
                aria-label={`${entry.id} ${reason}`}
                className={`${css.row} ${css.disabled}`}
                title={reason}
              >
                {reserveDisclosure && <span className={css.disclosureSpace} />}
                <StateDot state="error" />
                <span className={css.content}>
                  <span className={css.label}>{entry.id}</span>
                  <span className={css.summary}>{reason}</span>
                </span>
              </div>
            </div>
          )
        }

        const childCatalog = catalogs[entry.id]
        const isExpanded = expanded.has(entry.id)
        const knownLeaf = !entry.hasChildren
        const childLoading = childCatalog === undefined
          || (childCatalog.state === 'loading' && childCatalog.entries.length === 0)
        const summary = summaries[entry.id]
        const label = entry.label ?? entry.id
        const mode = entry.mode === 'one-shot' ? t('mode.oneShot') : t('mode.continuable')
        const activity = entry.activity === 'running' ? t('activity.running') : t('activity.inactive')
        const secondary = [summary?.title, mode, activity]
          .filter(value => value !== undefined)
          .join(' · ')
        const totalTokens = tokenTotal(summary?.projectionValues?.tokenUsage)
        const durationMs = activityDuration(
          summary,
          entry.activity,
          now,
        )
        const tokenMetric = totalTokens === undefined
          ? undefined
          : `${formatTokens(totalTokens)} tok`
        const durationMetric = durationMs === undefined
          ? undefined
          : {
            compact: formatDuration(durationMs, t),
            exact: formatExactDuration(durationMs, t),
          }
        const metrics = [tokenMetric, durationMetric?.exact]
          .filter(value => value !== undefined)
          .join(' · ')

        const open = (): void => {
          openChild({ parentSessionId, childSessionId: entry.id, mode: entry.mode })
          closeCatalog()
        }
        const handleKey = (event: KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            open()
          } else if (
            (event.key === 'ArrowRight' && !knownLeaf && !isExpanded)
            || (event.key === 'ArrowLeft' && isExpanded)
          ) {
            event.preventDefault()
            event.stopPropagation()
            toggleBranch(entry.id)
          }
        }
        const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
          event.preventDefault()
          event.stopPropagation()
          toggleBranch(entry.id)
        }

        return (
          <div key={entry.id} className={css.node}>
            <div
              role="treeitem"
              tabIndex={0}
              aria-level={level}
              aria-label={[label, secondary, metrics].filter(value => value !== '').join(' ')}
              {...knownLeaf ? {} : { 'aria-expanded': isExpanded }}
              className={css.row}
              onClick={open}
              onKeyDown={handleKey}
            >
              {knownLeaf
                ? reserveDisclosure && <span className={css.disclosureSpace} />
                : (
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`${css.disclosure} ${isExpanded ? css.disclosureOpen : ''}`}
                    aria-label={t(isExpanded ? 'branch.collapse' : 'branch.expand', { label })}
                    onClick={toggle}
                  >
                    <IconChevronRightOutline14 />
                  </button>
                )}
              <div className={css.clickarea}>
                <StateDot state={entry.activity === 'running' ? 'ongoing' : 'done'} />
                <span className={css.content}>
                  <span className={css.label}>{label}</span>
                  <span className={css.summary}>{secondary}</span>
                </span>
                {metrics !== '' && (
                  <span className={css.metrics}>
                    {tokenMetric !== undefined && <span className={css.metricToken}>{tokenMetric}</span>}
                    {durationMetric !== undefined && (
                      <span
                        className={css.metricDuration}
                        title={t('duration.exactTitle', { duration: durationMetric.exact })}
                      >
                        {durationMetric.compact}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            {isExpanded && !knownLeaf && (
              <div
                role="group"
                className={css.children}
                aria-busy={childLoading || undefined}
              >
                {childCatalog === undefined
                  ? (
                    <CatalogLoadingRows
                      parentSessionId={entry.id}
                      summaries={summaries}
                      level={level + 1}
                      t={t}
                    />
                  )
                  : (
                    <CatalogRows
                      parentSessionId={entry.id}
                      catalog={childCatalog}
                      catalogs={catalogs}
                      summaries={summaries}
                      expanded={expanded}
                      level={level + 1}
                      now={now}
                      openChild={openChild}
                      refresh={refresh}
                      toggleBranch={toggleBranch}
                      closeCatalog={closeCatalog}
                      t={t}
                    />
                  )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * Render the current session's direct catalog and lazily expanded descendants.
 * @param props - session standard props plus catalog navigation actions.
 * @returns The action while the catalog is pending or summaries establish descendants.
 */
export function SubagentCatalogAction({
  sessionId, useSessions, openChild, refresh, setCatalogOpen, t,
}: SubagentCatalogActionProps) {
  const catalogs = useSessions(state => state.subagentsByParent)
  const summaries = useSessions(state => state.byId)
  const catalog = catalogs[sessionId]
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState<ReadonlySet<SessionId>>(() => new Set())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const observedCatalogs = useRef(new Set<SessionId>())
  const setCatalogOpenRef = useRef(setCatalogOpen)
  setCatalogOpenRef.current = setCatalogOpen
  const healthy = catalog?.entries.filter(entry => entry.kind === 'child') ?? []
  const descendants = useMemo(
    () => indexSubagentDescendants(summaries).get(sessionId) ?? NO_DESCENDANTS,
    [sessionId, summaries],
  )
  // The catalog can arrive before the session-list baseline; never undercount
  // the already-visible direct rows during that short bootstrap window.
  const descendantCount = Math.max(healthy.length, descendants.count)
  const totalCountKey = descendantCount === 1 ? 'count.total.one' : 'count.total.other'
  const runningCountKey = descendants.runningCount === 1 ? 'count.running.one' : 'count.running.other'
  // Session summaries can announce membership before the descriptor-backed catalog catches up.
  // Keep that entry point visible through disabled loading rows; only catalog rows are navigable.
  const summaryBackedLoading = descendants.count > 0
    && (catalog === undefined || (catalog.state === 'ready' && catalog.entries.length === 0))
  const presentedCatalog: SubagentCatalogSnapshot | undefined = summaryBackedLoading
    ? {
      entries: [],
      parentAvailable: catalog?.parentAvailable ?? false,
      state: 'loading',
      error: null,
    }
    : catalog

  const observeCatalog = (parentSessionId: SessionId, next: boolean): void => {
    if (next) observedCatalogs.current.add(parentSessionId)
    else observedCatalogs.current.delete(parentSessionId)
    setCatalogOpen(parentSessionId, next)
  }

  const closeAllCatalogs = (): void => {
    for (const parentSessionId of observedCatalogs.current) {
      setCatalogOpen(parentSessionId, false)
    }
    observedCatalogs.current.clear()
    setExpanded(new Set())
  }

  const changeOpen = (next: boolean, restoreFocus = false): void => {
    setOpen(next)
    if (next) {
      setNow(Date.now())
      observeCatalog(sessionId, true)
    }
    else closeAllCatalogs()
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const closeBranch = (root: SessionId): void => {
    const closing = new Set<SessionId>()
    const visit = (parentSessionId: SessionId): void => {
      if (closing.has(parentSessionId) || !expanded.has(parentSessionId)) return
      closing.add(parentSessionId)
      const branch = catalogs[parentSessionId]
      for (const entry of branch?.entries ?? []) {
        if (entry.kind === 'child') visit(entry.id)
      }
    }
    visit(root)
    for (const parentSessionId of closing) observeCatalog(parentSessionId, false)
    setExpanded(current => new Set([...current].filter(id => !closing.has(id))))
  }

  const toggleBranch = (childSessionId: SessionId): void => {
    if (expanded.has(childSessionId)) {
      closeBranch(childSessionId)
      return
    }
    setExpanded(current => new Set(current).add(childSessionId))
    observeCatalog(childSessionId, true)
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        changeOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  useEffect(() => {
    if (!open || descendants.runningCount === 0) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [open, descendants.runningCount])

  useEffect(() => () => {
    for (const parentSessionId of observedCatalogs.current) {
      setCatalogOpenRef.current(parentSessionId, false)
    }
    observedCatalogs.current.clear()
  }, [])

  // Visibility needs evidence of children (entries, summary-known descendants,
  // or a failed load worth retrying). A bare loading catalog is not evidence:
  // selecting any session schedules a refresh whose loading snapshot would
  // otherwise flash the action in and out on childless sessions.
  const visible = presentedCatalog !== undefined
    && (presentedCatalog.state === 'error'
      || presentedCatalog.entries.length > 0
      || descendantCount > 0)
  useEffect(() => {
    if (visible || !open) return
    setOpen(false)
    closeAllCatalogs()
  }, [visible, open])

  if (!visible) return null

  const focusAt = (index: number): void => {
    const items = treeItems(rootRef.current)
    if (items.length === 0) return
    items[(index + items.length) % items.length]?.focus()
  }

  const navigate = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = treeItems(rootRef.current)
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      changeOpen(false, true)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(items.length - 1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(index < 0 ? items.length - 1 : index - 1)
    }
  }

  return (
    <div className={css.root} ref={rootRef} onKeyDown={navigate}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-haspopup="tree"
        aria-expanded={open}
        aria-label={t(
          descendants.runningCount > 0 ? runningCountKey : totalCountKey,
          { count: descendants.runningCount > 0 ? descendants.runningCount : descendantCount },
        )}
        onClick={() => { changeOpen(!open) }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          if (!open) changeOpen(true)
          queueMicrotask(() => { focusAt(0) })
        }}
      >
        <span className={css.activitySlot}>
          {descendants.runningCount > 0 && <StateDot state="ongoing" />}
        </span>
        <span className={css.count}>{t(totalCountKey, { count: descendantCount })}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>
      {open && (
        <div className={css.menu} role="tree" aria-label={t('tree.aria')}>
          <CatalogRows
            parentSessionId={sessionId}
            catalog={presentedCatalog}
            catalogs={catalogs}
            summaries={summaries}
            expanded={expanded}
            level={1}
            now={now}
            openChild={openChild}
            refresh={refresh}
            toggleBranch={toggleBranch}
            closeCatalog={() => { changeOpen(false) }}
            t={t}
          />
        </div>
      )}
    </div>
  )
}
