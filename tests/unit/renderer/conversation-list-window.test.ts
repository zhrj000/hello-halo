/**
 * The conversation list mounts only the rows near its viewport; the rest fold
 * into gaps of their height, so the column keeps its full height and every row
 * lands where it would have been.
 */

import { describe, expect, it } from 'vitest'
import { windowRows, type WindowedItem } from '../../../src/renderer/components/chat/conversation-list-window'

const rows = Array.from({ length: 1000 }, (_, i) => ({ key: `c${i}` }))
const height = () => 30
const none = () => false
const mounted = <T extends { key: string }>(items: WindowedItem<T>[]) => items.filter((item): item is { row: T } => 'row' in item).map(item => item.row.key)
const total = <T,>(items: WindowedItem<T & { key: string }>[]) => items.reduce((sum, item) => sum + ('gap' in item ? item.gap : 30), 0)

describe('windowRows', () => {
  it('draws every row without a window (no DOM)', () => {
    expect(mounted(windowRows(rows, 0, height, null, none))).toHaveLength(1000)
  })

  it('mounts the rows overlapping the window and keeps the column its full height', () => {
    const items = windowRows(rows, 0, height, { top: 3000, bottom: 3600 }, none)
    expect(mounted(items)).toEqual(Array.from({ length: 20 }, (_, i) => `c${100 + i}`))
    expect(total(items)).toBe(30_000)
    expect(items[0]).toEqual({ gap: 3000, key: 'gap:c0' })
  })

  it('accounts for content above the rows (headings and earlier sections)', () => {
    expect(mounted(windowRows(rows, 600, height, { top: 600, bottom: 660 }, none))).toEqual(['c0', 'c1'])
  })

  it('keeps chosen rows mounted wherever they are, splitting the gap around them', () => {
    const items = windowRows(rows, 0, height, { top: 0, bottom: 60 }, key => key === 'c500')
    expect(mounted(items)).toEqual(['c0', 'c1', 'c500'])
    expect(items.filter(item => 'gap' in item)).toEqual([{ gap: 14_940, key: 'gap:c2' }, { gap: 14_970, key: 'gap:c501' }])
    expect(total(items)).toBe(30_000)
  })

  it('takes each row at its own height', () => {
    const mixed = [{ key: 'h', h: 34 }, { key: 'a', h: 33.5 }, { key: 'b', h: 26 }, { key: 'c', h: 33.5 }]
    // h 0–34, a 34–67.5, b 67.5–93.5, c 93.5–127
    const items = windowRows(mixed, 0, row => row.h, { top: 70, bottom: 90 }, none)
    expect(mounted(items)).toEqual(['b'])
    expect(items.filter(item => 'gap' in item).map(item => (item as { gap: number }).gap)).toEqual([67.5, 33.5])
  })

  it('adjusts gaps for a flex column whose spacing sits between children', () => {
    const items = windowRows(rows.slice(0, 10), 0, () => 26, { top: 0, bottom: 26 }, none, -2)
    expect(items.at(-1)).toEqual({ gap: 26 * 9 - 2, key: 'gap:c1' })
  })
})
