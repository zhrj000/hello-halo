import { describe, expect, it } from 'vitest'
import { decisionWaits, subtaskBoard, subtaskDurations, unionLength } from '../../../src/renderer/components/team/workbench/subtasks'
import { formatSpan } from '../../../src/renderer/components/team/workbench/time'
import type { MemberProgress } from '../../../src/renderer/components/team/workbench/progress'
import type { BlackboardTask, TeamActivity } from '../../../src/shared/apps/team-types'

const MIN = 60_000
const row = (id: string, status: BlackboardTask['status'], patch: Partial<BlackboardTask> = {}): BlackboardTask => ({
  id, teamId: 'team', epochId: 'task', title: id, assigneeAppId: null, status, resultRef: null, note: null, parentId: null, createdByAppId: 'lead', createdAt: 0, updatedAt: 0, ...patch,
})
const act = (patch: Partial<TeamActivity>): TeamActivity => ({
  id: `${patch.kind}-${patch.refId}-${patch.status}-${patch.createdAt}`, teamId: 'team', epochId: 'task', kind: 'task_update', actorAppId: 'lead', targetAppId: null, subject: '', body: null, refId: null, correlationId: null, status: null, createdAt: 0, ...patch,
})

describe('subtask board', () => {
  it('groups in-progress work by what its assignee needs', () => {
    const members: MemberProgress[] = [
      { appId: 'asks', state: 'waiting', decisionId: 'd1' },
      { appId: 'waits-elsewhere', state: 'waiting' },
      { appId: 'broke', state: 'failed', activityId: 'a1' },
    ]
    const board = subtaskBoard([
      row('ask', 'in_progress', { assigneeAppId: 'asks' }),
      row('other-owner', 'in_progress', { assigneeAppId: 'waits-elsewhere' }),
      row('fail', 'in_progress', { assigneeAppId: 'broke' }),
      row('stuck', 'blocked'),
      row('later', 'pending'),
      row('ok', 'done'),
      row('no', 'rejected'),
    ], members)
    expect(board.groups.map(group => [group.id, group.tasks.map(task => task.id)])).toEqual([
      ['waiting', ['ask']],
      ['failed', ['fail', 'stuck']],
      ['working', ['other-owner']],
      ['pending', ['later']],
      ['done', ['ok', 'no']],
    ])
  })

  it('draws finished work first, oldest first, then what is still open', () => {
    const board = subtaskBoard([
      row('new', 'done', { updatedAt: 2 }),
      row('old', 'rejected', { updatedAt: 1 }),
      row('next', 'pending', { createdAt: 2 }),
      row('first', 'pending', { createdAt: 1 }),
      row('run', 'in_progress'),
    ], [])
    expect(board.cells).toEqual(['rejected', 'done', 'working', 'pending', 'pending'])
    expect(board.groups.find(group => group.id === 'pending')?.tasks.map(task => task.id)).toEqual(['first', 'next'])
  })

  it('keeps work passed from member to member in the order it was handed out', () => {
    const board = subtaskBoard([
      row('research', 'done', { createdAt: 1, updatedAt: 3 }),
      row('write', 'done', { createdAt: 2, updatedAt: 5 }),
      row('review', 'in_progress', { createdAt: 4, updatedAt: 4 }),
    ], [], true)
    expect(board.groups.map(group => [group.id, group.tasks.map(task => task.id)])).toEqual([['working', ['review']], ['done', ['research', 'write']]])
    expect(board.cells).toEqual(['done', 'done', 'working'])
  })

  it('omits empty groups', () => {
    expect(subtaskBoard([], []).groups).toEqual([])
  })
})

describe('subtask durations', () => {
  it('runs from when a task was taken up to when it was marked done', () => {
    const durations = subtaskDurations([row('t', 'done', { createdAt: 0, updatedAt: 99 * MIN })], [
      act({ refId: 't', status: 'in_progress', createdAt: 5 * MIN }),
      act({ refId: 't', status: 'in_progress', createdAt: 8 * MIN }),
      act({ refId: 't', status: 'done', createdAt: 20 * MIN }),
    ])
    expect(durations.get('t')).toBe(15 * MIN)
  })

  it('falls back to when it was posted and last changed, and skips open or rejected tasks', () => {
    const durations = subtaskDurations([
      row('plain', 'done', { createdAt: MIN, updatedAt: 4 * MIN }),
      row('open', 'in_progress', { createdAt: 0, updatedAt: 9 * MIN }),
      row('no', 'rejected', { createdAt: 0, updatedAt: 9 * MIN }),
    ], [])
    expect([...durations]).toEqual([['plain', 3 * MIN]])
  })
})

describe('decision waits', () => {
  const ask = (id: string, appId: string, at: number) => act({ kind: 'decision', status: 'escalation', refId: id, actorAppId: appId, createdAt: at })
  const answer = (id: string, at: number) => act({ kind: 'decision', status: 'ok', refId: id, actorAppId: 'x', createdAt: at })

  it('counts parallel questions to one person once and ignores unanswered ones', () => {
    const waits = decisionWaits([
      ask('a', 'mine', 0), answer('a', 10 * MIN),
      ask('b', 'mine', 5 * MIN), answer('b', 15 * MIN),
      ask('c', 'theirs', 0), answer('c', 3 * MIN),
      ask('open', 'mine', 20 * MIN),
    ], appId => (appId === 'mine' ? '' : 'Zhang'))
    expect(waits).toEqual({ shown: [{ owner: '', ms: 15 * MIN }, { owner: 'Zhang', ms: 3 * MIN }], others: null })
  })

  it('folds everyone past the limit together', () => {
    const activities = ['p1', 'p2', 'p3', 'p4', 'p5'].flatMap((id, index) => [ask(id, id, 0), answer(id, (10 - index) * MIN)])
    const waits = decisionWaits(activities, appId => appId, 3)
    expect(waits.shown.map(row => row.owner)).toEqual(['p1', 'p2', 'p3'])
    expect(waits.others).toEqual({ count: 2, ms: 7 * MIN })
  })

  it('merges overlapping spans', () => {
    expect(unionLength([[0, 5], [3, 8], [10, 12], [11, 11]])).toBe(10)
  })
})

describe('span format', () => {
  const t = (key: string, options?: Record<string, unknown>) => key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name]))
  it('says minutes, hours and days the way people do', () => {
    expect(formatSpan(20_000, t)).toBe('under a minute')
    expect(formatSpan(42 * MIN, t)).toBe('42 min')
    expect(formatSpan(60 * MIN, t)).toBe('1 h')
    expect(formatSpan(95 * MIN, t)).toBe('1 h 35 min')
    expect(formatSpan(26 * 60 * MIN, t)).toBe('1 d 2 h')
  })
})
