import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../src/main/http/websocket', () => ({ broadcastToAll: vi.fn() }))
vi.mock('../../../../../src/main/foundation/window.service', () => ({ sendToRenderer: vi.fn() }))
vi.mock('../../../../../src/main/apps/team', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../src/main/apps/team')>(),
  getTeamService: () => ({ getCollaborationScope: () => null, disposePrivateCollaborations: async () => {} }),
}))
vi.mock('../../../../../src/main/services/agent', () => ({ onAgentEvent: vi.fn(), evictIdleSession: vi.fn() }))
vi.mock('../../../../../src/main/services/space.service', () => ({ getSpaceDir: vi.fn() }))
vi.mock('../../../../../src/main/apps/manager', () => ({ getAppManager: vi.fn() }))
vi.mock('../../../../../src/main/apps/runtime/team/board-archive', () => ({
  createBoardArchive: () => ({ sweep: vi.fn(), clearEpoch: vi.fn() }),
}))

import { createTeamRuntime, type TeamRuntime } from '../../../../../src/main/apps/runtime/team'
import { firstLine, TASK_NOTICE_REPEAT_WINDOW_MS, TASK_QUIET_CONFIRM_MS, type TaskEndNoticeSink } from '../../../../../src/main/apps/runtime/team/task-end-notice'
import { createDatabaseManager } from '../../../../../src/main/platform/store/database-manager'
import { TeamStore } from '../../../../../src/main/apps/team/store'
import { MIGRATION_NAMESPACE, migrations } from '../../../../../src/main/apps/team/migrations'
import type { OrchestrationSessionDeps } from '../../../../../src/main/apps/runtime/team/orchestration'
import type { MemberTurnFate, TeamTriggerContext } from '../../../../../src/shared/apps/team-types'

const ME = 'node-me'

