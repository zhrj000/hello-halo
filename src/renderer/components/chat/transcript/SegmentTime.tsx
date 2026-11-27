/**
 * The one quiet time line above a message that begins a stretch of
 * conversation (see message-time.ts). Every transcript draws it the same way,
 * from its own full list of messages so paging never moves it.
 */

import type { Message } from '../../../types'
import { useTranslation } from '../../../i18n'
import { formatSegmentLabel, startsNewDay, startsNewSegment } from './message-time'

interface SegmentTimeProps {
  messages: readonly Pick<Message, 'timestamp'>[]
  index: number
  className?: string
}

export function SegmentTime({ messages, index, className = '' }: SegmentTimeProps) {
  const { t } = useTranslation()
  if (!startsNewSegment(messages, index)) return null
  return (
    <div className={`pb-4 text-center text-[11px] tabular-nums text-faint-foreground ${className}`}>
      {formatSegmentLabel(messages[index].timestamp, startsNewDay(messages, index), t)}
    </div>
  )
}
