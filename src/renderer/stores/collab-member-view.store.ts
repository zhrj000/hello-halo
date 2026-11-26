/**
 * Which temporary team member's work is shown in place of a conversation's chat,
 * in memory only. Held outside the chat page so the team progress canvas, a
 * notification or the collaboration bar can open a member there too.
 */

import { create } from 'zustand'

/** A question to bring into view on arrival; `seq` asks again for the same one. */
export interface CollabMemberFocus { entryId: string; seq: number }

interface CollabMemberViewState {
  /** Applies only while `conversationId` is the open conversation; never carried to another. */
  view: { conversationId: string; appId: string; focus?: CollabMemberFocus } | null
  open: (conversationId: string, appId: string, focus?: CollabMemberFocus) => void
  close: () => void
}

export const useCollabMemberViewStore = create<CollabMemberViewState>()(set => ({
  view: null,
  open: (conversationId, appId, focus) => set({ view: { conversationId, appId, ...(focus ? { focus } : {}) } }),
  close: () => set({ view: null }),
}))
