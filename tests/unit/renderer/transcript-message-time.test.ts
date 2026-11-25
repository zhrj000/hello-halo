/**
 * The transcript shows one quiet time line where a stretch of conversation
 * begins: a new calendar day or a pause of five minutes. The line names the day
 * where a day opens and anywhere before today. Boundaries come from the loaded
 * messages, so a page of older history moves the line to the true first message.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/i18n', () => ({
  getCurrentLanguage: () => 'en-US',
}))

import { formatDayLabel, formatMessageClock, formatSegmentLabel, startsNewDay, startsNewSegment } from '../../../src/renderer/components/chat/transcript/message-time'

const t = (text: string) => text
const at = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  ({ timestamp: new Date(year, month - 1, day, hour, minute).toISOString() })

describe('startsNewDay', () => {
  it('labels the first loaded message and each change of calendar day', () => {
    const messages = [at(2026, 11, 12, 23, 50), at(2026, 11, 12, 23, 59), at(2026, 11, 13, 0, 1), at(2026, 11, 13, 9)]
    expect(messages.map((_, index) => startsNewDay(messages, index))).toEqual([true, false, true, false])
  })

  it('moves the label to an older page prepended on the same day', () => {
    const loaded = [at(2026, 11, 13, 9), at(2026, 11, 13, 10)]
    expect(startsNewDay(loaded, 0)).toBe(true)
    const withOlder = [at(2026, 11, 13, 8), ...loaded]
    expect(startsNewDay(withOlder, 0)).toBe(true)
    expect(startsNewDay(withOlder, 1)).toBe(false)
  })

  it('skips messages without a readable time', () => {
    const messages = [at(2026, 11, 13, 9), { timestamp: '' }, at(2026, 11, 13, 10)]
    expect(startsNewDay(messages, 1)).toBe(false)
    expect(startsNewDay(messages, 2)).toBe(false)
  })
})

describe('formatDayLabel', () => {
  const now = new Date(2026, 10, 23, 15, 0)

  it('says Today and Yesterday for the two latest days', () => {
    expect(formatDayLabel(at(2026, 11, 23, 0, 5).timestamp, t, now)).toBe('Today')
    expect(formatDayLabel(at(2026, 11, 22, 23, 55).timestamp, t, now)).toBe('Yesterday')
  })

  it('shows the month and day this year, and the year before it', () => {
    expect(formatDayLabel(at(2026, 10, 22).timestamp, t, now)).toBe('October 22')
    expect(formatDayLabel(at(2025, 12, 31).timestamp, t, now)).toBe('December 31, 2025')
  })

  it('crosses a year boundary for Yesterday', () => {
    expect(formatDayLabel(at(2025, 12, 31).timestamp, t, new Date(2026, 0, 1, 8))).toBe('Yesterday')
  })
})

describe('formatMessageClock', () => {
  it('shows hours and minutes, and nothing for an unreadable time', () => {
    expect(formatMessageClock(at(2026, 11, 13, 11, 10).timestamp)).toBe('11:10 AM')
    expect(formatMessageClock('not a date')).toBe('')
    expect(formatMessageClock(undefined)).toBe('')
  })
})

describe('startsNewSegment', () => {
  it('starts a stretch at a new day or after a pause of five minutes, not within a quick exchange', () => {
    const messages = [
      at(2026, 11, 22, 23, 58), // first loaded
      at(2026, 11, 22, 23, 59), // quick reply
      at(2026, 11, 23, 0, 1), // new day, two minutes later
      at(2026, 11, 23, 16, 39),
      at(2026, 11, 23, 16, 43), // four minutes
      at(2026, 11, 23, 16, 48), // five minutes
    ]
    expect(messages.map((_, index) => startsNewSegment(messages, index))).toEqual([true, false, true, true, false, true])
  })

  it('measures the pause from the previous message with a readable time', () => {
    const messages = [at(2026, 11, 23, 16, 39), { timestamp: '' }, at(2026, 11, 23, 16, 41)]
    expect(startsNewSegment(messages, 1)).toBe(false)
    expect(startsNewSegment(messages, 2)).toBe(false)
  })
})

describe('formatSegmentLabel', () => {
  const now = new Date(2026, 10, 23, 18, 0)

  it('names the day where a day opens, and gives the time alone for a pause later today', () => {
    expect(formatSegmentLabel(at(2026, 11, 23, 16, 39).timestamp, true, t, now)).toBe('Today 4:39 PM')
    expect(formatSegmentLabel(at(2026, 11, 23, 16, 47).timestamp, false, t, now)).toBe('4:47 PM')
  })

  it('names the day on every stretch before today, so old history never needs a floating date', () => {
    expect(formatSegmentLabel(at(2026, 11, 22, 21, 5).timestamp, false, t, now)).toBe('Yesterday 9:05 PM')
    expect(formatSegmentLabel(at(2026, 10, 22, 11, 10).timestamp, false, t, now)).toBe('Oct 22, 11:10 AM')
    expect(formatSegmentLabel(at(2025, 12, 30, 16, 20).timestamp, true, t, now)).toBe('Dec 30, 2025, 4:20 PM')
  })

  it('shows nothing for an unreadable time', () => {
    expect(formatSegmentLabel('not a date', true, t, now)).toBe('')
  })

  it('orders and punctuates the date and time the way the language does', () => {
    expect(new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 9, 22, 11, 10))).toBe('10月22日 11:10')
  })
})
