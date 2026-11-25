import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/api', () => ({ api: {} }))
vi.mock('../../../src/renderer/i18n', () => ({ default: { t: (text: string) => text }, getCurrentLanguage: () => 'en' }))
vi.mock('../../../src/renderer/stores/chat.store', () => ({ usePulseItems: () => [] }))
vi.mock('../../../src/renderer/stores/apps.store', () => ({ useAppsStore: () => [], useAutomationTaskItems: () => [] }))
vi.mock('../../../src/renderer/stores/space.store', () => ({ useSpaceNameResolver: () => () => '', useSpaceStore: { getState: () => ({ spaces: [] }), subscribe: () => () => {} } }))

import { mergeSpaceTasks, teamTaskNeeds } from '../../../src/renderer/stores/team-task-items.store'
import { teamTaskToTaskItem } from '../../../src/renderer/stores/task.store'

const task = (epochId: string, patch: object = {}): any => ({ epochId, teamId: 'crew', spaceId: 's1', teamName: 'Crew', kind: 'native', label: `Task ${epochId}`, readonly: false, startedAt: 1, lastActivityAt: 100, ...patch })

describe('team tasks in the task panel', () => {
  it('lists each task once across spaces, from the first space that lists it', () => {
    const merged = mergeSpaceTasks([[task('a'), task('b')], [task('b', { spaceId: 's2' }), task('c', { spaceId: 's2' })]])
    expect(merged.map(item => [item.epochId, item.spaceId])).toEqual([['a', 's1'], ['b', 's1'], ['c', 's2']])
  })

  it('keeps only what needs the person: a question, a failure or a finish not yet opened', () => {
    const tasks = [task('ask', { waitingForMe: true }), task('busy', { active: true }), task('broke', { failure: { appId: 'm', activityId: 'x', reason: 'Model quota exceeded\nretry later' } }), task('done'), task('old', { lastActivityAt: 10 })]
    const needs = teamTaskNeeds(tasks, { 'team:crew:done': 50 }, 20)
    expect(needs.map(need => [need.task.epochId, need.status])).toEqual([['ask', 'waiting'], ['broke', 'error'], ['done', 'completed-unseen']])
  })

  it('names the entry by its task, says which team and why, and opens that task', () => {
    const [ask, broke] = teamTaskNeeds([task('ask', { waitingForMe: true }), task('broke', { failure: { appId: 'm', activityId: 'x', reason: 'Model quota exceeded\nretry later' } })], {}, 0)
    expect(teamTaskToTaskItem(ask)).toMatchObject({ key: 'team:crew:ask', source: 'team', status: 'waiting', title: 'Task ask', detail: 'Crew · Needs your reply', spaceId: 's1', teamId: 'crew', epochId: 'ask' })
    expect(teamTaskToTaskItem(broke).detail).toBe('Crew · Model quota exceeded')
  })
})
