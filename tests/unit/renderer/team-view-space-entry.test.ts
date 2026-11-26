/**
 * A temporary collaboration opened on its own shows its one task's team progress
 * (keep-as-team included); its members are talked to in the conversation that
 * leads it. Every other team shows its team page, wherever it is opened from;
 * only a legacy-coordinated team, waiting to be repaired, keeps the old workbench.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.stubGlobal('window', { innerWidth: 1600, addEventListener: () => {}, removeEventListener: () => {} })

const view = vi.hoisted(() => ({
  conversations: [
    { epochId: 'room', kind: 'collab' },
    { epochId: 'standalone', kind: 'native' },
  ],
  conversationsError: null,
  isLoadingConversations: false,
  selectedConversationId: 'standalone' as string | null,
  board: null as any,
}))

vi.mock('../../../src/renderer/i18n', () => ({ useTranslation: () => ({ t: (text: string) => text }) }))
vi.mock('../../../src/renderer/stores/team.store', () => ({
  useTeamStore: { getState: () => ({}) },
  useTeamView: (select: (v: typeof view) => unknown) => select(view),
  useSelectTeamTask: () => () => {},
}))
vi.mock('../../../src/renderer/stores/apps-page.store', () => ({ useAppsPageStore: { getState: () => ({}) } }))
vi.mock('../../../src/renderer/stores/people-view.store', () => ({
  usePeopleViewStore: Object.assign((select: (s: unknown) => unknown) => select({ teamTarget: null }), { setState: () => {} }),
}))
vi.mock('../../../src/renderer/stores/apps.store', () => ({
  useAppsStore: (select: (s: unknown) => unknown) => select({ apps: [] }),
}))
vi.mock('../../../src/renderer/stores/team-view-prefs.store', () => ({
  useDefaultChatTarget: () => null,
  useTeamViewPrefsStore: Object.assign((select: (s: unknown) => unknown) => select({ setTaskGroup: () => {}, setDefaultMember: () => {} }), { getState: () => ({}) }),
}))
vi.mock('../../../src/renderer/components/ui/Popover', () => ({ Popover: () => null, PopoverTrigger: () => null, PopoverContent: () => null }))
vi.mock('../../../src/renderer/components/team/SettingsTab', () => ({ SettingsTab: () => null }))
vi.mock('../../../src/renderer/components/team/TeamInviteDialog', () => ({ TeamInviteDialog: () => null }))
vi.mock('../../../src/renderer/components/team/workbench/TaskSidebar', async () => {
  const { createElement } = await import('react')
  return { TaskSidebar: () => createElement('nav', { 'data-task-sidebar': true }) }
})
vi.mock('../../../src/renderer/components/team/workbench/TaskRoom', async () => {
  const { createElement } = await import('react')
  return { TaskRoom: (props: { task: { epochId: string } | null; detail: { roster: Array<{ appId: string }> }; selectedAppId?: string }) => createElement('main', { 'data-room': props.task?.epochId ?? 'new', 'data-participants': props.detail.roster.map(member => member.appId).join(','), 'data-selected': props.selectedAppId }) }
})
vi.mock('../../../src/renderer/components/team/workbench/MemberRail', async () => {
  const { createElement } = await import('react')
  return { MemberRail: () => createElement('aside', { 'data-member-rail': true }) }
})
vi.mock('../../../src/renderer/components/team/detail/TeamDetailPage', async () => {
  const { createElement } = await import('react')
  return { TeamDetailPage: () => createElement('section', { 'data-team-page': true }) }
})
vi.mock('../../../src/renderer/utils/people-navigation', () => ({ openPersonTeam: () => {} }))
vi.mock('../../../src/renderer/components/team/TeamTaskProgress', async () => {
  const { createElement } = await import('react')
  return { TeamTaskProgress: (props: { epochId: string }) => createElement('section', { 'data-progress': props.epochId }) }
})
vi.mock('../../../src/renderer/components/team/workbench/TeamActivityDrawer', () => ({ TeamActivityDrawer: () => null }))
vi.mock('../../../src/renderer/components/team/workbench/WorkbenchDrawer', () => ({ WorkbenchDrawer: () => null }))
vi.mock('../../../src/renderer/components/team/workbench/useTaskBoard', () => ({ useTaskBoard: () => ({ board: view.board, activities: [], failed: false, retry: () => {} }) }))
vi.mock('../../../src/renderer/components/team/workbench/model', () => ({
  taskGroup: () => 'mine',
  visibleTasks: (tasks: unknown[]) => tasks,
}))

const { TeamView } = await import('../../../src/renderer/components/team/TeamView')

const detail = (team: { ephemeral?: boolean; coordinatorConversationId?: string | null; savedTeamId?: string }, legacyCoordinator = false) => ({
  team: { id: 'team', name: 'Crew', goal: '', hostNodeId: null, ...team },
  members: [], roster: [], pendingEscalations: [], ...(legacyCoordinator ? { legacyCoordinator: true } : {}),
}) as never

const render = (team: Parameters<typeof detail>[0], spaceEntry: boolean, legacyCoordinator = false) =>
  renderToStaticMarkup(createElement(TeamView, { detail: detail(team, legacyCoordinator), spaceEntry }))

// The team page loads on first use: render to start it, and wait until it is in. A
// busy run can take more than one tick, so this waits for the page, not for a tick.
for (let waited = 0; !render({ ephemeral: false, coordinatorConversationId: null }, false).includes('data-team-page') && waited < 2000; waited += 10) {
  await new Promise(resolve => setTimeout(resolve, 10))
}

describe('team view opened from a space conversation', () => {
  it('shows a temporary collaboration as its task progress, never the old room', () => {
    for (const spaceEntry of [true, false]) {
      for (const savedTeamId of [undefined, 'saved']) {
        const html = render({ ephemeral: true, coordinatorConversationId: 'conv', savedTeamId }, spaceEntry)
        expect(html).toContain('data-progress="room"')
        expect(html).not.toContain('data-room=')
        expect(html).not.toContain('data-team-page')
      }
    }
    // On the Teams page it can go back to the list; in the canvas the tab closes instead.
    expect(render({ ephemeral: true, coordinatorConversationId: 'conv' }, false)).toContain('Back to teams')
    expect(render({ ephemeral: true, coordinatorConversationId: 'conv' }, true)).not.toContain('Back to teams')
  })

  it('shows a kept team still bound to its conversation as its team page, from the canvas too', () => {
    const html = render({ ephemeral: false, coordinatorConversationId: 'conv' }, true)
    expect(html).toContain('data-team-page')
    expect(html).not.toContain('data-room=')
  })

  it('shows a team that no space conversation coordinates as its team page', () => {
    const html = render({ ephemeral: false, coordinatorConversationId: null }, true)
    expect(html).toContain('data-team-page')
    expect(html).not.toContain('data-room=')
    expect(html).not.toContain('data-task-sidebar')
  })

  it('shows a kept collaboration as its team page on the Teams page', () => {
    const html = render({ ephemeral: false, coordinatorConversationId: 'conv' }, false)
    expect(html).toContain('data-team-page')
    expect(html).not.toContain('data-room=')
  })

  it('keeps the full workbench for a team still run by a legacy coordinator', () => {
    const html = render({ ephemeral: false, coordinatorConversationId: null }, false, true)
    expect(html).not.toContain('data-team-page')
    expect(html).toContain('data-room="standalone"')
    expect(html).toContain('data-task-sidebar')
    expect(html).toContain('Team settings')
  })
})


it('projects the selected work participants into the room on desktop and narrow screens without exposing an empty goal', () => {
  const member = { appId: 'temporary', memberName: 'Investigator', isLead: false, isTemporary: true }
  view.board = { epoch: { id: 'standalone', teamId: 'team' }, members: [member], roster: [{ ...member, spaceId: 'space', sameMachine: true }] }
  try {
    for (const width of [1600, 375]) {
      vi.stubGlobal('window', { innerWidth: width, addEventListener: () => {}, removeEventListener: () => {} })
      const html = render({ ephemeral: false }, false, true)
      expect(html).toContain('data-participants="temporary"')
      expect(html).toContain('data-selected="temporary"')
      expect(html).not.toContain('View team goal')
      expect(html).toContain('aria-label="Members"')
    }
  } finally {
    view.board = null
    vi.stubGlobal('window', { innerWidth: 1600, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
