import { forwardRef, Fragment, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, ListChecks, Lock, MessageCircle } from 'lucide-react'
import type { RosterMember } from '../../../../shared/apps/team-types'
import { useTranslation } from '../../../i18n'
import { useAppsStore } from '../../../stores/apps.store'
import { AutomationAvatar } from '../../apps/AutomationAvatar'
import { orderTaskMembers, railFit, railMembers, rememberRecent } from './member-rail'
import { progressSummary, type MemberProgress, type TaskProgress } from './progress'
import { memberProgressText, progressSummaryText } from './progress-labels'
import { TaskMemberPanel } from './TaskMemberPanel'
import { TaskProgressBar } from './TaskProgressBar'

const EMPTY: ReadonlySet<string> = new Set()
const SLIDE_MS = 380
const ENTER_MS = 420
const GAP = 8
/** Time to cross from an avatar to its card before the card gives way. */
const CARD_GRACE_MS = 180

type Rect = { x: number; y: number; w: number; h: number }

export interface ConversationProgress {
  progress: TaskProgress
  leadAppId: string | null
  outputCount: number
  onAnswer: (decisionId: string) => void
}

/**
 * The conversation bar of a homepage team conversation: its members as an avatar rail
 * ending in the all-members toggle, then its status, which opens the team progress.
 * `waitingAppIds` / `workingAppIds` describe this conversation only, never a member-wide flag.
 */
