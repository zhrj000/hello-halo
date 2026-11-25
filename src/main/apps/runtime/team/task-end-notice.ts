/**
 * Tells the person when a team task they care about stops: the team finished
 * its round of work, or the work failed.
 *
 * What "stopped" means here is the runtime's own definition of a task with
 * nothing left to do — no member turn running or queued, no turn-end notice on
 * its way to the lead, no message waiting in a mailbox (`isWorking`) — held for
 * a moment so the gap between one turn ending and the next one starting does
 * not read as the end. A team conversation is never sealed as "done" by itself
 * (only a person ends one), so a stored end state cannot be what this watches.
 *
 * Only the machine hosting the team watches: it runs the lead and sees every
 * turn of the task begin and end. A joined machine sees its own members' turns
 * only, and would call a task finished whenever they went quiet.
 *
 * Nothing is said about work this process did not watch happen (a restart, a
 * replicated row), about a task a person ended or paused by hand, or while a
 * member waits on a person's decision — that question was already announced.
 *
 * A finished round is announced only when a person or a run set it going: a
 * person's message, a person's answer to a decision, or a run's start. A round
 * that a periodic check or another internal wake began, and the lead merely
 * closed, is background upkeep and stays quiet. A failure is announced either way.
 */

import { openMemberFailures } from '../../../../shared/apps/team-failures'
import { isRemoteMember, memberDisplayName, type EpochEndReason, type MemberTurnFate, type Team, type TeamActivity, type TeamEpoch, type TeamTriggerContext } from '../../../../shared/apps/team-types'
import { isNativeConversationChatKey } from '../../../../shared/apps/im-keys'
import { getWorkMember, type TeamStore } from '../../team'

const LOG_TAG = '[TeamTaskEndNotice]'

/** How long a task must stay quiet before it counts as stopped. */
export const TASK_QUIET_CONFIRM_MS = 1500
/** The same kind of notice for the same task is not repeated within this window. */
export const TASK_NOTICE_REPEAT_WINDOW_MS = 30_000
/** Bounded excerpt: a notification is one glance, not the answer. */
export const TASK_NOTICE_TEXT_MAX = 140

export type TaskEndNoticeKind = 'completed' | 'failed'

/** What the application layer supplies: who the person is, their setting, and the delivery. */
export interface TaskEndNoticeSink {
  /** This machine's person, as task records name their creator. */
  viewerIdentity(): string | null
  /** The person's "notify when a task completes" setting. Failures are not gated by it. */
  completionEnabled(): boolean
  notify(title: string, body: string, target: { appId: string; teamId: string; epochId: string }, kind: TaskEndNoticeKind): void
}

export interface TaskEndNoticeDeps {
  store: TeamStore
  sink: TaskEndNoticeSink
  /** Any member turn running or queued, a notice on its way, or mail waiting in this task. */
  isWorking(teamId: string, epochId: string): boolean
  /** A member of this task waits on a person's decision. */
  isWaitingOnPerson(teamId: string, epochId: string): boolean
  quietConfirmMs?: number
  repeatWindowMs?: number
  now?: () => number
}

export interface TaskEndNoticeTurn {
  appId: string
  teamId: string
  epochId: string
  fate: MemberTurnFate
  finalReply?: string
  /** What woke the turn; absent reads as a person's own message, as the turn report reads it. */
  triggerKind?: TeamTriggerContext['kind']
}

export interface TaskEndNotice {
  /** A member's turn in a task ended on this machine. */
  noteTurnEnded(turn: TaskEndNoticeTurn): void
  /** Work in a task started, ended or settled; re-read whether it is still going. */
  noteWorkChanged(teamId: string, epochId: string): void
  /** The task was sealed; only an error or a timeout says anything. */
  noteSealed(teamId: string, epochId: string, endReason: EpochEndReason): void
  dispose(): void
}

/** A task this process watched working, since it last went quiet. */
interface Watch {
  teamId: string
  since: number
  /** The last turn of the member the person talks to in this task, in this round. */
  front?: { fate: MemberTurnFate; reply?: string }
  /** A person or a run set this round going; only such a round is announced as finished. */
  prompted: boolean
  timer?: ReturnType<typeof setTimeout>
}

/** Turns a person or a run starts. Anything else (a teammate's message, a check, a notice) is internal. */
function isPrompt(kind: TeamTriggerContext['kind'] | undefined): boolean {
  return kind === undefined || kind === 'human_message' || kind === 'run_start'
}

