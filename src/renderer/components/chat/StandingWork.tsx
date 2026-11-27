/**
 * Work that comes back on its own — a team's periodic checks, a digital human's
 * reminders — drawn the same way wherever it stands: a panel that lists each one in
 * full with a stop that cannot be missed, and the quiet line each run's reply becomes
 * in its conversation. Only the name differs between the two.
 */

import { useState, type ReactNode } from 'react'
import { Square, Timer } from 'lucide-react'
import type { Message } from '../../types'
import { getCurrentLanguage, useTranslation } from '../../i18n'
import { formatRunStart } from '../../utils/format-time'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { clipSubject, PROCESS_CUE, PROCESS_DETAIL, PROCESS_LINE, PROCESS_TIME } from './process-line'

/**
 * Stopping is the one action every surface offers on standing work, and the one a reader
 * most often came to take, so it reads as a button in the destructive tone, not a faint link.
 */
export const STANDING_STOP_BUTTON = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-destructive/30 px-3 text-xs font-medium text-destructive transition-colors hover:border-destructive/50 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40'

/** The mark's trigger, as it sits inside the member rail or the capsule standing in for it. */
export const STANDING_MARK = 'member-rail-status relative z-[1] h-[34px] cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12.5px] tabular-nums transition-colors duration-100 hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

export const formatStandingTime = (at: number) => formatRunStart(at, Date.now(), getCurrentLanguage())

export interface StandingItem {
  id: string
  /** Who set it on whom, and how often. */
  meta: string
  text: string
  /** When it cannot run right now, and why. */
  warning?: string
  /** A way to where it stands, on a surface that spans several. */
  link?: { label: string; onOpen: () => void }
  /** What it has done or will do next. */
  stats: string
}

export function StandingWorkPopover({ title, subtitle, items, side, align, label, triggerClassName, onStop, stopTitle, stopMessage, children }: {
  title: string
  subtitle: string
  items: readonly StandingItem[]
  side: 'top' | 'bottom'
  align: 'start' | 'center' | 'end'
  label: string
  triggerClassName: (open: boolean) => string
  onStop: (id: string) => void
  stopTitle: string
  stopMessage: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [stopping, setStopping] = useState<string | null>(null)
  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger ariaLabel={label} className={triggerClassName(open)}>{children}</PopoverTrigger>
      <PopoverContent side={side} align={align} sideOffset={10} className="w-[min(26rem,calc(100vw-2rem))] overflow-hidden p-0">
        <header className="flex items-center gap-2.5 border-b border-border-faint px-4 pb-2.5 pt-3 text-left">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-subtle-foreground"><Timer size={14} strokeWidth={1.8} aria-hidden="true" /></span>
          <span className="min-w-0">
            <span className="flex items-baseline gap-1.5 text-sm font-semibold text-foreground">{title}<span className="text-xs font-normal tabular-nums text-faint-foreground">{items.length}</span></span>
            <span className="block truncate text-xs text-faint-foreground">{subtitle}</span>
          </span>
        </header>
        <ul className="max-h-[min(26rem,60vh)] divide-y divide-border-faint overflow-y-auto text-left">
          {items.map(item => <li key={item.id} className="px-4 py-3">
            <p className="text-xs text-subtle-foreground">{item.meta}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">{item.text}</p>
            {item.warning && <p className="mt-1.5 text-xs text-halo-warning">{item.warning}</p>}
            {item.link && <button onClick={() => { setOpen(false); item.link!.onOpen() }} className="mt-1.5 block max-w-full truncate rounded text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{item.link.label} ›</button>}
            <div className="mt-2.5 flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-subtle-foreground">{item.stats}</span>
              <button onClick={() => { setOpen(false); setStopping(item.id) }} className={STANDING_STOP_BUTTON}>
                <Square size={9} fill="currentColor" strokeWidth={0} aria-hidden="true" />{t('Stop')}
              </button>
            </div>
          </li>)}
        </ul>
      </PopoverContent>
    </Popover>
    {stopping && <ConfirmDialog
      title={stopTitle}
      message={stopMessage}
      confirmLabel={t('Stop')}
      cancelLabel={t('Cancel')}
      variant="danger"
      onConfirm={() => { const id = stopping; setStopping(null); onStop(id) }}
      onCancel={() => setStopping(null)}
    />}
  </>
}

/**
 * What a member said when its standing work woke it, as one quiet line in the conversation,
 * in order with everything else. `subject` is what the line is about (its words by default);
 * opening it shows `detail`, or the whole reply.
 */
export function StandingRunLine({ message, label, subject, detail }: { message: Message; label: string; subject?: string; detail?: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const at = new Date(message.timestamp).getTime()
  const text = message.content.trim()
  return <div className="w-[85%] min-w-0" data-message-id={message.id}>
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className={PROCESS_LINE}>
      <Timer size={14} strokeWidth={1.8} aria-hidden="true" className="shrink-0" />
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate text-[13px] text-muted-foreground">{clipSubject((subject ?? text) || t('No text reply')).text}</span>
      <span aria-hidden="true" className={PROCESS_CUE}>{open ? t('Collapse') : t('View')}</span>
      {Number.isFinite(at) && <time dateTime={new Date(at).toISOString()} className={PROCESS_TIME}>{formatStandingTime(at)}</time>}
    </button>
    {open && <div className={PROCESS_DETAIL}>
      {detail ?? <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.7] text-foreground/[0.88]">{text || t('No text reply')}</p>}
    </div>}
  </div>
}
