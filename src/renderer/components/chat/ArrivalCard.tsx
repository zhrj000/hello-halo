/**
 * A record received while a reply was being written (see transcript/arrivals):
 * ArrivalCard draws it in the reply's process; a reply with no process draws
 * them after it (TrailingArrivals) as the received line — one per team, or per
 * source conversation, for consecutive records.
 */

import { memo, useMemo } from 'react'
import type { Message } from '../../types'
import { ReplyOpeners, TeamMemberMessage, isTeamMessage, receivedLineKey } from './team-collab'
import { CrossConversationMessage } from './cross-conversation'

interface ArrivalCardProps {
  message: Message
  /** A line of the reply's work, shaped like the operations around it. */
  inProcess?: boolean
}

/** Drawn under a reply that re-renders with every streamed word; a stored record does not change. */
export const ArrivalCard = memo(function ArrivalCard({ message, inProcess = false }: ArrivalCardProps) {
  return isTeamMessage(message)
    ? <TeamMemberMessage message={message} inProcess={inProcess} />
    : <CrossConversationMessage message={message} inProcess={inProcess} />
})

interface TrailingArrivalsProps {
  arrivals: readonly Message[]
  senderName?: string
  /** Space above a received line; the default leaves room for the reply's hover actions. */
  lineGapClassName?: string
}

export function TrailingArrivals({ arrivals, senderName, lineGapClassName = 'mt-8' }: TrailingArrivalsProps) {
  // Kept across the streamed words that re-render a live reply, so each line's sources resolve once.
  const runs = useMemo(() => {
    const out: { key: string; messages: Message[] }[] = []
    for (const message of arrivals) {
      const key = receivedLineKey(message)
      // A delivery whose source cannot be read has nothing to show.
      if (key === null) continue
      const run = out[out.length - 1]
      if (run?.key === key) run.messages.push(message)
      else out.push({ key, messages: [message] })
    }
    return out
  }, [arrivals])
  return (
    <>
      {runs.map(({ messages }) => (
        <div key={messages[0].clientKey ?? messages[0].id} className={lineGapClassName}>
          <ReplyOpeners senderName={senderName} openers={messages} />
        </div>
      ))}
    </>
  )
}
