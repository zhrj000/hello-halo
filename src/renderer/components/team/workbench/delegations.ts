import type { BlackboardTask, RosterMember, TeamActivity, TeamDetail } from '../../../../shared/apps/team-types'
import { taskTime } from './time'

const PREFIX = 'delegation:'

/** A conversation's subtasks: its board's, else what its coordinators handed out by message. */
export function conversationSubtasks(detail: TeamDetail, epochId: string | null, boardTasks: BlackboardTask[] | undefined, activities: readonly TeamActivity[]): BlackboardTask[] {
  const tasks = boardTasks ?? detail.tasks.filter(row => row.epochId === epochId)
  if (tasks.length || !epochId) return tasks
  return delegatedTasks({ teamId: detail.team.id, epochId, leadAppId: detail.team.leadAppId ?? null, activities, roster: detail.roster })
}

export const isDelegatedTask = (task: BlackboardTask) => task.id.startsWith(PREFIX)

interface Delegation {
  first: TeamActivity
  firstAt: number
  /** Per coordinator that asked: its latest ask and this member's latest answer to it. */
  asks: Map<string, { askedAt: number; answeredAt: number }>
  answer: TeamActivity | null
  answeredAt: number
}

/**
 * A lead may hand work out by message alone, leaving the board empty. Each member
 * a coordinator wrote to then reads as one subtask, done once the member has
 * answered every coordinator's latest message and is not at work. Until then it is
 * titled by the first message; once done, by the opening line of the member's
 * first report, which says what was actually done (later ones tend to be
 * acknowledgements).
 *
 * Coordinators are the lead plus any member that wrote before anyone wrote to it:
 * in a standing team each person talks to their own digital human, which then
 * coordinates the others, so the one handing out work need not be the lead.
 */
export function delegatedTasks({ teamId, epochId, leadAppId, activities, roster }: {
  teamId: string; epochId: string; leadAppId: string | null; activities: readonly TeamActivity[]; roster: readonly RosterMember[]
}): BlackboardTask[] {
  const sent = activities
    .filter(activity => (activity.kind === 'message' || activity.kind === 'reply') && activity.epochId === epochId && taskTime(activity.createdAt) !== null)
    .sort((a, b) => taskTime(a.createdAt)! - taskTime(b.createdAt)!)
  const coordinators = new Set(leadAppId ? [leadAppId] : [])
  const addressed = new Set<string>()
  for (const activity of sent) {
    if (activity.kind === 'message' && !addressed.has(activity.actorAppId)) coordinators.add(activity.actorAppId)
    if (activity.targetAppId && activity.targetAppId !== activity.actorAppId) addressed.add(activity.targetAppId)
  }
  const byMember = new Map<string, Delegation>()
  for (const activity of sent) {
    const target = activity.targetAppId
    if (activity.kind !== 'message' || !coordinators.has(activity.actorAppId) || !target || coordinators.has(target)) continue
    const at = taskTime(activity.createdAt)!
    let row = byMember.get(target)
    if (!row) byMember.set(target, row = { first: activity, firstAt: at, asks: new Map(), answer: null, answeredAt: -1 })
    const ask = row.asks.get(activity.actorAppId)
    if (ask) ask.askedAt = Math.max(ask.askedAt, at)
    else row.asks.set(activity.actorAppId, { askedAt: at, answeredAt: -1 })
  }
  for (const activity of sent) {
    const row = byMember.get(activity.actorAppId)
    const ask = activity.targetAppId ? row?.asks.get(activity.targetAppId) : undefined
    if (!row || !ask || activity.status === 'undelivered' || activity.status === 'error' || activity.status === 'timeout') continue
    const at = taskTime(activity.createdAt)!
    ask.answeredAt = Math.max(ask.answeredAt, at)
    row.answer ??= activity
    row.answeredAt = Math.max(row.answeredAt, at)
  }
  const busy = new Set(roster.filter(member => member.busy?.some(item => item.epochId === epochId)).map(member => member.appId))
  return [...byMember].map(([appId, row]): BlackboardTask => {
    const asks = [...row.asks.values()]
    const done = asks.every(ask => ask.answeredAt > ask.askedAt) && !busy.has(appId)
    return {
      id: `${PREFIX}${appId}`,
      teamId,
      epochId,
      title: (done && row.answer && headline(row.answer)) || headline(row.first),
      assigneeAppId: appId,
      status: done ? 'done' : 'in_progress',
      resultRef: null,
      note: null,
      parentId: null,
      createdByAppId: row.first.actorAppId,
      createdAt: row.firstAt,
      updatedAt: Math.max(row.answeredAt, ...asks.map(ask => ask.askedAt)),
    }
  }).sort((a, b) => a.createdAt - b.createdAt)
}

/** A message's opening line as plain text, local paths named by their file. */
function headline(activity: Pick<TeamActivity, 'subject' | 'body'>): string {
  const line = activity.body?.split('\n').map(text => text.trim()).find(Boolean) ?? activity.subject.trim()
  return line
    .replace(/[*`]+/g, '')
    .replace(/^#+\s*/, '')
    .replace(/(^|[\s:：(（"'“‘])(?:~|[A-Za-z]:)?[\\/](?:[^\s\\/"'”’()（）]+[\\/])+([^\s\\/"'”’()（）]+)/g, '$1$2')
    .trim()
}
