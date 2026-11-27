import { type ReactNode } from 'react'
import { Timer } from 'lucide-react'
import type { TeamCheckView, TeamDetail } from '../../../shared/apps/team-types'
import { useTranslation } from '../../i18n'
import { useTeamStore } from '../../stores/team.store'
import { formatStandingTime, STANDING_MARK, StandingWorkPopover, type StandingItem } from '../chat/StandingWork'
import { describeRhythm } from './check-format'

/**
 * The periodic checks standing in one conversation, as a small mark inside the member
 * rail beside the team progress. A check keeps firing long after it was set and long after
 * the message that set it has scrolled away, so this is where a person can always see that
 * it is still there, and open it to read what it asks, how often it has run, and stop it.
 *
 * Absent when the conversation has none. What each run said stays in the conversation as its own
 * quiet line (see CheckRunLine); this mark is only the live state.
 */
export function EpochChecksChip({ detail, epochId }: { detail: TeamDetail; epochId: string }) {
  const { t } = useTranslation()
  const checks = (detail.checks ?? []).filter(check => check.epochId === epochId)
  if (checks.length === 0) return null
  const unreachable = checks.some(check => !check.reachable)
  return <>
    <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
    <ChecksPopover teamId={detail.team.id} checks={checks} side="top" align="end" label={t('Periodic checks: {{n}}', { n: checks.length })}
      triggerClassName={open => `${STANDING_MARK} ${unreachable ? 'text-halo-warning' : 'text-subtle-foreground'} ${open ? 'bg-foreground/[0.07] text-foreground' : ''}`}>
      <Timer size={13} strokeWidth={1.8} aria-hidden="true" className="shrink-0" />
      <span>{checks.length}</span>
    </ChecksPopover>
  </>
}

/**
 * A team's checks in the standing-work panel. The member rail opens it on one conversation's
 * checks; the team page on all of them, with the way to each task.
 */
export function ChecksPopover({ teamId, checks, side, align, label, triggerClassName, onOpenTask, workLabel, children }: {
  teamId: string
  checks: readonly TeamCheckView[]
  side: 'top' | 'bottom'
  align: 'start' | 'center' | 'end'
  label: string
  triggerClassName: (open: boolean) => string
  /** Opens the task a check stands in; offered only where the panel spans several tasks. */
  onOpenTask?: (epochId: string) => void
  workLabel?: (epochId: string) => string | null
  children: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const cancelCheck = useTeamStore(state => state.cancelCheck)
  const items: StandingItem[] = checks.map(check => {
    const work = workLabel?.(check.epochId)
    return {
      id: check.id,
      meta: [check.createdByMemberName === check.targetMemberName ? check.targetMemberName : `${check.createdByMemberName} → ${check.targetMemberName}`, describeRhythm(check.schedule, t, i18n.language)].join(' · '),
      text: check.instruction,
      ...(!check.reachable ? { warning: t('Not running: {{owner}}’s computer is offline', { owner: check.targetOwner || t('its owner') }) } : {}),
      ...(onOpenTask && work ? { link: { label: t('In {{work}}', { work }), onOpen: () => onOpenTask(check.epochId) } } : {}),
      stats: [t('Runs so far: {{n}}', { n: check.runCount }), check.lastRunAt ? t('Latest run {{time}}', { time: formatStandingTime(check.lastRunAt) }) : t('Not run yet')].join(' · '),
    }
  })
  return <StandingWorkPopover title={t('Periodic checks')} subtitle={t('They run on their own in the background and use model allowance')}
    items={items} side={side} align={align} label={label} triggerClassName={triggerClassName}
    onStop={id => void cancelCheck(teamId, id)}
    stopTitle={t('Stop this periodic check?')} stopMessage={t('The instruction it was checking for is not saved anywhere else — stopping it cannot be undone.')}>
    {children}
  </StandingWorkPopover>
}
