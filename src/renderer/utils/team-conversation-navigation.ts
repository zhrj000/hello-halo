import { api } from '../api'
import i18n from '../i18n'
import { useAppStore } from '../stores/app.store'
import { useCollabMemberViewStore } from '../stores/collab-member-view.store'
import { navigateToConversation } from './conversation-navigation'
import { useChatStore, type TeamChatTarget } from '../stores/chat.store'
import { useNotificationStore } from '../stores/notification.store'
import { useSpaceStore } from '../stores/space.store'
import { useTeamChatHiddenStore } from '../stores/team-chat-hidden.store'
import { teamTaskKey } from '../stores/team-chat-pins.store'
import type { TeamDetail } from '../../shared/apps/team-types'

/** Opens a task on the homepage; false when its space is not on this computer. */
function tryOpenTeamConversation(spaceId: string, target: TeamChatTarget): boolean {
  const spaces = useSpaceStore.getState()
  const space = spaces.currentSpace?.id === spaceId ? spaces.currentSpace
    : spaces.haloSpace?.id === spaceId ? spaces.haloSpace
      : spaces.spaces.find(item => item.id === spaceId)
  if (!space) {
    console.warn('[TeamNavigation] Local space unavailable', { spaceId, teamId: target.teamId })
    return false
  }
  if (target.epochId) useTeamChatHiddenStore.getState().restore(spaceId, teamTaskKey(target.teamId, target.epochId))
  useChatStore.getState().selectTeamConversation(spaceId, target)
  spaces.setCurrentSpace(space)
  useAppStore.getState().navigate('space')
  return true
}

/**
 * Opens a task without creating it or changing its execution context. A space
 * that is not on this computer says so, rather than leaving the button dead.
 */
export function openTeamConversation(spaceId: string, target: TeamChatTarget): boolean {
  const opened = tryOpenTeamConversation(spaceId, target)
  if (!opened) {
    useNotificationStore.getState().show({
      title: i18n.t('Could not open this conversation.'),
      body: i18n.t('Its space is not on this computer.'),
      variant: 'error',
      duration: 6000,
    })
  }
  return opened
}

export function localTeamSpace(detail: TeamDetail): string | null {
  if (!detail.team.hostNodeId) return detail.team.owningSpaceId
  const spaces = useSpaceStore.getState()
  const local = detail.roster.filter(member => member.sameMachine !== false && member.spaceId)
  return local.find(member => member.spaceId === spaces.currentSpace?.id)?.spaceId ?? local[0]?.spaceId ?? null
}

export interface TeamWorkTarget {
  teamId: string
  epochId: string
  /** The member who asked or reported; the conversation opens on them. */
  appId?: string
  /** A waiting decision to scroll to and focus. */
  decisionEntryId?: string
}

/**
 * Lands on a team task where it is handled: its homepage conversation, in the
 * space it lives in, on the member concerned and at their waiting decision.
 * False when it cannot be shown there (a temporary collaboration, which lives in
 * its own conversation, or a team or space not on this computer), so the
 * caller can fall back to the team page.
 */
export async function openTeamWork(target: TeamWorkTarget, loaded?: TeamDetail): Promise<boolean> {
  try {
    let detail = loaded
    if (!detail) {
      const result = await api.teamGetDetail(target.teamId)
      if (!result.success || !result.data) return false
      detail = result.data as TeamDetail
    }
    if (detail.team.ephemeral) return openCollabWork(detail, target)
    const spaceId = localTeamSpace(detail)
    if (!spaceId) return false
    return tryOpenTeamConversation(spaceId, {
      teamId: target.teamId,
      epochId: target.epochId,
      teamName: detail.team.name,
      ...(target.appId ? { appId: target.appId } : {}),
      ...(target.decisionEntryId ? { entryId: target.decisionEntryId, decision: true, revealSeq: Date.now() } : {}),
    })
  } catch (error) {
    console.warn('[TeamNavigation] Team task could not be opened on the homepage', { teamId: target.teamId, epochId: target.epochId, error })
    return false
  }
}

/**
 * A temporary collaboration's work lives in the conversation that leads it: open
 * that conversation, on the member who asked or reported, at their question when
 * there is one. False when that conversation is not on this computer.
 */
export function openCollabWork(detail: TeamDetail, target: Pick<TeamWorkTarget, 'appId' | 'decisionEntryId'>): boolean {
  const conversationId = detail.team.coordinatorConversationId
  const spaceId = detail.team.owningSpaceId
  if (!conversationId || !spaceId) return false
  const spaces = useSpaceStore.getState()
  if (spaces.haloSpace?.id !== spaceId && !spaces.spaces.some(space => space.id === spaceId)) return false
  const member = target.appId && detail.roster.some(row => row.appId === target.appId) ? target.appId : null
  if (member) {
    useCollabMemberViewStore.getState().open(conversationId, member,
      target.decisionEntryId ? { entryId: target.decisionEntryId, seq: Date.now() } : undefined)
  } else useCollabMemberViewStore.getState().close()
  navigateToConversation(spaceId, conversationId)
  return true
}

/**
 * A team task from the task panel: its homepage conversation, at the decision
 * waiting there when there is one; the space the panel listed it in when the
 * team cannot be read.
 */
export async function openTeamTask(target: { teamId: string; epochId: string; spaceId: string | null; label?: string; teamName?: string }): Promise<boolean> {
  try {
    const result = await api.teamGetDetail(target.teamId)
    if (result.success && result.data) {
      const detail = result.data as TeamDetail
      const decision = detail.pendingEscalations?.find(item => item.epochId === target.epochId)
      if (await openTeamWork({ teamId: target.teamId, epochId: target.epochId, ...(decision ? { appId: decision.appId, decisionEntryId: decision.entryId } : {}) }, detail)) return true
    }
  } catch (error) {
    console.warn('[TeamNavigation] Team could not be read for its task', { teamId: target.teamId, error })
  }
  return target.spaceId ? openTeamConversation(target.spaceId, { teamId: target.teamId, epochId: target.epochId, label: target.label, teamName: target.teamName }) : false
}

/** Whether this task is the conversation on screen right now. */
export function isViewingTeamTask(teamId: string, epochId: string): boolean {
  if (useAppStore.getState().view !== 'space') return false
  const chat = useChatStore.getState()
  const selected = chat.spaceStates.get(chat.currentSpaceId ?? '')?.selectedTeamChat
  return selected?.teamId === teamId && selected.epochId === epochId
}
