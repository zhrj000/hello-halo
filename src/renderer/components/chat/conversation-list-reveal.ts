/**
 * The conversation list follows the open conversation: when one is opened from
 * elsewhere (a conversation link, search, a notification, the task panel,
 * another space), its row is scrolled into view.
 *
 * Pinned rows sit in their own pane above one scrolling column; every row carries `data-row-key`, and the row is
 * found among the rows the list draws, made only while a reveal is pending. The
 * request is one-shot: once the row has been reached, later reorders of the list
 * never move it again. A row the person picked in the list is already in view,
 * so the list stays still.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { ConversationSection } from '../../stores/conversation-list-prefs.store'

/** One section's rows as the list draws them, and whether the section is open. */
export interface RevealPane {
  rows: readonly { key: string }[]
  open: boolean
}

export type RevealPanes = Record<ConversationSection, RevealPane>

export type RevealStep =
  /** The row's section is folded: open it for now, then look again. */
  | { type: 'open'; section: ConversationSection }
  | { type: 'row'; section: ConversationSection; index: number }
  /** The list is folded to its icon strip. */
  | { type: 'dot'; index: number }

const SECTIONS: readonly ConversationSection[] = ['pinned', 'teams', 'digital-humans', 'conversations']

/**
 * The next step towards showing conversation `id`, or `null` while the list
 * does not draw it (still loading, its group still opening, or not a
 * conversation this list shows).
 */
export function planReveal(
  id: string,
  panes: RevealPanes,
  strip: readonly { key: string }[] | null,
): RevealStep | null {
  for (const section of SECTIONS) {
    const pane = panes[section]
    const index = pane.rows.findIndex(row => row.key === id)
    if (index < 0) continue
    if (!pane.open) return { type: 'open', section }
    if (!strip) return { type: 'row', section, index }
    const dot = strip.findIndex(row => row.key === id)
    return dot < 0 ? null : { type: 'dot', index: dot }
  }
  return null
}

/** A section heading's height: one stays on top while its rows scroll, those further down wait at the bottom. */
export const STICKY_HEADING_PX = 34

/** The sections in the scrolling column, in order; pinned stays above it. */
export const SCROLLING_SECTIONS: readonly ConversationSection[] = ['teams', 'digital-humans', 'conversations']

/**
 * Scrolls only `container`, never its ancestors, and only when `child` is not
 * fully in view between the heading on top and those waiting at the bottom.
 */
export function scrollChildIntoView(container: HTMLElement, child: Element, topInset = 0, bottomInset = 0): void {
  const box = container.getBoundingClientRect()
  const rect = child.getBoundingClientRect()
  if (rect.top < box.top + topInset) container.scrollTop += rect.top - box.top - topInset
  else if (rect.bottom > box.bottom - bottomInset) container.scrollTop += rect.bottom - box.bottom + bottomInset
}

/** The drawn row for `key`, compared as data rather than through a selector, so no key needs escaping. */
function findRow(container: HTMLElement, key: string): Element | undefined {
  return Array.from(container.querySelectorAll('[data-row-key]')).find(element => (element as HTMLElement).dataset.rowKey === key)
}

/** Per space, the conversation last brought into view; outlives the list leaving the screen. */
const revealedKept = new Map<string, string>()

interface RevealOptions {
  spaceId: string
  /** The row on screen: a conversation, a digital human's session, a team task. */
  conversationId: string | undefined
  panes: RevealPanes
  /** The icon strip's rows, in drawing order; `null` while the list is open. */
  strip: readonly { key: string }[] | null
  /** Open a folded section without touching the user's saved fold choice. */
  openSection: (section: ConversationSection) => void
}

/**
 * Brings the open conversation into view whenever it changes, and whenever the
 * list appears or switches between open and folded.
 */
export function useConversationReveal({ spaceId, conversationId, panes, strip, openSection }: RevealOptions) {
  const latest = useRef({ conversationId, panes, strip, openSection })
  const pending = useRef<string | null>(null)
  /** Whether reaching the pending row may open its folded section. */
  const mayOpen = useRef(true)
  const pickedHere = useRef<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const reveal = useCallback(() => {
    const id = pending.current
    if (!id) return
    const step = planReveal(id, latest.current.panes, latest.current.strip)
    if (!step) return
    if (step.type === 'open') {
      if (mayOpen.current) latest.current.openSection(step.section)
      else pending.current = null
      return
    }
    if (step.type === 'dot') {
      const column = stripRef.current
      const dot = column?.children[step.index]
      if (!column || !dot) return
      scrollChildIntoView(column, dot)
    } else {
      const pinned = step.section === 'pinned'
      const column = pinned ? pinnedRef.current : scrollerRef.current
      const row = column ? findRow(column, id) : undefined
      // Not laid out yet: the next render of the list looks again.
      if (!column || !row) return
      // Headings of the sections before this one (and its own) stay stacked on top;
      // those after it wait at the bottom of the column.
      const present = SCROLLING_SECTIONS.filter(section => latest.current.panes[section].rows.length > 0)
      const index = present.indexOf(step.section)
      const below = pinned ? 0 : present.length - 1 - index
      scrollChildIntoView(column, row, pinned ? 0 : (index + 1) * STICKY_HEADING_PX, below * STICKY_HEADING_PX)
    }
    pending.current = null
  }, [])

  const pickedInList = useCallback((id: string) => {
    if (id !== latest.current.conversationId) pickedHere.current = id
  }, [])

  useEffect(() => {
    latest.current = { conversationId, panes, strip, openSection }
  })

  const folded = strip !== null
  useEffect(() => {
    const picked = pickedHere.current === conversationId
    pickedHere.current = null
    // Shown before (the list is back from another page, or unfolded): bring it into
    // view again, but leave a section the person has folded since then folded.
    const again = !!conversationId && revealedKept.get(spaceId) === conversationId
    if (conversationId) revealedKept.set(spaceId, conversationId)
    pending.current = conversationId && !picked ? conversationId : null
    mayOpen.current = !again
  }, [spaceId, conversationId, folded])

  const { pinned, teams, 'digital-humans': digitalHumans, conversations } = panes
  useEffect(reveal, [
    reveal, spaceId, conversationId, strip,
    pinned.rows, pinned.open, teams.rows, teams.open, digitalHumans.rows, digitalHumans.open, conversations.rows, conversations.open,
  ])

  return { scrollerRef, pinnedRef, stripRef, pickedInList }
}
