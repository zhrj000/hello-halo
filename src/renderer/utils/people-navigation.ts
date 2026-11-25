import { api } from '../api'
import { useAppsStore } from '../stores/apps.store'
import { useAppsPageStore } from '../stores/apps-page.store'
import { useChatStore } from '../stores/chat.store'
import { usePeopleViewStore, type ConversationReturn, type TeamNavigationTarget } from '../stores/people-view.store'
import { useTeamStore } from '../stores/team.store'
import { useAppStore } from '../stores/app.store'
import { navigateToAppChat, navigateToConversation } from './conversation-navigation'
import { openTeamConversation, openTeamWork } from './team-conversation-navigation'

/**
 * Opens a team's page. Opened from the homepage, the conversation on screen is
 * remembered so the page's back arrow returns to it rather than to the team list.
 */
export function openPersonTeam(target: TeamNavigationTarget, returnPerson: string | null = null) {
  usePeopleViewStore.setState({
    teamTarget: target, returnPerson, returnInbox: useAppsPageStore.getState().currentTab === 'inbox', returnTeam: null,
    returnConversation: homepageConversation(target.teamId),
  })
  useTeamStore.getState().selectTeam(target.teamId)
  useAppsPageStore.getState().setCurrentTab('team')
  useAppStore.getState().navigate('apps')
}

/** The conversation selected on the homepage now; null anywhere else. */
function homepageConversation(teamId: string): ConversationReturn | null {
  if (useAppStore.getState().view !== 'space') return null
  const chat = useChatStore.getState()
  const spaceId = chat.currentSpaceId
  if (!spaceId) return null
  const state = chat.spaceStates.get(spaceId)
  return {
    teamId, spaceId,
    teamChat: state?.selectedTeamChat ?? null,
    appChat: state?.selectedAppChat ?? null,
    conversationId: state?.currentConversationId ?? null,
  }
}

/**
 * Back from a team page to the homepage conversation it was opened from. When
 * that conversation is still the one selected there, the homepage is simply shown
 * again, as it was left; otherwise it is selected anew. A waiting decision it was
 * opened at is not reopened: that was a one-off arrival, not where the person was.
 */
export function returnToConversation(origin: ConversationReturn) {
  usePeopleViewStore.setState({ returnConversation: null })
  useTeamStore.getState().selectTeam(null)
  const chat = useChatStore.getState()
  const state = chat.currentSpaceId === origin.spaceId ? chat.spaceStates.get(origin.spaceId) : undefined
  const team = state?.selectedTeamChat ?? null
  const app = state?.selectedAppChat ?? null
  const unchanged = !!state
    && (team?.teamId ?? null) === (origin.teamChat?.teamId ?? null) && (team?.epochId ?? null) === (origin.teamChat?.epochId ?? null)
    && (app?.conversationId ?? null) === (origin.appChat?.conversationId ?? null)
    && (state.currentConversationId ?? null) === origin.conversationId
  if (unchanged) return useAppStore.getState().navigate('space')
  if (origin.teamChat) openTeamConversation(origin.spaceId, { ...origin.teamChat, entryId: undefined, decision: undefined })
  else if (origin.appChat) navigateToAppChat(origin.spaceId, origin.appChat.appId, origin.appChat.conversationId)
  else if (origin.conversationId) navigateToConversation(origin.spaceId, origin.conversationId)
  else useAppStore.getState().navigate('space')
}

export interface WorkNavigationTarget {
  appId: string
  entryId?: string
  teamId?: string
  epochId?: string
  runId?: string
}

export async function openWorkNotification(target: WorkNavigationTarget) {
  let decision: boolean | undefined
  if (target.entryId) {
    try {
      const result = await api.appGetActivityEntry(target.appId, target.entryId)
      if (result.success && result.data) {
        const entry = result.data
        useAppsStore.getState().handleNewActivityEntry(target.appId, entry)
        decision = entry.type === 'escalation'
        target = { ...target, teamId: entry.content.source?.teamId ?? entry.content.teamContext?.teamId ?? target.teamId, epochId: entry.content.source?.epochId ?? entry.content.teamContext?.epochId ?? target.epochId }
      } else console.warn('[PeopleNavigation] Notification record unavailable', { appId: target.appId, entryId: target.entryId, error: result.error })
    } catch (error) { console.warn('[PeopleNavigation] Notification record lookup failed', { appId: target.appId, entryId: target.entryId, error }) }
  }
  // Team work is handled in its homepage conversation; the team page is only
  // where it lands when the task cannot be shown there.
  if (target.teamId && target.epochId && await openTeamWork({
    teamId: target.teamId, epochId: target.epochId, appId: target.appId,
    ...(decision && target.entryId ? { decisionEntryId: target.entryId } : {}),
  })) return
  useAppsPageStore.getState().setInitialAppId(null)
  if (target.teamId) {
    const current = useAppsPageStore.getState()
    openPersonTeam({ teamId: target.teamId, epochId: target.epochId, appId: target.appId, entryId: target.entryId, decision }, current.currentTab === 'my-digital-humans' ? current.selectedAppId : null)
    return
  }
  useAppsPageStore.getState().setCurrentTab('my-digital-humans')
  if (target.entryId) {
    usePeopleViewStore.setState({ focusEntry: { appId: target.appId, entryId: target.entryId } })
    useAppsPageStore.getState().openActivityThread(target.appId)
  } else if (target.runId) useAppsPageStore.getState().openSessionDetail(target.appId, target.runId)
  else useAppsPageStore.getState().openActivityThread(target.appId)
  useAppStore.getState().navigate('apps')
}

/**
 * The navigation entry for the Digital Humans page. Coming from elsewhere it
 * returns to where the page was left (tab and open detail); pressed while
 * already on the page it goes back to the digital-humans tab.
 */
export function openDigitalHumansPage() {
  if (useAppStore.getState().view === 'apps') {
    useAppsPageStore.getState().setCurrentTab('my-digital-humans')
  }
  useAppStore.getState().navigate('apps')
}

/**
 * Open a digital human's page on its activity thread; an uninstalled one opens
 * its reinstall / delete page instead, since it has no thread to show.
 */
export function openPersonActivity(appId: string) {
  const page = useAppsPageStore.getState()
  page.setInitialAppId(null)
  page.setCurrentTab('my-digital-humans')
  if (useAppsStore.getState().apps.find(a => a.id === appId)?.status === 'uninstalled') {
    page.selectApp(appId, 'uninstalled')
  } else {
    page.openActivityThread(appId)
  }
  useAppStore.getState().navigate('apps')
}

/** Open a digital human's settings at its model choice. */
export function openPersonModelSettings(appId: string) {
  useAppsPageStore.getState().setInitialAppId(null)
  useAppsPageStore.getState().setCurrentTab('my-digital-humans')
  useAppsPageStore.getState().openAppConfigAt(appId, 'settings-group-model-capabilities')
  useAppStore.getState().navigate('apps')
}
