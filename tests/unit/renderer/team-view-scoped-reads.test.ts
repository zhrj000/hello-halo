/**
 * A canvas team tab (a team view other than the Teams page's selection) reads
 * its own team: message-flow signals must not come from whatever team the
 * Teams page has selected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/renderer/api', () => ({
  api: new Proxy({}, { get: () => vi.fn().mockResolvedValue({ success: true, data: [] }) }),
}))
vi.mock('../../../src/renderer/i18n', () => ({ default: { t: (s: string) => s }, useTranslation: () => ({ t: (s: string) => s }) }))

const { useTeamStore } = await import('../../../src/renderer/stores/team.store')

function detail(teamId: string, checks: Array<{ id: string; targetAppId: string }>) {
  return {
    team: { id: teamId, name: teamId },
    members: [], edges: [], roster: [], tasks: [], findings: [], activities: [],
    checks: checks.map((c) => ({ ...c, epochId: 'e1' })),
  }
}

function view(teamId: string, checks: Array<{ id: string; targetAppId: string }>) {
  return {
    detail: detail(teamId, checks), epochs: [], conversations: [], conversationsError: null,
    isLoadingDetail: false, isLoadingConversations: false, selectedConversationId: null, error: null,
  }
}

describe('team view scoped reads', () => {
  beforeEach(() => {
    useTeamStore.setState({
      currentTeamId: 'page-team',
      detail: detail('page-team', [{ id: 'c1', targetAppId: 'm' }, { id: 'c2', targetAppId: 'm' }]) as never,
      views: { 'tab-team': view('tab-team', [{ id: 'c3', targetAppId: 'm' }]) as never },
      activeFlows: [],
    })
  })

  it('a message in a team shown only by a canvas tab animates, tagged with that team', () => {
    useTeamStore.getState().applyTeamMessage({ teamId: 'tab-team', fromAppId: 'a', toAppId: 'b', messageId: 'x', ts: Date.now() } as never)
    useTeamStore.getState().applyTeamMessage({ teamId: 'not-shown', fromAppId: 'a', toAppId: 'b', messageId: 'y', ts: Date.now() } as never)
    expect(useTeamStore.getState().activeFlows.map((f) => [f.id, f.teamId])).toEqual([['x', 'tab-team']])
  })
})