export function TaskMemberSelector({ roster, selectedAppId, ownedAppIds, waitingAppIds = EMPTY, workingAppIds = EMPTY, progress, onActivity, onSelect, onAnswer, onProfile, temporary = false, insideProgress = false, checksSlot }: {
  roster: readonly RosterMember[]
  selectedAppId: string | null
  ownedAppIds: readonly string[]
  waitingAppIds?: ReadonlySet<string>
  workingAppIds?: ReadonlySet<string>
  progress?: ConversationProgress | null
  onActivity?: (activityId?: string) => void
  onSelect: (member: RosterMember) => void
  /** Opens the decision a waiting member asked the user here. */
  onAnswer?: (appId: string) => void
  /** Opens a member's profile in the team progress; its hover card offers it. */
  onProfile?: (appId: string) => void
  /**
   * A temporary team led by the ordinary conversation it sits in: its members are
   * watched, not talked to, and none is current while that conversation is shown.
   */
  temporary?: boolean
  /** Shown inside the task's progress, where the status leads back to it rather than opening it. */
  insideProgress?: boolean
  /** A small mark after the status for things standing in this conversation (its periodic checks), which draws its own divider; counted in the rail's width. */
  checksSlot?: ReactNode
}) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const statusSegment = useRef<HTMLSpanElement>(null)
  const statusBar = useRef<HTMLSpanElement>(null)
  const tag = useRef<HTMLSpanElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const painted = useRef<Rect | null>(null)
  const seen = useRef<Map<string, number> | null>(null)
  const [width, setWidth] = useState(0)
  const [statusWidth, setStatusWidth] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const apps = useAppsStore(state => state.apps)
  // The hovered member's card. It is a real surface the pointer can move onto, so it
  // closes only after a short grace rather than the moment the avatar is left.
  const [cardFor, setCardFor] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const cardTimer = useRef<number>()
  const openCard = (appId: string) => { window.clearTimeout(cardTimer.current); setCardFor(appId) }
  const closeCard = (delay = CARD_GRACE_MS) => {
    window.clearTimeout(cardTimer.current)
    if (delay) cardTimer.current = window.setTimeout(() => setCardFor(null), delay)
    else setCardFor(null)
  }
  useEffect(() => () => window.clearTimeout(cardTimer.current), [])

  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { if (selectedAppId) setRecent(previous => previous[0] === selectedAppId ? previous : rememberRecent(previous, selectedAppId)) }, [selectedAppId])
  // Measured without the bar, which railFit decides on; the tag beside the bar takes its share too.
  useLayoutEffect(() => {
    const segment = statusSegment.current
    const bar = statusBar.current?.offsetWidth ?? 0
    const status = segment ? segment.offsetWidth - (bar ? bar + 8 : 0) : 0
    setStatusWidth(status + (tag.current ? tag.current.offsetWidth + GAP : 0))
  })

  const owned = new Set(ownedAppIds)
  const ordered = orderTaskMembers(roster, ownedAppIds)
  const waiting = new Set([...waitingAppIds].filter(id => owned.has(id)))
  const progressOf = new Map(progress?.progress.members.map(row => [row.appId, row]) ?? [])
  const failed = new Set([...progressOf.values()].filter(row => row.state === 'failed').map(row => row.appId))
  const fit = width ? railFit(width, statusWidth, ordered.length) : { capacity: 8, bar: true }
  const { shown, hidden } = railMembers(ordered, {
    selectedAppId, ownedAppIds, waiting, working: workingAppIds, recent, capacity: fit.capacity,
  })
  const shownKey = shown.map(member => member.appId).join(',')

  const now = performance.now()
  if (!seen.current) seen.current = new Map(shown.map(member => [member.appId, 0]))
  for (const member of shown) if (!seen.current.has(member.appId)) seen.current.set(member.appId, now)
  for (const id of [...seen.current.keys()]) if (!shown.some(member => member.appId === id)) seen.current.delete(id)
  const entering = (appId: string) => now - (seen.current?.get(appId) ?? 0) < ENTER_MS

  // The thumb follows the selected item's live box while its name unfolds.
  useLayoutEffect(() => {
    const element = thumb.current
    const target = track.current?.querySelector<HTMLElement>('[data-rail-item][aria-pressed="true"]')
    if (!element) return
    if (!target) { element.style.opacity = '0'; painted.current = null; return }
    const from = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : painted.current
    const start = performance.now()
    let frame = 0
    const step = (time: number) => {
      const progress = Math.min(1, (time - start) / SLIDE_MS)
      const eased = 1 - (1 - progress) ** 3
      const to = { x: target.offsetLeft, y: target.offsetTop, w: target.offsetWidth, h: target.offsetHeight }
      const rect = from ? {
        x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased,
        w: from.w + (to.w - from.w) * eased, h: from.h + (to.h - from.h) * eased,
      } : to
      element.style.opacity = '1'
      element.style.transform = `translate(${rect.x}px, ${rect.y}px)`
      element.style.width = `${rect.w}px`
      element.style.height = `${rect.h}px`
      painted.current = rect
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    step(start)
    return () => cancelAnimationFrame(frame)
  }, [selectedAppId, shownKey, width])

  if (!ordered.length) return null
  const cardOf = (member: RosterMember) => memberCardFacts(member, {
    roster, progressOf, owned, waiting, working: workingAppIds, temporary,
    // Read live from the app, as the profile does; a teammate's digital human has no local record.
    description: apps.find(app => app.id === member.appId)?.spec.description,
  }, t)
  const shownCard = !panelOpen && cardFor ? shown.find(member => member.appId === cardFor) : undefined
  const viewProfile = onProfile && ((member: RosterMember) => { closeCard(0); onProfile(member.appId) })
  const memberCard = (member: RosterMember) => <MemberRailCard ref={cardRef} member={member} card={cardOf(member)} onProfile={viewProfile}
    onPointerEnter={() => openCard(member.appId)} onPointerLeave={event => { if (event.pointerType === 'mouse') closeCard() }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeCard(0) }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeCard(0); track.current?.querySelector<HTMLElement>(`[data-rail-item][data-app-id="${CSS.escape(member.appId)}"]`)?.focus() } }} />
  const hiddenWaiting = hidden.filter(member => waiting.has(member.appId)).length
  const pick = (member: RosterMember) => {
    if (onAnswer && waiting.has(member.appId)) onAnswer(member.appId)
    else if (member.appId !== selectedAppId) onSelect(member)
  }
  const toggle = (from: HTMLElement | null) => { opener.current = from; setPanelOpen(open => !open) }
  const close = (refocus = true) => { setPanelOpen(false); if (refocus) opener.current?.focus() }

  const summary = progress ? progressSummary(progress.progress, progress.leadAppId) : null
  // With nothing to report yet, the segment stays as a quiet way into the team progress.
  const label = progress && summary ? progressSummaryText(summary, progress.outputCount, t) : onActivity ? t('Team progress') : null
  const { counts, total } = progress?.progress ?? { counts: null, total: 0 }
  const attention = summary?.kind === 'waiting' || summary?.kind === 'failed' || summary?.kind === 'decision'
  const tone = summary?.kind === 'failed' ? 'text-destructive' : attention ? 'text-halo-warning' : 'text-subtle-foreground'
  const icon = !summary ? <ListChecks size={14} className="text-faint-foreground" />
    : attention ? <AlertCircle size={14} />
      : summary.kind === 'working' ? <span className="flex h-3.5 w-3.5 items-center justify-center"><i className="h-2 w-2 rounded-full bg-primary" /></span>
        : summary.kind === 'done' ? <CheckCircle2 size={14} className="text-halo-success" />
          : <ListChecks size={14} className="text-faint-foreground" />
  const Chevron = panelOpen ? ChevronDown : ChevronUp
  const allMembers = t('All {{count}} members', { count: ordered.length })
  const statusBody = label && <>
    {icon && <span aria-hidden="true" className="shrink-0">{icon}</span>}
    <span>{label}</span>
    {total > 0 && counts && <>
      <span className="text-xs tabular-nums text-subtle-foreground">{counts.done}/{total}</span>
      {fit.bar && <span ref={statusBar} className="hidden sm:flex"><TaskProgressBar counts={counts} className="flex w-11" /></span>}
    </>}
  </>
  const statusLabel = [label, ...(total && counts ? [t('{{done}}/{{total}} tasks done', { done: counts.done, total })] : [])].join(' · ')
  const statusTip = !insideProgress ? t('View team progress')
    : summary?.kind === 'failed' ? t('Back to task details to see what went wrong') : t('Back to task details')

  return <div ref={root} className="flex min-w-0 items-center gap-2">
    {temporary && <span ref={tag} className="shrink-0 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{t('Temporary team')}</span>}
    <div ref={track} role="group" aria-label={t('Team members')}
      className="member-rail relative flex max-w-full items-center gap-0.5 rounded-full p-1">
      <span ref={thumb} aria-hidden="true" className="member-rail-thumb" />
      {shown.map(member => {
        const selected = member.appId === selectedAppId
        const card = cardOf(member)
        const offline = member.presence === 'offline'
        const state = waiting.has(member.appId) ? 'waiting' : failed.has(member.appId) ? 'failed' : workingAppIds.has(member.appId) && !offline ? 'working' : undefined
        const readOnly = !owned.has(member.appId)
        const carded = shownCard?.appId === member.appId
        return <Fragment key={member.appId}><button type="button" data-rail-item="" data-app-id={member.appId} data-state={state} data-readonly={readOnly ? '' : undefined}
          data-card-open={carded ? '' : undefined} aria-pressed={selected} aria-label={card.label}
          onClick={() => pick(member)}
          onPointerEnter={event => { if (event.pointerType === 'mouse') openCard(member.appId) }}
          onPointerLeave={event => { if (event.pointerType === 'mouse') closeCard() }}
          onFocus={event => { if (event.currentTarget.matches(':focus-visible')) openCard(member.appId) }}
          onBlur={event => { if (!cardRef.current?.contains(event.relatedTarget as Node | null)) closeCard(0) }}
          onKeyDown={event => { if (event.key === 'Escape' && carded) { event.stopPropagation(); closeCard(0) } }}
          className={`member-rail-item z-[1] flex h-[34px] shrink-0 items-center rounded-full p-[5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${entering(member.appId) ? 'animate-member-rail-enter' : ''}`}>
          <span className={`member-rail-avatar relative flex shrink-0 rounded-full ${offline ? 'opacity-50' : ''}`}>
            <AutomationAvatar name={member.memberName} size={24} />
            {/* Read-only: a light veil with a lock over the face; the status dot is drawn after it so it stays on top. */}
            {readOnly && <i aria-hidden="true" data-lock="" className="absolute inset-0 flex items-center justify-center rounded-full bg-black/[.28] text-white"><Lock strokeWidth={3} className="h-[46%] w-[46%] drop-shadow-sm" /></i>}
            {state && <i aria-hidden="true" data-tone={state} className="avatar-status-dot" />}
            {onAnswer && state === 'waiting' && !selected && <span aria-hidden="true" className="member-rail-ask">{t('Needs your answer')}</span>}
          </span>
          <span className="member-rail-name truncate text-[13px] font-semibold text-foreground">{member.memberName}</span>
        </button>{carded && memberCard(member)}</Fragment>
      })}
      <button ref={moreButton} type="button" aria-haspopup="dialog" aria-expanded={panelOpen}
        aria-label={hiddenWaiting ? `${allMembers} · ${t('{{count}} more waiting for you', { count: hiddenWaiting })}` : allMembers}
        onClick={() => toggle(moreButton.current)}
        className={`member-rail-more relative z-[1] flex h-[34px] min-w-[30px] shrink-0 items-center justify-center gap-0.5 rounded-full px-2 text-xs font-medium tabular-nums transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${panelOpen ? 'bg-foreground/[0.07] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground'}`}>
        {hidden.length > 0 && <span>+{hidden.length}</span>}
        <Chevron size={14} aria-hidden="true" className="shrink-0" />
        {hiddenWaiting > 0 && <span aria-hidden="true" className="absolute right-[5px] top-1.5 h-1.5 w-1.5 rounded-full bg-halo-warning [box-shadow:0_0_0_2px_var(--member-rail-bg)]" />}
        {!panelOpen && <span aria-hidden="true" className="member-rail-tip">{allMembers}{hiddenWaiting > 0 && <span className="ml-1.5 opacity-65">{t('{{count}} more waiting for you', { count: hiddenWaiting })}</span>}</span>}
      </button>
      {(statusBody || checksSlot) && <span ref={statusSegment} className="flex shrink-0 items-center">
        {statusBody && <><span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
        {onActivity
          ? <button type="button" aria-label={summary ? `${statusLabel} · ${statusTip}` : statusTip} onClick={() => onActivity()}
            className={`member-rail-status relative z-[1] flex h-[34px] items-center gap-2 whitespace-nowrap rounded-full pl-2 pr-3 text-[12.5px] transition-colors duration-100 hover:bg-foreground/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tone} ${attention ? '' : 'hover:text-foreground'}`}>
            {statusBody}
            <span aria-hidden="true" className="member-rail-tip">{statusTip}</span>
          </button>
          : <span aria-label={statusLabel} className={`flex h-[34px] items-center gap-2 whitespace-nowrap pl-2 pr-3 text-[12.5px] ${tone}`}>{statusBody}</span>}</>}
        {checksSlot}
      </span>}
    </div>
    {panelOpen && <TaskMemberPanel members={ordered} selectedAppId={selectedAppId} owned={owned} waiting={waiting} working={workingAppIds}
      progress={progress ?? null} onActivity={onActivity} temporary={temporary} anchor={track} triggers={[moreButton]}
      onPick={member => { setPanelOpen(false); pick(member) }} onClose={close} />}
  </div>
}

