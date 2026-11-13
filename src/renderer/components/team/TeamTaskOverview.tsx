import { useMemo, useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { BookmarkPlus, Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import type { BlackboardTask, RosterMember, TeamActivity, TeamConversation, TeamDetail } from '../../../shared/apps/team-types'
import { parseSpaceCoordinatorAppId } from '../../../shared/apps/team-types'
import { useTranslation } from '../../i18n'
import { canvasLifecycle } from '../../services/canvas-lifecycle'
import { useTeamStore } from '../../stores/team.store'
import { formatTimeAgo } from '../../utils/format-time'
import { AutomationAvatar } from '../apps/AutomationAvatar'
import { FileIcon } from '../icons/ToolIcons'
import type { ArtifactEntry } from './TeamArtifacts'
import type { MemberProgress, TaskProgress } from './workbench/progress'
import { memberProgressText, progressMemberName } from './workbench/progress-labels'
import { decisionWaits, subtaskBoard, subtaskDurations, type SubtaskCell, type SubtaskGroupId } from './workbench/subtasks'
import { isDelegatedTask } from './workbench/delegations'
import { formatSpan, taskTime } from './workbench/time'
import type { TaskActivityData } from './workbench/useTaskActivity'

/** Stands in for a name inside a translated sentence, so the name can be drawn bold. */
const NAME = '\u0001'
const BRIEF_LIMIT = 3
const OUTPUT_LIMIT = 5
const OPEN_BY_DEFAULT: Record<SubtaskGroupId, boolean> = { waiting: true, failed: true, working: true, pending: false, done: false }
const SECTION = 'mt-9'
const HEADING = 'mb-1.5 ml-0.5 flex items-baseline gap-1.5 text-[13px] font-medium text-foreground/85'
const HEADING_COUNT = 'font-normal tabular-nums text-faint-foreground'

export const STATE_DOT = { waiting: 'bg-halo-warning', failed: 'bg-halo-error', working: 'bg-primary', pending: 'bg-border', done: 'bg-halo-success', idle: 'bg-border' } as const
const CELL: Record<SubtaskCell, string> = { ...STATE_DOT, rejected: 'bg-muted-foreground/30' }

export interface TaskOutput { entry: ArtifactEntry; at: number | null }

/** The overview a team task opens on: where it stands, what it needs from me, and its subtasks. */
export function TeamTaskOverview({ detail, task, data, progress, lastActs, outputs, open, onToggle, onDecision, onOpenMember, onOpenActivity, onGo }: {
  detail: TeamDetail; task: TeamConversation; data: TaskActivityData; progress: TaskProgress
  /** Each member's latest act in this task. */
  lastActs: ReadonlyMap<string, TeamActivity>
  /** Newest first. */
  outputs: readonly TaskOutput[]
  /** Groups opened or closed against their default. */
  open: Readonly<Record<string, boolean>>
  onToggle: (group: SubtaskGroupId, open: boolean) => void
  onDecision: (entryId: string) => void
  onOpenMember: (appId: string) => void
  onOpenActivity: (activityId: string) => void
  onGo: (page: 'history' | 'members') => void
}) {
  const { t } = useTranslation()
  const board = useMemo(() => subtaskBoard(data.tasks, progress.members, data.tasks.some(isDelegatedTask)), [data.tasks, progress.members])
  const durations = useMemo(() => subtaskDurations(data.tasks, data.activities), [data.tasks, data.activities])
  const roster = detail.roster
  const inRoster = (appId: string | null) => !!appId && roster.some(member => member.appId === appId)
  const nameOf = (appId: string | null) => (appId ? progressMemberName(roster, appId, t) : t('Unassigned'))
  const stateOf = useMemo(() => new Map(progress.members.map(row => [row.appId, row])), [progress.members])
  const leadAppId = detail.team.leadAppId ?? null
  const failedMembers = progress.members.filter(row => row.state === 'failed')
  const working = board.groups.find(group => group.id === 'working')?.tasks ?? []
  const finished = progress.finished
  const status = taskStatus(finished, data.pending.length > 0, failedMembers.length > 0 || data.tasks.some(row => row.status === 'blocked'), working.length > 0 || data.busy.length > 0)
  const started = taskTime(task.startedAt)
  const ended = !finished ? Date.now()
    : task.finishedAt ?? (task.completed ? taskTime(task.lastActivityAt) : Math.max(...data.tasks.map(row => row.updatedAt)))
  const span = started !== null && ended !== null && ended > started ? formatSpan(ended - started, t) : null
  const statusText: Record<typeof status, string> = { done: t('Completed'), waiting: t('Waiting on you'), failed: t('Errored'), working: t('In progress'), idle: t('Idle') }
  const [allOutputs, setAllOutputs] = useState(false)
  const waits = useWaitsText(roster, data.activities)
  const outputsBlock = (outputs.length > 0 || data.artifacts.status !== 'ready') && <section className={SECTION} aria-label={t('Outputs')}>
    <div className={HEADING}>
      {t('Outputs')}{outputs.length > 0 && <span className={HEADING_COUNT}>{outputs.length}</span>}
    </div>
    {(allOutputs ? outputs : outputs.slice(0, OUTPUT_LIMIT)).map(output => <OutputRow key={output.entry.path} output={output} onOpen={() => void data.artifacts.openEntry(output.entry)} />)}
    {outputs.length > OUTPUT_LIMIT && <button aria-expanded={allOutputs} onClick={() => setAllOutputs(value => !value)} className="group/more -ml-1.5 mt-1 inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[12.5px] text-subtle-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {allOutputs ? t('Show less') : t('Show {{count}} more', { count: outputs.length - OUTPUT_LIMIT })}
      <ChevronDown size={13} aria-hidden className={`text-faint-foreground transition-transform group-hover/more:text-foreground ${allOutputs ? 'rotate-180' : ''}`} />
    </button>}
    {data.artifacts.status === 'loading' && <p role="status" className="mt-1 flex items-center gap-2 text-xs text-faint-foreground"><Loader2 size={14} className="animate-spin" />{t('Loading outputs…')}</p>}
    {data.artifacts.status === 'failed' && <p role="alert" className="mt-1 text-xs text-destructive">{t('Could not load outputs.')} <button className="underline" onClick={data.retry}>{t('Retry')}</button></p>}
  </section>

  const memberNames = [...progress.members.map(row => row.appId), ...roster.filter(member => !stateOf.has(member.appId)).map(member => member.appId)].map(nameOf)
  const doneCount = data.tasks.filter(row => row.status === 'done').length
  const taskTitle = task.label || (detail.team.ephemeral ? t('Temporary collaboration') : t('New team conversation'))

  const activeBrief = (): ReactNode => {
    const items: ReactNode[] = []
    for (const decision of data.pending) items.push(<BriefItem key={decision.entryId} text={named(t('{{name}} needs your decision: {{question}}', { name: NAME, question: decision.question }), decision.memberName)}
      action={<BriefButton primary onClick={() => onDecision(decision.entryId)}>{t('Go reply')} ↗</BriefButton>} />)
    for (const row of failedMembers) items.push(<BriefItem key={row.appId} text={named(t('{{name}} ran into an error: {{reason}}', { name: NAME, reason: memberProgressText(row, roster, t) }), nameOf(row.appId))}
      action={row.activityId ? <BriefButton onClick={() => onOpenActivity(row.activityId!)}>{t('View')}</BriefButton> : null} />)
    for (const row of data.tasks) {
      if (row.status !== 'blocked' || stateOf.get(row.assigneeAppId ?? '')?.state === 'failed') continue
      items.push(<BriefItem key={row.id} text={named(t('{{name}} ran into an error: {{reason}}', { name: NAME, reason: row.note?.trim() || row.title }), nameOf(row.assigneeAppId))}
        action={inRoster(row.assigneeAppId) ? <BriefButton onClick={() => onOpenMember(row.assigneeAppId!)}>{t('View')}</BriefButton> : null} />)
    }
    const others = working.length || progress.members.filter(row => row.state === 'working' && row.appId !== leadAppId).length
    if (items.length) return <>
      {items.slice(0, BRIEF_LIMIT)}
      {items.length > BRIEF_LIMIT && <p className="text-[13.5px] text-subtle-foreground [&:not(:first-child)]:mt-3">{t('{{count}} more need attention; see the subtasks below.', { count: items.length - BRIEF_LIMIT })}</p>}
      {others > 0 && <p className="text-[13.5px] text-subtle-foreground [&:not(:first-child)]:mt-3">{t('The other {{count}} are going normally.', { count: others })}</p>}
    </>
    if (!others && status === 'idle') return <p>{t('Nothing is running right now.')}</p>
    const only = working.length === 1 ? working[0] : null
    return <>
      <p>{t('Going normally, nothing needs you.')}</p>
      {(only || working.length > 1) && <p className="mt-3 text-[13.5px] text-subtle-foreground">{only
        ? named(t('{{name}} is working on “{{task}}”.', { name: NAME, task: only.title }), nameOf(only.assigneeAppId))
        : t('{{count}} subtasks are in progress.', { count: working.length })}</p>}
    </>
  }
  const summary = task.completed || task.finishedAt !== undefined ? task.summary?.trim() : undefined
  const brief = finished
    ? completedBrief({ summary, tasks: data.tasks, waits: span ? waits : null, outputCount: data.artifacts.status === 'ready' ? outputs.length : null, t })
    : activeBrief()
  const openOf = (row: BlackboardTask) => (inRoster(row.assigneeAppId) ? () => onOpenMember(row.assigneeAppId!) : undefined)
  const lite = (row: BlackboardTask) => <LiteRow key={row.id} row={row} who={nameOf(row.assigneeAppId)} took={durations.has(row.id) ? formatSpan(durations.get(row.id)!, t) : null} onOpen={openOf(row)} />
  const allSettled = board.groups.length === 1 && board.groups[0].id === 'done'

  return <>
    <div className="flex items-center gap-3">
      <button onClick={() => onGo('members')} className="-ml-1 flex min-w-0 items-center gap-2 rounded-full py-0.5 pl-1 pr-2 text-[12.5px] text-subtle-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {memberNames.length > 0 && <AvatarStack names={memberNames} />}
        <span className="truncate">
          <span className="font-medium text-foreground/80">{detail.team.ephemeral ? t('Temporary team') : detail.team.name}</span>
          {memberNames.length > 0 && <> · {memberList(memberNames, t)}</>}
        </span>
      </button>
      <span className="flex-1" />
      {detail.team.ephemeral && <KeepTeam team={detail.team} />}
    </div>

    <h2 title={taskTitle} className="mt-3 line-clamp-2 break-words text-[18px] font-semibold leading-[1.45] tracking-[-0.01em]">{taskTitle}</h2>
    <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-subtle-foreground">
      <span aria-hidden className={`h-[7px] w-[7px] shrink-0 rounded-full ${STATE_DOT[status]}`} />
      <span className={status === 'waiting' ? 'text-halo-warning' : status === 'failed' ? 'text-destructive' : ''}>{statusText[status]}</span>
      {span && status !== 'idle' && <span>· {finished ? t('Took {{time}}', { time: span }) : t('Running for {{time}}', { time: span })}</span>}
      {data.tasks.length > 0 && <span className="tabular-nums">· {t('{{done}}/{{total}} subtasks', { done: doneCount, total: data.tasks.length })}</span>}
    </p>
    {brief && <div className="mt-4 rounded-[18px] bg-card px-[18px] py-3.5 text-[14.5px] leading-[1.75] [&_b]:font-semibold">{brief}</div>}

    {finished && outputsBlock}

    <section className={SECTION} aria-label={t('Subtasks')}>
      <div className={HEADING}>
        {t('Subtasks')}<span className={HEADING_COUNT}>{data.tasks.length}</span>
      </div>
      {!data.tasks.length ? (!data.loaded && !data.failed
        ? <p role="status" className="mt-2 flex items-center gap-2 text-xs text-faint-foreground"><Loader2 size={14} className="animate-spin" />{t('Loading conversation…')}</p>
        : <p className="mt-2 text-[13px] text-faint-foreground">{finished ? t('This task was not split into subtasks.') : t('The lead has not split this into subtasks yet.')}</p>)
        : <>
          <div className="mt-2 flex h-[5px] gap-0.5" aria-hidden>{board.cells.map((cell, index) => <i key={index} className={`min-w-[3px] flex-1 rounded-[3px] ${CELL[cell]}`} />)}</div>
          {allSettled ? <ul className="mt-2">{board.groups[0].tasks.map(lite)}</ul> : <div className="mt-3 space-y-1.5">{board.groups.map(group => {
            const isOpen = open[group.id] ?? OPEN_BY_DEFAULT[group.id]
            const label = { waiting: t('Waiting on you'), failed: t('Errored'), working: t('In progress'), pending: t('Not started yet'), done: t('Completed') }[group.id]
            return <div key={group.id} className={`rounded-[14px] bg-card px-2.5 ${isOpen ? 'pb-1' : ''}`}>
              <button aria-expanded={isOpen} onClick={() => onToggle(group.id, !isOpen)} className={`group/head flex w-full items-center text-left text-[12.5px] text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isOpen ? 'pb-[3px] pt-[11px]' : 'py-[11px]'}`}>
                <span aria-hidden className={`ml-[9px] mr-[21px] h-2 w-2 shrink-0 rounded-full ${STATE_DOT[group.id]}`} />
                {label}<span className="ml-1 tabular-nums">{group.tasks.length}</span>
                <ChevronRight size={13} aria-hidden className={`text-faint-foreground transition-transform group-hover/head:text-foreground ${isOpen ? 'ml-[7px] rotate-90' : 'ml-1'}`} />
              </button>
              {isOpen && <ul>{group.tasks.map(row => group.id === 'pending' || group.id === 'done'
                ? lite(row)
                : <ActiveRow key={row.id} row={row} who={nameOf(row.assigneeAppId)} state={stateOf.get(row.assigneeAppId ?? '')} roster={roster} latest={row.assigneeAppId ? lastActs.get(row.assigneeAppId)?.subject : undefined}
                  onOpen={openOf(row)} />)}</ul>}
            </div>
          })}</div>}
        </>}
    </section>

    {!finished && outputsBlock}

    <button onClick={() => onGo('history')} className="mt-8 block text-[12.5px] text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {t('{{count}} collaboration records', { count: data.activities.length })} ›
    </button>
  </>
}

/** Keeps a temporary team, or opens the team it was kept as. */
function KeepTeam({ team }: { team: TeamDetail['team'] }) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const keep = async () => {
    setSaving(true)
    try { await useTeamStore.getState().saveCollab(team.id) } finally { setSaving(false) }
  }
  const action = 'flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'
  return team.savedTeamId
    ? <button onClick={() => void canvasLifecycle.openTeam(team.savedTeamId!)} className={action}>{t('Open saved team')}<ChevronRight size={12} aria-hidden="true" /></button>
    : <button disabled={saving} onClick={() => void keep()} className={action}><BookmarkPlus size={13} aria-hidden="true" />{t('Keep this team')}</button>
}

function taskStatus(finished: boolean, waiting: boolean, failed: boolean, working: boolean): 'done' | 'waiting' | 'failed' | 'working' | 'idle' {
  if (finished) return 'done'
  if (waiting) return 'waiting'
  if (failed) return 'failed'
  return working ? 'working' : 'idle'
}

/**
 * What a finished task's brief adds to its status line, or null when nothing:
 * the closing summary, rejected subtasks (the "done/total" count reads them as
 * unfinished), the waits within the time shown, and that nothing was produced.
 */
function completedBrief({ summary, tasks, waits, outputCount, t }: {
  /** What the work ended with, when it was ended rather than read off a settled board. */
  summary: string | undefined; tasks: readonly BlackboardTask[]
  /** Null when the status line shows no duration for the waits to be part of. */
  waits: string | null
  /** Null while the outputs are not known yet. */
  outputCount: number | null
  t: TFunction
}): ReactNode {
  const done = tasks.filter(row => row.status === 'done').length
  const rejected = tasks.filter(row => row.status === 'rejected').length
  const head = summary
    || (rejected ? t('{{first}}, {{next}}', { first: t('{{count}} subtasks completed', { count: done }), next: t('{{count}} rejected', { count: rejected }) }) : null)
  const facts = [waits ? t('Of that, {{waits}}', { waits }) : null, outputCount === 0 ? t('No output files') : null].filter(Boolean)
  if (!head && !facts.length) return null
  return <>
    {head && <p className="line-clamp-4 whitespace-pre-line">{head}</p>}
    {facts.length > 0 && <p className="text-[13.5px] text-subtle-foreground [&:not(:first-child)]:mt-3">{facts.join(' · ')}</p>}
  </>
}

/** "waiting for you 5 min, for Zhang 12 min": who had to answer, and for how long. */
function useWaitsText(roster: readonly RosterMember[], activities: readonly TeamActivity[]): string | null {
  const { t } = useTranslation()
  return useMemo(() => {
    const ownerOf = (appId: string) => {
      const member = roster.find(row => row.appId === appId)
      if (!member) return `member:${appId}`
      if (member.owner == null && member.sameMachine !== false) return ''
      return member.owner ? `owner:${member.owner}` : `member:${appId}`
    }
    const { shown, others } = decisionWaits(activities, ownerOf)
    const parts = shown.map(({ owner, ms }) => {
      const time = formatSpan(ms, t)
      if (!owner) return t('waiting for you {{time}}', { time })
      if (owner.startsWith('owner:')) return t('waiting for {{owner}} {{time}}', { owner: owner.slice(6), time })
      return t('waiting for {{member}}’s owner {{time}}', { member: progressMemberName(roster, owner.slice(7), t), time })
    })
    if (others) parts.push(t('waiting for {{count}} others {{time}}', { count: others.count, time: formatSpan(others.ms, t) }))
    return parts.length ? parts.reduce((first, next) => t('{{first}}, {{next}}', { first, next })) : null
  }, [activities, roster, t])
}

const NAMES_SHOWN = 3

/** "Ann, Bo, Cy and 2 more". */
function memberList(names: readonly string[], t: TFunction): string {
  const shown = names.slice(0, NAMES_SHOWN).reduce((first, next) => t('{{first}}, {{next}}', { first, next }))
  return names.length > NAMES_SHOWN ? t('{{names}} and {{count}} more', { names: shown, count: names.length - NAMES_SHOWN }) : shown
}

function BriefItem({ text, action }: { text: ReactNode; action: ReactNode }) {
  return <div className="[&:not(:first-child)]:mt-3">
    <p className="break-words">{text}</p>
    {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
  </div>
}

function BriefButton({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className={`h-8 rounded-full px-3.5 text-[13px] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${primary ? 'bg-foreground text-background hover:opacity-90' : 'bg-background ring-1 ring-inset ring-border hover:bg-secondary'}`}>{children}</button>
}

/** A translated sentence with its `NAME` marker drawn as the bold name. */
function named(text: string, name: string): ReactNode {
  return text.split(NAME).flatMap((part, index) => (index ? [<b key={index}>{name}</b>, part] : [part]))
}

export function AvatarStack({ names, limit = 4 }: { names: readonly string[]; limit?: number }) {
  return <span className="flex">
    {names.slice(0, limit).map((name, index) => <span key={index} className="-ml-[7px] flex rounded-full ring-2 ring-background first:ml-0"><AutomationAvatar name={name} size={24} /></span>)}
    {names.length > limit && <span className="-ml-[7px] flex h-6 min-w-6 items-center justify-center rounded-full bg-secondary px-1 text-[10.5px] font-medium tabular-nums text-subtle-foreground ring-2 ring-background">+{names.length - limit}</span>}
  </span>
}

const ROW = '-mx-2.5 flex w-[calc(100%+20px)] items-center gap-3 rounded-xl px-2.5 py-[9px] text-left'

function ActiveRow({ row, who, state, roster, latest, onOpen }: {
  row: BlackboardTask; who: string; state: MemberProgress | undefined; roster: readonly RosterMember[]; latest?: string; onOpen?: () => void
}) {
  const { t } = useTranslation()
  const detail = row.status === 'blocked'
    ? <span className="text-destructive">{row.note?.trim() || t('Cannot continue')}</span>
    : state?.state === 'waiting' ? <span className="text-halo-warning">{state.decisionId ? t('Waiting on you') : memberProgressText(state, roster, t)}</span>
      : state?.state === 'failed' ? <span className="text-destructive">{memberProgressText(state, roster, t)}</span>
        : row.note?.trim() || latest?.trim()
  const body = <>
    <AutomationAvatar name={who} size={26} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">{row.title}</span>
      <span className="mt-px block truncate text-[12.5px] text-faint-foreground">{who}{detail ? <> · {detail}</> : null}</span>
    </span>
    <span className="shrink-0 whitespace-nowrap text-xs text-faint-foreground">{formatTimeAgo(row.updatedAt, t)}</span>
  </>
  return <li>{onOpen
    ? <button onClick={onOpen} className={`${ROW} hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}>{body}</button>
    : <div className={ROW}>{body}</div>}</li>
}

function LiteRow({ row, who, took, onOpen }: { row: BlackboardTask; who: string; took: string | null; onOpen?: () => void }) {
  const { t } = useTranslation()
  const rejected = row.status === 'rejected'
  const body = <>
    {row.status === 'done' ? <span aria-label={t('Completed')} className="mx-[5px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-halo-success text-white"><Check size={10} strokeWidth={3} /></span>
      : rejected ? <span aria-label={t('Rejected')} className="mx-[5px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"><X size={10} strokeWidth={3} /></span>
        : <span aria-hidden className="mx-[5px] h-4 w-4 shrink-0 rounded-full border-[1.6px] border-dashed border-faint-foreground/60" />}
    <span className={`min-w-0 flex-1 truncate text-[13.5px] ${rejected ? 'text-subtle-foreground line-through decoration-faint-foreground' : ''}`}>{row.title}</span>
    <span className="max-w-[45%] shrink-0 truncate text-xs text-faint-foreground">{took ? `${who} · ${t('Took {{time}}', { time: took })}` : who}</span>
  </>
  return <li>{onOpen
    ? <button onClick={onOpen} className={`${ROW} hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}>{body}</button>
    : <div className={ROW}>{body}</div>}</li>
}

function OutputRow({ output, onOpen }: { output: TaskOutput; onOpen: () => void }) {
  const { t } = useTranslation()
  const { entry, at } = output
  const by = entry.appId && parseSpaceCoordinatorAppId(entry.appId) ? t('Main chat') : entry.memberName
  const dot = entry.name.lastIndexOf('.')
  return <button onClick={onOpen} className={`${ROW} hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
    <FileIcon extension={dot > 0 ? entry.name.slice(dot + 1) : ''} size={16} className="mx-[5px] shrink-0" />
    <span className="min-w-0 flex-1 truncate text-[13.5px]">{entry.name}</span>
    {(by || at !== null) && <span className="max-w-[45%] shrink-0 truncate text-xs text-faint-foreground">{[by, at !== null ? formatTimeAgo(at, t) : null].filter(Boolean).join(' · ')}</span>}
  </button>
}
