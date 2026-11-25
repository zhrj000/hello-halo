import { describe, expect, it } from 'vitest'
import { LIST_PEEK, attentionFirst, attentionRank, headingStatus, nextShown, peek, rowRank } from '../../../src/renderer/components/chat/conversation-list-model'

describe('the order of what needs the person', () => {
  it('ranks a question before a failure before an unseen finish, and nothing else', () => {
    expect(['waiting', 'error', 'completed-unseen', 'generating', 'idle', undefined].map(status => attentionRank(status as any))).toEqual([0, 1, 2, undefined, undefined, undefined])
  })
  it('keeps the place a row held while it is the one open', () => {
    expect(rowRank('a', 'idle', { key: 'a', rank: 2 })).toBe(2)
    expect(rowRank('b', 'idle', { key: 'a', rank: 2 })).toBeUndefined()
    expect(rowRank('a', 'waiting', { key: 'a', rank: 2 })).toBe(0)
  })
  it('puts ranked items first, each rank in the order they came, the rest after in theirs', () => {
    const rank: Record<string, number | undefined> = { c: 2, e: 0, f: 2 }
    expect(attentionFirst(['a', 'b', 'c', 'd', 'e', 'f'], key => rank[key])).toEqual(['e', 'c', 'f', 'a', 'b', 'd'])
  })
  it('names the most urgent state for a folded heading', () => {
    expect(headingStatus(['generating', 'completed-unseen', undefined])).toBe('completed-unseen')
    expect(headingStatus(['idle', undefined])).toBeUndefined()
  })
})

describe('the first few and "More"', () => {
  const items = Array.from({ length: 12 }, (_, i) => i)
  it('shows the first five and counts the rest', () => {
    expect(peek(items, undefined, () => false)).toEqual({ visible: [0, 1, 2, 3, 4], rest: 7, expanded: false })
  })
  it('shows the open one past them in the last place, so the count holds', () => {
    expect(peek(items, undefined, item => item === 9)).toEqual({ visible: [0, 1, 2, 3, 9], rest: 7, expanded: false })
  })
  it('opens further by a step and says when everything shows after being opened', () => {
    expect(nextShown(undefined, 10)).toBe(LIST_PEEK + 10)
    expect(peek(items, 15, () => false)).toEqual({ visible: items, rest: 0, expanded: true })
    expect(peek([1, 2], 15, () => false)).toEqual({ visible: [1, 2], rest: 0, expanded: false })
  })
})