export type MemberCardFacts = ReturnType<typeof memberCardFacts>

/** What a member's card says: who it is, what it does here, its state in this conversation and who may message it. */
export function memberCardFacts(member: RosterMember, { roster, progressOf, owned, waiting, working, temporary, description }: {
  roster: readonly RosterMember[]
  progressOf: ReadonlyMap<string, MemberProgress>
  owned: ReadonlySet<string>
  waiting: ReadonlySet<string>
  working: ReadonlySet<string>
  temporary: boolean
  description?: string | null
}, t: TFunction) {
  const row = progressOf.get(member.appId)
  // A lead's role is often "Team Lead" itself, in English or any casing; show it once.
  const role = member.role?.trim() ?? ''
  const leadRole = member.isLead && [t('Team lead'), 'Team lead'].some(name => name.toLowerCase() === role.toLowerCase())
  const kind = [member.isLead ? t('Team lead') : '', leadRole ? '' : role].filter(Boolean).join(' · ')
  const state: { text: string; tone: string } | null = row?.state === 'waiting' ? { text: memberProgressText(row, roster, t), tone: 'bg-halo-warning' }
    : waiting.has(member.appId) ? { text: t('Waiting for you'), tone: 'bg-halo-warning' }
      : row?.state === 'failed' ? { text: memberProgressText(row, roster, t), tone: 'bg-destructive' }
        // Whatever an offline member was doing is stale; the card says it is offline instead.
        : member.presence === 'offline' ? null
          : row?.state === 'working' ? { text: memberProgressText(row, roster, t), tone: 'bg-primary' }
            : working.has(member.appId) ? { text: t('Working…'), tone: 'bg-primary' }
              : null
  const readOnly = !owned.has(member.appId)
  const access = !readOnly ? (temporary ? '' : t('You can message it'))
    : member.owner ? t('{{owner}}’s digital human · Read-only', { owner: member.owner }) : t('Read-only')
  const offline = readOnly && member.presence === 'offline' ? (member.owner ? t('{{owner}} is offline', { owner: member.owner }) : t('Its owner is offline')) : ''
  return {
    kind, duty: member.duty?.trim() ?? '', description: description?.trim() ?? '', state, readOnly, access, offline,
    label: [member.memberName, kind, state?.text, access, offline].filter(Boolean).join(' · '),
  }
}

