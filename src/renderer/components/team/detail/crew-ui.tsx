import { useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import type { TeamActivity } from '../../../../shared/apps/team-types'
import { recentTalk, talkExpiry, type CrewState } from './crew'

/** `partners` are the names of whoever this member is talking with right now. */
export function crewStateText(state: CrewState, partners: readonly string[], t: TFunction): string {
  if (state === 'waiting') return t('Waiting for a decision')
  if (state === 'failed') return t('Ran into a problem')
  if (state === 'offline') return t('Offline')
  if (state === 'done') return t('Did their part')
  if (state === 'idle') return t('On standby')
  return partners.length ? t('Talking with {{names}}', { names: partners.join(', ') }) : t('Working')
}

/** Exchanges still inside the talk window; recomputed when the oldest leaves it, not on a poll. */
export function useRecentTalk(activities: readonly TeamActivity[] | undefined): TeamActivity[] {
  const [tick, setTick] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recent = useMemo(() => recentTalk(activities ?? [], Date.now()), [activities, tick])
  useEffect(() => {
    const expiry = talkExpiry(recent)
    if (expiry === null) return
    const timer = setTimeout(() => setTick(value => value + 1), Math.max(0, expiry - Date.now()) + 100)
    return () => clearTimeout(timer)
  }, [recent])
  return recent
}
