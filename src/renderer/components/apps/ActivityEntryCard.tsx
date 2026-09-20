/**
 * ActivityEntryCard
 *
 * Renders a single activity entry in the timeline.
 * Each entry has a left-side timeline node (color-coded dot)
 * connected by the parent's timeline rail, and right-side content.
 *
 * Supports all 6 entry types: run_complete, run_skipped, run_error,
 * milestone, escalation, output.
 */

import { useState } from 'react'
import { CheckCircle2, SkipForward, XCircle, Bell, FileOutput, Clock, ChevronRight, Play, FileText, FolderOpen } from 'lucide-react'
import type { ActivityEntry } from '../../../shared/apps/app-types'
import { EscalationCard } from './EscalationCard'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'
import { useAppsPageStore } from '../../stores/apps-page.store'
import { useAppsStore } from '../../stores/apps.store'
import { useDataContent } from '../../hooks/useDataContent'
import { useTranslation } from '../../i18n'
import { api } from '../../api'

interface ActivityEntryCardProps {
  entry: ActivityEntry
  appId: string
  /** Whether this is the last entry (hides the rail tail) */
  isLast?: boolean
  /** Staggered animation delay in seconds (undefined = no animation) */
  animationDelay?: number
  /** Rendered inside a host card (Overview's summary block): the body skips
   * its own card, and the drill-in stays muted rather than competing with the
   * one entry on screen. The feed needs the opposite on both counts. */
  insideCard?: boolean
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatTs(ts: number): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${date}  ${time}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

// ──────────────────────────────────────────────
// Timeline node color per entry type
// ──────────────────────────────────────────────

function nodeColorClass(entry: ActivityEntry): string {
  switch (entry.type) {
    case 'run_complete': return 'bg-green-500'
    case 'run_skipped':  return 'bg-muted-foreground/40'
    case 'run_error':    return 'bg-red-500'
    case 'milestone':    return 'bg-blue-400'
    case 'escalation':   return entry.userResponse ? 'bg-green-500' : 'bg-orange-400'
    case 'output':       return 'bg-purple-400'
    default:             return 'bg-muted-foreground/40'
  }
}

// ──────────────────────────────────────────────
// Type-specific header elements
// ──────────────────────────────────────────────

function EntryIcon({ entry }: { entry: ActivityEntry }) {
  switch (entry.type) {
    case 'run_complete':
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
    case 'run_skipped':
      return <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />
    case 'run_error':
      return <XCircle className="w-3.5 h-3.5 text-red-500" />
    case 'milestone':
      return <Bell className="w-3.5 h-3.5 text-blue-400" />
    case 'escalation':
      return entry.userResponse
        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
        : <Clock className="w-3.5 h-3.5 text-orange-400" />
    case 'output':
      return <FileOutput className="w-3.5 h-3.5 text-purple-400" />
    default:
      return null
  }
}

function entryLabel(entry: ActivityEntry): string {
  switch (entry.type) {
    case 'run_complete': return 'Completed'
    case 'run_skipped': return 'Skipped'
    case 'run_error': return 'Failed'
    case 'milestone': return 'Milestone'
    case 'escalation': return entry.userResponse ? 'Answered' : 'Waiting for you'
    case 'output': return 'Output'
    default: return entry.type
  }
}

/** Whether this entry type supports "View process" drill-down */
function hasSessionLink(entry: ActivityEntry): boolean {
  return (entry.type === 'run_complete' || entry.type === 'run_error') && !!entry.sessionKey
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export function ActivityEntryCard({ entry, appId, isLast, animationDelay, insideCard }: ActivityEntryCardProps) {
  const { t } = useTranslation()
  const openSessionDetail = useAppsPageStore(s => s.openSessionDetail)
  const continueApp = useAppsStore(s => s.continueApp)
  const appState = useAppsStore(s => s.appStates[appId])
  const [isContinuing, setIsContinuing] = useState(false)
  /** Hovering "View process" lights up the node, timestamp and card together,
   * so it's unambiguous which entry the drill-in belongs to. */
  const [drillHover, setDrillHover] = useState(false)

  const { content } = entry
  const durationMs = content.durationMs
  const canViewProcess = hasSessionLink(entry)
  const resolvedData = useDataContent(content)

  /** Whether this run_error was due to premature AI termination (no report_to_user call) */
  const isPrematureTermination =
    entry.type === 'run_error' && content.error === 'report_to_user not called'

  const isOpenEscalation = entry.type === 'escalation' && !entry.userResponse

  /** Disable Continue while already running/queued or a continue is in-flight */
  const isAppBusy = appState?.status === 'running' || appState?.status === 'queued'

  const handleViewProcess = () => {
    if (entry.sessionKey) {
      openSessionDetail(appId, entry.runId, entry.sessionKey)
    }
  }

  const handleContinue = async () => {
    if (isContinuing || isAppBusy) return
    setIsContinuing(true)
    try {
      await continueApp(appId, entry.runId)
    } finally {
      setIsContinuing(false)
    }
  }

  return (
    <div
      className={`relative flex gap-3 ${isLast ? 'pb-2' : 'pb-6'}${animationDelay != null ? ' activity-entry-in' : ''}`}
      style={animationDelay != null ? { animationDelay: `${animationDelay}s` } : undefined}
    >
      {/* Timeline node */}
      <div className="relative z-10 flex-shrink-0 h-4 flex items-center">
        <div className="w-[19px] h-[19px] rounded-full flex items-center justify-center bg-background">
          <div
            className={`w-2 h-2 rounded-full transition-all ${nodeColorClass(entry)}
              ${drillHover ? 'ring-[3px] ring-primary/25' : ''}`}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Meta row: caption for the card below it, plus its drill-in */}
        <div className="flex items-center gap-2 mb-1">
          <span className={`font-mono text-[11px] tabular-nums transition-colors ${drillHover ? 'text-foreground' : 'text-muted-foreground/80'}`}>
            {formatTs(entry.ts)}
          </span>
          <EntryIcon entry={entry} />
          <span className="text-xs font-medium text-muted-foreground">{t(entryLabel(entry))}</span>
          {durationMs != null && (
            <span className="font-mono text-[11px] text-muted-foreground/60">{formatDuration(durationMs)}</span>
          )}
          {canViewProcess && (
            <button
              onClick={handleViewProcess}
              onMouseEnter={() => setDrillHover(true)}
              onMouseLeave={() => setDrillHover(false)}
              className={`ml-auto flex items-center gap-0.5 text-xs transition-colors ${
                insideCard
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'text-primary/70 hover:text-primary'
              }`}
            >
              {t('View process')}
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Content. An unanswered escalation brings its own alert-coloured
            card, so it's the one body that doesn't get the neutral one; the
            meta row above stays on the page background either way so it reads
            as this card's caption. */}
        <div className={`space-y-1.5${
          insideCard || isOpenEscalation
            ? ''
            : ` bg-card border rounded-lg p-3 transition-colors ${drillHover ? 'border-primary/50' : 'border-border/60'}`
        }`}>
          {entry.type === 'escalation' ? (
            <EscalationCard entry={entry} appId={appId} />
          ) : (
            <>
            <MarkdownRenderer content={content.summary} className="text-sm" />

            {/* Detailed data: file-sourced (dataPath) or inline */}
            {content.dataPath ? (
              <div className="rounded-md border border-border overflow-hidden">
                <button
                  onClick={() => api.showArtifactInFolder(content.dataPath!)}
                  title={content.dataPath}
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5
                    bg-secondary/60 hover:bg-secondary text-muted-foreground
                    text-[11px] font-mono transition-colors group border-b border-border"
                >
                  <FileText className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{content.dataPath.split('/').pop()}</span>
                  <FolderOpen className="w-3 h-3 flex-shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                {resolvedData && (
                  <div className="p-3">
                    <MarkdownRenderer content={resolvedData} className="text-sm" />
                  </div>
                )}
              </div>
            ) : (
              <>
                {resolvedData && (
                  <MarkdownRenderer content={resolvedData} className="text-sm" />
                )}
                {!resolvedData && content.data != null && typeof content.data === 'object' && (
                  <pre className="text-xs bg-secondary rounded-md p-2 overflow-x-auto text-muted-foreground">
                    {JSON.stringify(content.data, null, 2)}
                  </pre>
                )}
              </>
            )}

            {/* Output download link */}
            {entry.type === 'output' && content.outputUrl && (
              <a
                href={content.outputUrl}
                download
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <FileOutput className="w-3 h-3" />
                {t('Download')}
              </a>
            )}

            {/* Error details for run_error */}
            {entry.type === 'run_error' && content.error && (
              <p className="text-xs text-red-400">{content.error}</p>
            )}

            {/* Continue button — only for premature AI termination */}
            {isPrematureTermination && (
              <button
                onClick={handleContinue}
                disabled={isContinuing || isAppBusy}
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md
                  bg-primary/10 text-primary hover:bg-primary/20 transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-3 h-3" />
                {isContinuing ? t('Continuing…') : t('Continue')}
              </button>
            )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
