import { useMemo, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { RosterMember, TeamConversation, TeamDetail } from '../../../../shared/apps/team-types'
import { useTranslation } from '../../../i18n'
import { AutomationAvatar } from '../../apps/AutomationAvatar'
import type { TaskActivityKind } from '../workbench/model'
import { TaskCollaborationHistory, TaskMemberExecution } from '../workbench/TaskActivitySections'
import { KindFilter } from '../workbench/TaskActivityTimeline'
import type { TaskActivityData } from '../workbench/useTaskActivity'
import { PanelBar } from './PanelBar'
import { taskTitle } from './task-ui'

const READING = 'mx-auto max-w-[calc(var(--chat-reading-width)+3rem)] px-6'

/**
 * A task's collaboration record: what members handed each other and reported, read
 * here and never answered. Narrowed to one member where the task has no homepage
 * conversation to turn to (an IM chat), with that member's execution a step further.
 */
export function CollaborationRecord({ detail, task, data, member, focus, kind, onKindChange, docked, onOpenMember, onEveryone, onBack, onClose }: {
  detail: TeamDetail
  task: TeamConversation
  data: TaskActivityData
  /** Only this member's part. */
  member?: RosterMember
  focus: { seq: number; activityId: string } | null
  kind: TaskActivityKind | null
  onKindChange: (kind: TaskActivityKind | null) => void
  docked: boolean
  /** A face in the record; absent where it would lead nowhere new. */
  onOpenMember?: (appId: string) => void
  onEveryone: () => void
  onBack: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [execution, setExecution] = useState(false)
  const shown = useMemo(() => member ? {
    ...data,
    activities: data.activities.filter(row => row.actorAppId === member.appId || row.targetAppId === member.appId),
    reports: { ...data.reports, reports: data.reports.reports.filter(row => row.appId === member.appId) },
  } : data, [data, member])
  const recordLabel = t('Collaboration record')

  if (execution && member) return <div className="flex h-full min-h-0 flex-col">
    <PanelBar docked={docked} backTo={recordLabel} onBack={() => setExecution(false)} onClose={onClose} />
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-10 pt-1 sm:px-6">
      <TaskMemberExecution detail={detail} task={task} member={member} homepageConversation={false} />
    </div>
  </div>

  const filterable = data.activities.length > 0 || data.reports.reports.length > 0
  return <div className="flex h-full min-h-0 flex-col">
    <PanelBar docked={docked} backTo={taskTitle(detail, task, t)} onBack={onBack} onClose={onClose} />
    {/* Outside the record's scroll, so it stays put while reading; the reserved gutter keeps it on the record's column. */}
    <div className="shrink-0 overflow-hidden border-b border-border [scrollbar-gutter:stable]">
      <div className={`${READING} flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 py-1`}>
        <h2 className="text-[13px] font-medium">{recordLabel}</h2>
        {member && <>
          <span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-secondary pl-1 pr-0.5 text-xs">
            <AutomationAvatar name={member.memberName} size={16} />
            <span className="max-w-[10rem] truncate">{member.memberName}</span>
            <button type="button" onClick={onEveryone} aria-label={t('Show everyone')} title={t('Show everyone')}
              className="inline-flex size-5 items-center justify-center rounded-full text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <X size={12} aria-hidden="true" />
            </button>
          </span>
          <button type="button" onClick={() => setExecution(true)} className="inline-flex min-h-6 items-center gap-0.5 rounded text-xs text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t('Execution record')}<ChevronRight size={12} aria-hidden="true" />
          </button>
        </>}
        {filterable && <div className="-mr-1.5 ml-auto"><KindFilter bare value={kind} onChange={onKindChange} /></div>}
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"><div className={`${READING} py-5`}>
      <TaskCollaborationHistory key={`${member?.appId ?? ''}:${focus?.seq ?? ''}`} data={shown} detail={detail} task={task} focusActivityId={focus?.activityId} homepageConversation={false} onOpenMember={onOpenMember} kind={kind} onKindChange={onKindChange} />
    </div></div>
  </div>
}
