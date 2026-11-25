/**
 * When a transcript message was sent. Times stay out of the way: one quiet
 * line where a stretch of conversation begins (a new day, or a pause), never
 * one per message.
 */

import { getCurrentLanguage } from '../../../i18n'
import type { Message } from '../../../types'

type Translate = (s: string) => string

function parse(timestamp: string | undefined): Date | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Each language orders and punctuates date and time its own way
// ("Oct 22, 11:10 AM", "10月22日 11:10", "22. Okt., 11:10").
const FORMATS = {
  clock: { hour: 'numeric', minute: '2-digit' },
  day: { month: 'long', day: 'numeric' },
  dayWithYear: { year: 'numeric', month: 'long', day: 'numeric' },
  dayTime: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  dayTimeWithYear: { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
} satisfies Record<string, Intl.DateTimeFormatOptions>

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(kind: keyof typeof FORMATS): Intl.DateTimeFormat {
  const language = getCurrentLanguage()
  const key = `${language}|${kind}`
  let format = formatters.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(language, FORMATS[kind])
    formatters.set(key, format)
  }
  return format
}

function isYesterday(date: Date, now: Date): boolean {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  return sameDay(date, yesterday)
}

/**
 * The message opens a calendar day in the loaded transcript. Decided from the
 * messages themselves, never from which rows are mounted, so paging older
 * history in cannot shift a label onto the wrong row.
 */
export function startsNewDay(messages: readonly Pick<Message, 'timestamp'>[], index: number): boolean {
  const current = parse(messages[index]?.timestamp)
  if (!current) return false
  for (let i = index - 1; i >= 0; i--) {
    const previous = parse(messages[i].timestamp)
    if (previous) return !sameDay(previous, current)
  }
  return true
}

/** A pause this long between two messages starts a new stretch with its own time. */
export const SEGMENT_GAP_MS = 5 * 60 * 1000

/**
 * The message begins a stretch of conversation: it opens a calendar day, or
 * follows the previous timed message after a pause. Decided from the loaded
 * messages like `startsNewDay`.
 */
export function startsNewSegment(messages: readonly Pick<Message, 'timestamp'>[], index: number, gapMs = SEGMENT_GAP_MS): boolean {
  const current = parse(messages[index]?.timestamp)
  if (!current) return false
  for (let i = index - 1; i >= 0; i--) {
    const previous = parse(messages[i].timestamp)
    if (previous) return !sameDay(previous, current) || current.getTime() - previous.getTime() >= gapMs
  }
  return true
}

/**
 * The line above a stretch. It names the day wherever that is not obvious —
 * where a day opens ("Today 4:39 PM") and anywhere before today ("Oct 22,
 * 11:10 AM") — so a reader dropped into old history sees the date without
 * anything floating over the transcript. A pause later today shows the time alone.
 */
export function formatSegmentLabel(timestamp: string, opensDay: boolean, t: Translate, now = new Date()): string {
  const date = parse(timestamp)
  if (!date) return ''
  const clock = formatter('clock').format(date)
  if (sameDay(date, now)) return opensDay ? `${t('Today')} ${clock}` : clock
  if (isYesterday(date, now)) return `${t('Yesterday')} ${clock}`
  return formatter(date.getFullYear() === now.getFullYear() ? 'dayTime' : 'dayTimeWithYear').format(date)
}

/** "Today", "Yesterday", the month and day, or the full date for another year. */
export function formatDayLabel(timestamp: string, t: Translate, now = new Date()): string {
  const date = parse(timestamp)
  if (!date) return ''
  if (sameDay(date, now)) return t('Today')
  if (isYesterday(date, now)) return t('Yesterday')
  return formatter(date.getFullYear() === now.getFullYear() ? 'day' : 'dayWithYear').format(date)
}

/** Clock time of a message, e.g. 11:10 AM or 11:10. */
export function formatMessageClock(timestamp: string | undefined): string {
  const date = parse(timestamp)
  return date ? formatter('clock').format(date) : ''
}
