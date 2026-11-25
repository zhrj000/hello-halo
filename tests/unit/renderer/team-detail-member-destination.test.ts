/**
 * On the team page, a member of a task is turned to where the task is talked
 * about: its homepage conversation, on that member — never a read-only copy of
 * the chat. A task with no conversation here (an IM chat) has nowhere to go, so
 * the page shows the member's part of the collaboration record instead.
 */
import { beforeEach, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ open: vi.fn(() => true), remember: vi.fn(), collab: vi.fn(), navigate: vi.fn() }))
vi.mock('../../../src/renderer/i18n', () => ({ default: { t: (s: string) => s, on: () => {} }, useTranslation: () => ({ t: (s: string) => s }) }))
vi.mock('../../../src/renderer/utils/people-navigation', () => ({ openPersonTeam: vi.fn(), openPersonModelSettings: vi.fn() }))
vi.mock('../../../src/renderer/api', () => ({ api: new Proxy({}, { get: () => vi.fn().mockResolvedValue({ success: true, data: [] }) }) }))
vi.mock('../../../src/renderer/utils/team-conversation-navigation', () => ({ openTeamConversation: env.open }))
vi.mock('../../../src/renderer/utils/conversation-navigation', () => ({ navigateToConversation: env.navigate }))
vi.mock('../../../src/renderer/stores/team-view-prefs.store', () => ({ useTeamViewPrefsStore: { getState: () => ({ rememberTaskMember: env.remember }) } }))
vi.mock('../../../src/renderer/stores/collab-member-view.store', () => ({ useCollabMemberViewStore: { getState: () => ({ open: env.collab }) } }))

const { taskMemberDestination } = await import('../../../src/renderer/components/team/detail/TaskPanel')

const detail = { team: { id: 'team', name: 'Research' } } as never
const task = (patch: Record<string, unknown>) => ({ epochId: 'task', label: 'Weekly report', kind: 'native', readonly: false, ...patch }) as never

beforeEach(() => { vi.clearAllMocks() })

it('opens the task on the homepage, on the member, as the progress beside a chat does', () => {
  const talkTo = taskMemberDestination(detail, task({}), 'space')
  talkTo!('writer')
  expect(env.remember).toHaveBeenCalledWith('team', 'task', 'writer')
  expect(env.open).toHaveBeenCalledWith('space', { teamId: 'team', epochId: 'task', teamName: 'Research', label: 'Weekly report', appId: 'writer' })
})

it('has nowhere to go for an IM chat, a watch-only task, or a space not on this computer', () => {
  expect(taskMemberDestination(detail, task({ kind: 'im', readonly: true }), 'space')).toBeNull()
  expect(taskMemberDestination(detail, task({ readonly: true }), 'space')).toBeNull()
  expect(taskMemberDestination(detail, task({}), null)).toBeNull()
})

it('turns to a temporary team member in the conversation that leads it, where it lives', () => {
  const talkTo = taskMemberDestination(detail, task({ kind: 'collab', sourceConversation: { spaceId: 'space', conversationId: 'main' } }), 'space')
  talkTo!('writer')
  expect(env.collab).toHaveBeenCalledWith('main', 'writer')
  expect(env.navigate).toHaveBeenCalledWith('space', 'main')
  expect(env.open).not.toHaveBeenCalled()
  expect(taskMemberDestination(detail, task({ kind: 'collab' }), 'space')).toBeNull()
})