export function createTaskEndNotice(deps: TaskEndNoticeDeps): TaskEndNotice {
  const { store, sink } = deps
  const now = deps.now ?? Date.now
  const quietConfirmMs = deps.quietConfirmMs ?? TASK_QUIET_CONFIRM_MS
  const repeatWindowMs = deps.repeatWindowMs ?? TASK_NOTICE_REPEAT_WINDOW_MS
  const watches = new Map<string, Watch>()
  const lastSent = new Map<string, { kind: TaskEndNoticeKind; at: number }>()
  /**
   * Tasks whose last round stopped on a person's decision. The answer resumes the
   * member as a teammate's message would, so the round it starts is marked here:
   * it is the person's, like their own message.
   */
  const awaitingAnswer = new Set<string>()

  /** The task, when it is one this machine announces: hosted here, a person's task or a run. */
  function scopeOf(teamId: string, epochId: string): { team: Team; epoch: TeamEpoch } | null {
    const team = store.getTeamById(teamId)
    const epoch = store.getEpochById(epochId)
    if (!team || !epoch || epoch.teamId !== teamId) return null
    // A joined machine sees only its own members' turns; a temporary collaboration
    // is announced by the space conversation that coordinates it.
    if (team.hostNodeId != null || team.ephemeral) return null
    // IM chats are answered in the IM app and member side-threads are not tasks.
    if (epoch.lifecycle !== 'run' && !isNativeConversationChatKey(epoch.chatKey ?? '')) return null
    return { team, epoch }
  }

  function isOpen(epoch: TeamEpoch): boolean {
    return epoch.endedAt === null && epoch.workItem?.status !== 'completed'
  }

  /** The member the person talks to in this task, where the notification opens. */
  function frontOf(team: Team, epoch: TeamEpoch): string | null {
    return epoch.workItem?.entryAppId || team.leadAppId || null
  }

  function nameOf(teamId: string, epochId: string, appId: string): string {
    const member = getWorkMember(store, teamId, epochId, appId)
    return member ? memberDisplayName(member) : ''
  }

  /**
   * The person started it, or one of their own digital humans took part. Work
   * nobody started by hand (a schedule, a webhook) is the team owner's, and the
   * owner is the person on the hosting machine.
   */
  function concernsViewer(team: Team, epoch: TeamEpoch): boolean {
    const createdBy = epoch.workItem?.createdBy ?? null
    if (!createdBy) return true
    const viewer = sink.viewerIdentity()
    if (viewer && createdBy === viewer) return true
    const own = store.listMembersByTeam(team.id).filter(member => !isRemoteMember(member)).map(member => member.appId)
    return own.length > 0 && store.getConversationStats(team.id, own, [epoch.id], false).involved.has(epoch.id)
  }

  function watch(teamId: string, epochId: string): Watch | null {
    const existing = watches.get(epochId)
    if (existing) return existing
    const scope = scopeOf(teamId, epochId)
    if (!scope || !isOpen(scope.epoch)) return null
    const created: Watch = { teamId, since: now(), prompted: awaitingAnswer.delete(epochId) }
    watches.set(epochId, created)
    return created
  }

  function drop(epochId: string): Watch | undefined {
    const existing = watches.get(epochId)
    if (existing?.timer) clearTimeout(existing.timer)
    watches.delete(epochId)
    return existing
  }

  function deliver(kind: TaskEndNoticeKind, team: Team, epoch: TeamEpoch, appId: string, body: string): void {
    const last = lastSent.get(epoch.id)
    const at = now()
    if (last && last.kind === kind && at - last.at < repeatWindowMs) {
      console.log(`${LOG_TAG} repeat suppressed: team=${team.id} epoch=${epoch.id} kind=${kind}`)
      return
    }
    lastSent.set(epoch.id, { kind, at })
    // Same shape as a team member's own notification: the team and the task in
    // the title, who says what in the body.
    const title = [team.name, epoch.workItem?.title || epoch.title].filter(Boolean).join(' · ')
    console.log(`${LOG_TAG} notify: team=${team.id} epoch=${epoch.id} kind=${kind} app=${appId}`)
    try { sink.notify(title, body, { appId, teamId: team.id, epochId: epoch.id }, kind) }
    catch (error) { console.error(`${LOG_TAG} notification failed: team=${team.id} epoch=${epoch.id}`, error) }
  }

  /** A failure that happened in this round and nothing has answered since, as the task list reads it. */
  function newFailure(teamId: string, epochId: string, since: number): { appId: string; reason: string } | null {
    const rows = store.listActivityOfFailedEpochs(teamId, [epochId])
    if (!rows.length) return null
    const failure = openMemberFailures(rows, new Set()).values().next().value
    if (!failure) return null
    const row = rows.find(activity => activity.id === failure.activityId)
    if (!row || timeOf(row.createdAt) < since) return null
    return { appId: failure.appId, reason: failure.reason || row.subject || '' }
  }

  function settle(teamId: string, epochId: string): void {
    const current = watches.get(epochId)
    if (!current) return
    current.timer = undefined
    if (deps.isWorking(teamId, epochId)) return
    const scope = scopeOf(teamId, epochId)
    if (!scope) { drop(epochId); return }
    // A seal answers for itself (noteSealed); an ended task keeps its watch until then.
    if (!isOpen(scope.epoch)) return
    drop(epochId)
    const { team, epoch } = scope
    if (deps.isWaitingOnPerson(teamId, epochId)) {
      // The round their answer starts is the person's, whatever woke this one.
      awaitingAnswer.add(epochId)
      return
    }
    if (!concernsViewer(team, epoch)) return

    const frontAppId = frontOf(team, epoch)
    const front = current.front
    const frontFailed = front && front.fate.kind !== 'ended' && front.fate.kind !== 'stopped'
    if (frontFailed && frontAppId) {
      deliver('failed', team, epoch, frontAppId, says(nameOf(teamId, epochId, frontAppId), fateReason(front.fate)))
      return
    }
    const failure = newFailure(teamId, epochId, current.since)
    if (failure) {
      const appId = getWorkMember(store, teamId, epochId, failure.appId) ? failure.appId : frontAppId
      if (appId) deliver('failed', team, epoch, appId, says(nameOf(teamId, epochId, failure.appId), failure.reason))
      return
    }
    // A person stopped the member they talk to; the round ends with them, not with the team.
    if (!front || front.fate.kind !== 'ended' || !frontAppId) return
    // Upkeep a check or another internal wake began, closed by the lead: not news.
    if (!current.prompted || !sink.completionEnabled()) return
    const name = nameOf(teamId, epochId, frontAppId)
    deliver('completed', team, epoch, frontAppId, says(name, firstLine(front.reply) || firstLine(epoch.summary)) || name)
  }

  function noteWorkChanged(teamId: string, epochId: string): void {
    try {
      const working = deps.isWorking(teamId, epochId)
      const current = working ? watch(teamId, epochId) : watches.get(epochId)
      if (!current) return
      if (working) {
        if (current.timer) { clearTimeout(current.timer); current.timer = undefined }
        return
      }
      if (current.timer) return
      const timer = setTimeout(() => {
        try { settle(teamId, epochId) }
        catch (error) { console.error(`${LOG_TAG} settle failed: team=${teamId} epoch=${epochId}`, error) }
      }, quietConfirmMs)
      timer.unref?.()
      current.timer = timer
    } catch (error) {
      console.error(`${LOG_TAG} work change failed: team=${teamId} epoch=${epochId}`, error)
    }
  }

  function noteTurnEnded(turn: TaskEndNoticeTurn): void {
    try {
      const current = watch(turn.teamId, turn.epochId)
      if (!current) return
      if (isPrompt(turn.triggerKind)) current.prompted = true
      const scope = scopeOf(turn.teamId, turn.epochId)
      if (scope && turn.appId === frontOf(scope.team, scope.epoch)) {
        current.front = { fate: turn.fate, ...(turn.finalReply ? { reply: turn.finalReply } : {}) }
      }
    } catch (error) {
      console.error(`${LOG_TAG} turn end failed: team=${turn.teamId} epoch=${turn.epochId}`, error)
    }
  }

  function noteSealed(teamId: string, epochId: string, endReason: EpochEndReason): void {
    try {
      const watched = drop(epochId)
      if (endReason !== 'stopped') awaitingAnswer.delete(epochId)
      // Interrupted runs sealed at startup were not watched here: nobody is told
      // about work this process never saw happen.
      if (!watched || (endReason !== 'error' && endReason !== 'timeout')) return
      const scope = scopeOf(teamId, epochId)
      if (!scope || !concernsViewer(scope.team, scope.epoch)) return
      const frontAppId = frontOf(scope.team, scope.epoch)
      if (!frontAppId) return
      deliver('failed', scope.team, scope.epoch, frontAppId, firstLine(scope.epoch.summary) || nameOf(teamId, epochId, frontAppId))
    } catch (error) {
      console.error(`${LOG_TAG} seal failed: team=${teamId} epoch=${epochId}`, error)
    }
  }

  function dispose(): void {
    for (const epochId of [...watches.keys()]) drop(epochId)
    lastSent.clear()
    awaitingAnswer.clear()
  }

  return { noteTurnEnded, noteWorkChanged, noteSealed, dispose }
}

/** "Name: text", or whichever of the two exists. */
function says(name: string, text: string | undefined): string {
  const line = firstLine(text)
  if (!line) return name
  return name ? `${name}: ${line}` : line
}

function fateReason(fate: MemberTurnFate): string {
  if (fate.kind === 'error') return fate.message
  if (fate.kind === 'never_ran') return fate.reason
  return ''
}

/** The first line that says something, bounded; markdown markers stripped. */
export function firstLine(text: string | null | undefined): string {
  if (!text) return ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
    if (!line) continue
    const points = Array.from(line)
    return points.length > TASK_NOTICE_TEXT_MAX ? `${points.slice(0, TASK_NOTICE_TEXT_MAX - 1).join('')}…` : line
  }
  return ''
}

function timeOf(value: TeamActivity['createdAt'] | unknown): number {
  if (typeof value === 'number') return value
  if (typeof value !== 'string' || !value.trim()) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}
