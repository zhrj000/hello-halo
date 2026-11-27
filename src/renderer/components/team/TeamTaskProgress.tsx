import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import type { BlackboardTask, RosterMember, TeamActivity, TeamConversation, TeamDetail } from '../../../shared/apps/team-types'
import type { TeamTaskViewMemory } from '../../services/canvas-lifecycle'
import { useAppsStore } from '../../stores/apps.store'
import { useTeamStore, useTeamView } from '../../stores/team.store'
import { useTeamViewPrefsStore } from '../../stores/team-view-prefs.store'
import { useCollabMemberViewStore } from '../../stores/collab-member-view.store'
import { navigateToConversation } from '../../utils/conversation-navigation'
import { useTranslation } from '../../i18n'
import { formatTimeAgo } from '../../utils/format-time'
import { openPersonTeam } from '../../utils/people-navigation'
import { openTeamConversation } from '../../utils/team-conversation-navigation'
import { AutomationAvatar } from '../apps/AutomationAvatar'
import type { OpenOutput } from './TeamArtifacts'
import { useHeldDecisions } from './detail/DecisionCard'
import { memberOwner } from './detail/member-ui'
import { useTaskOverview } from './detail/TaskBody'
import { PANEL_ACTION, SectionHeading } from './detail/task-ui'
import { TeamMemberSettings } from './TeamMemberSettings'
import { TeamTaskOverview } from './TeamTaskOverview'
import { detailForTask, ownedTaskMembers } from './workbench/members'
import type { MemberProgress, TaskProgress as Progress } from './workbench/progress'
import { memberProgressText, progressMemberName } from './workbench/progress-labels'
import { taskTime } from './workbench/time'
import { useTaskBoard } from './workbench/useTaskBoard'
import { useTaskActivity } from './workbench/useTaskActivity'
import { TaskCollaborationHistory, TaskMemberExecution } from './workbench/TaskActivitySections'

type Section = NonNullable<TeamTaskViewMemory['section']>
const SECTIONS: readonly Section[] = ['overview', 'history', 'members']

export interface TeamTaskReveal {
  seq: number
  activityId?: string
  memberAppId?: string
  profileAppId?: string
}

/** One team conversation's progress for the right canvas: an overview, with its outputs, collaboration record and members a step away. */
export function TeamTaskProgress({ spaceId, epochId, teamDetail, memory, reveal, onRevealHandled, onLeave, openFile }: {
  spaceId: string; epochId: string; teamDetail: TeamDetail
  /** Where the user was, so returning to the tab lands there again. */
  memory: TeamTaskViewMemory
  reveal?: TeamTaskReveal
  onRevealHandled: (seq: number) => void
  /** Called after navigating to the conversation, so a full-screen canvas can step aside. */
  onLeave?: () => void
  openFile?: OpenOutput
}) {
  const { t } = useTranslation()
  const conversations = useTeamView(view => view.conversations)
  const loading = useTeamView(view => view.isLoadingConversations)
  const task = conversations.find(item => item.epochId === epochId) ?? null
  if (!task) return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
    {loading ? <Loader2 className="animate-spin text-muted-foreground" aria-label={t('Loading conversation…')} /> : <>
      <p role="alert" className="text-sm text-muted-foreground">{t('This conversation is unavailable. Refresh the conversation list to try again.')}</p>
      <button onClick={() => void useTeamStore.getState().loadConversations(teamDetail.team.id)} className="rounded px-3 py-2 text-sm text-primary">{t('Retry')}</button>
    </>}
  </div>
  return <TaskProgress spaceId={spaceId} task={task} teamDetail={teamDetail} memory={memory} reveal={reveal} onRevealHandled={onRevealHandled} onLeave={onLeave} openFile={openFile} />
}

