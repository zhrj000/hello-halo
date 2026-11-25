/**
 * When the person last had each team task open, so a task that finished or
 * failed since can say so in the list ("done, not seen yet") the way a regular
 * conversation does. Kept on this computer only, like the list's other view
 * state: what someone has looked at is theirs, not the team's.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TaskStatus } from '../types'
import type { NativeTeamTask } from '../hooks/useTeamConversationRows'

/** Records older than this are dropped on the next write; the tasks are long settled by then. */
const KEEP_MS = 60 * 24 * 60 * 60 * 1000

interface TeamChatSeenState {
  /**
   * When this store first ran. Work that ended before it is treated as seen,
   * so the first start after an update does not light up every old task.
   */
  since: number
  /** teamTaskKey → when it was last on screen (epoch ms). */
  seen: Record<string, number>
  markSeen: (key: string, at?: number) => void
}

export const useTeamChatSeenStore = create<TeamChatSeenState>()(persist((set) => ({
  since: Date.now(),
  seen: {},
  markSeen: (key, at = Date.now()) => set(state => {
    if ((state.seen[key] ?? 0) >= at) return state
    const cutoff = at - KEEP_MS
    const seen: Record<string, number> = {}
    for (const [k, v] of Object.entries(state.seen)) if (v >= cutoff) seen[k] = v
    seen[key] = at
    return { seen }
  }),
}), { name: 'halo-team-chat-seen' }))

/**
 * A team task's state for the list, most urgent first: a question for the
 * person; a failure they have not opened since; work done since they last
 * looked that has now stopped (the team went quiet, or someone ended it), as a
 * regular conversation says "done" once its reply is in; work in progress.
 * A task the person ended themselves is not news to them.
 */
export function teamTaskStatus(task: NativeTeamTask, seenAt: number | undefined, since: number): TaskStatus {
  if (task.waitingForMe) return 'waiting'
  if (task.active) return 'generating'
  const lastLook = Math.max(seenAt ?? 0, since)
  if (task.failure && task.lastActivityAt > lastLook) return 'error'
  if (task.endedByMe) return 'idle'
  if (Math.max(task.lastActivityAt, task.finishedAt ?? 0) > lastLook) return 'completed-unseen'
  return 'idle'
}
