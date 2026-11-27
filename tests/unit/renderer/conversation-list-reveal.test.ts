/**
 * The conversation list follows the open conversation: one opened from
 * elsewhere (a conversation link, search, a notification, another space) is
 * scrolled into view below the sticky section heading — shown even when it
 * sits past "More", in a section or group the list opens for the moment, or as
 * its dot on the icon strip. A row picked in the list itself never moves it,
 * and once reached a row is not chased again when the list reorders.
 *
 * No DOM here: React's hooks are replaced by a small runner that also runs
 * effects, the scrolling column is a stand-in whose rows are the `data-row-key`
 * lines of the latest render, and the returned element tree is searched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => {
  const items = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) }, removeItem: (key: string) => { items.delete(key) } },
  })
  return { mount: null as any, chat: null as any, rows: [] as any[], tree: null as any, team: { tasks: [] as any[], teams: [] as any[] }, statuses: new Map<string, string>() }
})
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (value: any) => env.mount.state(value),
  useRef: (value: any) => env.mount.ref(value),
  useMemo: (compute: any) => compute(),
  useCallback: (fn: any) => fn,
  useEffect: (run: any, deps?: unknown[]) => env.mount.effect(run, deps),
  useLayoutEffect: (run: any, deps?: unknown[]) => env.mount.effect(run, deps),
}))
vi.mock('zustand/react/shallow', () => ({ useShallow: (select: any) => select }))
vi.mock('../../../src/renderer/api', () => ({ api: {} }))
vi.mock('../../../src/renderer/i18n', () => ({ useTranslation: () => ({ t: (text: string) => text }) }))
vi.mock('../../../src/renderer/stores/team-chat-seen.store', async original => ({ ...await original<typeof import('../../../src/renderer/stores/team-chat-seen.store')>(), useTeamChatSeenStore: (select: any) => select({ seen: {}, since: 1000, markSeen: () => {} }) }))
vi.mock('../../../src/renderer/stores/apps-page.store', () => ({ useAppsPageStore: { getState: () => ({ setShowInstallDialog: () => {} }) } }))
vi.mock('../../../src/renderer/stores/chat.store', () => ({
  useChatStore: Object.assign((select: any) => select(env.chat), { getState: () => env.chat }),
  useAllConversationStatuses: () => env.statuses,
}))
vi.mock('../../../src/renderer/stores/apps.store', () => ({ useAppsStore: (select: any) => select({ appStates: {} }) }))
vi.mock('../../../src/renderer/stores/space.store', () => ({ useSpaceStore: { getState: () => ({ currentSpace: { id: env.chat.currentSpaceId } }) } }))
vi.mock('../../../src/renderer/stores/app.store', () => ({ useAppStore: Object.assign((select: any) => select({ config: null }), { getState: () => ({ config: null }) }) }))
vi.mock('../../../src/renderer/stores/app-chat-pins.store', () => ({ useAppChatPinsStore: (select: any) => select({ toggleAppChatPin: vi.fn() }) }))
// The real preference store, read the way its hook reads it.
vi.mock('../../../src/renderer/stores/conversation-list-prefs.store', async original => {
  const actual = await original<typeof import('../../../src/renderer/stores/conversation-list-prefs.store')>()
  const store = actual.useConversationListPrefs
  return { ...actual, useConversationListPrefs: Object.assign((select: any) => select(store.getState()), store) }
})
vi.mock('../../../src/renderer/hooks/useAppChatConversationRows', () => ({ useAppChatConversationRows: () => env.rows }))
vi.mock('../../../src/renderer/hooks/useTeamConversationRows', async original => ({
  ...await original<typeof import('../../../src/renderer/hooks/useTeamConversationRows')>(),
  useTeamConversationRows: () => ({ tasks: env.team.tasks, teams: env.team.teams, pins: [], hidden: {}, error: false, cursor: null, loadMore: () => {}, refresh: () => {} }),
}))
vi.mock('../../../src/renderer/components/apps/AutomationAvatar', () => ({ AutomationAvatar: () => null }))
vi.mock('../../../src/renderer/services/home-telemetry', () => ({ markEntry: vi.fn(), trackHome: vi.fn(), trackNavigate: vi.fn() }))
vi.mock('../../../src/renderer/utils/conversation-navigation', () => ({ openDigitalHumanChat: vi.fn() }))
vi.mock('../../../src/renderer/utils/people-navigation', () => ({ openPersonActivity: vi.fn(), openPersonTeam: vi.fn() }))

import { ConversationList } from '../../../src/renderer/components/chat/ConversationList'
import { planReveal, STICKY_HEADING_PX } from '../../../src/renderer/components/chat/conversation-list-reveal'
import { useConversationListPrefs } from '../../../src/renderer/stores/conversation-list-prefs.store'

/** One mounted list: its hook state lives here, and its effects run after each render. */
class Mount {
  private slots: any[] = []
  private index = 0
  private queued: Array<() => void> = []

