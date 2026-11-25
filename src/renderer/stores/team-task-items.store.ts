/**
 * Team tasks the task panel lists across every space: one entry per task that
 * needs the person — a question for them, a failure or finished work they have
 * not opened — named by its task, not just its team.
 *
 * The homepage list reads one space's tasks; the panel is the place that spans
 * spaces, so this reads each local space's own list (the same "mine" scope:
 * started by the person, waiting on them, or worked on by their digital humans)
 * and keeps only what needs them. Reads are coalesced and happen on team and
 * decision events, while something is subscribed.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { api } from '../api'
import { useSpaceStore } from './space.store'
import { teamTaskKey } from './team-chat-pins.store'
import { teamTaskStatus, useTeamChatSeenStore } from './team-chat-seen.store'
import type { NativeTeamTask } from '../hooks/useTeamConversationRows'
import type { TaskStatus } from '../types'

const PER_SPACE = 30
const COALESCE_MS = 2000

let tasks: NativeTeamTask[] = []
const listeners = new Set<() => void>()
let users = 0
let timer: ReturnType<typeof setTimeout> | undefined
let reading = false
let again = false
let stop: (() => void) | null = null

function publish(next: NativeTeamTask[]) {
  tasks = next
  for (const listener of listeners) listener()
}

/** Every local space, the Halo space first. */
function localSpaceIds(): string[] {
  const spaces = useSpaceStore.getState()
  return [...new Set([spaces.haloSpace?.id, ...spaces.spaces.map(space => space.id)].filter((id): id is string => !!id))]
}

/** Each space's tasks into one list; a task several spaces list opens from the first of them. */
export function mergeSpaceTasks(pages: readonly (readonly NativeTeamTask[])[]): NativeTeamTask[] {
  const merged = new Map<string, NativeTeamTask>()
  for (const page of pages) {
    for (const task of page) {
      const key = teamTaskKey(task.teamId, task.epochId)
      if (!merged.has(key)) merged.set(key, task)
    }
  }
  return [...merged.values()]
}

/** The tasks that need the person: a question, a failure or a finish not yet opened. */
export function teamTaskNeeds(tasks: readonly NativeTeamTask[], seen: Record<string, number>, since: number): TeamTaskNeed[] {
  return tasks.flatMap(task => {
    const status = teamTaskStatus(task, seen[teamTaskKey(task.teamId, task.epochId)], since)
    return status === 'waiting' || status === 'error' || status === 'completed-unseen' ? [{ task, status }] : []
  })
}

async function read() {
  if (reading) { again = true; return }
  reading = true
  try {
    const pages: NativeTeamTask[][] = []
    for (const spaceId of localSpaceIds()) {
      try {
        const page = await api.teamListNativeTasks({ spaceId, limit: PER_SPACE, scope: 'mine' })
        if (page.success && page.data) pages.push(page.data.items)
      } catch (error) {
        console.warn('[TeamTaskItems] A space\'s team tasks could not be read', { spaceId, error })
      }
    }
    if (users > 0) publish(mergeSpaceTasks(pages))
  } finally {
    reading = false
    if (again && users > 0) { again = false; schedule() }
  }
}

function schedule() {
  if (timer !== undefined) return
  timer = setTimeout(() => { timer = undefined; void read() }, COALESCE_MS)
}

function start() {
  void read()
  const offTeam = api.onTeamUpdated(schedule)
  const offAsked = api.onAppEscalation(schedule)
  const offAnswered = api.onAppEscalationResolved(schedule)
  const offSpaces = useSpaceStore.subscribe((state, previous) => {
    if (state.spaces !== previous.spaces || state.haloSpace !== previous.haloSpace) schedule()
  })
  stop = () => { offTeam(); offAsked(); offAnswered(); offSpaces(); clearTimeout(timer); timer = undefined }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Keeps the reads going while at least one caller is mounted. */
function acquire(): () => void {
  if (users++ === 0) start()
  return () => {
    if (--users > 0) return
    stop?.()
    stop = null
    publish([])
  }
}

export interface TeamTaskNeed {
  task: NativeTeamTask
  status: Extract<TaskStatus, 'waiting' | 'error' | 'completed-unseen'>
}

/** Team tasks, across spaces, that need the person now. */
export function useTeamTaskNeeds(): TeamTaskNeed[] {
  useEffect(acquire, [])
  const current = useSyncExternalStore(subscribe, () => tasks)
  const seen = useTeamChatSeenStore(s => s.seen)
  const since = useTeamChatSeenStore(s => s.since)
  return useMemo(() => teamTaskNeeds(current, seen, since), [current, seen, since])
}
