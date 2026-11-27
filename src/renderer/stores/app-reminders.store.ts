/**
 * The reminders digital humans set in their conversations, read per digital human
 * and kept while a list row, a composer or a conversation needs them. A reminder is
 * set, cancelled or comes due inside a turn of its conversation, so a digital human's
 * reminders are read again when a turn of an open conversation ends (see
 * useRemindersAfterTurns: the session update arrives as a turn starts, before its
 * reminder tool has run) and on that update too, for list rows of other conversations.
 */

import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { api } from '../api'
import type { ConversationReminderView } from '../../shared/apps/conversation-reminders'

const EMPTY: ConversationReminderView[] = []

interface AppRemindersState {
  byApp: Record<string, ConversationReminderView[]>
  load: (appId: string) => Promise<void>
  cancel: (appId: string, reminderId: string) => Promise<boolean>
}

const requested = new Set<string>()
let subscribed = false

export const useAppRemindersStore = create<AppRemindersState>((set, get) => ({
  byApp: {},
  load: async (appId) => {
    const res = await api.appListReminders(appId)
    if (!res.success) return
    set(state => ({ byApp: { ...state.byApp, [appId]: res.data ?? [] } }))
  },
  cancel: async (appId, reminderId) => {
    const res = await api.appCancelReminder(appId, reminderId)
    await get().load(appId)
    return res.success
  },
}))

/** Read a digital human's reminders once, and again whenever one of its sessions moves. */
export function ensureAppReminders(appId: string): void {
  if (!subscribed) {
    subscribed = true
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    api.onImSessionUpdated?.(data => {
      const appId = (data as { appId?: string } | null)?.appId
      if (!appId || !requested.has(appId) || timers.has(appId)) return
      timers.set(appId, setTimeout(() => { timers.delete(appId); void useAppRemindersStore.getState().load(appId) }, 400))
    })
  }
  if (requested.has(appId)) return
  requested.add(appId)
  void useAppRemindersStore.getState().load(appId)
}

/** The reminders standing in one conversation of a digital human. */
export function useConversationReminders(appId: string | null | undefined, conversationId: string | null | undefined): ConversationReminderView[] {
  const all = useAppRemindersStore(state => (appId ? state.byApp[appId] : undefined) ?? EMPTY)
  useEffect(() => { if (appId) ensureAppReminders(appId) }, [appId])
  return useMemo(() => !conversationId || all === EMPTY ? EMPTY
    : all.filter(reminder => reminder.conversationId === conversationId && reminder.nextAt !== null), [all, conversationId])
}