  state(initial: any) {
    const index = this.index++
    if (!(index in this.slots)) this.slots[index] = { value: typeof initial === 'function' ? initial() : initial }
    const slot = this.slots[index]
    return [slot.value, (update: any) => { slot.value = typeof update === 'function' ? update(slot.value) : update }]
  }

  ref(initial: any) {
    const index = this.index++
    this.slots[index] ??= { current: initial }
    return this.slots[index]
  }

  effect(run: () => void | (() => void), deps?: unknown[]) {
    const index = this.index++
    const previous = this.slots[index]
    if (previous && deps && previous.deps?.length === deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
    const slot = { deps, cleanup: undefined as void | (() => void) }
    this.slots[index] = slot
    this.queued.push(() => {
      if (typeof previous?.cleanup === 'function') previous.cleanup()
      slot.cleanup = run()
    })
  }

  render(): any {
    this.index = 0
    env.mount = this
    const tree = (ConversationList as unknown as { type: (props: object) => unknown }).type({})
    // Effects see the rows this render drew, as they would in the DOM.
    env.tree = tree
    const queued = this.queued
    this.queued = []
    for (const run of queued) run()
    return tree
  }

  /** Renders until state set by effects (a section opened for the moment) has settled. */
  settle(): any {
    let tree = this.render()
    for (let i = 0; i < 3; i++) tree = this.render()
    return tree
  }
}

/** Every element in the tree, without rendering child components. */
/** A list row as drawn: memoized rows are rendered once (they hold no state of their own). */
const drawnRow = (el: any) => (el?.type?.type ? el.type.type(el.props) : el)
function nodes(tree: any): any[] { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] }

const ROW = 32
/** Keys of the rows the list draws, in order. */
const drawnKeys = (tree: any): string[] => nodes(tree).filter(node => node.props?.['data-row-key']).map(node => node.props['data-row-key'])

/**
 * A stand-in for the scrolling column: `height` px tall, its rows 32px each
 * under a 40px heading, laid out from the latest render.
 */
function column(height = 100) {
  const box = { top: 0, bottom: height }
  const el: any = {
    scrollTop: 0,
    getBoundingClientRect: () => box,
    querySelectorAll: () => drawnKeys(env.tree).map((key, i) => ({
      dataset: { rowKey: key },
      getBoundingClientRect: () => ({ top: 40 + i * ROW - el.scrollTop, bottom: 40 + (i + 1) * ROW - el.scrollTop }),
    })),
  }
  return el
}

/** Puts the stand-in column under the list's scroller ref. */
function attach(tree: any, height?: number) {
  const scroller = nodes(tree).find(node => node.ref && typeof node.ref === 'object' && 'current' in node.ref && /overflow-y-auto/.test(node.props.className ?? '') && 'data-fill-pane' in node.props)
  if (!scroller) throw new Error('The list column is not drawn')
  const el = column(height)
  scroller.ref.current = el
  return el
}

/** Where `key` sits in the column now, or undefined when not drawn. */
function placed(el: any, key: string) {
  const row = el.querySelectorAll().find((item: any) => item.dataset.rowKey === key)
  return row?.getBoundingClientRect()
}

/** In full view under the sticky heading. */
function inView(el: any, key: string) {
  const rect = placed(el, key)
  return !!rect && rect.top >= STICKY_HEADING_PX && rect.bottom <= el.getBoundingClientRect().bottom
}

const conversation = (id: string, starred = false) => ({ id, spaceId: 's1', title: `Title ${id}`, updatedAt: '2026-11-01T00:00:00.000Z', starred })
/** Forty conversations, newest first. */
const archive = (space = 's1', prefix = 'c') => Array.from({ length: 40 }, (_, i) => ({ ...conversation(`${prefix}${String(i).padStart(2, '0')}`), spaceId: space }))

function spaceState(conversations: any[], current: string | null, selectedAppChat: any = null, selectedTeamChat: any = null) {
  return { conversations, currentConversationId: current, selectedAppChat, selectedTeamChat }
}

