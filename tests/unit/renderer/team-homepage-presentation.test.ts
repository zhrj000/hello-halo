import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/i18n', () => ({ useTranslation: () => ({ t: (text: string) => text }) }))
vi.mock('../../../src/renderer/api', () => ({ api: {} }))
vi.mock('../../../src/renderer/utils/people-navigation', () => ({ openPersonTeam: vi.fn() }))
vi.mock('../../../src/renderer/components/apps/AutomationAvatar', () => ({ AutomationAvatar: ({ name, size }: any) => createElement('span', { 'data-avatar': name, 'data-size': size }) }))
vi.mock('../../../src/renderer/stores/chat.store', () => ({ useChatStore: (select: any) => select({ spaceStates: new Map(), getSession: () => ({ isGenerating: false }) }) }))
vi.mock('../../../src/renderer/stores/team-chat-pins.store', () => ({ useTeamChatPinsStore: (select: any) => select({ togglePin: () => {} }) }))
vi.mock('../../../src/renderer/utils/team-conversation-navigation', () => ({ openTeamConversation: () => true }))
vi.mock('../../../src/renderer/utils/conversation-navigation', () => ({ navigateToConversation: () => {} }))
vi.mock('../../../src/renderer/stores/team.store', () => ({ useTeamStore: (select: any) => select({ renameConversation: () => {}, openConversation: () => {} }), useMemberPresence: () => ({ reachability: 'online', ownerName: null, isRemote: false }) }))
vi.mock('../../../src/renderer/stores/apps.store', () => ({ useAppsStore: (select: any) => select({ apps: [{ id: 'member', spaceId: 'space' }] }) }))
vi.mock('../../../src/renderer/stores/team-view-prefs.store', () => ({ useTeamViewPrefsStore: (select: any) => select({ setDefaultMember: () => {} }) }))
vi.mock('../../../src/renderer/components/team/workbench/useTaskDecisions', () => ({ useTaskDecisions: () => ({ entries: [] }) }))
vi.mock('../../../src/renderer/components/team/workbench/members', () => ({ ownedTaskMembers: (detail: any) => detail.roster }))
vi.mock('../../../src/renderer/components/team/workbench/TaskMemberSelector', () => ({ TaskMemberSelector: () => null }))
vi.mock('../../../src/renderer/components/team/workbench/TaskConversation', () => ({ TaskConversation: () => null }))
vi.mock('../../../src/renderer/components/team/workbench/ExecutionStatus', () => ({ ExecutionStatus: () => null }))
vi.mock('../../../src/renderer/components/team/TeamSessionChat', () => ({ TeamSessionChat: (props: any) => createElement('div', { 'data-picker': props.toolbarSlot ? 'toolbar' : props.composerAdjacentSlot ? 'composer' : 'none' }, props.emptyContent ?? props.emptyTitle, props.emptyHint) }))

vi.mock('../../../src/renderer/components/references', () => ({ ConversationReferenceScope: ({ children }: any) => children }))
import { TeamConversationRow } from '../../../src/renderer/components/chat/TeamConversationRow'
import { TaskRoom } from '../../../src/renderer/components/team/workbench/TaskRoom'

const detail: any = { team: { id: 'team' }, roster: [{ appId: 'member', memberName: 'Member' }], pendingEscalations: [], tasks: [], findings: [], activities: [] }
const task: any = { teamId: 'team', epochId: 'epoch', label: 'Discussion', kind: 'native' }
const room = (homepageConversation: boolean, selectedTask: any = null) => renderToStaticMarkup(createElement(TaskRoom, {
  homepageConversation, detail, task: selectedTask, selectedAppId: 'member', tasks: [], boardState: { board: null, activities: [], failed: false, retry: () => {} } as any,
  onSelectMember: () => {}, onCreated: () => {}, onActivity: () => {}, onTask: () => {}, onExecution: () => {},
}))
const row = (value: any, compact = false) => renderToStaticMarkup(createElement(TeamConversationRow, {
  row: { avatar: { names: [], overflow: 0 }, ...value }, compact, spaceId: 'space', onToggle: () => {}, onRefresh: () => {},
}))

