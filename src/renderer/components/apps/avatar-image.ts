/**
 * Digital-human faces and team marks as static images.
 *
 * A face is drawn once per name and kept as an SVG data URL, so every avatar on
 * screen is a single `<img>`: no React subtree to build or compare on each list
 * render, and the browser decodes a URL once however many rows show it. A team
 * mark is a crowd of such faces seeded by the team id, composed into one image
 * the same way (teamMarkSvg).
 *
 * The face is boring-avatars' "beam" (v2.0.4), ported so it can be produced as a
 * string; `avatar-image.test.ts` holds it to the library's own markup, so a
 * digital human looks the same here as anywhere the library still draws it.
 */

/** Brand-aligned palette seeding the generator (algorithm input, not UI chrome — literal colours, not theme tokens). */
export const AVATAR_COLORS = ['#84B9EF', '#6C8EBF', '#3D5A80', '#98C1D9', '#E0FBFC']

const SIZE = 36

function hashCode(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash)
}
const digit = (n: number, place: number) => Math.floor((n / Math.pow(10, place)) % 10)
const bool = (n: number, place: number) => !(digit(n, place) % 2)
function unit(n: number, range: number, index?: number): number {
  const value = n % range
  return index && digit(n, index) % 2 === 0 ? -value : value
}
const pick = (n: number, colors: readonly string[]) => colors[n % colors.length]
function contrast(hex: string): string {
  const h = hex.startsWith('#') ? hex.slice(1) : hex
  const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? '#000000' : '#FFFFFF'
}

/** The face's drawing (mask and shapes) inside a 36×36 box; `maskId` must be unique within one image. */
function beamBody(name: string, maskId: string, colors: readonly string[] = AVATAR_COLORS): string {
  const n = hashCode(name)
  const wrapperColor = pick(n, colors)
  const faceColor = contrast(wrapperColor)
  const backgroundColor = pick(n + 13, colors)
  const pre = unit(n, 10, 1)
  const wrapperTranslateX = pre < 5 ? pre + SIZE / 9 : pre
  const preY = unit(n, 10, 2)
  const wrapperTranslateY = preY < 5 ? preY + SIZE / 9 : preY
  const wrapperRotate = unit(n, 360)
  const wrapperScale = 1 + unit(n, SIZE / 12) / 10
  const isMouthOpen = bool(n, 2)
  const isCircle = bool(n, 1)
  const eyeSpread = unit(n, 5)
  const mouthSpread = unit(n, 3)
  const faceRotate = unit(n, 10, 3)
  const faceTranslateX = wrapperTranslateX > SIZE / 6 ? wrapperTranslateX / 2 : unit(n, 8, 1)
  const faceTranslateY = wrapperTranslateY > SIZE / 6 ? wrapperTranslateY / 2 : unit(n, 7, 2)
  const mouth = isMouthOpen
    ? `<path d="M15 ${19 + mouthSpread}c2 1 4 1 6 0" stroke="${faceColor}" fill="none" stroke-linecap="round"></path>`
    : `<path d="M13,${19 + mouthSpread} a1,0.75 0 0,0 10,0" fill="${faceColor}"></path>`
  return `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${SIZE * 2}" fill="#FFFFFF"></rect></mask>`
    + `<g mask="url(#${maskId})"><rect width="${SIZE}" height="${SIZE}" fill="${backgroundColor}"></rect>`
    + `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" transform="translate(${wrapperTranslateX} ${wrapperTranslateY}) rotate(${wrapperRotate} ${SIZE / 2} ${SIZE / 2}) scale(${wrapperScale})" fill="${wrapperColor}" rx="${isCircle ? SIZE : SIZE / 6}"></rect>`
    + `<g transform="translate(${faceTranslateX} ${faceTranslateY}) rotate(${faceRotate} ${SIZE / 2} ${SIZE / 2})">${mouth}`
    + `<rect x="${14 - eyeSpread}" y="14" width="1.5" height="2" rx="1" stroke="none" fill="${faceColor}"></rect>`
    + `<rect x="${20 + eyeSpread}" y="14" width="1.5" height="2" rx="1" stroke="none" fill="${faceColor}"></rect></g></g>`
}

const SVG_OPEN = 'fill="none" role="img" xmlns="http://www.w3.org/2000/svg"'

/** One face as SVG markup, in the library's own form. */
export function faceSvg(name: string, maskId = 'm', colors: readonly string[] = AVATAR_COLORS): string {
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" ${SVG_OPEN} width="${SIZE}" height="${SIZE}">${beamBody(name, maskId, colors)}</svg>`
}

/** How many faces a team mark shows at most; a bigger team shows this many. */
export const TEAM_MARK_MAX_FACES = 5