/**
 * A member's hover card on the rail: everything worth knowing about it in this team,
 * in full. With `onProfile`, the whole card, and its "View details" for the keyboard,
 * opens the member's profile.
 */
export const MemberRailCard = forwardRef<HTMLDivElement, {
  member: RosterMember
  card: MemberCardFacts
  onProfile?: (member: RosterMember) => void
} & Pick<HTMLAttributes<HTMLDivElement>, 'onPointerEnter' | 'onPointerLeave' | 'onBlur' | 'onKeyDown'>>(function MemberRailCard({ member, card, onProfile, ...events }, ref) {
  const { t } = useTranslation()
  const heading = 'mb-1 block text-[11px] font-medium text-faint-foreground'
  const prose = 'whitespace-pre-wrap break-words text-[12.5px] leading-[1.55] text-muted-foreground'
  return <div ref={ref} role="group" aria-label={member.memberName} data-member-card="" {...events}
    className={`member-rail-card ${onProfile ? 'cursor-pointer' : ''}`}
    // Selecting text in the card does not open the profile.
    onClick={onProfile && (() => { if (!window.getSelection()?.toString()) onProfile(member) })}>
    <div className="flex items-center gap-3">
      <span className="flex shrink-0"><AutomationAvatar name={member.memberName} size={40} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{member.memberName}</span>
        {card.kind && <span className="mt-0.5 block truncate text-xs text-subtle-foreground">{card.kind}</span>}
      </span>
      {onProfile && <button type="button" onClick={event => { event.stopPropagation(); onProfile(member) }}
        className="member-rail-card-action -mr-1.5 inline-flex h-7 shrink-0 items-center gap-0.5 self-start rounded-md pl-2 pr-1 text-xs text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {t('View details')}<ChevronRight size={13} aria-hidden="true" />
      </button>}
    </div>
    {card.state && <div className="mt-3 flex items-start gap-2 rounded-lg bg-secondary/70 px-2.5 py-2 text-xs leading-[1.5] text-foreground">
      <i className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${card.state.tone}`} />
      {/* A waiting question can be a whole report; the card shows its opening, the hover title the rest. */}
      <span title={card.state.text} className="line-clamp-2 min-w-0 break-words">{card.state.text}</span>
    </div>}
    {(card.duty || card.description) && <div className="member-rail-card-body">
      {card.duty && <div className="mt-3"><span className={heading}>{t('Duty in this team')}</span><p className={prose}>{card.duty}</p></div>}
      {card.description && <div className="mt-3"><span className={heading}>{t('The digital human itself')}</span><p className={prose}>{card.description}</p></div>}
    </div>}
    {(card.access || card.offline) && <div className="mt-3 flex flex-col gap-1 border-t border-border-faint pt-2.5 text-xs text-subtle-foreground">
      {card.access && <span className="flex items-start gap-1.5">
        {card.readOnly ? <Lock size={12} aria-hidden="true" className="mt-[3px] shrink-0 text-faint-foreground" /> : <MessageCircle size={12} aria-hidden="true" className="mt-[3px] shrink-0 text-primary" />}
        <span className="min-w-0 break-words">{card.access}</span>
      </span>}
      {card.offline && <span className="flex items-start gap-1.5 text-faint-foreground">
        <i className="mx-[3px] mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-faint-foreground" />
        <span className="min-w-0 break-words">{card.offline}</span>
      </span>}
    </div>}
  </div>
})
