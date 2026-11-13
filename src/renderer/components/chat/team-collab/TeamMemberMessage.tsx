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
import type { Message } from '../../../types'
import { getCurrentLanguage, useTranslation } from '../../../i18n'
import { readTeamProvenance } from './message-source'

export function TeamMemberMessage({ message }: { message: Message }) {
  const { t } = useTranslation()
  const provenance = readTeamProvenance(message)
  const [isExpanded, setIsExpanded] = useState(false)

  if (!provenance) return null

  const time = new Date(message.timestamp).toLocaleTimeString(getCurrentLanguage(), {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const summary = message.metadata?.summary || (message.content.split('\n').find(line => line.trim()) ?? '')
  const label = provenance.fromMemberName || t('Team update')
  return (
    <div className="w-full min-w-0" data-message-id={message.id}>
      <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5">
        <span className="min-w-0 truncate font-medium text-muted-foreground">{label}</span>
        <span className="shrink-0 text-[11px] text-faint-foreground">· {time}</span>
      </div>
      {!isExpanded ? (
        <button
          onClick={() => setIsExpanded(true)}
          aria-expanded={false}
          className="mt-0.5 block w-full min-w-0 truncate text-left text-[13px] leading-5 text-muted-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="inline-block max-w-[calc(100%-4rem)] truncate align-bottom">{summary}</span>{' '}
          <span className="text-xs text-primary">{t('Expand')}</span>
        </button>
      ) : (
        <div className="pb-2">
          <div className="text-[13px] leading-[1.7] text-foreground/[0.88] whitespace-pre-wrap break-words">
            {message.content}{' '}
            <button
              onClick={() => setIsExpanded(false)}
              aria-expanded={true}
              className="text-xs text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('Collapse')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
