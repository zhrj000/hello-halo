/**
 * Props comparison for memoized list rows.
 *
 * The list's row models are rebuilt whenever anything they derive from changes
 * (a status anywhere, a re-read page of team tasks, a session touched), so a row
 * receives new objects that hold the same values. Comparing a few levels into
 * plain objects and arrays lets such a row skip rendering; functions and
 * anything deeper are compared by identity, so a miss only costs a render.
 */
export function sameProps(a: unknown, b: unknown, depth = 3): boolean {
  if (Object.is(a, b)) return true
  if (depth <= 0 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameProps(left[key], right[key], depth - 1))
}

/** For `memo`: props, then the row models they carry and the values inside those. */
export const sameRowProps = (prev: object, next: object): boolean => sameProps(prev, next, 4)
