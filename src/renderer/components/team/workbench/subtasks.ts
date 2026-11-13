import type { BlackboardTask, TeamActivity } from '../../../../shared/apps/team-types'
import type { MemberProgress } from './progress'
import { taskTime } from './time'

export type SubtaskGroupId = 'waiting' | 'failed' | 'working' | 'pending' | 'done'
export type SubtaskCell = SubtaskGroupId | 'rejected'

export interface SubtaskGroup {
  id: SubtaskGroupId
  tasks: BlackboardTask[]
}

export interface SubtaskBoard {
  /** Non-empty groups in display order. */
  groups: SubtaskGroup[]
  /** One cell per task, in the order the progress strip draws them. */
  cells: SubtaskCell[]
}

const ORDER: SubtaskGroupId[] = ['waiting', 'failed', 'working', 'pending', 'done']

/**
 * The board's tasks grouped by what they need: an in-progress task takes its
 * assignee's state (a decision for me, a failure); a blocked task cannot go on.
 * `inOrder` keeps every group in the order the work was handed out, for work that
 * passed from one member to the next.
 */
export function subtaskBoard(tasks: readonly BlackboardTask[], members: readonly MemberProgress[], inOrder = false): SubtaskBoard {
  const stateOf = new Map(members.map(member => [member.appId, member]))
  const buckets: Record<SubtaskGroupId, BlackboardTask[]> = { waiting: [], failed: [], working: [], pending: [], done: [] }
  for (const task of tasks) buckets[groupOf(task, task.assigneeAppId ? stateOf.get(task.assigneeAppId) : undefined)].push(task)
  const newest = inOrder ? (a: BlackboardTask, b: BlackboardTask) => a.createdAt - b.createdAt : (a: BlackboardTask, b: BlackboardTask) => b.updatedAt - a.updatedAt
  buckets.waiting.sort(newest)
  buckets.failed.sort(newest)
  buckets.working.sort(newest)
  buckets.done.sort(newest)
  buckets.pending.sort((a, b) => a.createdAt - b.createdAt)
  const cells: SubtaskCell[] = [
    ...(inOrder ? buckets.done : [...buckets.done].reverse()).map(task => (task.status === 'rejected' ? 'rejected' : 'done') as SubtaskCell),
    ...(['waiting', 'failed', 'working', 'pending'] as const).flatMap(id => buckets[id].map(() => id)),
  ]
  return { groups: ORDER.filter(id => buckets[id].length).map(id => ({ id, tasks: buckets[id] })), cells }
}

function groupOf(task: BlackboardTask, member: MemberProgress | undefined): SubtaskGroupId {
  switch (task.status) {
    case 'done':
    case 'rejected': return 'done'
    case 'pending': return 'pending'
    case 'blocked': return 'failed'
    case 'in_progress':
      if (member?.state === 'waiting' && member.decisionId) return 'waiting'
      if (member?.state === 'failed') return 'failed'
      return 'working'
  }
}

/** How long each done task took: from when it was taken up (else posted) to when it was marked done. */
export function subtaskDurations(tasks: readonly BlackboardTask[], activities: readonly TeamActivity[]): Map<string, number> {
  const started = new Map<string, number>()
  const finished = new Map<string, number>()
  for (const activity of activities) {
    if (activity.kind !== 'task_update' || !activity.refId) continue
    const at = taskTime(activity.createdAt)
    if (at === null) continue
    if (activity.status === 'in_progress') started.set(activity.refId, Math.min(at, started.get(activity.refId) ?? at))
    else if (activity.status === 'done') finished.set(activity.refId, Math.max(at, finished.get(activity.refId) ?? at))
  }
  const result = new Map<string, number>()
  for (const task of tasks) {
    if (task.status !== 'done') continue
    const span = (finished.get(task.id) ?? task.updatedAt) - (started.get(task.id) ?? task.createdAt)
    if (span > 0) result.set(task.id, span)
  }
  return result
}

export interface DecisionWait {
  /** Whose answer was awaited, as `ownerOf` names it. */
  owner: string
  ms: number
}

/**
 * Time spent waiting for answers, per person who had to answer. Each person's
 * waits are merged where they overlap, so parallel questions count once.
 * Beyond `limit` people, the rest are returned together as `others`.
 */
export function decisionWaits(activities: readonly TeamActivity[], ownerOf: (appId: string) => string, limit = 3): { shown: DecisionWait[]; others: { count: number; ms: number } | null } {
  const asked = new Map<string, { appId: string; at: number }>()
  const answered = new Map<string, number>()
  for (const activity of activities) {
    if (activity.kind !== 'decision' || !activity.refId) continue
    const at = taskTime(activity.createdAt)
    if (at === null) continue
    if (activity.status === 'escalation') asked.set(activity.refId, { appId: activity.actorAppId, at })
    else if (activity.status === 'ok') answered.set(activity.refId, at)
  }
  const byOwner = new Map<string, [number, number][]>()
  for (const [id, request] of asked) {
    const end = answered.get(id)
    if (end === undefined || end <= request.at) continue
    const owner = ownerOf(request.appId)
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), [request.at, end]])
  }
  const all = [...byOwner].map(([owner, spans]) => ({ owner, spans, ms: unionLength(spans) })).sort((a, b) => b.ms - a.ms)
  const rest = all.slice(limit)
  return {
    shown: all.slice(0, limit).map(({ owner, ms }) => ({ owner, ms })),
    others: rest.length ? { count: rest.length, ms: unionLength(rest.flatMap(row => row.spans)) } : null,
  }
}

export function unionLength(spans: readonly [number, number][]): number {
  let total = 0
  let end = -Infinity
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (to <= end) continue
    total += to - Math.max(from, end)
    end = to
  }
  return total
}
