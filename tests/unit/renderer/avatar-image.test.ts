/**
 * Faces drawn as static images must look exactly like the boring-avatars faces
 * they replace, so a digital human is recognisable wherever it appears; and a
 * team mark is a crowd of such faces drawn from the team id, one per member.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Avatar from 'boring-avatars'
import { AVATAR_COLORS, TEAM_MARK_MAX_FACES, faceImageUrl, faceSvg, teamMarkImageUrl, teamMarkSvg } from '../../../src/renderer/components/apps/avatar-image'

/** The library's markup with its generated mask id made fixed. */
function libraryFace(name: string): string {
  const markup = renderToStaticMarkup(createElement(Avatar, { name, size: 36, variant: 'beam', colors: AVATAR_COLORS }))
  const id = /<mask id="([^"]+)"/.exec(markup)?.[1]
  if (!id) throw new Error('no mask id')
  return markup.split(id).join('m')
}

const NAMES = [
  // Names in CJK and other scripts hash by UTF-16 code unit, like any other.
  'Halo 写作助手', '日报助手', 'レビュー担当', 'Design Lead', 'qa-bot', 'a', '', 'Ассистент 2',
  ...Array.from({ length: 300 }, (_, i) => `member-${i}-${(i * 7919).toString(36)}`),
]

describe('digital-human faces as images', () => {
  it('draws every face exactly as boring-avatars does', () => {
    for (const name of NAMES) expect(faceSvg(name), name).toBe(libraryFace(name))
  })

  it('yields one URL per name, the same each time', () => {
    expect(faceImageUrl('日报助手')).toBe(faceImageUrl('日报助手'))
    expect(faceImageUrl('日报助手')).not.toBe(faceImageUrl('Halo 写作助手'))
    expect(decodeURIComponent(faceImageUrl('日报助手').split(',').slice(1).join(','))).toBe(faceSvg('日报助手'))
  })
})

describe('team marks as images', () => {
  const faceSeeds = (svg: string) => svg.match(/<mask id="m\d"/g) ?? []

  it('draws one face per member, at least one and at most five', () => {
    expect(faceSeeds(teamMarkSvg('team-a', 0))).toHaveLength(1)
    for (const members of [1, 2, 3, 4, 5]) expect(faceSeeds(teamMarkSvg('team-a', members)), String(members)).toHaveLength(members)
    expect(faceSeeds(teamMarkSvg('team-a', 120))).toHaveLength(TEAM_MARK_MAX_FACES)
  })

  it('draws every face as a digital-human face seeded by the team id and its seat', () => {
    // Seat k of a team is the face of the name `<id>#k`, so a seat keeps its face as the team grows.
    for (const members of [1, 3, 5]) {
      const svg = teamMarkSvg('team-a', members)
      for (let seat = 0; seat < members; seat++) {
        const body = faceSvg(`team-a#${seat}`).replace(/^<svg[^>]*>|<\/svg>$/g, '').replace(/id="m"|url\(#m\)/g, '')
        expect(svg.replace(/id="m\d"|url\(#m\d\)/g, ''), `${members}/${seat}`).toContain(body)
      }
    }
  })

  it('depends on the team id alone, not its name or members, and differs between teams', () => {
    expect(teamMarkSvg('team-a', 3)).toBe(teamMarkSvg('team-a', 3))
    expect(teamMarkSvg('team-a', 3)).not.toBe(teamMarkSvg('team-b', 3))
  })

  it('keeps one URL per team id and face count', () => {
    expect(teamMarkImageUrl('team-a', 2)).toBe(teamMarkImageUrl('team-a', 2))
    expect(teamMarkImageUrl('team-a', 2)).not.toBe(teamMarkImageUrl('team-a', 3))
    expect(teamMarkImageUrl('team-a', 9)).toBe(teamMarkImageUrl('team-a', 5))
    expect(teamMarkImageUrl('team-a', 0)).toBe(teamMarkImageUrl('team-a', 1))
  })

  // Pins the drawing: changing the algorithm would give every existing team a new mark.
  it('stays the same mark for a known team', () => {
    expect(fnvOf(teamMarkSvg('7d3c2a10-5f1e-4c8b-9a2d-0e6b1f4c3a21', 4))).toBe(PINNED_MARK_HASH)
  })
})

/** Hash of the mark above as first drawn (2026-11-27); update it only when every team is meant to get a new mark. */
const PINNED_MARK_HASH = 4120522432

function fnvOf(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) }
  return hash >>> 0
}
