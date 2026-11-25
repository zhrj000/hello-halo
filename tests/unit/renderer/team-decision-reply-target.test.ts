import { describe, expect, it } from 'vitest'

import { replyTarget } from '../../../src/renderer/components/team/team-page-host'

const detail: any = { team: { id: 'crew', name: 'Crew' } }
const decision: any = { appId: 'writer', memberName: 'Writer', entryId: 'q1', question: 'Which title?', epochId: 'e1', entry: { id: 'q1' } }
const task = (kind: string): any => ({ epochId: 'e1', teamId: 'crew', kind, label: 'Launch plan' })

describe('Reply on the team page', () => {
  it('opens the task conversation at the question', () => {
    expect(replyTarget(true, detail, 's1', decision, task('native'))).toEqual({
      spaceId: 's1',
      target: { teamId: 'crew', epochId: 'e1', teamName: 'Crew', label: 'Launch plan', appId: 'writer', entryId: 'q1', decision: true },
    })
    expect(replyTarget(true, detail, 's1', decision, task('run'))).not.toBeNull()
  })
  it('answers in place where leaving is turned off, and for what the homepage does not hold', () => {
    expect(replyTarget(false, detail, 's1', decision, task('native'))).toBeNull()
    expect(replyTarget(true, detail, null, decision, task('native'))).toBeNull()
    expect(replyTarget(true, detail, 's1', { ...decision, epochId: undefined }, task('native'))).toBeNull()
    expect(replyTarget(true, detail, 's1', decision, task('im'))).toBeNull()
    expect(replyTarget(true, detail, 's1', decision, task('collab'))).toBeNull()
  })
})
