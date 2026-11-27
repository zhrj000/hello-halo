/**
 * The line under a reply that handed work on: "Lead · Sent a message to X · Received a
 * message from X ›". It is the counterpart of the openers line — what the reply exchanged
 * while it ran rather than what started it — styled the same, and expands to the messages
 * in full, in the order they happened. What arrived mid-turn is also in the reply's folded
 * work; it is named here too so an exchange reads as one, in both directions.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { CollabQuotes } from './CollabQuotes'
import type { OpenerReveal } from './ReplyOpeners'

export interface DispatchItem {
  id: string
  /** Who it was sent to; absent for a message the reply received (`from`). */
  to?: string
  /** Who sent it, for a message the reply received while it ran. */
  from?: string
  at: number
  content: string
  onOpen?: () => void
}

export function DispatchLine({ senderName, items, footer, reveal }: { senderName?: string; items: readonly DispatchItem[]; footer: ReactNode; reveal?: OpenerReveal }) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(!!reveal)
  useEffect(() => {
    if (reveal) setIsExpanded(true)
  }, [reveal])
  const sentTo = [...new Set(items.flatMap(item => item.from === undefined && item.to !== undefined ? [item.to] : []))]
  const heardFrom = [...new Set(items.flatMap(item => item.from !== undefined ? [item.from] : []))]
  const label = [
    sentTo.length === 1 ? t('Sent a message to {{member}}', { member: sentTo[0] })
      : sentTo.length > 1 ? t('Sent messages to {{member}} and {{count}} others', { member: sentTo[0], count: sentTo.length - 1 }) : null,
    heardFrom.length === 1 ? t('Received a message from {{member}}', { member: heardFrom[0] })
      : heardFrom.length > 1 ? t('Received messages from {{member}} and {{count}} more', { member: heardFrom[0], count: heardFrom.length - 1 }) : null,
  ].filter(Boolean).join(' · ')
  const ordered = [...items].sort((a, b) => a.at - b.at)

  // Spaced as a row of its own: mb-7 matches the room a reply keeps for its hover actions.
  return (
    <div className="mt-8 mb-7">
      <div className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
        {senderName && <span className="shrink-0 text-sm font-semibold text-foreground">{senderName}</span>}
        {senderName && <span className="shrink-0 text-faint-foreground">·</span>}
        <button
          onClick={() => setIsExpanded(v => !v)}
          aria-expanded={isExpanded}
          className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-foreground"
        >
          <span className="truncate">{label}</span>
          <ChevronRight size={12} className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </button>
      </div>
      {isExpanded && (
        <CollabQuotes
          quotes={ordered.map(item => ({ key: item.id, messageId: item.id, label: item.from ?? t('To {{member}}', { member: item.to ?? '' }), onOpen: item.onOpen, at: item.at, content: item.content }))}
          footer={footer}
        />
      )}
    </div>
  )
}