describe('team task end notifications', () => {
  let database: ReturnType<typeof createDatabaseManager>
  let store: TeamStore
  let completionEnabled: boolean
  let waitingOnPerson: boolean
  let notify: ReturnType<typeof vi.fn>
  let runtime: TeamRuntime

  function addTeam(id: string, extra: { hostNodeId?: string } = {}) {
    store.insertTeam({ id, name: 'Launch', owningSpaceId: `space-${id}`, goal: '', leadAppId: 'lead',
      memberSourcing: 'manual', collabMode: 'free', escalationRouting: 'user', status: 'idle',
      currentEpochId: null, createdAt: 1, updatedAt: 1, ...extra })
    for (const appId of ['lead', 'first']) {
      store.addMember({ teamId: id, appId, memberName: appId === 'lead' ? 'Lead' : 'First', role: '', isLead: appId === 'lead', aiProvisioned: false, addedAt: 1 })
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    database = createDatabaseManager(':memory:')
    const db = database.getAppDatabase()
    database.runMigrations(db, MIGRATION_NAMESPACE, migrations)
    store = new TeamStore(db)
    addTeam('team')
    completionEnabled = true
    waitingOnPerson = false
    notify = vi.fn()
    const sink: TaskEndNoticeSink = {
      viewerIdentity: () => ME,
      completionEnabled: () => completionEnabled,
      notify,
    }
    runtime = createTeamRuntime({
      store, teamFolderRoot: '/unused-team-work', taskEndNotice: sink,
      hasPendingEscalation: () => waitingOnPerson,
      session: {
        isSessionActive: () => false,
        closeTeamSession: async () => {},
      } as unknown as OrchestrationSessionDeps,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    database.closeAll()
  })

  function task(createdBy: string | undefined = ME, teamId = 'team') {
    return runtime.ensureConversationEpoch(teamId, `native:${Math.random()}`, 'Plan the launch', createdBy).id
  }

  function turn(epochId: string, fate: MemberTurnFate = { kind: 'ended' }, finalReply?: string, appId = 'lead', teamId = 'team', triggerKind?: TeamTriggerContext['kind']) {
    runtime.noteMemberTurnStarted({ appId, teamId, epochId })
    runtime.noteMemberTurnEnded({ appId, teamId, epochId, fate, ...(finalReply ? { finalReply } : {}), ...(triggerKind ? { triggerKind } : {}) })
  }

  /** A periodic check wakes a member; its ending wakes the lead, who closes the round. */
  function checkRound(epochId: string, fate: MemberTurnFate = { kind: 'ended' }) {
    runtime.noteMemberTurnStarted({ appId: 'first', teamId: 'team', epochId })
    runtime.noteMemberTurnStarted({ appId: 'lead', teamId: 'team', epochId })
    // The lead's turn below stands for the one the member's turn-end notice wakes,
    // so the notice itself is not queued again here.
    runtime.noteMemberTurnEnded({ appId: 'first', teamId: 'team', epochId, fate: { kind: 'ended' }, triggerKind: 'periodic_check' }, { report: false })
    runtime.noteMemberTurnEnded({ appId: 'lead', teamId: 'team', epochId, fate, finalReply: 'Checked; nothing new.', triggerKind: 'member_stopped' })
  }

  const settle = () => vi.advanceTimersByTime(TASK_QUIET_CONFIRM_MS + 10)

  it('announces a finished round with the team, the task and the lead’s closing words', () => {
    const epochId = task()
    turn(epochId, { kind: 'ended' }, '## The plan is ready\n\nDetails follow.')
    expect(notify).not.toHaveBeenCalled()
    settle()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Launch · Plan the launch', 'Lead: The plan is ready',
      { appId: 'lead', teamId: 'team', epochId }, 'completed')
  })

  it('does not call a task finished while a member is still working in it', () => {
    const epochId = task()
    runtime.noteMemberTurnStarted({ appId: 'first', teamId: 'team', epochId })
    turn(epochId, { kind: 'ended' }, 'Waiting on First.')
    settle()
    expect(notify).not.toHaveBeenCalled()
    runtime.noteMemberTurnEnded({ appId: 'first', teamId: 'team', epochId, fate: { kind: 'ended' } })
    turn(epochId, { kind: 'ended' }, 'All done.')
    settle()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toBe('Lead: All done.')
  })

  it('announces a failed lead turn with its reason, even with completion notifications off', () => {
    completionEnabled = false
    const epochId = task()
    turn(epochId, { kind: 'error', message: 'Model quota exceeded\nstack…' })
    settle()
    expect(notify).toHaveBeenCalledWith('Launch · Plan the launch', 'Lead: Model quota exceeded',
      { appId: 'lead', teamId: 'team', epochId }, 'failed')
  })

  it('announces a member failure the task still holds, opening on that member', () => {
    const epochId = task()
    runtime.noteMemberTurnStarted({ appId: 'lead', teamId: 'team', epochId })
    store.insertActivity({
      id: 'failed-turn', teamId: 'team', epochId, kind: 'reply', actorAppId: 'first', targetAppId: 'lead',
      subject: 'The member’s turn failed: rate limited', body: null, refId: null, correlationId: 'c-1', status: 'error', createdAt: Date.now(),
    })
    runtime.noteMemberTurnEnded({ appId: 'lead', teamId: 'team', epochId, fate: { kind: 'ended' }, finalReply: 'First failed.' })
    settle()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Launch · Plan the launch', 'First: rate limited',
      { appId: 'first', teamId: 'team', epochId }, 'failed')
  })

  it('announces a task sealed on an error', async () => {
    const epochId = task()
    runtime.noteMemberTurnStarted({ appId: 'lead', teamId: 'team', epochId })
    await runtime.sealConversationEpoch('team', epochId, 'error', 'Circuit breaker: maxDepth')
    expect(notify).toHaveBeenCalledWith('Launch · Plan the launch', 'Circuit breaker: maxDepth',
      { appId: 'lead', teamId: 'team', epochId }, 'failed')
    settle()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('says nothing when a person ends or pauses the task', async () => {
    const ended = task()
    turn(ended, { kind: 'ended' }, 'Done.')
    store.updateWorkItem(ended, { status: 'completed', endedBy: ME })
    await runtime.sealConversationEpoch('team', ended, 'ended')
    const paused = task()
    turn(paused, { kind: 'ended' }, 'Done.')
    await runtime.sealConversationEpoch('team', paused, 'stopped')
    settle()
    expect(notify).not.toHaveBeenCalled()
  })

  it('says nothing when the person stopped the lead, or a decision waits on them', () => {
    turn(task(), { kind: 'stopped' })
    waitingOnPerson = true
    turn(task(), { kind: 'ended' }, 'Which option?')
    settle()
    expect(notify).not.toHaveBeenCalled()
  })

  it('leaves out tasks someone else started that none of my digital humans took part in', () => {
    const others = task('node-other')
    turn(others, { kind: 'ended' }, 'Answered.')
    settle()
    expect(notify).not.toHaveBeenCalled()

    const joined = task('node-other')
    store.insertActivity({
      id: 'lead-message', teamId: 'team', epochId: joined, kind: 'message', actorAppId: 'lead', targetAppId: 'first',
      subject: 'Please draft', body: null, refId: null, correlationId: 'c-2', status: 'sent', createdAt: Date.now(),
    })
    turn(joined, { kind: 'ended' }, 'Drafted.')
    settle()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][2]).toMatchObject({ epochId: joined })
  })

  it('leaves the announcement to the hosting machine', () => {
    addTeam('joined', { hostNodeId: 'node-host' })
    const epochId = task(ME, 'joined')
    turn(epochId, { kind: 'error', message: 'boom' }, undefined, 'lead', 'joined')
    settle()
    expect(notify).not.toHaveBeenCalled()
  })

  it('keeps a round a periodic check began quiet, but not one a person or a run began', () => {
    const epochId = task()
    checkRound(epochId)
    settle()
    expect(notify).not.toHaveBeenCalled()

    turn(epochId, { kind: 'ended' }, 'Here is the update you asked for.')
    settle()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toBe('Lead: Here is the update you asked for.')

    vi.advanceTimersByTime(TASK_NOTICE_REPEAT_WINDOW_MS)
    turn(epochId, { kind: 'ended' }, 'Run finished.', 'lead', 'team', 'run_start')
    settle()
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('still announces a failure in a round a periodic check began', () => {
    completionEnabled = false
    const epochId = task()
    checkRound(epochId, { kind: 'error', message: 'Model unavailable' })
    settle()
    expect(notify).toHaveBeenCalledWith('Launch · Plan the launch', 'Lead: Model unavailable',
      { appId: 'lead', teamId: 'team', epochId }, 'failed')
  })

  it('counts the round a person’s answer to a decision starts as theirs', () => {
    const epochId = task()
    waitingOnPerson = true
    turn(epochId, { kind: 'ended' }, 'Which option?')
    settle()
    expect(notify).not.toHaveBeenCalled()
    // The answer resumes the lead as a message, not as a person's own turn.
    waitingOnPerson = false
    turn(epochId, { kind: 'ended' }, 'Going with option B; done.', 'lead', 'team', 'message')
    settle()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toBe('Lead: Going with option B; done.')
  })

  it('respects the completion setting', () => {
    completionEnabled = false
    turn(task(), { kind: 'ended' }, 'Done.')
    settle()
    expect(notify).not.toHaveBeenCalled()
  })

  it('announces one quiet task once and does not repeat itself within the window', () => {
    const epochId = task()
    // One turn end reaches the watcher twice (the turn's own signal and the
    // orchestration's settlement), and the quiet is confirmed more than once.
    turn(epochId, { kind: 'ended' }, 'First answer.')
    settle()
    settle()
    expect(notify).toHaveBeenCalledTimes(1)

    turn(epochId, { kind: 'ended' }, 'Second answer.')
    settle()
    expect(notify).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(TASK_NOTICE_REPEAT_WINDOW_MS)
    turn(epochId, { kind: 'ended' }, 'Third answer.')
    settle()
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify.mock.calls[1][1]).toBe('Lead: Third answer.')
  })

  it('reduces a reply to its first line', () => {
    expect(firstLine('\n\n- **Ready**: see `plan.md`\nmore')).toBe('Ready: see plan.md')
    expect(firstLine('x'.repeat(300))).toHaveLength(140)
    expect(firstLine(null)).toBe('')
  })
})
