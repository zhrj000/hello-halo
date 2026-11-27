/**
 * InjectionAnnotation - Permanent annotation for mid-turn injected messages.
 *
 * Displayed at the bottom of an assistant message bubble when the user sent
 * supplementary messages during that response's generation. The injected
 * messages are persisted with `source: 'injection'` and filtered out of the
 * main message list — this component is their only visual representation,
 * reference chips included (an older message's `<attached_paths>` block shows
 * as file chips too, never as raw text).
 *
 * Drawn with the same card and rows as QueuedMessagesPanel (the streaming-time
 * equivalent), so a message going from Queued to Appended changes only its
 * heading. The card spans the reply's width, like the reply above it; each row
 * is one 20px line (compact chips included), so the arrow lines up with text
 * and chips alike.
 */

import type { ReactNode } from 'react'
import { CornerDownRight } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { Message } from '../../types'
import { messageReferences } from '../../../shared/content-reference'
import { MessageReferenceChips } from '../references'
import { MessageImages } from './ImageAttachmentPreview'

/** The card shared by the Queued and Appended notes. */
export function AdditionsCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-1.5 w-full rounded-lg border border-border-soft bg-card py-2 pl-2.5 pr-3">
      <div className="mb-1 ml-0.5 select-none text-xs leading-4 text-subtle-foreground">{label}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

/** One message in that card: an arrow, then its chips and text on 20px lines. */
export function AdditionRow({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-[13px] leading-5 text-muted-foreground">
      <CornerDownRight size={13} className="mt-[3.5px] shrink-0 text-faint-foreground" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5 break-words">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">{children}</div>
        {note}
      </div>
    </div>
  )
}

interface InjectionAnnotationProps {
  messages: Message[]
}

export function InjectionAnnotation({ messages }: InjectionAnnotationProps) {
  const { t } = useTranslation()

  if (messages.length === 0) return null

  return (
    <AdditionsCard label={t('Appended')}>
      {messages.map((msg) => {
        const { text, references } = messageReferences(msg.content ?? '', msg.metadata?.references)
        return (
          <AdditionRow
            key={msg.id}
            note={msg.metadata?.inputOutcome === 'stopped' && (
              <span className="text-[11px] leading-4 text-subtle-foreground">{t('Stopped, not handled')}</span>
            )}
          >
            <MessageReferenceChips references={references} compact className="contents" />
            {!!msg.images?.length && <MessageImages images={msg.images} presentation="chips" />}
            {text.trim() && <span className="min-w-0 whitespace-pre-wrap">{text.trimEnd()}</span>}
          </AdditionRow>
        )
      })}
    </AdditionsCard>
  )
}