function TaskProgress({ spaceId, task, teamDetail, memory, reveal, onRevealHandled, onLeave, openFile }: {
  spaceId: string; task: TeamConversation; teamDetail: TeamDetail; memory: TeamTaskViewMemory; reveal?: TeamTaskReveal; onRevealHandled: (seq: number) => void; onLeave?: () => void; openFile?: OpenOutput
}) {
  const { t } = useTranslation()
  const baseDetail = useMemo(() => detailForTask(teamDetail, task), [teamDetail, task])
  const boardState = useTaskBoard(baseDetail, task.epochId)
  // A temporary team's members join this one task, so only its board lists them.
  const detail = useMemo(() => detailForTask(teamDetail, task, boardState.board), [teamDetail, task, boardState.board])
  const [section, setSection] = useState<Section>(SECTIONS.includes(memory.section as Section) ? memory.section! : 'overview')
  const [open, setOpen] = useState<Record<string, boolean>>(memory.open ?? {})
  const [executionMember, setExecutionMember] = useState<string | null>(memory.memberAppId ?? null)
  // A member's profile is a step inside the members page, never a page of its own.
  const [profile, setProfile] = useState<string | null>(memory.section === 'members' ? memory.profileAppId ?? null : null)
  useEffect(() => {
    memory.section = section
    memory.open = open
    memory.memberAppId = executionMember ?? undefined
    memory.profileAppId = profile ?? undefined
  }, [memory, section, open, executionMember, profile])
  const [focus, setFocus] = useState<{ seq: number; activityId: string } | null>(null)
  const data = useTaskActivity(detail, task, boardState, !executionMember, openFile)
  const handled = useRef(onRevealHandled)
  handled.current = onRevealHandled
  const showActivity = useRef((activityId: string, seq: number) => {
    setExecutionMember(null)
    setProfile(null)
    setSection('history')
    setFocus({ seq, activityId })
  }).current
  useEffect(() => {
    if (!reveal) return
    if (reveal.memberAppId) setExecutionMember(reveal.memberAppId)
    else if (reveal.profileAppId) {
      setExecutionMember(null)
      setSection('members')
      setProfile(reveal.profileAppId)
    } else if (reveal.activityId) showActivity(reveal.activityId, reveal.seq)
    handled.current(reveal.seq)
  }, [reveal, showActivity])

  const overview = useTaskOverview(detail, task, data)
  const held = useHeldDecisions(data.pending)

  // A temporary team's members show in the conversation that leads it, which only its own machine has.
  const onTalkTo = (appId: string) => {
    if (task.kind === 'collab') {
      const source = task.sourceConversation
      if (!source) return setExecutionMember(appId)
      useCollabMemberViewStore.getState().open(source.conversationId, appId)
      navigateToConversation(source.spaceId, source.conversationId)
      return onLeave?.()
    }
    useTeamViewPrefsStore.getState().rememberTaskMember(detail.team.id, task.epochId, appId)
    if (openTeamConversation(spaceId, { teamId: detail.team.id, epochId: task.epochId, teamName: detail.team.name, label: task.label, appId })) onLeave?.()
  }

  const back = (onClick: () => void, label = t('Team progress'), action?: ReactNode) => <div className="sticky top-0 z-20 -mx-4 -mt-[18px] flex h-11 items-center justify-between gap-3 bg-background px-4 sm:-mx-6 sm:-mt-[22px] sm:px-6">
    <button onClick={onClick} className="min-w-0 truncate text-[12.5px] text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">← {label}</button>
    {action}
  </div>
  const inspected = detail.roster.find(member => member.appId === executionMember)
  const profiled = !inspected && section === 'members' ? detail.roster.find(member => member.appId === profile) : undefined

  // Back from a profile lands on the list where it was left, not at its top.
  const scroller = useRef<HTMLDivElement | null>(null)
  const listTop = useRef<number | null>(null)
  const openProfile = (appId: string) => {
    listTop.current = scroller.current?.scrollTop ?? 0
    setProfile(appId)
  }
  useLayoutEffect(() => {
    if (profiled || listTop.current === null || !scroller.current) return
    scroller.current.scrollTop = listTop.current
    listTop.current = null
  }, [profiled])

  const apps = useAppsStore(state => state.apps)
  const owned = useMemo(() => new Set(ownedTaskMembers(detail, apps).map(member => member.appId)), [detail, apps])
  const work = memberWork(detail, overview.progress, data.tasks, overview.lastActs, t)
  const profileAction = (member: RosterMember) => {
    if (work.progressOf.has(member.appId)) return <button onClick={() => onTalkTo(member.appId)} className={PANEL_ACTION}>
      {t('View its conversation in this task')}<span aria-hidden="true">↗</span>
    </button>
    // Outside this task there is no conversation here to show; one of my own can still be talked to.
    if (task.kind === 'collab' || !owned.has(member.appId)) return undefined
    const chat = () => {
      if (openTeamConversation(spaceId, { teamId: detail.team.id, epochId: null, teamName: detail.team.name, appId: member.appId })) onLeave?.()
    }
    return <button onClick={chat} className={PANEL_ACTION}>{t('Chat with {{name}}', { name: progressMemberName(detail.roster, member.appId, t) })}<span aria-hidden="true">↗</span></button>
  }
  // Editing a member belongs to the team page; a temporary team has none.
  const manage = (appId: string) => task.kind !== 'collab' && owned.has(appId)
    ? () => { openPersonTeam({ teamId: detail.team.id, appId }); onLeave?.() }
    : undefined

  const pageKey = inspected ? `member:${inspected.appId}` : profiled ? `profile:${profiled.appId}` : section
  return <div ref={scroller} key={pageKey} className="h-full overflow-y-auto">
    {/* Members are single-line lists that use extra width; the rest keep a reading width.
        The sticky back bar's height, so sticky content below it stops underneath instead of behind it. */}
    <div className={`mx-auto ${!inspected && !profiled && section === 'members' ? 'max-w-5xl' : 'max-w-3xl'} px-4 pb-8 pt-[18px] [--page-sticky-top:2.75rem] sm:px-6 sm:pb-10 sm:pt-[22px]`}>
      {data.failed && <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl bg-destructive/5 p-3 text-xs text-destructive"><AlertCircle size={15} className="shrink-0" /><span className="flex-1">{t('Could not load conversation history.')}</span><button onClick={data.retry} className="inline-flex shrink-0 items-center gap-1 rounded hover:underline"><RefreshCw size={12} />{t('Retry')}</button></div>}
      {inspected ? <>
        {back(() => setExecutionMember(null))}
        <div className="space-y-4"><TaskMemberExecution detail={detail} task={task} member={inspected} homepageConversation /></div>
      </> : profiled ? <>
        {back(() => setProfile(null), t('Members'), profileAction(profiled))}
        <MemberProfile detail={detail} member={profiled} work={work} onManage={manage(profiled.appId)} />
      </> : section === 'overview' ? <TeamTaskOverview detail={detail} task={task} taskSpaceId={spaceId} data={data} overview={overview} held={held} open={open} setOpen={setOpen}
        onTalkTo={onTalkTo} onOpenExchange={id => showActivity(id, Date.now())} onGo={setSection} />
        : <>
          {back(() => setSection('overview'))}
          {section === 'history' && <Page title={t('Collaboration record')} subtitle={t('How the lead split the work and what members handed over')}>
            <TaskCollaborationHistory key={focus?.seq} data={data} detail={detail} task={task} focusActivityId={focus?.activityId} homepageConversation onOpenMember={onTalkTo} />
          </Page>}
          {section === 'members' && <Page title={t('Members')} subtitle={t('{{count}} members', { count: detail.roster.length })}>
            <TaskMembersPage detail={detail} work={work} lastActs={overview.lastActs} onOpen={openProfile} />
          </Page>}
        </>}
    </div>
  </div>
}

function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <>
    <h2 className="mb-1 text-[17px] font-semibold">{title}</h2>
    {subtitle && <p className="mb-3.5 text-[12.5px] text-faint-foreground">{subtitle}</p>}
    {children}
  </>
}

