/**
 * Windowing for the conversation list: only the rows near the viewport are
 * mounted. A run of rows outside it is one empty element of the same height,
 * so the column keeps its full height — the sticky headings, the headings
 * docked at the bottom, jumping to a section and the scrollbar all behave as
 * if every row were there.
 *
 * Heights come from rows measured while mounted, else from an estimate per
 * row type that matches the drawn rows (33.5px rows, 34px group headings,
 * 26px "More" lines). Rows are a single line, so the estimate is exact for
 * almost every row; a row that is not (an error line under it) is measured
 * the first time it is mounted, and the browser's scroll anchoring keeps the
 * view still if it differs.
 *
 * Some rows stay mounted wherever they are (`keep`): the open conversation (the
 * list brings it into view by finding its element), a row whose menu is open
 * or that is being renamed, and the row holding keyboard focus.
 *
 * Without a window (`null`: no DOM, as in unit tests) every row is drawn.
 */

import { useEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'

/** What is mounted, in the scroller's content coordinates (px from its top). */
export interface ScrollWindow { top: number; bottom: number }

/** The window moves in steps of this, so scrolling re-renders the list once per step, not per frame. */
const STEP = 300
/** Rows mounted beyond the viewport on each side, so ordinary scrolling never shows an empty stretch. */
const OVERSCAN = 600

export const ROW_ESTIMATE_PX: Record<string, number> = {
  item: 33.5, 'dh-item': 33.5, 'team-item': 33.5,
  'dh-header': 34, 'team-header': 34,
  more: 26, 'team-empty': 26, 'team-hidden': 26, 'team-retry': 33.5,
}
const DEFAULT_ESTIMATE_PX = 33.5

/**
 * The part of `scroller` worth mounting, following its scroll and size. `target`
 * changes when the list swaps which element scrolls (open list ↔ icon strip).
 */
export function useScrollWindow(scroller: RefObject<HTMLElement>, target: unknown): ScrollWindow | null {
  const [step, setStep] = useState<{ at: number; height: number } | null>(() =>
    typeof window === 'undefined' ? null : { at: 0, height: window.innerHeight || 800 })
  const current = useRef(step)
  current.current = step

  useEffect(() => {
    const el = scroller.current
    if (!el || typeof el.addEventListener !== 'function' || typeof el.clientHeight !== 'number') return
    const update = () => {
      const next = { at: Math.floor(el.scrollTop / STEP), height: Math.ceil(el.clientHeight / STEP) * STEP }
      const prev = current.current
      if (prev && prev.at === next.at && prev.height === next.height) return
      current.current = next
      // Synchronously, before the frame paints: a long jump (scrollbar drag,
      // bringing a far row into view) never shows an empty stretch.
      flushSync(() => setStep(next))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    resize?.observe(el)
    return () => { el.removeEventListener('scroll', update); resize?.disconnect() }
  }, [scroller, target])

  return step && { top: step.at * STEP - OVERSCAN, bottom: (step.at + 1) * STEP + step.height + OVERSCAN }
}

export type WindowedItem<T> = { row: T } | { gap: number; key: string }

/**
 * `rows` laid out from `top` (content px), with the runs outside `view` folded
 * into gaps. `gapAdjust` is added to each gap's height (a flex column with
 * `gap` puts its spacing around a spacer as it did around the rows).
 */
export function windowRows<T extends { key: string }>(
  rows: readonly T[],
  top: number,
  heightOf: (row: T) => number,
  view: ScrollWindow | null,
  keep: (key: string) => boolean,
  gapAdjust = 0,
): WindowedItem<T>[] {
  if (!view) return rows.map(row => ({ row }))
  const out: WindowedItem<T>[] = []
  let y = top
  let gap = 0
  let gapKey = ''
  for (const row of rows) {
    const h = heightOf(row)
    if ((y + h > view.top && y < view.bottom) || keep(row.key)) {
      if (gap) out.push({ gap: gap + gapAdjust, key: `gap:${gapKey}` })
      gap = 0
      out.push({ row })
    } else {
      if (!gap) gapKey = row.key
      gap += h
    }
    y += h
  }
  if (gap) out.push({ gap: gap + gapAdjust, key: `gap:${gapKey}` })
  return out
}

/** Heights of rows seen mounted, by key, for the gaps they leave once they scroll away. */
export function useRowHeights() {
  const heights = useRef(new Map<string, number>())
  const heightOf = (row: { key: string; type: string }) => heights.current.get(row.key) ?? ROW_ESTIMATE_PX[row.type] ?? DEFAULT_ESTIMATE_PX
  /** Records the mounted rows of `column` (elements carrying `data-row-key`). */
  const measure = (column: HTMLElement | null) => {
    if (!column || typeof column.querySelectorAll !== 'function') return
    for (const el of Array.from(column.querySelectorAll<HTMLElement>(':scope > [data-row-key]'))) {
      const key = el.dataset?.rowKey
      const h = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect().height : undefined
      if (key && typeof h === 'number' && h > 0) heights.current.set(key, h)
    }
  }
  return { heightOf, measure }
}

/**
 * The row of `column` holding keyboard focus, so it stays mounted while the
 * person scrolls away from it (a rename in progress, a menu button).
 */
export function useFocusedRow(column: RefObject<HTMLElement>, target: unknown): RefObject<string | null> {
  const focused = useRef<string | null>(null)
  useEffect(() => {
    const el = column.current
    if (!el || typeof el.addEventListener !== 'function') return
    const enter = (event: Event) => {
      const row = (event.target as HTMLElement | null)?.closest?.('[data-row-key]') as HTMLElement | null
      focused.current = row?.dataset.rowKey ?? null
    }
    const leave = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !el.contains(event.relatedTarget)) focused.current = null
    }
    el.addEventListener('focusin', enter)
    el.addEventListener('focusout', leave as EventListener)
    return () => { el.removeEventListener('focusin', enter); el.removeEventListener('focusout', leave as EventListener) }
  }, [column, target])
  return focused
}
