import type { TFunction } from 'i18next'
import type { RosterMember } from '../../../../shared/apps/team-types'
import { parseSpaceCoordinatorAppId } from '../../../../shared/apps/team-types'
import type { MemberProgress, ProgressSummary } from './progress'

export function progressMemberName(roster: readonly RosterMember[], appId: string | null | undefined, t: TFunction) {
  if (appId && parseSpaceCoordinatorAppId(appId)) return t('Main chat')
  return roster.find(member => member.appId === appId)?.memberName ?? t('Former member')
}

/** What a member needs or is doing here; empty when there is nothing to add to its name. */
export function memberProgressText(row: MemberProgress, roster: readonly RosterMember[], t: TFunction) {
  if (row.state === 'waiting') return row.question ? t('Waiting for you · {{question}}', { question: row.question }) : t('Waiting for its owner’s decision')
  if (row.state === 'failed') return row.senderAppId !== undefined ? t('Didn’t receive {{sender}}’s message', { sender: progressMemberName(roster, row.senderAppId, t) }) : t('Its last turn failed')
  if (row.state === 'working') return row.taskTitle ? t('Working on {{task}}', { task: row.taskTitle }) : t('Working…')
  if (row.state === 'done') return t('Done')
  return row.taskTitle ?? ''
}

export function progressSummaryText(summary: ProgressSummary, outputCount: number, t: TFunction) {
  switch (summary.kind) {
    case 'waiting': return t('{{count}} waiting for you', { count: summary.count })
    case 'failed': return t('{{count}} failed', { count: summary.count })
    case 'decision': return t('{{count}} waiting for a decision', { count: summary.count })
    case 'working': return t('{{count}} working', { count: summary.count })
    case 'done': return [t('Completed'), ...(outputCount ? [t('{{count}} outputs', { count: outputCount })] : [])].join(' · ')
    case 'idle': return t('Team progress')
  }
}