/** Opens `id` the way a link or another surface does: only the store's pointer moves. */
function openElsewhere(id: string) {
  const state = env.chat.spaceStates.get(env.chat.currentSpaceId)
  env.chat.spaceStates.set(env.chat.currentSpaceId, { ...state, currentConversationId: id, selectedAppChat: null, selectedTeamChat: null })
}

function dhRow(appId: string, id: string, updatedAt = 1) {
  return { id, appId, appSpaceId: 's1', digitalHumanName: appId, isDefault: false, displayName: id, updatedAt, messageCount: 2, starred: false, status: 'active', uninstalled: false }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0)
  env.rows = []
  env.statuses = new Map()
  env.team = { tasks: [], teams: [] }
  env.chat = {
    currentSpaceId: 's1',
    spaceStates: new Map([['s1', spaceState(archive(), 'c00')]]),
    selectConversation: vi.fn((id: string) => openElsewhere(id)),
  }
  useConversationListPrefs.setState({ sectionOpen: {}, appGroupOpen: {}, shown: {}, listFolded: {} })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('planReveal', () => {
  const rows = (...keys: string[]) => keys.map(key => ({ key }))
  const panes = (open = { pinned: true, teams: true, 'digital-humans': true, conversations: true }) => ({
    pinned: { rows: rows('p1', 'p2'), open: open.pinned },
    teams: { rows: rows('team:t', 'team:t:e1'), open: open.teams },
    'digital-humans': { rows: rows('dh-header:a', 'd1'), open: open['digital-humans'] },
    conversations: { rows: rows('c1', 'c2', 'c3'), open: open.conversations },
  })

  it('finds the row by id in the section that draws it', () => {
    expect(planReveal('c3', panes(), null)).toEqual({ type: 'row', section: 'conversations', index: 2 })
    expect(planReveal('p2', panes(), null)).toEqual({ type: 'row', section: 'pinned', index: 1 })
    expect(planReveal('team:t:e1', panes(), null)).toEqual({ type: 'row', section: 'teams', index: 1 })
    expect(planReveal('d1', panes(), null)).toEqual({ type: 'row', section: 'digital-humans', index: 1 })
  })

  it('opens a folded section first', () => {
    expect(planReveal('team:t:e1', panes({ pinned: true, teams: false, 'digital-humans': true, conversations: true }), null))
      .toEqual({ type: 'open', section: 'teams' })
  })

  it('aims at the dot when the list is folded to its strip', () => {
    expect(planReveal('c2', panes(), rows('p1', 'p2', 'c1', 'c2'))).toEqual({ type: 'dot', index: 3 })
  })

  it('waits while the conversation is not drawn', () => {
    expect(planReveal('missing', panes(), null)).toBeNull()
    expect(planReveal('d9', panes(), null)).toBeNull()
  })
})