type MemberGroup = 'waiting' | 'failed' | 'working' | 'pending' | 'done' | 'idle' | 'absent' | 'offline'

interface MemberWork {
  progressOf: ReadonlyMap<string, MemberProgress>
  groupOf: (appId: string) => MemberGroup
  /** What it is doing or has done in this task; for a member outside it, its duty. */
  workOf: (appId: string) => string
  labels: Record<MemberGroup, string>
}

/** Where each member stands in this task, shared by the members list and a member's profile so both say the same. */
function memberWork(detail: TeamDetail, progress: Progress, tasks: readonly BlackboardTask[], lastActs: ReadonlyMap<string, TeamActivity>, t: TFunction): MemberWork {
  const progressOf = new Map(progress.members.map(row => [row.appId, row]))
  const memberOf = (appId: string) => detail.roster.find(member => member.appId === appId)
  const groupOf = (appId: string): MemberGroup => {
    const row = progressOf.get(appId)
    // A question for you or a failure still needs you; anything else an offline member was doing is stale,
    // and its owner's computer would not even receive new work, as the member selector and team scene say.
    if (row?.state === 'failed' || (row?.state === 'waiting' && row.decisionId)) return row.state === 'failed' ? 'failed' : 'waiting'
    if (memberOf(appId)?.presence === 'offline') return 'offline'
    return !row ? 'absent'
      : row.state === 'waiting' ? (row.decisionId ? 'waiting' : 'working')
        : row.state === 'idle' ? (row.taskTitle ? 'pending' : 'idle') : row.state
  }
  const record = (appId: string) => {
    const finished = tasks.filter(task => task.assigneeAppId === appId && task.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt)
    if (finished.length > 1) return t('Finished “{{task}}” and {{count}} more', { task: finished[0].title, count: finished.length - 1 })
    if (finished.length) return t('Finished “{{task}}”', { task: finished[0].title })
    const split = tasks.filter(task => task.createdByAppId === appId && task.assigneeAppId !== appId).length
    if (split) return t('Split the work into {{count}} subtasks', { count: split })
    return lastActs.get(appId)?.subject ?? ''
  }
  const workOf = (appId: string) => {
    const row = progressOf.get(appId)
    if (groupOf(appId) === 'offline') return [t('Offline'), memberOf(appId)?.owner].filter(Boolean).join(' · ')
    if (!row) return memberOf(appId)?.duty ?? ''
    if (row.state === 'idle' && row.taskTitle) return t('Up next: “{{task}}”', { task: row.taskTitle })
    if (row.state === 'done') return record(appId) || t('Done')
    if (row.state === 'idle') return record(appId) || t('Idle')
    return memberProgressText(row, detail.roster, t)
  }
  const labels: Record<MemberGroup, string> = {
    waiting: t('Waiting on you'), failed: t('Errored'), working: t('In progress'), pending: t('Not started yet'),
    done: t('Completed'), idle: t('Idle'), absent: t('Not in this task'), offline: t('Offline'),
  }
  return { progressOf, groupOf, workOf, labels }
}

