/**
 * How the conversation list orders and shortens what it shows — pure, shared by
 * the sidebar and the history sheet.
 *
 * - What needs the person (a question, a failure, a finish not yet seen) comes
 *   first: rows within their group, groups within their section.
 * - A row the person opened while it needed them keeps its place until they
 *   open something else, so it never moves under the pointer.
 * - Each list shows its first few and keeps the rest behind "More"; the open
 *   conversation is always shown.
 */

import type { TaskStatus } from '../../types'

/** Rows, groups and conversations shown before "More". */
export const LIST_PEEK = 5
/** How many more one press of "More" shows, per kind of list. */
export const MORE_STEP = { rows: 10, groups: 10, conversations: 20 } as const

export type AttentionStatus = 'waiting' | 'error' | 'completed-unseen'

const RANK: Record<AttentionStatus, number> = { waiting: 0, error: 1, 'completed-unseen': 2 }

/** The order the person should get to things in; absent for what does not need them. */
export function attentionRank(status: TaskStatus | undefined): number | undefined {
  return status && status in RANK ? RANK[status as AttentionStatus] : undefined
}

/** The row opened while it needed the person, and how it ranked then. */
export interface HeldRow { key: string; rank: number }

/** A row's rank, counting the place it holds while it is open. */
export function rowRank(key: string, status: TaskStatus | undefined, held: HeldRow | null): number | undefined {
  const own = attentionRank(status)
  const kept = held?.key === key ? held.rank : undefined
  if (own === undefined) return kept
  return kept === undefined ? own : Math.min(own, kept)
}

/** Items needing the person first, by rank; within a rank and after them, the order they came in. */
export function attentionFirst<T>(items: readonly T[], rank: (item: T) => number | undefined): T[] {
  return items
    .map((item, index) => ({ item, index, rank: rank(item) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.item)
}

/** The most urgent of several states, for a folded heading. */
const HEADING_ORDER: TaskStatus[] = ['waiting', 'error', 'completed-unseen', 'generating']
export function headingStatus(statuses: Iterable<TaskStatus | undefined>): TaskStatus | undefined {
  const present = new Set(statuses)
  return HEADING_ORDER.find(status => present.has(status))
}

export interface Peeked<T> {
  visible: T[]
  /** How many stay behind "More". */
  rest: number
  /** Opened past the first few, so "Show less" is offered. */
  expanded: boolean
}

/**
 * The first `shown` items (the first few when absent), plus the selected one
 * when it falls further down, which takes the last place so the count holds.
 */
export function peek<T>(items: readonly T[], shown: number | undefined, isSelected: (item: T) => boolean): Peeked<T> {
  const limit = Math.max(LIST_PEEK, shown ?? LIST_PEEK)
  if (items.length <= limit) return { visible: [...items], rest: 0, expanded: limit > LIST_PEEK && items.length > LIST_PEEK }
  const head = items.slice(0, limit)
  const selected = head.some(isSelected) ? undefined : items.slice(limit).find(isSelected)
  const visible = selected ? [...head.slice(0, -1), selected] : head
  return { visible, rest: items.length - visible.length, expanded: limit > LIST_PEEK }
}

/** What "More" opens a list to. */
export function nextShown(shown: number | undefined, step: number): number {
  return Math.max(LIST_PEEK, shown ?? LIST_PEEK) + step
}
