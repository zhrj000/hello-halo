import { createContext, useContext } from 'react'
import type { TeamConversation, TeamDetail, TeamPendingEscalation } from '../../../shared/apps/team-types'

/**
 * A question from a team is answered in its task's homepage conversation:
 * "Reply" on the team page or in a task's team progress goes there, to the
 * question. Only where leaving is not possible (the team progress covering the
 * chat on a phone) is it answered in place; such a surface turns this off.
 */
export const ReplyInConversationContext = createContext(true)

export const useReplyGoesToConversation = () => useContext(ReplyInConversationContext)

/** The conversation a decision is answered in, or null to answer it in place. */
export function replyTarget(goesToConversation: boolean, detail: TeamDetail, taskSpaceId: string | null, decision: TeamPendingEscalation, task?: TeamConversation) {
  if (!goesToConversation || !taskSpaceId || !decision.epochId) return null
  // An IM chat or a temporary collaboration is not continued on the homepage.
  if (task && task.kind !== 'native' && task.kind !== 'run') return null
  return {
    spaceId: taskSpaceId,
    target: { teamId: detail.team.id, epochId: decision.epochId, teamName: detail.team.name, label: task?.label, appId: decision.appId, entryId: decision.entryId, decision: true },
  }
}
