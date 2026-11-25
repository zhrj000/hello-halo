/**
 * The owner's words waiting behind a turn that serves someone else stay shown
 * until their own turn has written them into the transcript — and only that:
 * the same words said earlier do not count, and two identical waiting messages
 * leave one at a time.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/api', () => ({ api: {} }))
vi.mock('../../../src/renderer/i18n', () => ({ useTranslation: () => ({ t: (text: string) => text }) }))

import { stillWaiting, type WaitingMessage } from '../../../src/renderer/components/team/WaitingAfterTurn'

const at = Date.parse('2026-11-25T10:00:00.000Z')
const waiting = (key: string, content: string): WaitingMessage => ({ key, content, at })
const user = (content: string, time: number) => ({ id: `u${time}`, role: 'user', content, timestamp: new Date(time).toISOString() }) as never

describe('waiting after the turn', () => {
  it('stays until its own turn records it', () => {
    const items = [waiting('a', 'use ai-terminal')]
    expect(stillWaiting(items, [])).toEqual(items)
    // Said the same thing an hour before: not this message.
    expect(stillWaiting(items, [user('use ai-terminal', at - 3_600_000)])).toEqual(items)
    expect(stillWaiting(items, [user(' use ai-terminal ', at + 60_000)])).toEqual([])
  })

  it('lets identical messages go one record at a time', () => {
    const items = [waiting('a', 'again'), waiting('b', 'again')]
    expect(stillWaiting(items, [user('again', at + 1000)]).map(item => item.key)).toEqual(['b'])
  })
})