const groupTone = (group: MemberGroup) => group === 'waiting' ? 'text-halo-warning' : group === 'failed' ? 'text-destructive' : 'text-faint-foreground'

/**
 * A member's face with its state in this task. Only an offline member is greyed, with no stale dot:
 * one outside the task keeps its colours, so taking no part never reads as being offline.
 */
function TaskMemberFace({ name, row, group, size }: { name: string; row: MemberProgress | undefined; group: MemberGroup; size: number }) {
  const offline = group === 'offline'
  const dot = row && row.state !== 'idle' && !offline ? row.state : null
  return <span className={`relative flex shrink-0 ${offline ? 'opacity-50 grayscale' : ''}`}>
    <AutomationAvatar name={name} size={size} />
    {dot && <i aria-hidden="true" data-tone={dot} className="avatar-status-dot" />}
  </span>
}

/** Every member of the team, with what each is doing or has done in this task; each opens its profile. */
function TaskMembersPage({ detail, work, lastActs, onOpen }: {
  detail: TeamDetail; work: MemberWork; lastActs: ReadonlyMap<string, TeamActivity>; onOpen: (appId: string) => void
}) {
  const { t } = useTranslation()
  const groups = (Object.keys(work.labels) as MemberGroup[])
    .map(id => ({ id, members: detail.roster.filter(member => work.groupOf(member.appId) === id) }))
    .filter(group => group.members.length)
  return <>{groups.map(group => <section key={group.id}>
    <h3 className="mb-0.5 ml-0.5 mt-[18px] text-xs text-faint-foreground first:mt-0">{work.labels[group.id]} <span className="tabular-nums">{group.members.length}</span></h3>
    {group.members.map(member => {
      const name = progressMemberName(detail.roster, member.appId, t)
      const text = work.workOf(member.appId)
      const at = taskTime(lastActs.get(member.appId)?.createdAt)
      return <button key={member.appId} onClick={() => onOpen(member.appId)} className="-mx-2.5 flex w-[calc(100%+20px)] items-center gap-3 rounded-xl px-2.5 py-[9px] text-left hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <TaskMemberFace name={name} row={work.progressOf.get(member.appId)} group={group.id} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}{member.role && <span className="font-normal text-faint-foreground"> · {member.role}</span>}</span>
          {text && <span title={text} className={`mt-px block truncate text-[12.5px] ${groupTone(group.id)}`}>{text}</span>}
        </span>
        {at !== null && <span className="shrink-0 whitespace-nowrap text-xs text-faint-foreground">{formatTimeAgo(at, t)}</span>}
      </button>
    })}
  </section>)}</>
}

