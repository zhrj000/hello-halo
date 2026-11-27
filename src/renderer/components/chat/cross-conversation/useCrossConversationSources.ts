/**
 * Where other conversations' deliveries came from, resolved against the live
 * conversation list: a rename shows the current name, and a source that is
 * gone (deleted, or its digital human uninstalled) can no longer be opened.
 */

import { useMemo } from 'react'
import type { Message } from '../../../types'
import { useChatStore } from '../../../stores/chat.store'
import { useAppsStore } from '../../../stores/apps.store'
import { nativeChatAppId, parseRunSenderKey } from '../../../../shared/apps/im-keys'
import { navigateToAppChat, navigateToConversation } from '../../../utils/conversation-navigation'
import { readProvenance } from './message-source'

export interface CrossConversationSource {
  /** The source's current title, or the snapshot taken at delivery once it is gone. */
  title: string
  /** One line the sending AI wrote about the message. */
  summary: string
  /** A scheduled run's one-way notice: nothing to open, nothing to reply to. */
  fromRun: boolean
  /** Opens the source; absent for a run or a source that is gone. */
  open?: () => void
}

const NO_SOURCES: ReadonlyMap<string, CrossConversationSource> = new Map()
const MISSING = '\u0000'
const SEPARATOR = '\u0001'

/** The deliveries among `messages` from other conversations, by message id. */
export function useCrossConversationSources(messages: readonly Message[]): ReadonlyMap<string, CrossConversationSource> {
  const currentSpaceId = useChatStore(s => s.currentSpaceId)
  const apps = useAppsStore(s => s.apps)
  // Space conversations are named by the live list; digital humans' chats and runs are not in it.
  const listed = useMemo(() => [...new Set(messages.flatMap(message => {
    const id = readProvenance(message)?.fromConversationId
    return id && !nativeChatAppId(id) && parseRunSenderKey(id) === null ? [id] : []
  }))], [messages])
  // One string, so the row re-renders only when one of these titles changes, not with every list update.
  const titles = useChatStore(s => {
    if (!currentSpaceId || listed.length === 0) return ''
    const conversations = s.getSpaceState(currentSpaceId).conversations
    return listed.map(id => conversations.find(c => c.id === id)?.title ?? MISSING).join(SEPARATOR)
  })

  return useMemo(() => {
    const live = new Map<string, string>()
    if (listed.length) titles.split(SEPARATOR).forEach((title, index) => { if (title !== MISSING) live.set(listed[index], title) })
    const sources = new Map<string, CrossConversationSource>()
    for (const message of messages) {
      const provenance = readProvenance(message)
      if (!provenance) continue
      const id = provenance.fromConversationId
      const fromRun = parseRunSenderKey(id) !== null
      const appId = nativeChatAppId(id)
      let title = provenance.fromConversationTitle
      let open: (() => void) | undefined
      if (appId) {
        const app = apps.find(a => a.id === appId)
        const spaceId = app && app.status !== 'uninstalled' ? app.spaceId : undefined
        if (spaceId) open = () => navigateToAppChat(spaceId, appId, id)
      } else if (!fromRun && live.has(id)) {
        title = live.get(id)!
        if (currentSpaceId) open = () => navigateToConversation(currentSpaceId, id)
      }
      sources.set(message.id, { title, summary: provenance.summary, fromRun, ...(open ? { open } : {}) })
    }
    return sources.size ? sources : NO_SOURCES
  }, [messages, listed, titles, apps, currentSpaceId])
}
