/**
 * AutomationAvatar
 *
 * Deterministic avatar for a digital human (automation app), generated from its
 * name (boring-avatars' "beam" face). Shared by the installed-app header, the
 * store, the conversation list and team views, so the same name always yields
 * the same face.
 *
 * A single static `<img>`: the face is drawn once per name into a cached SVG
 * data URL (see avatar-image.ts), so a list showing hundreds of faces builds and
 * compares no SVG subtree on its renders, and the browser decodes each face once.
 */

import { memo } from 'react'
import { faceImageUrl } from './avatar-image'

interface AutomationAvatarProps {
  /** Seed for the generated face. The same name always yields the same avatar. */
  name: string
  /** Rendered pixel size (square). */
  size: number
}

export const AutomationAvatar = memo(function AutomationAvatar({ name, size }: AutomationAvatarProps) {
  return <img src={faceImageUrl(name)} width={size} height={size} alt="" aria-hidden="true" draggable={false} className="shrink-0 select-none" />
})