/**
 * Who a member is, read from inside this task: its state here (not across the team,
 * which the team page shows), then everything the team page's member settings show,
 * read-only (only a periodic check can be stopped). Changing a member is the team
 * page's, reached through `onManage`.
 */
function MemberProfile({ detail, member, work, onManage }: {
  detail: TeamDetail; member: RosterMember; work: MemberWork; onManage?: () => void
}) {
  const { t } = useTranslation()
  // The team page's own member settings, read-only here, so the two never drift apart.
  const settings = detail.members.find(entry => entry.appId === member.appId)
  const name = progressMemberName(detail.roster, member.appId, t)
  const row = work.progressOf.get(member.appId)
  const group = work.groupOf(member.appId)
  // The owner is already named under the name, so an offline member just reads "Offline" here.
  const status = group === 'offline' ? work.labels.offline : row ? work.workOf(member.appId) : work.labels.absent
  const owner = memberOwner(member, t)
  const duty = member.duty?.trim()
  const box = 'whitespace-pre-wrap break-words rounded-xl bg-secondary/50 px-3.5 py-2.5 text-[13px] leading-relaxed'
  return <div className="space-y-7 pt-2">
    <header className="flex items-center gap-3.5">
      <TaskMemberFace name={name} row={row} group={group} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[17px] font-semibold leading-7">{name}</h2>
          {member.isLead && <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-subtle-foreground">{t('Lead')}</span>}
        </div>
        {(member.role || owner) && <p className="truncate text-[13px] text-faint-foreground">{[member.role, owner].filter(Boolean).join(' · ')}</p>}
        {status && <p title={status} className={`mt-0.5 line-clamp-2 break-words text-[13px] ${groupTone(group)}`}>{status}</p>}
      </div>
      {/* Seen on arrival rather than below a long read-only page; a secondary way out, so a quiet link. */}
      {onManage && <button onClick={onManage} className="mt-1 inline-flex shrink-0 items-center gap-1 self-start rounded text-[13px] text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {t('Manage in team details')}<span aria-hidden="true">↗</span>
      </button>}
    </header>

    {settings
      ? <TeamMemberSettings key={member.appId} detail={detail} member={settings} onBack={() => {}} embedded readOnly onManage={onManage} />
      // A temporary team's collaborator has no member row: only its duty is known.
      : <section>
        <SectionHeading title={t('Duty in this team')} />
        <p className={`${box} ${duty ? 'text-foreground' : 'text-faint-foreground'}`}>{duty || t('Nothing written yet.')}</p>
      </section>}
  </div>
}
