/**
 * TeamMemberMessage — a team member's report (or a collaboration status
 * notice) received while a reply was being written, drawn as a row of that
 * reply's process timeline (which supplies the icon and the spacing): the
 * reply's work, not a turn it started. Anywhere else a team's messages read as
 * the received line (ReplyOpeners).
 *
 * Collapsed to one line by default; the model always received the full body
 * regardless of this UI state.
 */

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Message } from '../../../types'
import { useTranslation } from '../../../i18n'
import { canvasLifecycle } from '../../../services/canvas-lifecycle'
import { formatTimeAgo } from '../../../utils/format-time'
import { readTeamProvenance } from './message-source'

export function TeamMemberMessage({ message }: { message: Message }) {
  const { t } = useTranslation()
  const provenance = readTeamProvenance(message)
  const [isExpanded, setIsExpanded] = useState(false)

  if (!provenance) return null

  const time = formatTimeAgo(new Date(message.timestamp).getTime(), t)
  const summary = message.metadata?.summary || (message.content.split('\n').find(line => line.trim()) ?? '')
  const label = provenance.fromMemberName
    ? t('{{member}} · {{team}}', { member: provenance.fromMemberName, team: provenance.teamName })
    : t('Team update · {{team}}', { team: provenance.teamName })
  return (
    <div className="w-full min-w-0" data-message-id={message.id}>
      <button
        onClick={() => setIsExpanded(v => !v)}
        aria-expanded={isExpanded}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/25"
      >
        <ChevronRight
          size={12}
          className={`shrink-0 text-muted-foreground/60 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
        <span className="max-w-[55%] truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground truncate min-w-0">{summary}</span>
        <span className="hidden sm:inline shrink-0 text-muted-foreground/40 text-[10px]">·</span>
        <span className="hidden sm:inline shrink-0 text-[10px] text-muted-foreground/55">{time}</span>
      </button>
      {isExpanded && (
        <div className="px-2.5 pb-2">
          <div className="text-[13px] leading-[1.7] text-foreground/[0.88] whitespace-pre-wrap break-words">
            {message.content}
          </div>
          <div className="mt-2 pt-1.5 border-t border-dashed border-border-faint
            flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-muted-foreground/80">
            <span>{t('Sent by a team member, not by you')}</span>
            <span>·</span>
            <button
              onClick={() => void canvasLifecycle.openTeam(provenance.teamId, provenance.teamName)}
              className="text-primary hover:underline"
            >
              {t('Open team view')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
