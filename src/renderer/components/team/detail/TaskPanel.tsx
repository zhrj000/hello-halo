import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import type { TeamConversation, TeamDetail } from '../../../../shared/apps/team-types'
import type { TeamTaskViewMemory } from '../../../services/canvas-lifecycle'
import { useConfirmDialog } from '../../../hooks/useConfirmDialog'
import { useTranslation } from '../../../i18n'
import { useCollabMemberViewStore } from '../../../stores/collab-member-view.store'
import { useTeamStore } from '../../../stores/team.store'
import { useTeamViewPrefsStore } from '../../../stores/team-view-prefs.store'
import { navigateToConversation } from '../../../utils/conversation-navigation'
import { openTeamConversation } from '../../../utils/team-conversation-navigation'
import { KeepTeam } from '../TeamTaskOverview'
import { detailForTask } from '../workbench/members'
import type { TaskActivityKind } from '../workbench/model'
import { useTaskActivity } from '../workbench/useTaskActivity'
import { useTaskBoard } from '../workbench/useTaskBoard'
import { CollaborationRecord } from './CollaborationRecord'
import { useHeldDecisions } from './DecisionCard'
import { PanelBar, PanelClose } from './PanelBar'
import { isTeamWork } from './status'
import { imChannelName, PANEL_ACTION, taskTitle } from './task-ui'
import { TaskBody, useTaskOverview } from './TaskBody'

export interface TaskPanelReveal {
  seq: number
  activityId?: string
  decisionId?: string
}

/**
 * Where a member of this task is talked to: the task's homepage conversation, on
 * that member — the same move as the progress beside a homepage chat. A temporary
 * team's member lives in the conversation that leads it. Null where Halo has no
 * conversation to turn to (an IM chat is answered in the IM app), so the member's
 * part is shown in the record instead.
 */
export function taskMemberDestination(detail: TeamDetail, task: TeamConversation, taskSpaceId: string | null): ((appId: string) => void) | null {
  if (task.kind === 'collab') {
    const source = task.sourceConversation
    if (!source) return null
    return appId => {
      useCollabMemberViewStore.getState().open(source.conversationId, appId)
      navigateToConversation(source.spaceId, source.conversationId)
    }
  }
  if (task.kind === 'im' || task.readonly || !taskSpaceId) return null
  return appId => {
    useTeamViewPrefsStore.getState().rememberTaskMember(detail.team.id, task.epochId, appId)
    openTeamConversation(taskSpaceId, { teamId: detail.team.id, epochId: task.epochId, teamName: detail.team.name, label: task.label, appId })
  }
}

