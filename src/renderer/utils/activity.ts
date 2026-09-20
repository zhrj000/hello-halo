/**
 * Activity entry selectors shared across surfaces that need "what did this
 * digital human last produce" — currently the overview tab's output block.
 * The card wall does NOT use this: it reads `AppOverviewEntry.latestSummary`,
 * the server-computed equivalent, to avoid loading full activity entries for
 * every card just to render two lines of text (see the card-wall performance
 * budget in 数字人看板-需求文档.md §11 P1/P2).
 */

import type { ActivityEntry } from '../../shared/apps/app-types'

/** Most recent run_complete/output entry. `entries` must be newest-first. */
export function selectLatestOutput(entries: ActivityEntry[]): ActivityEntry | undefined {
  return entries.find(e => e.type === 'run_complete' || e.type === 'output')
}
