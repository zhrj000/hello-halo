import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ api: { appGetActivityEntry: vi.fn() }, people: {} as Record<string, unknown>, page: { currentTab: 'my-digital-humans', selectedAppId: 'previous', setInitialAppId: vi.fn(), setCurrentTab: vi.fn(), openActivityThread: vi.fn(), openSessionDetail: vi.fn() }, selectTeam: vi.fn(), upsert: vi.fn(), navigate: vi.fn(), openTeamWork: vi.fn() }))
vi.mock('../../../src/renderer/api', () => ({ api: state.api }))
vi.mock('../../../src/renderer/stores/people-view.store', () => ({ usePeopleViewStore: { setState: (patch: object) => Object.assign(state.people, patch) } }))
vi.mock('../../../src/renderer/stores/apps-page.store', () => ({ useAppsPageStore: { getState: () => state.page } }))
vi.mock('../../../src/renderer/stores/apps.store', () => ({ useAppsStore: { getState: () => ({ handleNewActivityEntry: state.upsert }) } }))
vi.mock('../../../src/renderer/stores/team.store', () => ({ useTeamStore: { getState: () => ({ selectTeam: state.selectTeam }) } }))
const home = vi.hoisted(() => ({ view: 'apps', chat: { currentSpaceId: null as string | null, spaceStates: new Map<string, Record<string, unknown>>() }, openTeamConversation: vi.fn(), navigateToConversation: vi.fn(), navigateToAppChat: vi.fn() }))
vi.mock('../../../src/renderer/stores/app.store', () => ({ useAppStore: { getState: () => ({ navigate: state.navigate, view: home.view }) } }))
vi.mock('../../../src/renderer/stores/chat.store', () => ({ useChatStore: { getState: () => home.chat } }))
vi.mock('../../../src/renderer/utils/conversation-navigation', () => ({ navigateToConversation: home.navigateToConversation, navigateToAppChat: home.navigateToAppChat }))
vi.mock('../../../src/renderer/utils/team-conversation-navigation', () => ({ openTeamWork: state.openTeamWork, openTeamConversation: home.openTeamConversation }))
import { openPersonTeam, openWorkNotification, returnToConversation } from '../../../src/renderer/utils/people-navigation'
beforeEach(() => {
  vi.clearAllMocks(); state.openTeamWork.mockResolvedValue(false); state.people = {}; state.page.currentTab = 'my-digital-humans'
  home.view = 'apps'; home.chat = { currentSpaceId: null, spaceStates: new Map() }
})
it('resolves the canonical team task and decision instead of opening an unrelated person execution', async () => {
  const entry = { id: 'question', type: 'escalation', content: { source: { kind: 'team', teamId: 'real-team', epochId: 'real-task' } } }
  state.api.appGetActivityEntry.mockResolvedValue({ success: true, data: entry })
  await openWorkNotification({ appId: 'person', entryId: 'question', teamId: 'old-team' })
  expect(state.upsert).toHaveBeenCalledWith('person', entry)
  expect(state.people.teamTarget).toEqual({ teamId: 'real-team', epochId: 'real-task', appId: 'person', entryId: 'question', decision: true })
  expect(state.people.returnPerson).toBe('previous')
  expect(state.page.openActivityThread).not.toHaveBeenCalled()
})
it('keeps a report an activity anchor and preserves an inbox return destination', async () => {
  state.page.currentTab = 'inbox'
  state.api.appGetActivityEntry.mockResolvedValue({ success: true, data: { type: 'output', content: { source: { kind: 'team', teamId: 'team', epochId: 'task' } } } })
  await openWorkNotification({ appId: 'person', entryId: 'report' })
  expect(state.people.teamTarget).toMatchObject({ entryId: 'report', decision: false })
  expect(state.people.returnInbox).toBe(true)
})
it('opens an exact independent request and preserves app-only legacy notification behavior', async () => {
  state.api.appGetActivityEntry.mockResolvedValue({ success: true, data: { type: 'escalation', content: { source: { kind: 'automation' } } } })
  await openWorkNotification({ appId: 'person', entryId: 'question' })
  expect(state.people.focusEntry).toEqual({ appId: 'person', entryId: 'question' })
  expect(state.page.openActivityThread).toHaveBeenCalledWith('person')
  await openWorkNotification({ appId: 'legacy' })
  expect(state.page.openActivityThread).toHaveBeenLastCalledWith('legacy')
})
it('lands team work in its homepage conversation, at the waiting decision, before the team page', async () => {
  state.openTeamWork.mockResolvedValue(true)
  state.api.appGetActivityEntry.mockResolvedValue({ success: true, data: { type: 'escalation', content: { source: { kind: 'team', teamId: 'team', epochId: 'task' } } } })
  await openWorkNotification({ appId: 'person', entryId: 'question' })
  expect(state.openTeamWork).toHaveBeenCalledWith({ teamId: 'team', epochId: 'task', appId: 'person', decisionEntryId: 'question' })
  expect(state.people.teamTarget).toBeUndefined()
  expect(state.navigate).not.toHaveBeenCalled()
  state.api.appGetActivityEntry.mockResolvedValue({ success: true, data: { type: 'output', content: { source: { kind: 'team', teamId: 'team', epochId: 'task' } } } })
  await openWorkNotification({ appId: 'person', entryId: 'report' })
  expect(state.openTeamWork).toHaveBeenLastCalledWith({ teamId: 'team', epochId: 'task', appId: 'person' })
})
it('falls back to the team page when the task cannot be shown on the homepage, and never tries without a task', async () => {
  state.api.appGetActivityEntry.mockResolvedValue({ success: true, data: { type: 'escalation', content: { source: { kind: 'team', teamId: 'team', epochId: 'task' } } } })
  await openWorkNotification({ appId: 'person', entryId: 'question' })
  expect(state.people.teamTarget).toMatchObject({ teamId: 'team', epochId: 'task', decision: true })
  state.openTeamWork.mockClear()
  await openWorkNotification({ appId: 'person', teamId: 'team' })
  expect(state.openTeamWork).not.toHaveBeenCalled()
})
it('remembers the homepage conversation a team page is opened from, and nothing from elsewhere', () => {
  const task = { teamId: 'team', epochId: 'task', appId: 'mine' }
  home.view = 'space'
  home.chat = { currentSpaceId: 'space', spaceStates: new Map([['space', { currentConversationId: 'chat', selectedTeamChat: task, selectedAppChat: null }]]) }
  openPersonTeam({ teamId: 'team' })
  expect(state.people.returnConversation).toEqual({ teamId: 'team', spaceId: 'space', teamChat: task, appChat: null, conversationId: 'chat' })
  home.view = 'apps'
  openPersonTeam({ teamId: 'team' })
  expect(state.people.returnConversation).toBeNull()
})
it('goes back to the conversation as it was left, or selects it again when the homepage moved on', () => {
  const task = { teamId: 'team', epochId: 'task', appId: 'mine', entryId: 'question', decision: true }
  const origin = { teamId: 'team', spaceId: 'space', teamChat: task, appChat: null, conversationId: 'chat' }
  home.chat = { currentSpaceId: 'space', spaceStates: new Map([['space', { currentConversationId: 'chat', selectedTeamChat: task, selectedAppChat: null }]]) }
  returnToConversation(origin)
  expect(state.navigate).toHaveBeenCalledWith('space')
  expect(home.openTeamConversation).not.toHaveBeenCalled()
  expect(state.people.returnConversation).toBeNull()
  expect(state.selectTeam).toHaveBeenCalledWith(null)
  // Another space is on screen now: the task opens again, without re-opening the decision it was reached at.
  home.chat = { currentSpaceId: 'other', spaceStates: new Map() }
  returnToConversation(origin)
  expect(home.openTeamConversation).toHaveBeenCalledWith('space', { teamId: 'team', epochId: 'task', appId: 'mine', entryId: undefined, decision: undefined })
  returnToConversation({ ...origin, teamChat: null, appChat: { appId: 'person', conversationId: 'dm' } })
  expect(home.navigateToAppChat).toHaveBeenCalledWith('space', 'person', 'dm')
  returnToConversation({ ...origin, teamChat: null })
  expect(home.navigateToConversation).toHaveBeenCalledWith('space', 'chat')
})