/** One task, read like an AI client's answer: the lead's brief, the plan as steps, and what came out. */
export function TaskPanel({ detail: teamDetail, task, taskSpaceId, docked, memory, reveal, onRevealHandled, onClose }: {
  detail: TeamDetail
  task: TeamConversation
  taskSpaceId: string | null
  docked: boolean
  memory: TeamTaskViewMemory
  reveal?: TaskPanelReveal
  onRevealHandled: (seq: number) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const baseDetail = useMemo(() => detailForTask(teamDetail, task), [teamDetail, task])
  const boardState = useTaskBoard(baseDetail, task.epochId)
  // A temporary team's members join this one task, so only its board lists them.
  const detail = useMemo(() => detailForTask(teamDetail, task, boardState.board), [teamDetail, task, boardState.board])
  // The record, open on everyone (null member) or, where the task has no conversation to turn to, on one member.
  const [record, setRecord] = useState<{ member: string | null } | null>(memory.allMembers || memory.memberAppId ? { member: memory.memberAppId ?? null } : null)
  const [open, setOpen] = useState<Record<string, boolean>>(memory.open ?? {})
  const [focus, setFocus] = useState<{ seq: number; activityId: string } | null>(null)
  const [kind, setKind] = useState<TaskActivityKind | null>(null)
  const [stuck, setStuck] = useState(false)
  const titleRowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    memory.open = open
    memory.memberAppId = record?.member ?? undefined
    memory.allMembers = record ? true : undefined
  }, [memory, open, record])
  const data = useTaskActivity(detail, task, boardState)
  const held = useHeldDecisions(data.pending)

  const talkTo = taskMemberDestination(detail, task, taskSpaceId)
  const openAll = () => {
    setRecord({ member: null })
    setFocus(null)
  }
  // A member opens where the task is talked about; with nowhere to talk, the record narrows to them.
  const openMember = (appId: string) => {
    if (talkTo) return talkTo(appId)
    setRecord({ member: appId })
    setFocus(null)
  }
  const closeRecord = () => setRecord(null)
  const showActivity = (activityId: string, seq: number) => {
    setRecord({ member: null })
    setFocus({ seq, activityId })
  }
  const handled = useRef(onRevealHandled)
  handled.current = onRevealHandled
  const pendingRef = useRef(data.pending)
  pendingRef.current = data.pending
  useEffect(() => {
    if (!reveal) return
    if (reveal.decisionId) {
      closeRecord()
      const decision = pendingRef.current.find(item => item.entryId === reveal.decisionId)
      if (decision) held.setAnswering(decision)
    } else if (reveal.activityId) showActivity(reveal.activityId, reveal.seq)
    handled.current(reveal.seq)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal])

  const overview = useTaskOverview(detail, task, data)

  const openConversation = () => {
    if (!taskSpaceId) return
    openTeamConversation(taskSpaceId, { teamId: detail.team.id, epochId: task.epochId, teamName: detail.team.name, label: task.label })
  }
  const endTask = useEndTask(detail.team.id, task.epochId, task.createdByMe ? undefined : task.startedBy, overview.stateKey === 'waiting_member' || overview.stateKey === 'waiting_user')
  // Team work that is not running, waiting on others included, can be closed by hand, on the team's host only.
  // A plain chat has nothing to stop, and an IM chat cannot be picked up again after ending: its next message
  // starts a new session.
  const canEnd = detail.team.hostNodeId == null && isTeamWork(task) && task.kind !== 'im' && overview.stateKey !== 'done' && overview.stateKey !== 'running'
  const action = task.kind === 'im'
    ? <p className="min-w-0 truncate text-right text-xs text-faint-foreground">{t('Reply in {{channel}}', { channel: imChannelName(task, t) })}</p>
    : <button onClick={openConversation} disabled={!taskSpaceId} className={PANEL_ACTION}>{t('Open conversation')}<span aria-hidden="true">↗</span></button>
  const title = taskTitle(detail, task, t)

  if (record) return <CollaborationRecord detail={detail} task={task} data={data} member={record.member ? detail.roster.find(member => member.appId === record.member) : undefined}
    focus={focus} kind={kind} onKindChange={setKind} docked={docked} onOpenMember={talkTo ?? undefined} onEveryone={openAll} onBack={closeRecord} onClose={onClose} />

  // Docked, the action and the way out sit beside the title; once it scrolls away a slim bar keeps them in reach.
  const onScroll = (top: number) => {
    const row = titleRowRef.current
    setStuck(!!row && top >= row.offsetTop + row.offsetHeight)
  }

  return <div className="flex h-full min-h-0 flex-col">
    {!docked && <PanelBar docked={docked} onBack={onClose} onClose={onClose}>{action}</PanelBar>}
    <div onScroll={docked ? event => onScroll(event.currentTarget.scrollTop) : undefined} className={`relative min-h-0 flex-1 overflow-y-auto ${docked && stuck ? '[--page-sticky-top:3rem]' : ''}`}>
      {docked && <div className="sticky top-0 z-10 h-0">
        <div className={`absolute inset-x-0 top-0 flex h-12 items-center gap-2 border-b border-border-soft bg-background pl-5 pr-3 transition-[opacity,visibility] duration-150 sm:pl-6 ${stuck ? 'visible opacity-100' : 'invisible opacity-0'}`}>
          <p title={title} className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{title}</p>
          {action}
          <PanelClose onClose={onClose} />
        </div>
      </div>}
      <div className={`px-5 pb-12 sm:px-6 ${docked ? 'pt-4' : 'pt-1'}`}>
        {endTask.failed && <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle size={15} className="shrink-0" /><span className="flex-1">{t('Could not end this task. Try again.')}</span>
        </div>}
        {data.failed && <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle size={15} className="shrink-0" /><span className="flex-1">{t('Could not load conversation history.')}</span>
          <button onClick={data.retry} className="inline-flex shrink-0 items-center gap-1 rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><RefreshCw size={12} />{t('Retry')}</button>
        </div>}

        <div ref={titleRowRef} className="flex items-start gap-3">
          <h2 title={title} className="line-clamp-2 min-w-0 flex-1 break-words py-[3px] text-[18px] font-semibold leading-[1.45] tracking-[-0.01em]">{title}</h2>
          {detail.team.ephemeral && <KeepTeam team={detail.team} />}
          {docked && <div className="-mr-2 flex shrink-0 items-center gap-1">{action}<PanelClose onClose={onClose} /></div>}
        </div>
        <TaskBody detail={detail} task={task} taskSpaceId={taskSpaceId} data={data} overview={overview} held={held} open={open} setOpen={setOpen}
          onOpenMember={openMember} onOpenAll={openAll} onOpenExchange={id => showActivity(id, Date.now())} onContinue={task.kind === 'im' || !taskSpaceId ? undefined : openConversation}
          onEnd={canEnd ? endTask.end : undefined} />
      </div>
    </div>
    {endTask.DialogComponent}
  </div>
}

/** Closes unfinished work for good: members stop, the record stays, and a new message from a person picks it up again. */
function useEndTask(teamId: string, epochId: string, startedBy: string | undefined, waitingOnOthers: boolean) {
  const { t } = useTranslation()
  const ending = useRef(false)
  const [failed, setFailed] = useState(false)
  const { showConfirm, DialogComponent } = useConfirmDialog()
  const end = async () => {
    if (ending.current) return
    const message = startedBy
      ? t('{{name}} started this task and will see that you ended it. Members will stop working on it. Its outputs and record are kept, and sending it a new message picks it up again.', { name: startedBy })
      : t('Members will stop working on it. Its outputs and record are kept, and sending it a new message picks it up again.')
    const confirmed = await showConfirm({
      title: t('End this task?'),
      // Every question still open on the task, yours included, is withdrawn on ending it.
      message: waitingOnOthers ? `${message} ${t('Confirmations still waiting on someone are withdrawn.')}` : message,
      confirmLabel: t('End task'),
      cancelLabel: t('Cancel'),
      variant: 'danger',
    })
    if (!confirmed) return
    ending.current = true
    setFailed(false)
    const ok = await useTeamStore.getState().archiveConversation(teamId, epochId)
    ending.current = false
    setFailed(!ok)
  }
  return { end: () => void end(), failed, DialogComponent }
}
