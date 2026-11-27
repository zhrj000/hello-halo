/**
 * The hovered row's identity card in the conversation list: rows truncate their
 * title and the folded strip shows no title at all, so both lean on it.
 *
 * It keeps which row is hovered to itself. Held by the list, every pointer move
 * between rows would render the whole list again; here only the card renders,
 * and the list reaches it through the stable `show`/`hide` of its handle.
 */

import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Timer } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { TaskStatusDot } from '../pulse/TaskStatusDot'
import { AutomationAvatar } from '../apps/AutomationAvatar'
import { TeamAvatar } from '../team/TeamAvatar'
import { taskStatusLabel, type RowHoverCard } from './conversation-row-format'

export interface ConversationHoverCardHandle {
  /** Shows `card` beside `element` (a row, or a dot on the folded strip). */
  show: (element: HTMLElement, card: RowHoverCard) => void
  hide: () => void
}

type Shown = RowHoverCard & { top: number; left: number }

export const ConversationHoverCard = memo(forwardRef<ConversationHoverCardHandle, {
  /** Out of the way while a row is renamed or its menu is open; it comes back if the row is still hovered. */
  suppressed: boolean
}>(function ConversationHoverCard({ suppressed }, ref) {
  const { t } = useTranslation()
  const [card, setCard] = useState<Shown | null>(null)
  useImperativeHandle(ref, () => ({
    show: (element, next) => {
      const r = element.getBoundingClientRect()
      setCard({ ...next, top: r.top + r.height / 2, left: r.right + 8 })
    },
    hide: () => setCard(null),
  }), [])

  // Centred on its row, but shifted to stay inside the window — rows near the
  // bottom (or top) edge would otherwise cut the card off.
  const cardRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el || !card) return
    const margin = 8
    const h = el.offsetHeight
    const top = Math.min(Math.max(card.top - h / 2, margin), window.innerHeight - h - margin)
    el.style.top = `${top}px`
  }, [card, suppressed])

  if (!card || suppressed) return null
  const statusLabel = card.status ? taskStatusLabel(card.status, t) : undefined
  // Three lines, one kind of thing each: whose it is and when (the time always at
  // the right), the title, then who started it and its state — left out when
  // there is neither, so a plain conversation's card stays two lines.
  const footer = [
    card.note && <span key="note" className="min-w-0 truncate">{card.note}</span>,
    card.checks && <span key="checks" className="flex shrink-0 items-center gap-1"><Timer className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />{card.checks}</span>,
    card.status && statusLabel && <span key="status" className="flex shrink-0 items-center gap-1"><TaskStatusDot status={card.status} size="sm" />{statusLabel}</span>,
  ].filter(Boolean)
  // Fixed-positioned and portaled: the row lists scroll, and a scroll
  // container clips anything reaching past its edge.
  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      style={{ top: card.top, left: card.left }}
      className="pointer-events-none fixed z-[60] w-max min-w-[160px] max-w-[300px] rounded-lg border border-border-faint bg-popover px-3.5 py-3 shadow-soft"
    >
      {(card.owner || card.time) && (
        <span className="mb-1.5 flex items-center gap-3 text-[11px] leading-4 text-faint-foreground">
          {card.owner && <span className="flex min-w-0 items-center gap-1.5">
            {card.ownerMark ? <TeamAvatar mark={card.ownerMark} size={16} /> : <AutomationAvatar name={card.owner} size={14} />}
            <span className="truncate">{card.owner}</span>
          </span>}
          {card.time && <span className="ml-auto shrink-0 tabular-nums">{card.time}</span>}
        </span>
      )}
      <span className="block text-[13px] font-medium leading-5 text-foreground line-clamp-3">{card.label}</span>
      {footer.length > 0 && (
        <span className="mt-1.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] leading-4 text-faint-foreground">
          {footer.flatMap((item, index) => index ? [<span key={`sep-${index}`} aria-hidden="true">·</span>, item] : [item])}
        </span>
      )}
    </div>,
    document.body
  )
}))
