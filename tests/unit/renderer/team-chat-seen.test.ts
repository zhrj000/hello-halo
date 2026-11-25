import { describe, expect, it } from 'vitest'
import { teamTaskStatus } from '../../../src/renderer/stores/team-chat-seen.store'

const task = (patch: object = {}): any => ({ epochId: 'e', teamId: 't', spaceId: 's', teamName: 'Crew', kind: 'native', label: 'Plan', readonly: false, startedAt: 1, lastActivityAt: 100, ...patch })

describe('a team task\'s state in the list', () => {
  it('asks first, then shows work under way', () => {
    expect(teamTaskStatus(task({ waitingForMe: true, active: true }), undefined, 0)).toBe('waiting')
    expect(teamTaskStatus(task({ active: true, failure: { appId: 'a', activityId: 'x' } }), undefined, 0)).toBe('generating')
  })
  it('tells a failure, or work that stopped, since the person last looked', () => {
    expect(teamTaskStatus(task({ failure: { appId: 'a', activityId: 'x' } }), 50, 0)).toBe('error')
    expect(teamTaskStatus(task(), 50, 0)).toBe('completed-unseen')
    expect(teamTaskStatus(task({ finishedAt: 200, lastActivityAt: 40 }), 50, 0)).toBe('completed-unseen')
  })
  it('stays quiet once looked at, for work that ended before it first ran, and for what the person ended', () => {
    expect(teamTaskStatus(task(), 150, 0)).toBe('idle')
    expect(teamTaskStatus(task(), undefined, 150)).toBe('idle')
    expect(teamTaskStatus(task({ endedByMe: true, finishedAt: 120 }), 50, 0)).toBe('idle')
  })
})