describe('the open conversation in the list', () => {
  it('shows the first ten conversations and the open one past them, scrolled below the sticky heading', () => {
    const list = new Mount()
    const el = attach(list.render())
    expect(drawnKeys(env.tree)).toEqual(['c00', 'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'more:conversations'])

    openElsewhere('c35')
    list.render()
    // The open one takes the tenth place, so the count holds.
    expect(drawnKeys(env.tree)).toEqual(['c00', 'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c35', 'more:conversations'])
    expect(inView(el, 'c35')).toBe(true)
    expect(el.scrollTop).toBeGreaterThan(0)
  })

  it('is not chased again when the list reorders after it was reached', () => {
    const list = new Mount()
    const el = attach(list.render())
    openElsewhere('c35')
    list.render()
    const reached = el.scrollTop

    el.scrollTop = 0
    const state = env.chat.spaceStates.get('s1')
    const moved = state.conversations.find((conv: any) => conv.id === 'c35')
    env.chat.spaceStates.set('s1', { ...state, conversations: [moved, ...state.conversations.filter((conv: any) => conv !== moved)] })
    list.render()
    expect(reached).toBeGreaterThan(0)
    expect(el.scrollTop).toBe(0)
  })

  it('leaves the list still when the row was picked in the list itself', () => {
    const list = new Mount()
    const tree = list.render()
    const el = attach(tree)
    el.scrollTop = 0
    const line = nodes(tree).find(node => node.props?.['data-row-key'] === 'c04')
    drawnRow(line.props.children).props.onClick()
    expect(env.chat.selectConversation).toHaveBeenCalledWith('c04')
    list.render()
    expect(el.scrollTop).toBe(0)
  })

  it('waits for a conversation the list does not hold yet, then reaches it', () => {
    const list = new Mount()
    const el = attach(list.render())
    openElsewhere('fresh')
    list.render()
    expect(el.scrollTop).toBe(0)

    const state = env.chat.spaceStates.get('s1')
    env.chat.spaceStates.set('s1', { ...state, conversations: [...state.conversations, conversation('fresh')] })
    list.render()
    expect(inView(el, 'fresh')).toBe(true)
  })

  it('opens a folded section for the moment, without saving it as the user\'s choice', () => {
    useConversationListPrefs.getState().setSectionOpen('s1', 'conversations', false)
    openElsewhere('c20')
    const list = new Mount()
    const tree = list.settle()
    expect(nodes(tree).find(node => node.props?.section === 'conversations').props.collapsed).toBe(false)
    expect(drawnKeys(tree)).toContain('c20')
    expect(useConversationListPrefs.getState().sectionOpen).toEqual({ s1: { conversations: false } })

    // The user's own fold still wins once they use the header.
    nodes(list.render()).find(node => node.props?.section === 'conversations').props.onToggle('conversations')
    expect(nodes(list.render()).find(node => node.props?.section === 'conversations').props.collapsed).toBe(true)
  })

  it('reaches a digital human\'s conversation in a folded group, leaving the saved folds alone', () => {
    env.rows = [dhRow('dh1', 'app-chat:dh1:local:direct:c1', 2), dhRow('dh1', 'app-chat:dh1:local:direct:c2', 1), dhRow('dh2', 'app-chat:dh2:local:direct:c3')]
    useConversationListPrefs.getState().setAppGroupOpen('s1', 'dh1', false)
    const list = new Mount()
    list.render()

    const state = env.chat.spaceStates.get('s1')
    env.chat.spaceStates.set('s1', { ...state, selectedAppChat: { appId: 'dh1', conversationId: 'app-chat:dh1:local:direct:c2' } })
    const tree = list.settle()
    expect(drawnKeys(tree)).toContain('app-chat:dh1:local:direct:c2')
    expect(useConversationListPrefs.getState().appGroupOpen).toEqual({ s1: { dh1: false } })
    expect(useConversationListPrefs.getState().sectionOpen).toEqual({})
  })

  it('reaches a team task opened from a notification, opening its folded group for the moment', () => {
    env.team.teams = [{ id: 'crew', name: 'Crew' }]
    env.team.tasks = Array.from({ length: 8 }, (_, i) => ({ epochId: `e${i}`, teamId: 'crew', spaceId: 's1', teamName: 'Crew', kind: 'native', label: `Task ${i}`, readonly: false, startedAt: 1, lastActivityAt: 100 - i }))
    useConversationListPrefs.getState().setAppGroupOpen('s1', 'team:crew', false)
    const list = new Mount()
    const el = attach(list.render(), 120)

    const state = env.chat.spaceStates.get('s1')
    env.chat.spaceStates.set('s1', { ...state, selectedTeamChat: { teamId: 'crew', epochId: 'e7', teamName: 'Crew' } })
    list.settle()
    expect(drawnKeys(env.tree)).toContain('team:crew:e7')
    expect(inView(el, 'team:crew:e7')).toBe(true)
    expect(useConversationListPrefs.getState().appGroupOpen).toEqual({ s1: { 'team:crew': false } })
  })

  it('keeps a section folded after leaving the page and coming back', () => {
    env.team.teams = [{ id: 'back', name: 'Back' }]
    env.team.tasks = [{ epochId: 'b1', teamId: 'back', spaceId: 's1', teamName: 'Back', kind: 'native', label: 'Task', readonly: false, startedAt: 1, lastActivityAt: 1 }]
    useConversationListPrefs.getState().setSectionOpen('s1', 'conversations', false)
    const state = env.chat.spaceStates.get('s1')
    env.chat.spaceStates.set('s1', { ...state, currentConversationId: 'c20', selectedTeamChat: { teamId: 'back', epochId: 'b1', teamName: 'Back' } })
    const section = (tree: any, name: string) => nodes(tree).find(node => node.props?.section === name)
    // Opened from elsewhere: both its sections open for the moment.
    let tree = new Mount().settle()
    expect(section(tree, 'teams').props.collapsed).toBe(false)

    // The person folds teams, the list leaves the screen and comes back.
    section(tree, 'teams').props.onToggle('teams')
    tree = new Mount().settle()
    expect(section(tree, 'teams').props.collapsed).toBe(true)
    expect(section(tree, 'conversations').props.collapsed).toBe(false)
  })

  it('is reached in another space after the switch', () => {
    const list = new Mount()
    const el = attach(list.render())
    env.chat.spaceStates.set('s2', spaceState(archive('s2', 'd'), null))
    env.chat.currentSpaceId = 's2'
    list.render()
    openElsewhere('d25')
    list.render()
    expect(inView(el, 'd25')).toBe(true)
  })

  it('scrolls the dot into view on the icon strip and leaves the list folded', () => {
    useConversationListPrefs.getState().setListFolded('without-canvas', true)
    const list = new Mount()
    const tree = list.render()
    const strip = nodes(tree).find(node => node.ref && typeof node.ref === 'object' && 'current' in node.ref && /overflow-y-auto/.test(node.props.className))
    const dots = Array.from({ length: 10 }, (_, i) => ({ getBoundingClientRect: () => ({ top: 40 + i * 26 - stripColumn.scrollTop, bottom: 64 + i * 26 - stripColumn.scrollTop }) }))
    const stripColumn = { scrollTop: 0, children: dots, getBoundingClientRect: () => ({ top: 40, bottom: 100 }) }
    strip.ref.current = stripColumn

    openElsewhere('c35')
    const folded = list.render()
    // The strip shows the open list's rows: c00–c08 and the open c35, dot 9, ending at 64 + 9 * 26 = 298.
    expect(stripColumn.scrollTop).toBe(298 - 100)
    expect(nodes(folded).some(node => /(^|\s)w-14(\s|$)/.test(node.props?.className ?? ''))).toBe(true)
    expect(nodes(folded).find(node => node.key === 'c35').props['aria-current']).toBe(true)
  })
})

describe('"More"', () => {
  it('opens a list further, keeps that for the space, and goes back to the first few', () => {
    const list = new Mount()
    const more = () => nodes(env.tree).find(node => node.props?.['data-row-key'] === 'more:conversations').props.children
    list.render()
    more().props.onClick()
    list.render()
    expect(drawnKeys(env.tree).filter(key => key.startsWith('c'))).toHaveLength(30)
    expect(useConversationListPrefs.getState().shown).toEqual({ s1: { conversations: 30 } })
    more().props.onClick()
    list.render()
    expect(drawnKeys(env.tree).filter(key => key.startsWith('c'))).toHaveLength(40)
    // Everything shown: the line now goes back.
    expect(more().props.children).toBe('Show less')
    more().props.onClick()
    list.render()
    expect(drawnKeys(env.tree).filter(key => key.startsWith('c'))).toHaveLength(10)
  })
})

describe('what needs the person', () => {
  it('comes first in its list, says why at the end of the row, and keeps its place while open until something else is opened', () => {
    env.statuses = new Map([['c30', 'completed-unseen'], ['c20', 'waiting']])
    const list = new Mount()
    list.render()
    const conversationKeys = () => drawnKeys(env.tree).filter(key => key.startsWith('c'))
    expect(conversationKeys()).toEqual(['c20', 'c30', 'c00', 'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07'])

    // Opened from the list: the finish is seen, but the row stays where it was clicked.
    const line = nodes(env.tree).find(node => node.props?.['data-row-key'] === 'c30')
    drawnRow(line.props.children).props.onClick()
    env.statuses = new Map([['c20', 'waiting']])
    list.render()
    list.render()
    expect(conversationKeys()).toEqual(['c20', 'c30', 'c00', 'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07'])

    // Something else opened: it goes back to its place by time.
    const other = nodes(env.tree).find(node => node.props?.['data-row-key'] === 'c01')
    drawnRow(other.props.children).props.onClick()
    list.render()
    list.render()
    expect(conversationKeys()).toEqual(['c20', 'c00', 'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08'])
  })

  it('puts a team with a question first in its section and opens it', () => {
    env.team.teams = [{ id: 'quiet', name: 'Quiet' }, { id: 'asking', name: 'Asking' }]
    env.team.tasks = [
      { epochId: 'q1', teamId: 'quiet', spaceId: 's1', teamName: 'Quiet', kind: 'native', label: 'q1', readonly: false, startedAt: 1, lastActivityAt: 3 },
      { epochId: 'a1', teamId: 'asking', spaceId: 's1', teamName: 'Asking', kind: 'native', label: 'a1', readonly: false, startedAt: 1, lastActivityAt: 2, waitingForMe: true },
    ]
    const list = new Mount()
    list.render()
    const keys = drawnKeys(env.tree).filter(key => key.startsWith('team:'))
    expect(keys).toEqual(['team:asking', 'team:asking:a1', 'team:quiet'])
  })
})
