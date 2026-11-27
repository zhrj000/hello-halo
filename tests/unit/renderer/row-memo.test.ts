/**
 * List rows skip rendering when the list hands them new objects holding the
 * same values, and render when anything they show or call changes.
 */

import { describe, expect, it } from 'vitest'
import { sameProps, sameRowProps } from '../../../src/renderer/components/chat/row-memo'

const onHover = () => {}
const task = { teamId: 't', epochId: 'e', label: 'Plan', lastActivityAt: 1, active: false }
const row = () => ({ type: 'team-item', key: 't:e', task: { ...task }, standalone: false, starred: false, avatar: { teamId: 't', members: 2 }, status: 'idle' })

describe('row props comparison', () => {
  it('treats a rebuilt row model with the same values as unchanged', () => {
    expect(sameRowProps({ row: row(), spaceId: 's', onHover }, { row: row(), spaceId: 's', onHover })).toBe(true)
  })

  it('sees a change in the row, the task it shows, the faces or a handler', () => {
    const base = { row: row(), spaceId: 's', onHover }
    expect(sameRowProps(base, { ...base, row: { ...row(), status: 'waiting' } })).toBe(false)
    expect(sameRowProps(base, { ...base, row: { ...row(), task: { ...task, label: 'Ship' } } })).toBe(false)
    expect(sameRowProps(base, { ...base, row: { ...row(), avatar: { teamId: 't', members: 1 } } })).toBe(false)
    expect(sameRowProps(base, { ...base, onHover: () => {} })).toBe(false)
    expect(sameRowProps(base, { ...base, edit: undefined })).toBe(false)
  })

  it('compares no deeper than asked, falling back to identity', () => {
    const deep = { a: { b: { c: 1 } } }
    expect(sameProps(deep, { a: { b: { c: 1 } } }, 3)).toBe(true)
    expect(sameProps(deep, { a: { b: { c: 1 } } }, 2)).toBe(false)
    expect(sameProps([1, 2], { 0: 1, 1: 2 })).toBe(false)
  })
})
