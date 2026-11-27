import { useLayoutEffect, useRef, useState } from 'react'
import { Megaphone } from 'lucide-react'
import type { TeamActivity } from '../../../../shared/apps/team-types'
import { useTranslation } from '../../../i18n'
import { MarkdownRenderer } from '../../chat/MarkdownRenderer'

/** Taller than this, a report opens on request rather than pushing the conversation down. */
const FOLDED_HEIGHT = 240

/**
 * What a member reported to the person (report_to_user), drawn in the conversation
 * under the turn that reported it. A report is often the work itself — the draft, the
 * figures — while the reply's last words only say it was delivered, so without this the
 * deliverable was only to be found in the team progress.
 */
export function ReportCard({ activity }: { activity: TeamActivity }) {
  const { t } = useTranslation()
  const body = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  const [open, setOpen] = useState(false)
  const text = (activity.body || activity.subject).trim()
  useLayoutEffect(() => { setTall((body.current?.scrollHeight ?? 0) > FOLDED_HEIGHT + 24) }, [text])
  return <article data-message-id={activity.id} className="mt-3 min-w-0 rounded-xl border border-border-faint bg-secondary/30 px-4 py-3">
    <header className="mb-1.5 flex items-center gap-1.5 text-xs text-subtle-foreground">
      <Megaphone size={13} strokeWidth={1.8} aria-hidden="true" className="shrink-0" />
      <span>{t('Report')}</span>
    </header>
    <div ref={body} className={`relative min-w-0 overflow-hidden text-sm [overflow-wrap:anywhere] ${tall && !open ? 'max-h-60 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]' : ''}`}>
      <MarkdownRenderer content={text} mode="static" />
    </div>
    {tall && <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="mt-1 rounded text-xs text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {open ? t('Show less') : t('Show more')}
    </button>}
  </article>
}
