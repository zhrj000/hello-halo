import { Timer } from 'lucide-react'
import type { TeamDetail } from '../../../../shared/apps/team-types'
import { useTranslation } from '../../../i18n'
import { useTeamView } from '../../../stores/team.store'
import { ChecksPopover } from '../EpochChecksChip'
import { epochWorkLabel } from '../run-history'

/**
 * The team's periodic checks, as a mark on the header's status line that opens them. The tasks
 * they stand in are filed with the work in progress, each with its clock; this is the one place
 * to read every check in full, see who set it and stop it — including checks someone else set,
 * which no conversation of the person's would show. Absent when there are none.
 */
export function TeamChecksButton({ detail, onOpenTask }: { detail: TeamDetail; onOpenTask: (epochId: string) => void }) {
  const { t } = useTranslation()
  const conversations = useTeamView(view => view.conversations)
  const epochs = useTeamView(view => view.epochs)
  const checks = detail.checks ?? []
  if (checks.length === 0) return null
  const unreachable = checks.some(check => !check.reachable)
  const label = t('Periodic checks: {{n}}', { n: checks.length })
  const workLabel = (epochId: string) => conversations.some(task => task.epochId === epochId) ? epochWorkLabel(epochId, conversations, epochs, t) : null
  return <ChecksPopover teamId={detail.team.id} checks={checks} side="bottom" align="center" label={label} onOpenTask={onOpenTask} workLabel={workLabel}
    triggerClassName={open => `-mx-1 shrink-0 cursor-pointer items-center gap-1 rounded-full px-1.5 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${unreachable ? 'text-halo-warning' : ''} ${open ? 'bg-secondary text-foreground' : ''}`}>
    <Timer size={12} strokeWidth={1.8} aria-hidden="true" />{label}
  </ChecksPopover>
}
