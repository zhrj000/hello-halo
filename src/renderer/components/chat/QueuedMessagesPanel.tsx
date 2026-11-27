/**
 * QueuedMessagesPanel - Shows user messages queued for mid-turn injection.
 *
 * Displayed below StreamingBubble while agent generation is active.
 * Each entry represents a message sent by the user during a running turn;
 * agent:input-arrived replaces it with the accepted input annotation, drawn
 * with the same card and rows (InjectionAnnotation).
 */

import { useTranslation } from '../../i18n'
import type { QueuedMessage } from '../../types'
import { MessageImages } from './ImageAttachmentPreview'
import { AdditionRow, AdditionsCard } from './InjectionAnnotation'

interface QueuedMessagesPanelProps {
  messages: QueuedMessage[]
}

export function QueuedMessagesPanel({ messages }: QueuedMessagesPanelProps) {
  const { t } = useTranslation()

  if (messages.length === 0) return null

  return (
    <AdditionsCard label={t('Queued')}>
      {messages.map((msg, i) => (
        <AdditionRow key={i}>
          {!!msg.images?.length && <MessageImages images={msg.images} presentation="chips" />}
          {(msg.summary || !msg.images?.length) && (
            <span className="min-w-0 whitespace-pre-wrap">{msg.summary || t('References')}</span>
          )}
        </AdditionRow>
      ))}
    </AdditionsCard>
  )
}
