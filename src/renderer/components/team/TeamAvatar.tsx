import { memo } from 'react'
import type { TeamMarkSpec } from '../../hooks/useTeamConversationRows'
import { teamMarkImageUrl } from '../apps/avatar-image'

const BASE = 20

interface TeamAvatarProps { mark: TeamMarkSpec; size?: number }

/**
 * A team's mark: digital-human faces crowded into a rounded square, one per
 * member up to five. Square where a digital human is round, so the two never
 * read as each other. The faces come from the team id, not from who the
 * members are, so the mark stays the same through renames and member changes;
 * only how many faces there are follows the team's size.
 *
 * Static: one cached image per team id and member count (avatar-image.ts),
 * rendered again only when one of those or the size changes.
 */
export const TeamAvatar = memo(function TeamAvatar({ mark, size = BASE }: TeamAvatarProps) {
  return <img src={teamMarkImageUrl(mark.teamId, mark.members)} width={size} height={size} alt="" aria-hidden="true"
    draggable={false} className="block shrink-0 select-none" data-team-mark={mark.teamId} />
}, (prev, next) => prev.size === next.size && prev.mark.teamId === next.mark.teamId && prev.mark.members === next.mark.members)
