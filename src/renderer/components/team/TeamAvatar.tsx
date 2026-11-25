import type { TeamAvatarFaces } from '../../hooks/useTeamConversationRows'
import { AutomationAvatar } from '../apps/AutomationAvatar'

const BASE = 20

/**
 * A team's mark: a rounded square holding its members' faces in a grid, lead
 * first — one centred, two side by side, three as one over two, four or more
 * as the first four in two rows. Square where a digital human is round, so the
 * two never read as each other; the faces are not overlapped, and how many more
 * there are is told where there is room for it (hover card, team page header).
 */
export function TeamAvatar({ faces, name, size = BASE }: { faces: TeamAvatarFaces; name: string; size?: number }) {
  const names = faces.names.slice(0, 4)
  const count = names.length
  const radius = Math.round(size * 0.28)
  const pad = Math.max(1.5, size * 0.09)
  const gap = Math.max(1, size * 0.06)
  const cell = count === 1 ? Math.round(size * 0.62) : (size - pad * 2 - gap) / 2
  return <span aria-hidden="true" className="grid shrink-0 place-content-center bg-secondary theme-dark:bg-surface-hover"
    style={{ width: size, height: size, borderRadius: radius, gap, gridTemplateColumns: `repeat(${count > 1 ? 2 : 1}, ${cell}px)` }}>
    {count === 0
      ? <span className="font-medium leading-none text-muted-foreground" style={{ fontSize: Math.round(size * 0.5) }}>{Array.from(name.trim())[0] ?? ''}</span>
      : names.map((memberName, index) => <span key={index} className="flex overflow-hidden rounded-full"
        style={count === 3 && index === 0 ? { gridColumn: '1 / 3', justifySelf: 'center' } : undefined}>
        <AutomationAvatar name={memberName} size={cell} />
      </span>)}
  </span>
}