describe('homepage team conversation presentation', () => {
  it('draws a team as a square grid of up to four member faces, lead first, the same in headers and pins, and only a status mark in the folded list', () => {
    const avatarNames = ['Lead', 'Writer', 'Analyst', 'Researcher']
    const avatar = { names: avatarNames, overflow: 2 }
    const header = row({ type: 'team-header', teamId: 'team', name: 'Crew', collapsed: false, avatar })
    const pin = row({ type: 'team-item', task: { ...task, teamName: 'Crew' }, standalone: true, avatar })
    expect(row({ type: 'team-item', task: { ...task, teamName: 'Crew' }, avatar }, true)).not.toContain('data-avatar=')
    for (const [html, size] of [[header, 20], [pin, 18]] as const) {
      expect(html.match(/data-avatar=/g)).toHaveLength(4)
      for (const name of avatarNames) expect(html).toContain(`data-avatar="${name}"`)
      expect(html.indexOf('data-avatar="Lead"')).toBeLessThan(html.indexOf('data-avatar="Writer"'))
      expect(html).toContain(`width:${size}px;height:${size}px`)
      expect(html).toContain('grid-template-columns:repeat(2,')
      // How many more there are is told elsewhere: no count drawn over a face, no overlap.
      expect(html).not.toContain('+2')
      expect(html).not.toContain('box-shadow')
    }
  })
  it('lays out one face centred, two side by side and three as one over two', () => {
    const header = (names: string[]) => row({ type: 'team-header', teamId: 'team', name: 'Crew', collapsed: false, avatar: { names, overflow: 0 } })
    const one = header(['Lead'])
    expect(one.match(/data-avatar=/g)).toHaveLength(1)
    expect(one).toContain('grid-template-columns:repeat(1,')
    expect(header(['Lead', 'Writer'])).toContain('grid-template-columns:repeat(2,')
    const three = header(['Lead', 'Writer', 'Analyst'])
    expect(three.match(/data-avatar=/g)).toHaveLength(3)
    expect(three).toContain('grid-column:1 / 3')
  })
  it('shows the team initial without faces and keeps the team page behind the avatar alone', () => {
    const fallback = row({ type: 'team-header', teamId: 'team', name: 'Crew', collapsed: false })
    expect(fallback).toContain('>C</span>')
    expect(fallback).not.toContain('data-avatar=')
    expect(fallback.match(/<button/g)).toHaveLength(4)
    expect(fallback).toContain('aria-label="View {{name}}"')
  })
  it('marks a folded team with its most urgent state, and an open one not at all', () => {
    const folded = row({ type: 'team-header', teamId: 'team', name: 'Crew', collapsed: true, attention: 'waiting' })
    expect(folded).toContain('pulse-dot-waiting')
    expect(row({ type: 'team-header', teamId: 'team', name: 'Crew', collapsed: false, attention: 'waiting' })).not.toContain('pulse-dot')
  })
  it('tells the state of a task by its dot alone and keeps the time at the end of the row', () => {
    const at = (status: string) => row({ type: 'team-item', key: 'team:team:epoch', task: { ...task, lastActivityAt: Date.now() }, starred: false, status })
    for (const [status, dot] of [['waiting', 'pulse-dot-waiting'], ['completed-unseen', 'pulse-dot-completed'], ['error', 'pulse-dot-error']]) {
      const html = at(status)
      expect(html).toContain(dot)
      expect(html).toContain('tabular-nums')
      expect(html).not.toMatch(/Needs your reply|>Completed<|>Errored</)
    }
  })
  it('offers an open empty team its first conversation, and archived tasks back', () => {
    expect(row({ type: 'team-empty', key: 'team-empty:team', teamId: 'team', name: 'Crew' })).toContain('Start the first conversation')
    expect(row({ type: 'team-hidden', key: 'team-hidden:team', teamId: 'team', count: 2 })).toContain('Show {{count}} archived')
  })
  it('uses a simple draft while preserving workbench onboarding', () => {
    expect(room(true)).toContain('No messages yet')
    expect(room(true)).not.toContain('Start a new task')
    expect(room(false)).toContain('Start a new task')
  })
  it('labels the homepage room and activity as a conversation only', () => {
    const home = room(true, task)
    expect(home).toContain('aria-label="Conversation"')
    expect(home).not.toContain('Rename conversation')
    expect(home).toContain('data-picker="composer"')
    const workbench = room(false, task)
    expect(workbench).toContain('aria-label="Rename task"')
    expect(workbench).toContain('Task activity')
    expect(workbench).toContain('data-picker="toolbar"')
  })
  it('labels the team plus and keeps task actions behind the row menu', () => {
    expect(row({ type: 'team-header', teamId: 'team', name: 'Crew', collapsed: false })).toContain('aria-label="New team conversation"')
    const html = row({ type: 'team-item', key: 'team:epoch', task, starred: false })
    expect(html).not.toContain('Complete task')
    expect(html).toContain('aria-label="More"')
    expect(html).toContain('aria-label="Pin"')
    expect(html).not.toContain('title="Rename"')
    expect(html).toContain('pl-[38px]')
    const working = row({ type: 'team-item', key: 'team:epoch', task: { ...task, active: true }, starred: false })
    expect(working).toContain('pl-[38px]')
    expect(working).toContain('absolute left-[26px] top-1/2 -translate-y-1/2')
    expect(html).toContain('group-hover:opacity-100')
    expect(html).toContain('[@media(hover:none)]:opacity-100')
    const header = row({ type: 'team-header', teamId: 'team', name: 'Crew', collapsed: false })
    expect(header).toContain('focus-visible:opacity-100')
    expect(header).toContain('[@media(hover:none)]:opacity-100')
  })
})