// FNV-1a and mulberry32: a well-spread, engine-independent stream of numbers from a team id.
function fnv(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
function stream(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MARK = 80
/** Backdrops a team id picks from: three light, one dark, all of the brand family. */
const TEAM_TILES = ['#F3F5F9', '#E0FBFC', '#DCE8F5', '#3D5A80']
/**
 * Faces per member count, in an 80-unit tile: [x, y, radius, row], back row
 * first. Two rows, big enough to fill the tile, overlapping each other and
 * running past its edges (the tile clips them). The front row sits low enough
 * to cover only the chins of the row behind, never its eyes.
 */
const TEAM_LAYOUTS: Record<number, ReadonlyArray<readonly [number, number, number, 0 | 1]>> = {
  1: [[40, 46, 40, 0]],
  2: [[24, 28, 29, 1], [55, 57, 32, 0]],
  3: [[18, 24, 25, 1], [62, 24, 25, 1], [40, 58, 29, 0]],
  4: [[18, 22, 24, 1], [62, 22, 24, 1], [22, 58, 26, 0], [58, 59, 26, 0]],
  5: [[11, 20, 20, 1], [40, 16, 20, 1], [69, 20, 20, 1], [24, 56, 24, 0], [56, 57, 24, 0]],
}
/** The back row is washed lighter and the front row darkened a little, so the two read apart whatever colours the faces drew. */
const BACK_WASH = 0.38
const FRONT_SHADE = 0.12

/**
 * A team's mark: up to five digital-human faces crowded into a rounded square,
 * one per member. Everything about it comes from the team id — the backdrop,
 * whether it is mirrored, and each face (seeded `<id>#<k>`) — so it never
 * changes with renames or with who the members are, and a joined copy of the
 * team (same id) looks the same on every machine. Only the member count
 * matters: it is how many faces there are, and a face keeps its look when
 * the team grows.
 */
export function teamMarkSvg(teamId: string, members: number): string {
  const count = Math.max(1, Math.min(TEAM_MARK_MAX_FACES, Math.floor(members) || 0))
  const random = stream(fnv(teamId))
  const tile = TEAM_TILES[Math.floor(random() * TEAM_TILES.length)]
  const mirror = random() < 0.5
  const layout = TEAM_LAYOUTS[count]
  const faces = layout.map(([x, y, r, row], i) => {
    const cx = mirror ? MARK - x : x
    const seat = count - 1 - i
    const veil = row === 1
      ? `<circle cx="${cx}" cy="${y}" r="${r}" fill="#FFFFFF" opacity="${BACK_WASH}"></circle>`
      : `<circle cx="${cx}" cy="${y}" r="${r}" fill="#000000" opacity="${FRONT_SHADE}"></circle>`
    return `<circle cx="${cx}" cy="${y}" r="${+(r * 1.11).toFixed(2)}" fill="${tile}"></circle>`
      + `<svg x="${cx - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" viewBox="0 0 ${SIZE} ${SIZE}" fill="none">${beamBody(`${teamId}#${seat}`, `m${i}`)}</svg>`
      + veil
  }).join('')
  const radius = +(MARK * 0.28).toFixed(2)
  return `<svg viewBox="0 0 ${MARK} ${MARK}" ${SVG_OPEN} width="${MARK}" height="${MARK}">`
    + `<clipPath id="t"><rect width="${MARK}" height="${MARK}" rx="${radius}"></rect></clipPath>`
    + `<g clip-path="url(#t)"><rect width="${MARK}" height="${MARK}" fill="${tile}"></rect>${faces}</g></svg>`
}

// Drawn once per key for the life of the window. Bounded only as a guard: names
// in a workspace number in the tens or hundreds, far under the cap.
const CACHE_LIMIT = 2000
const cache = new Map<string, string>()
function cached(key: string, draw: () => string): string {
  let url = cache.get(key)
  if (url === undefined) {
    if (cache.size >= CACHE_LIMIT) cache.clear()
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(draw())}`
    cache.set(key, url)
  }
  return url
}

/** A digital human's face as an image URL; the same name always yields the same URL. */
export function faceImageUrl(name: string): string {
  return cached(`f\u0000${name}`, () => faceSvg(name))
}

/** A team's mark as an image URL, drawn once per team id and member count (see teamMarkSvg). */
export function teamMarkImageUrl(teamId: string, members: number): string {
  const count = Math.max(1, Math.min(TEAM_MARK_MAX_FACES, Math.floor(members) || 0))
  return cached(`t\u0000${teamId}\u0000${count}`, () => teamMarkSvg(teamId, count))
}
