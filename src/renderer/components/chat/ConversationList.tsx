/**
 * Conversation List - Resizable sidebar for multiple conversations
 * Self-contained: subscribes to its own data from stores, no data props from parent.
 * Supports drag-to-resize, inline title editing, and conversation management.
 *
 * Pinned stays on top in a pane of its own (drag its edge for more room); below
 * it Teams, Digital Humans and Conversations share one scrolling column. The
 * heading of the section being read stays on top, and those of sections further
 * down wait at the bottom with their state, so none is ever out of reach: a
 * click there scrolls to it. Each list shows its first few and keeps the rest
 * behind "More"; what needs the person comes first (see conversation-list-model).
 */

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, memo } from 'react'
import { useAppRemindersStore, useConversationReminders } from '../../stores/app-reminders.store'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { Plus } from '../icons/ToolIcons'
import { EllipsisVertical, Pin, Pencil, Trash2, ChevronRight, Timer } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useChatStore, useAllConversationStatuses } from '../../stores/chat.store'
import { useSpaceStore } from '../../stores/space.store'
import { useAppStore } from '../../stores/app.store'
import { useAppsStore } from '../../stores/apps.store'
import { useAppChatPinsStore } from '../../stores/app-chat-pins.store'
import {
  useConversationListPrefs, isSectionOpen, isListFolded, type ConversationSection, type ConversationListLayout,
} from '../../stores/conversation-list-prefs.store'
import { SCROLLING_SECTIONS, STICKY_HEADING_PX, useConversationReveal } from './conversation-list-reveal'
import { usePaneResize, PaneResizeHandle } from './conversation-list-panes'
import { MORE_STEP, attentionFirst, attentionRank, headingStatus, nextShown, peek, rowRank, type HeldRow, type Peeked } from './conversation-list-model'
import { api } from '../../api'
import { cn } from '../../lib/utils'
import { TaskStatusDot } from '../pulse/TaskStatusDot'
import { AutomationAvatar } from '../apps/AutomationAvatar'
import { useAppChatConversationRows, type AppChatConversationRow } from '../../hooks/useAppChatConversationRows'
import { appChatSessionLabel, formatRowTime, type RowHoverCard } from './conversation-row-format'
import { appChatAppId, parseAppChatKey } from '../../../shared/apps/im-keys'
import { NATIVE_SESSION_CHANNEL, NATIVE_DEFAULT_CHAT_ID } from '../../../shared/types/im-channel'
import type { ConversationMeta, TaskStatus } from '../../types'
import { markEntry, trackHome, trackNavigate } from '../../services/home-telemetry'
import { openDigitalHumanChat } from '../../utils/conversation-navigation'
import { openPersonActivity } from '../../utils/people-navigation'
import { buildTeamGroups, useTeamConversationRows, type TeamListRow } from '../../hooks/useTeamConversationRows'
import { teamTaskKey } from '../../stores/team-chat-pins.store'
import { teamTaskStatus, useTeamChatSeenStore } from '../../stores/team-chat-seen.store'
import { TeamConversationRow } from './TeamConversationRow'
import { ConversationGroupHeader } from './ConversationGroupHeader'
import { ConversationHoverCard, type ConversationHoverCardHandle } from './ConversationHoverCard'
import { sameRowProps } from './row-memo'
import { useFocusedRow, useRowHeights, useScrollWindow, windowRows } from './conversation-list-window'

// Width constraints (in pixels)
const MIN_WIDTH = 140
const MAX_WIDTH = 360
const DEFAULT_WIDTH = 260
// Dragging the resize handle below this width folds the list to its 56px icon
// strip; dragging it back out past the same threshold opens the list again.
const DRAG_COLLAPSE_THRESHOLD = 100
const clampWidth = (v: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v))

interface ConversationListProps {
  /** The content canvas is open beside the chat. The list keeps a separate
   * fold choice for this layout, folded by default to the 56px icon strip
   * (prototype's `.body.canvas-open .conv`): grouping/pin hidden, each
   * conversation just a status dot. */
  canvasOpen?: boolean
}


/**
 * Registry coordinates for a digital-human session. The default session's key
 * has no channel/chatId segments to parse, so it uses the synthetic pair the
 * runtime registers it under.
 */
function appChatRegistryTarget(row: AppChatConversationRow): { channel: string; chatId: string } {
  const parsed = parseAppChatKey(row.id)
  return parsed
    ? { channel: parsed.channel, chatId: parsed.chatId }
    : { channel: NATIVE_SESSION_CHANNEL, chatId: NATIVE_DEFAULT_CHAT_ID }
}

/** What the hover card shows for a row, in either list form. */
function hoverCardFor(
  row: Extract<ConversationRow, { type: 'item' | 'dh-item' }>,
  t: (s: string, opts?: Record<string, unknown>) => string,
  status: TaskStatus,
): RowHoverCard {
  if (row.type === 'dh-item') {
    const reminders = (useAppRemindersStore.getState().byApp[row.row.appId] ?? []).filter(reminder => reminder.conversationId === row.row.id && reminder.nextAt !== null).length
    return {
      label: appChatSessionLabel(row.row, t),
      owner: row.row.digitalHumanName,
      ...(reminders ? { checks: t('Reminders: {{n}}', { n: reminders }) } : {}),
      time: formatRowTime(row.row.updatedAt, t),
      status,
    }
  }
  return {
    label: row.conversation.title || t('New conversation'),
    time: formatRowTime(row.conversation.updatedAt, t),
    status,
  }
}

/** One line of the list: a group heading and its rows share one flat list per section. */
type ConversationRow =
  | TeamListRow
  | { type: 'item'; key: string; conversation: ConversationMeta }
  /** `status`: shown after the name — what is most urgent inside while folded, else whether it works anywhere. */
  | { type: 'dh-header'; key: string; appId: string; name: string; uninstalled: boolean; collapsed: boolean; status?: TaskStatus }
  /** The way to the rest of a list (`list` is its key in the "More" choices), or back to its first few. */
  | { type: 'more'; key: string; list: string; rest: number; expanded: boolean; step: number; unit: 'rows' | 'teams' | 'digital-humans'; nested: boolean }
  /** `standalone` rows sit outside their digital human's section (i.e. in
   *  Pinned), so they carry the avatar/name context the section header would
   *  otherwise provide. */
  | { type: 'dh-item'; key: string; row: AppChatConversationRow; standalone: boolean }

type PinnedRow = Extract<ConversationRow, { type: 'item' | 'dh-item' }>

const EMPTY_SECTION_CHOICES: Partial<Record<ConversationSection, boolean>> = {}
const EMPTY_GROUP_CHOICES: Record<string, boolean> = {}
const EMPTY_SHOWN: Record<string, number> = {}

/** The sections and digital-human groups the list opened on its own (not the user). */
interface AutoOpen {
  sections: ReadonlySet<ConversationSection>
  apps: ReadonlySet<string>
}
const NO_AUTO_OPEN: AutoOpen = { sections: new Set(), apps: new Set() }
/**
 * Kept per space outside the component, so leaving the home page and coming
 * back finds the list as it was: what it had opened on its own stays open, and
 * a conversation that was already shown does not open its folded section again.
 */
const autoOpenKept = new Map<string, AutoOpen>()
const selectionShown = new Map<string, string>()
/** True the first time `selection` is seen for `key` (a space and what opens for it). */
function firstShowing(key: string, selection: string): boolean {
  if (selectionShown.get(key) === selection) return false
  selectionShown.set(key, selection)
  return true
}

// Titles run to the row's edge and fade out instead of ending in an ellipsis;
// the hover actions float over that edge rather than reserving room for it.
const ROW_TITLE = 'flex-1 min-w-0 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%_-_20px),transparent)]'
// Always in view (touch has no hover); gives way to the row actions.
const ROW_TIME = 'shrink-0 text-[11px] font-normal tabular-nums text-faint-foreground transition-opacity group-hover:opacity-0 group-data-[menu-open]:opacity-0 group-has-[:focus-visible]:opacity-0'
// Shown only while the row itself is highlighted (hover, open menu, keyboard
// focus), since their fade-in backdrop is the row's highlight colour.
const ROW_ACTIONS = 'absolute inset-y-0 right-1.5 flex items-center gap-0.5 pl-5 bg-[linear-gradient(to_right,transparent,hsl(var(--secondary))_20px)] opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-data-[menu-open]:opacity-100 group-data-[menu-open]:pointer-events-auto has-[:focus-visible]:opacity-100 has-[:focus-visible]:pointer-events-auto'
// `theme-dark:` rows win over plain state variants, so the open-menu text is restated for dark.
// A row of the scrolling column. Only rows near the viewport are mounted (see
// conversation-list-window), so there is no per-row containment to pay for.
const LIST_ROW = 'flow-root px-2 pb-0.5'
// A dot of the folded strip: 24px tall, 2px apart (the strip's gap-0.5).
const STRIP_DOT_PX = 26
const ROW_HIGHLIGHT = 'data-[menu-open]:bg-secondary data-[menu-open]:text-foreground theme-dark:data-[menu-open]:text-foreground has-[:focus-visible]:bg-secondary'

/**
 * A top-level section's fold toggle; its open-state arrow shows while the
 * pointer is on the heading (the `group/section` container). Waiting at the
 * bottom of the column (`docked`), it says what is inside and how much, and a
 * click goes to the section instead of folding it.
 * No uppercase/letter-spacing: both are no-ops on CJK labels and only loosen them oddly.
 */
function SectionHeaderButton({ section, label, hint, collapsed, attention, onToggle, docked = false, count, onJump, className }: {
  section: ConversationSection
  label: string
  /** Hover-only: the distinction between sections is one-time knowledge, not worth permanent space. */
  hint?: string
  collapsed: boolean
  /** Shown while folded, so a session needing the user isn't hidden with it. */
  attention?: TaskStatus
  onToggle: (section: ConversationSection) => void
  docked?: boolean
  /** How many it lists, shown while docked. */
  count?: number
  onJump?: (section: ConversationSection) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (docked && onJump) {
          trackHome('home.conversation.section', { section, action: 'jump' })
          // Going to a folded section is going to nothing: open it on the way.
          if (collapsed) onToggle(section)
          onJump(section)
          return
        }
        trackHome('home.conversation.section', { section, action: collapsed ? 'expand' : 'collapse' })
        onToggle(section)
      }}
      aria-expanded={!collapsed}
      title={hint}
      // pl-2.5 matches the rows' inset, so a label starts where its titles do.
      className={cn('group flex w-full items-center gap-1 rounded-sm pl-2.5 pr-1.5 pb-1 text-xs font-medium text-subtle-foreground hover:text-muted-foreground transition-colors ease-halo', className)}
    >
      <span>{label}</span>
      {(collapsed || docked) && attention && <TaskStatusDot status={attention} size="sm" />}
      {docked && count !== undefined && <span className="font-normal tabular-nums text-faint-foreground">{count}</span>}
      <ChevronRight className={cn(
        'ml-auto w-3 h-3 shrink-0 transition-[transform,opacity]',
        docked ? '-rotate-90 opacity-0 group-hover/section:opacity-100 group-focus-visible:opacity-100'
          : collapsed ? 'opacity-100' : 'rotate-90 opacity-0 group-hover/section:opacity-100 group-focus-visible:opacity-100'
      )} />
    </button>
  )
}

/** A digital human's face, clickable through to its page (activity thread, or the uninstalled page). */
function PersonAvatarLink({ appId, name, size, className }: {
  appId: string
  name: string
  size: number
  className?: string
}) {
  const { t } = useTranslation()
  const face = <AutomationAvatar name={name} size={size} />
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        trackNavigate('apps', 'conversation_list', 'home_conv_dh')
        openPersonActivity(appId)
      }}
      title={t('View {{name}}', { name })}
      aria-label={t('View {{name}}', { name })}
      className={cn(
        'flex shrink-0 cursor-pointer rounded-full transition-transform ease-halo hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        className
      )}
    >
      {face}
    </button>
  )
}

/**
 * Pinned rows, regular and digital-human mixed in one recency order so
 * neither kind pushes the other out of view. Rendered in their own fixed area
 * above the scrolling list.
 */
function buildPinnedRows(conversations: ConversationMeta[], appChatRows: AppChatConversationRow[]): PinnedRow[] {
  return [
    ...conversations.filter(conv => conv.starred)
      .map(conv => ({ at: Date.parse(conv.updatedAt) || 0, row: { type: 'item' as const, key: conv.id, conversation: conv } })),
    ...appChatRows.filter(row => row.starred)
      .map(row => ({ at: row.updatedAt, row: { type: 'dh-item' as const, key: row.id, row, standalone: true } })),
  ].sort((a, b) => b.at - a.at).map(entry => entry.row)
}

/** Unpinned digital-human sessions per digital human, in the apps' own order, newest session first. */
function groupDigitalHumanSessions(appChatRows: AppChatConversationRow[]): { appId: string; rows: AppChatConversationRow[] }[] {
  const byApp = new Map<string, AppChatConversationRow[]>()
  for (const row of appChatRows) {
    if (row.starred) continue
    const list = byApp.get(row.appId) ?? []
    list.push(row)
    byApp.set(row.appId, list)
  }
  return [...byApp].map(([appId, rows]) => ({ appId, rows: [...rows].sort((a, b) => b.updatedAt - a.updatedAt) }))
}

/** A "More" line for `list`, or nothing when everything already shows. */
function moreRow(list: string, peeked: Peeked<unknown>, step: number, unit: Extract<ConversationRow, { type: 'more' }>['unit'], nested: boolean): ConversationRow[] {
  if (peeked.rest === 0 && !peeked.expanded) return []
  return [{ type: 'more', key: `more:${list}`, list, rest: peeked.rest, expanded: peeked.expanded, step, unit, nested }]
}

/**
 * Digital humans with work in flight: a running task, or a turn in any of their
 * conversations, including the IM and team chats this list never shows.
 */
function digitalHumansAtWork(
  conversationStatuses: ReadonlyMap<string, TaskStatus>,
  appsRunningTasks: readonly string[],
): ReadonlySet<string> {
  const working = new Set(appsRunningTasks)
  for (const [conversationId, status] of conversationStatuses) {
    if (status !== 'generating' && status !== 'waiting') continue
    const appId = appChatAppId(conversationId)
    if (appId) working.add(appId)
  }
  return working
}

/** What the one row being renamed needs; the other rows get none, so typing renders that row alone. */
interface RowEdit {
  title: string
  onTitle: (title: string) => void
  inputRef: (input: HTMLInputElement | null) => void
  containerRef: React.RefObject<HTMLDivElement>
  onKeyDown: (e: React.KeyboardEvent) => void
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => void
  onSave: () => void
}

/** Row handlers, all stable for the life of the list, so rows can skip rendering. */
interface RowHandlers {
  onOpenMenu: (e: React.MouseEvent, id: string) => void
  onHover: (el: HTMLElement, card: RowHoverCard) => void
  onHoverEnd: () => void
}

/**
 * A regular conversation. Memoized by content: it renders only when its own
 * conversation, status, selection, menu or rename changes, not on every render
 * of the list (a status anywhere, the menu opening on another row, a drag).
 */
const ConversationItemRow = memo(function ConversationItemRow({ conversation, status, active, menuOpen, edit, onSelect, onTogglePin, onOpenMenu, onHover, onHoverEnd }: RowHandlers & {
  conversation: ConversationMeta
  status: TaskStatus
  /** currentConversationId stays pointed at the last regular conversation
   * even while a digital human is selected (switching back lands there
   * unchanged) — so the caller passes false during that time, or it and the
   * digital-human's row would both show selected at once. */
  active: boolean
  menuOpen: boolean
  edit?: RowEdit
  onSelect: (conversation: ConversationMeta) => void
  onTogglePin: (e: React.MouseEvent, conversation: ConversationMeta) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      onClick={() => !edit && onSelect(conversation)}
      onMouseEnter={(e) => onHover(e.currentTarget, hoverCardFor({ type: 'item', key: conversation.id, conversation }, t, status))}
      onMouseLeave={onHoverEnd}
      aria-current={active}
      data-menu-open={menuOpen || undefined}
      className={cn(
        'group relative flex w-full items-center gap-1.5 rounded-sm pl-2.5 pr-1.5 py-1.5 text-[13px] transition-colors ease-halo cursor-pointer',
        ROW_HIGHLIGHT,
        active
          ? 'bg-secondary text-foreground font-medium'
          // Rows are read, not just scanned: darker than the section labels in
          // light, the brighter secondary tone in dark; the selected one is marked by its fill.
          : 'text-foreground/80 hover:bg-secondary hover:text-foreground theme-dark:text-muted-foreground theme-dark:hover:text-foreground'
      )}
    >

      {edit ? (
        <div ref={edit.containerRef} className="flex flex-1 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            ref={edit.inputRef}
            type="text"
            value={edit.title}
            onChange={(e) => edit.onTitle(e.target.value)}
            onKeyDown={edit.onKeyDown}
            onBlur={edit.onBlur}
            className="flex-1 text-sm bg-input border border-border rounded px-2 py-1 focus:outline-none focus:border-primary min-w-0"
            placeholder={t('Conversation title...')}
          />
          <button
            onClick={edit.onSave}
            className="p-1 hover:bg-primary/20 text-primary rounded transition-colors flex-shrink-0"
            title={t('Save')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          {/* Status dot — inline, left of the title, only when non-idle
              (prototype: `.ci-dot`, only rendered when a conversation has
              a `run`/`done` state). Kept as the existing 4-state
              TaskStatusDot rather than reduced to the prototype's plain
              two states — the richer state set is an existing strength
              by design, not a prototype-vs-implementation mismatch to fix. */}
          {status !== 'idle' && <TaskStatusDot status={status} size="sm" />}

          <span className={ROW_TITLE}>{conversation.title}</span>
          <span className={ROW_TIME}>{formatRowTime(conversation.updatedAt, t)}</span>

          <div className={ROW_ACTIONS}>
            <button
              onClick={(e) => onTogglePin(e, conversation)}
              className={cn(
                'w-[22px] h-[22px] flex-shrink-0 rounded-[6px] flex items-center justify-center transition-colors',
                conversation.starred
                  ? 'text-accent-on-dark'
                  : 'text-faint-foreground hover:bg-surface-hover hover:text-foreground'
              )}
              title={conversation.starred ? t('Unpin') : t('Pin')}
              aria-pressed={conversation.starred}
            >
              <Pin className="w-[13px] h-[13px]" strokeWidth={1.8} />
            </button>

            <button
              onClick={(e) => onOpenMenu(e, conversation.id)}
              className="w-[22px] h-[22px] flex-shrink-0 rounded-[6px] flex items-center justify-center text-faint-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              title={t('More')}
            >
              <EllipsisVertical className="w-[13px] h-[13px]" strokeWidth={1.8} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}, sameRowProps)

/**
 * A digital-human conversation, memoized like ConversationItemRow. An
 * uninstalled digital human's row fades and no longer opens its chat rather
 * than disappearing; its avatar still leads to the person's page. Reinstalling
 * the app restores the row automatically since it's derived live from the apps list.
 */
const AppChatItemRow = memo(function AppChatItemRow({ row, standalone, status, active, menuOpen, edit, onSelect, onTogglePin, onOpenMenu, onHover, onHoverEnd }: RowHandlers & {
  row: AppChatConversationRow
  standalone: boolean
  status: TaskStatus
  active: boolean
  menuOpen: boolean
  edit?: RowEdit
  onSelect: (row: AppChatConversationRow) => void
  onTogglePin: (e: React.MouseEvent, row: AppChatConversationRow) => void
}) {
  const { t } = useTranslation()
  const sessionLabel = appChatSessionLabel(row, t)
  const reminders = useConversationReminders(row.uninstalled ? null : row.appId, row.id).length
  return (
    <div
      onClick={() => !edit && !row.uninstalled && onSelect(row)}
      onMouseEnter={(e) => onHover(e.currentTarget, hoverCardFor({ type: 'dh-item', key: row.id, row, standalone }, t, status))}
      onMouseLeave={onHoverEnd}
      aria-current={active && !row.uninstalled}
      data-menu-open={menuOpen || undefined}
      className={cn(
        'group relative flex w-full items-center gap-1.5 rounded-sm pr-1.5 py-1.5 text-[13px] transition-colors ease-halo',
        ROW_HIGHLIGHT,
        standalone ? 'pl-2.5' : 'pl-[38px]',
        row.uninstalled
          ? 'opacity-40 cursor-not-allowed'
          : 'cursor-pointer',
        active && !row.uninstalled
          ? 'bg-secondary text-foreground font-medium'
          // Rows are read, not just scanned: darker than the section labels in
          // light, the brighter secondary tone in dark; the selected one is marked by its fill.
          : 'text-foreground/80 hover:bg-secondary hover:text-foreground theme-dark:text-muted-foreground theme-dark:hover:text-foreground'
      )}
    >

      {standalone && (
        <PersonAvatarLink
          appId={row.appId}
          name={row.digitalHumanName}
          size={18}
        />
      )}

      {status !== 'idle' && <TaskStatusDot status={status} size="sm" className={standalone ? undefined : 'absolute left-[26px] top-1/2 -translate-y-1/2'} />}

      {edit ? (
        <div ref={edit.containerRef} className="flex flex-1 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            ref={edit.inputRef}
            type="text"
            value={edit.title}
            onChange={(e) => edit.onTitle(e.target.value)}
            onKeyDown={edit.onKeyDown}
            onBlur={edit.onBlur}
            className="flex-1 text-sm bg-input border border-border rounded px-2 py-1 focus:outline-none focus:border-primary min-w-0"
            placeholder={t('Conversation title...')}
          />
        </div>
      ) : (
        <span className={ROW_TITLE}>
          {standalone && row.isDefault ? row.digitalHumanName : sessionLabel}
        </span>
      )}
      {row.status === 'paused' && !edit && (
        <span className="text-[11px] text-muted-foreground shrink-0">{t('Paused')}</span>
      )}
      {/* A static mark, as on a team task: this conversation has reminders standing in it. */}
      {!edit && reminders > 0 && <span role="img" aria-label={t('Reminders: {{n}}', { n: reminders })} className="shrink-0 text-faint-foreground transition-opacity group-hover:opacity-0 group-data-[menu-open]:opacity-0"><Timer className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" /></span>}
      {!edit && <span className={ROW_TIME}>{formatRowTime(row.updatedAt, t)}</span>}

      {!row.uninstalled && (
        <div className={ROW_ACTIONS}>
          <button
            onClick={(e) => onTogglePin(e, row)}
            className={cn(
              'w-[22px] h-[22px] flex-shrink-0 rounded-[6px] flex items-center justify-center transition-colors',
              row.starred
                ? 'text-accent-on-dark'
                : 'text-faint-foreground hover:bg-surface-hover hover:text-foreground'
            )}
            title={row.starred ? t('Unpin') : t('Pin')}
            aria-pressed={row.starred}
          >
            <Pin className="w-[13px] h-[13px]" strokeWidth={1.8} />
          </button>

          <button
            onClick={(e) => onOpenMenu(e, row.id)}
            className="w-[22px] h-[22px] flex-shrink-0 rounded-[6px] flex items-center justify-center text-faint-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            title={t('More')}
          >
            <EllipsisVertical className="w-[13px] h-[13px]" strokeWidth={1.8} />
          </button>
        </div>
      )}
    </div>
  )
}, sameRowProps)

/** A digital human's group heading; its props are values and stable handlers, so the default compare suffices. */
const DigitalHumanHeaderRow = memo(function DigitalHumanHeaderRow({ appId, name, uninstalled, collapsed, status, onToggle, onNew }: {
  appId: string
  name: string
  uninstalled: boolean
  collapsed: boolean
  status?: TaskStatus
  onToggle: (appId: string, open: boolean) => void
  onNew: (appId: string) => void
}) {
  const { t } = useTranslation()
  return <ConversationGroupHeader
    name={name}
    collapsed={collapsed}
    disabled={uninstalled}
    onToggle={() => {
      trackHome('home.dh_group.toggle', { collapsed: !collapsed })
      onToggle(appId, !collapsed)
    }}
    onNew={() => onNew(appId)}
    newLabel={t('New conversation with {{name}}', { name })}
    avatar={<PersonAvatarLink appId={appId} name={name} size={20} />}
    status={status && <TaskStatusDot status={status} size="sm" className="ml-1.5" />}
  />
})

/**
 * A handler whose identity never changes but which always runs the latest
 * `fn`, so memoized rows can take it without rendering again when it is
 * recreated. Only for event handlers: it is not to be called during render.
 */
function useStableHandler<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn)
  latest.current = fn
  return useCallback((...args: A) => latest.current(...args), [])
}

export const ConversationList = memo(function ConversationList({
  canvasOpen = false,
}: ConversationListProps) {
  const { t } = useTranslation()

  // Self-subscribe to data from stores (precise selectors)
  const currentSpaceId = useChatStore(state => state.currentSpaceId)
  const conversations = useChatStore(state => {
    const spaceState = state.spaceStates.get(state.currentSpaceId ?? '')
    return spaceState?.conversations ?? []
  })
  const currentConversationId = useChatStore(state => {
    const spaceState = state.spaceStates.get(state.currentSpaceId ?? '')
    return spaceState?.currentConversationId ?? undefined
  })
  const selectedAppChat = useChatStore(state => {
    const spaceState = state.spaceStates.get(state.currentSpaceId ?? '')
    return spaceState?.selectedAppChat ?? null
  })
  const layoutConfig = useAppStore(state => state.config?.layout)

  const selectedTeamChat = useChatStore(state => state.spaceStates.get(state.currentSpaceId ?? '')?.selectedTeamChat)
  const teamList = useTeamConversationRows(currentSpaceId)
  const allAppChatRows = useAppChatConversationRows(currentSpaceId)
  const toggleAppChatPin = useAppChatPinsStore(s => s.toggleAppChatPin)

  const spaceKey = currentSpaceId ?? ''
  const sectionChoices = useConversationListPrefs(s => s.sectionOpen[spaceKey]) ?? EMPTY_SECTION_CHOICES
  const appGroupChoices = useConversationListPrefs(s => s.appGroupOpen[spaceKey]) ?? EMPTY_GROUP_CHOICES
  const setAppGroupOpen = useConversationListPrefs(s => s.setAppGroupOpen)
  const setSectionOpen = useConversationListPrefs(s => s.setSectionOpen)
  // Single batch subscription for all conversation statuses (replaces N individual hooks)
  const conversationStatuses = useAllConversationStatuses()
  const appsRunningTasks = useAppsStore(useShallow(s => Object.keys(s.appStates).filter(appId => s.appStates[appId].status === 'running')))
  const workingApps = useMemo(() => digitalHumansAtWork(conversationStatuses, appsRunningTasks), [conversationStatuses, appsRunningTasks])

  // What the list opens on its own, kept in memory only: the stored prefs hold
  // nothing but the user's own clicks. `sections` and `apps` override a stored
  // fold until the user toggles that section or group again.
  const [autoOpen, setAutoOpen] = useState<AutoOpen & { space: string }>(() => ({ space: spaceKey, ...(autoOpenKept.get(spaceKey) ?? NO_AUTO_OPEN) }))
  const auto: AutoOpen = autoOpen.space === spaceKey ? autoOpen : autoOpenKept.get(spaceKey) ?? NO_AUTO_OPEN
  const updateAutoOpen = useCallback((change: (prev: AutoOpen) => AutoOpen) => {
    setAutoOpen(prev => {
      const base = prev.space === spaceKey ? prev : { space: spaceKey, ...(autoOpenKept.get(spaceKey) ?? NO_AUTO_OPEN) }
      const next = change(base)
      if (next.sections === base.sections && next.apps === base.apps) return base
      autoOpenKept.set(spaceKey, next)
      return { space: spaceKey, ...next }
    })
  }, [spaceKey])
  const autoOpenSection = useCallback((section: ConversationSection) => {
    updateAutoOpen(prev => (prev.sections.has(section) ? prev : { ...prev, sections: new Set(prev.sections).add(section) }))
  }, [updateAutoOpen])

  const pinnedOpen = auto.sections.has('pinned') || isSectionOpen(sectionChoices, 'pinned')
  const teamsOpen = auto.sections.has('teams') || isSectionOpen(sectionChoices, 'teams')
  const digitalHumansOpen = auto.sections.has('digital-humans') || isSectionOpen(sectionChoices, 'digital-humans')
  const conversationsOpen = auto.sections.has('conversations') || isSectionOpen(sectionChoices, 'conversations')
  const toggleSection = useCallback((section: ConversationSection) => {
    const open = auto.sections.has(section) || isSectionOpen(sectionChoices, section)
    updateAutoOpen(prev => {
      if (!prev.sections.has(section)) return prev
      const sections = new Set(prev.sections)
      sections.delete(section)
      return { ...prev, sections }
    })
    setSectionOpen(spaceKey, section, !open)
  }, [setSectionOpen, spaceKey, sectionChoices, auto.sections, updateAutoOpen])

  // A digital human's group starts closed and opens on its own when it holds the
  // open conversation or a session needs attention; that stays until the user folds it.
  const selectedAppId = selectedAppChat?.appId
  const isAppGroupOpen = useCallback((appId: string, groupRows: AppChatConversationRow[]) => {
    if (auto.apps.has(appId)) return true
    const choice = appGroupChoices[appId]
    if (choice !== undefined) return choice
    return appId === selectedAppId || groupRows.some(row => conversationStatuses.has(row.id))
  }, [auto.apps, appGroupChoices, selectedAppId, conversationStatuses])
  const toggleAppCollapsed = useCallback((appId: string, open: boolean) => {
    updateAutoOpen(prev => {
      if (!prev.apps.has(appId)) return prev
      const apps = new Set(prev.apps)
      apps.delete(appId)
      return { ...prev, apps }
    })
    setAppGroupOpen(spaceKey, appId, !open)
  }, [setAppGroupOpen, spaceKey, updateAutoOpen])
  // Opening a conversation (from here or e.g. the task panel) shows its section
  // and group even if the user had folded them; pinned sessions sit outside any group.
  const selectedAppChatId = selectedAppChat?.conversationId
  const selectedAppChatPinned = !!selectedAppChatId && allAppChatRows.some(row => row.id === selectedAppChatId && row.starred)
  useEffect(() => {
    if (!selectedAppId || !selectedAppChatId || selectedAppChatPinned) return
    if (!firstShowing(`${spaceKey}|app`, selectedAppChatId)) return
    updateAutoOpen(prev => (prev.sections.has('digital-humans') && prev.apps.has(selectedAppId)
      ? prev
      : { sections: new Set(prev.sections).add('digital-humans'), apps: new Set(prev.apps).add(selectedAppId) }))
  }, [selectedAppId, selectedAppChatId, selectedAppChatPinned, updateAutoOpen, spaceKey])
  // A group that needs attention stays open after the session settles, unless the user folded it.
  useEffect(() => {
    const waiting = allAppChatRows.filter(row =>
      !row.starred && conversationStatuses.has(row.id) && appGroupChoices[row.appId] === undefined)
    if (waiting.length === 0) return
    updateAutoOpen(prev => {
      if (waiting.every(row => prev.apps.has(row.appId))) return prev
      const apps = new Set(prev.apps)
      for (const row of waiting) apps.add(row.appId)
      return { ...prev, apps }
    })
  }, [allAppChatRows, conversationStatuses, appGroupChoices, updateAutoOpen])

  // Width state - initialized from persisted config
  const initialWidth = layoutConfig?.sidebarWidth
  const [width, setWidth] = useState(initialWidth != null ? clampWidth(initialWidth) : DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)
  const widthRef = useRef(width)
  const dragStartWidthRef = useRef(width)

  // Folded or open as the user last left it in this layout; while the handle is
  // held the pointer decides, and releasing it saves that choice.
  const listLayout: ConversationListLayout = canvasOpen ? 'with-canvas' : 'without-canvas'
  const savedFolded = useConversationListPrefs(s => isListFolded(s.listFolded, listLayout))
  const setListFolded = useConversationListPrefs(s => s.setListFolded)
  const [dragFolded, setDragFolded] = useState<boolean | null>(null)
  const dragFoldedRef = useRef<boolean | null>(null)
  const folded = dragFolded ?? savedFolded

  // Sync width when config arrives asynchronously
  useEffect(() => {
    if (initialWidth !== undefined && !isDragging) {
      const clamped = clampWidth(initialWidth)
      setWidth(clamped)
      widthRef.current = clamped
    }
  }, [initialWidth, isDragging])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const editContainerRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const focusedEditingIdRef = useRef<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  /** Hovered row's identity card. Which row is hovered lives in the card, not
   * here, so moving the pointer between rows renders the card alone. */
  const hoverCardHandle = useRef<ConversationHoverCardHandle>(null)
  const showHoverCard = useCallback((el: HTMLElement, card: RowHoverCard) => hoverCardHandle.current?.show(el, card), [])
  const hideHoverCard = useCallback(() => hoverCardHandle.current?.hide(), [])

  // ── What each row needs from the person ──
  const teamSeen = useTeamChatSeenStore(s => s.seen)
  const teamSeenSince = useTeamChatSeenStore(s => s.since)
  const teamGroups = useMemo(() => buildTeamGroups(teamList.tasks, teamList.teams, teamList.pins, teamList.hidden),
    [teamList.tasks, teamList.teams, teamList.pins, teamList.hidden])
  const teamStatuses = useMemo(() => {
    const statuses = new Map<string, TaskStatus>()
    for (const task of teamList.tasks) {
      const key = teamTaskKey(task.teamId, task.epochId)
      statuses.set(key, teamTaskStatus(task, teamSeen[key], teamSeenSince))
    }
    return statuses
  }, [teamList.tasks, teamSeen, teamSeenSince])
  const statusOf = useCallback((key: string): TaskStatus => conversationStatuses.get(key) ?? teamStatuses.get(key) ?? 'idle',
    [conversationStatuses, teamStatuses])
  const statusOfRef = useRef(statusOf)
  statusOfRef.current = statusOf

  // The row on screen: a team task (or its group, for a new one) takes the place
  // of the regular conversation as a digital human's session does.
  const selectedKey = selectedTeamChat
    ? (selectedTeamChat.epochId ? teamTaskKey(selectedTeamChat.teamId, selectedTeamChat.epochId) : `team:${selectedTeamChat.teamId}`)
    : selectedAppChat ? selectedAppChat.conversationId : currentConversationId

  // A team task on screen is seen, also when it finishes or fails while it is.
  const selectedTeamTask = selectedTeamChat?.epochId ? teamList.tasks.find(task => task.teamId === selectedTeamChat.teamId && task.epochId === selectedTeamChat.epochId) : undefined
  const markTeamSeen = useTeamChatSeenStore(s => s.markSeen)
  useEffect(() => {
    if (selectedTeamChat?.epochId) markTeamSeen(teamTaskKey(selectedTeamChat.teamId, selectedTeamChat.epochId))
  }, [selectedTeamChat?.teamId, selectedTeamChat?.epochId, selectedTeamTask?.finishedAt, selectedTeamTask?.failure, selectedTeamTask?.lastActivityAt, markTeamSeen])

  // A row the person opens while it needs them keeps its place until they open
  // something else, so it does not move from under the pointer once seen.
  const [held, setHeld] = useState<HeldRow | null>(null)
  const heldReached = useRef(false)
  const holdRow = useCallback((key: string) => {
    heldReached.current = false
    const rank = attentionRank(statusOfRef.current(key))
    setHeld(rank === undefined ? null : { key, rank })
  }, [])
  useEffect(() => {
    if (!held) return
    if (selectedKey === held.key) { heldReached.current = true; return }
    if (heldReached.current) { heldReached.current = false; setHeld(null) }
  }, [selectedKey, held])
  const rankOf = useCallback((key: string) => rowRank(key, statusOf(key), held), [statusOf, held])

  // ── "More" ──
  const shownChoices = useConversationListPrefs(s => s.shown[spaceKey]) ?? EMPTY_SHOWN
  const setShown = useConversationListPrefs(s => s.setShown)

  // ── Sections ──
  // Opening a team task shows its group, also when it is opened again (e.g. from
  // a notification) after the person folded the group. A pinned task is shown in
  // Pinned, so its team's section stays as it was; until the team list has
  // loaded it is not yet known which, so this waits.
  const selectedTeamPinned = useMemo(() => {
    if (!selectedTeamChat) return undefined
    const group = teamGroups.find(g => g.teamId === selectedTeamChat.teamId)
    return group ? group.pinned.some(task => task.epochId === selectedTeamChat.epochId) : undefined
  }, [teamGroups, selectedTeamChat?.teamId, selectedTeamChat?.epochId])
  useEffect(() => {
    if (!selectedTeamChat || selectedTeamPinned === undefined) return
    if (!firstShowing(`${spaceKey}|team`, `${selectedTeamChat.teamId}:${selectedTeamChat.epochId}:${selectedTeamChat.entryId ?? ''}`)) return
    if (selectedTeamPinned) return
    updateAutoOpen(prev => ({ sections: new Set(prev.sections).add('teams'), apps: new Set(prev.apps).add(`team:${selectedTeamChat.teamId}`) }))
  }, [selectedTeamChat?.teamId, selectedTeamChat?.epochId, selectedTeamChat?.entryId, selectedTeamPinned, updateAutoOpen, spaceKey])

  const teamPinnedRows = useMemo<ConversationRow[]>(() => teamGroups.flatMap(group => group.pinned.map(task => {
    const key = teamTaskKey(group.teamId, task.epochId)
    return { type: 'team-item' as const, key, task, standalone: true, starred: true, avatar: group.avatar, status: statusOf(key) }
  })), [teamGroups, statusOf])
  const pinnedRows = useMemo<ConversationRow[]>(() => [...buildPinnedRows(conversations, allAppChatRows), ...teamPinnedRows].sort((a, b) => {
    const time = (row: ConversationRow) => row.type === 'team-item' ? row.task.lastActivityAt : row.type === 'dh-item' ? row.row.updatedAt : row.type === 'item' ? Date.parse(row.conversation.updatedAt) : 0
    return time(b) - time(a)
  }), [conversations, allAppChatRows, teamPinnedRows])

  // A team opens on its own while something in it needs the person or is under
  // way, or holds the open task; a fold the person chose wins.
  const teamRows = useMemo<ConversationRow[]>(() => {
    const arranged = teamGroups.map(group => {
      const keyOf = (task: (typeof group.tasks)[number]) => teamTaskKey(group.teamId, task.epochId)
      const rows = attentionFirst(group.tasks, task => rankOf(keyOf(task)))
      const ranks = group.tasks.map(task => rankOf(keyOf(task))).filter((rank): rank is number => rank !== undefined)
      return { group, rows, keyOf, rank: ranks.length ? Math.min(...ranks) : undefined, heading: headingStatus(group.tasks.map(task => statusOf(keyOf(task)))) }
    })
    const ordered = attentionFirst(arranged, entry => entry.rank)
    const groups = peek(ordered, shownChoices.teams, entry => entry.group.teamId === selectedTeamChat?.teamId)
    const out: ConversationRow[] = []
    for (const { group, rows, keyOf, heading } of groups.visible) {
      const choice = appGroupChoices[group.key]
      const open = auto.apps.has(group.key) || (choice ?? (heading !== undefined || selectedTeamChat?.teamId === group.teamId))
      out.push({ type: 'team-header', key: group.key, teamId: group.teamId, name: group.name, collapsed: !open, avatar: group.avatar, ...(heading ? { attention: heading as Exclude<TaskStatus, 'idle'> } : {}) })
      if (!open) continue
      const shown = peek(rows, shownChoices[group.key], task => keyOf(task) === selectedKey)
      for (const task of shown.visible) out.push({ type: 'team-item', key: keyOf(task), task, standalone: false, starred: false, avatar: group.avatar, status: statusOf(keyOf(task)) })
      out.push(...moreRow(group.key, shown, MORE_STEP.rows, 'rows', true))
      if (group.tasks.length === 0 && group.pinned.length === 0 && group.hidden === 0) out.push({ type: 'team-empty', key: `team-empty:${group.teamId}`, teamId: group.teamId, name: group.name })
      if (group.hidden > 0) out.push({ type: 'team-hidden', key: `team-hidden:${group.teamId}`, teamId: group.teamId, count: group.hidden })
    }
    out.push(...moreRow('teams', groups, MORE_STEP.groups, 'teams', false))
    if (teamList.error) out.push({ type: 'team-retry', key: 'team:retry' })
    return out
  }, [teamGroups, rankOf, statusOf, shownChoices, selectedTeamChat?.teamId, selectedKey, appGroupChoices, auto.apps, teamList.error])
  const teamsAttention = useMemo(() => headingStatus(teamGroups.flatMap(group => group.tasks.map(task => statusOf(teamTaskKey(group.teamId, task.epochId))))), [teamGroups, statusOf])

  const digitalHumanRows = useMemo<ConversationRow[]>(() => {
    const arranged = groupDigitalHumanSessions(allAppChatRows).map(({ appId, rows }) => {
      const ranks = rows.map(row => rankOf(row.id)).filter((rank): rank is number => rank !== undefined)
      return { appId, rows: attentionFirst(rows, row => rankOf(row.id)), rank: ranks.length ? Math.min(...ranks) : undefined }
    })
    const ordered = attentionFirst(arranged, entry => entry.rank)
    const groups = peek(ordered, shownChoices['digital-humans'], entry => entry.appId === selectedAppId)
    const out: ConversationRow[] = []
    for (const { appId, rows } of groups.visible) {
      const collapsed = !isAppGroupOpen(appId, rows)
      const inside = headingStatus(rows.map(row => statusOf(row.id)))
      const status = collapsed ? headingStatus([inside, workingApps.has(appId) ? 'generating' : undefined]) : workingApps.has(appId) ? 'generating' : undefined
      out.push({ type: 'dh-header', key: `dh-header:${appId}`, appId, name: rows[0].digitalHumanName, uninstalled: rows[0].uninstalled, collapsed, ...(status ? { status } : {}) })
      if (collapsed) continue
      const shown = peek(rows, shownChoices[`dh:${appId}`], row => row.id === selectedKey)
      for (const row of shown.visible) out.push({ type: 'dh-item', key: row.id, row, standalone: false })
      out.push(...moreRow(`dh:${appId}`, shown, MORE_STEP.rows, 'rows', true))
    }
    out.push(...moreRow('digital-humans', groups, MORE_STEP.groups, 'digital-humans', false))
    return out
  }, [allAppChatRows, rankOf, statusOf, shownChoices, selectedAppId, selectedKey, isAppGroupOpen, workingApps])

  const conversationRows = useMemo<ConversationRow[]>(() => {
    const rows = attentionFirst(conversations.filter(conv => !conv.starred), conv => rankOf(conv.id))
    const shown = peek(rows, shownChoices.conversations, conv => conv.id === selectedKey)
    return [
      ...shown.visible.map(conv => ({ type: 'item' as const, key: conv.id, conversation: conv })),
      ...moreRow('conversations', shown, MORE_STEP.conversations, 'rows', false),
    ]
  }, [conversations, rankOf, shownChoices.conversations, selectedKey])
  const conversationsAttention = useMemo(() => headingStatus(conversations.filter(conv => !conv.starred).map(conv => statusOf(conv.id))), [conversations, statusOf])

  // The icon strip shows the open list's rows, without headings or "More"; a
  // session needing the person shows there even inside a folded group.
  const stripRows = useMemo(() => {
    if (!folded) return null
    const listed = (rows: ConversationRow[], open: boolean) => open ? rows.filter(row => row.type === 'item' || row.type === 'dh-item' || row.type === 'team-item') : []
    const dhListed = new Set(listed(digitalHumanRows, digitalHumansOpen).map(row => row.key))
    const dhWaiting = allAppChatRows.filter(row => !row.starred && !dhListed.has(row.id) && attentionRank(statusOf(row.id)) !== undefined)
      .map(row => ({ type: 'dh-item' as const, key: row.id, row, standalone: false }))
    return [
      ...listed(pinnedRows, pinnedOpen),
      ...listed(teamRows, teamsOpen),
      ...listed(digitalHumanRows, digitalHumansOpen),
      ...dhWaiting,
      ...listed(conversationRows, conversationsOpen),
    ]
  }, [folded, pinnedRows, pinnedOpen, teamRows, teamsOpen, digitalHumanRows, digitalHumansOpen, allAppChatRows, statusOf, conversationRows, conversationsOpen])
  const reveal = useConversationReveal({
    spaceId: spaceKey,
    conversationId: selectedKey,
    panes: {
      pinned: { rows: pinnedRows, open: pinnedOpen },
      teams: { rows: teamRows, open: teamsOpen },
      'digital-humans': { rows: digitalHumanRows, open: digitalHumansOpen },
      conversations: { rows: conversationRows, open: conversationsOpen },
    },
    strip: stripRows,
    openSection: autoOpenSection,
  })
  /** Picked in the list: no scrolling to it, and it keeps its place while open. */
  const pickRow = useCallback((key: string) => {
    reveal.pickedInList(key)
    holdRow(key)
  }, [reveal.pickedInList, holdRow])
  // Its most urgent session status, for the folded digital-humans header; one of
  // its digital humans working anywhere counts as generating.
  const digitalHumanAttention = useMemo(() => {
    const sectionRows = allAppChatRows.filter(row => !row.starred)
    return headingStatus([...sectionRows.map(row => statusOf(row.id)), sectionRows.some(row => workingApps.has(row.appId)) ? 'generating' : undefined])
  }, [allAppChatRows, statusOf, workingApps])

  // ── Pinned pane: its own height, the scrolling column takes the rest ──
  const listColumnRef = useRef<HTMLDivElement>(null)
  const pinnedResize = usePaneResize('pinned', reveal.pinnedRef, listColumnRef, () => reveal.pinnedRef.current?.scrollHeight ?? 0)

  // ── Only the rows near the viewport are mounted; the rest are gaps of their height ──
  const windowScroller = folded ? reveal.stripRef : reveal.scrollerRef
  const view = useScrollWindow(windowScroller, folded)
  const rowHeights = useRowHeights()
  const focusedRow = useFocusedRow(windowScroller, folded)
  // Mounted wherever they are: the open row (the list scrolls to it by its element),
  // one whose menu is open or that is being renamed, and the one holding focus.
  const keepMounted = (key: string) => key === selectedKey || key === held?.key || key === menuOpenId || key === editingId || key === focusedRow.current
  useLayoutEffect(() => { if (!folded) rowHeights.measure(reveal.scrollerRef.current) })

  // ── Headings of sections further down wait at the bottom of the column ──
  const scrollingSections = SCROLLING_SECTIONS.filter(section =>
    (section === 'teams' ? teamRows : section === 'digital-humans' ? digitalHumanRows : conversationRows).length > 0)
  const sectionAnchors = useRef(new Map<ConversationSection, HTMLElement>())
  const [docked, setDocked] = useState<ReadonlySet<ConversationSection>>(() => new Set())
  const scrollingKey = scrollingSections.join(',')
  useEffect(() => {
    const column = reveal.scrollerRef.current
    if (!column || typeof column.addEventListener !== 'function') return
    let frame = 0
    const measure = () => {
      frame = 0
      const bottom = column.getBoundingClientRect().bottom
      const sections = scrollingKey ? scrollingKey.split(',') as ConversationSection[] : []
      const next = new Set<ConversationSection>()
      const top = column.getBoundingClientRect().top
      sections.forEach((section, index) => {
        const anchor = sectionAnchors.current.get(section)
        const below = sections.length - 1 - index
        // Its own place is under the headings stacked below it: it is waiting there.
        if (anchor && anchor.getBoundingClientRect().top > bottom - (below + 1) * STICKY_HEADING_PX + 1) next.add(section)
        // Scrolled past: its own place has gone above its slot on the stack (so a folded section at
        // the top of an unscrolled list is not), and the next heading has reached its slot, so every
        // row of this one has gone by.
        const after = sections[index + 1] && sectionAnchors.current.get(sections[index + 1])
        if (anchor && after
          && anchor.getBoundingClientRect().top - top < index * STICKY_HEADING_PX - 1
          && after.getBoundingClientRect().top - top <= (index + 1) * STICKY_HEADING_PX + 1) next.add(section)
      })
      setDocked(prev => (prev.size === next.size && [...next].every(section => prev.has(section)) ? prev : next))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    column.addEventListener('scroll', schedule, { passive: true })
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    resize?.observe(column)
    return () => { cancelAnimationFrame(frame); column.removeEventListener('scroll', schedule); resize?.disconnect() }
  }, [reveal.scrollerRef, scrollingKey, teamRows, digitalHumanRows, conversationRows])
  const jumpToSection = useCallback((section: ConversationSection) => {
    // After the next paint, so a section opened by the same click has its rows to scroll to.
    requestAnimationFrame(() => {
      const column = reveal.scrollerRef.current
      const anchor = sectionAnchors.current.get(section)
      if (!column || !anchor) return
      // Land with its heading in its own slot, under the headings of the sections above.
      const above = Math.max(0, scrollingKey.split(',').indexOf(section))
      const top = column.scrollTop + anchor.getBoundingClientRect().top - column.getBoundingClientRect().top - above * STICKY_HEADING_PX
      column.scrollTo({ top, behavior: 'smooth' })
    })
  }, [reveal.scrollerRef, scrollingKey])
  const sectionCount: Partial<Record<ConversationSection, number>> = {
    teams: teamGroups.reduce((sum, group) => sum + group.tasks.length, 0),
    'digital-humans': allAppChatRows.filter(row => !row.starred).length,
    conversations: conversations.filter(conv => !conv.starred).length,
  }

  const showMore = (row: Extract<ConversationRow, { type: 'more' }>) => {
    trackHome('home.conversation.section', { section: row.nested ? 'group' : row.list, action: row.rest > 0 ? 'more' : 'less' })
    if (row.rest > 0) {
      setShown(spaceKey, row.list, nextShown(shownChoices[row.list], row.step))
      // Team tasks arrive a page at a time: reading further into a team reads the next page.
      if (row.list.startsWith('team:') || row.list === 'teams') teamList.loadMore()
    } else {
      setShown(spaceKey, row.list, undefined)
    }
  }

  // Handle drag resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartWidthRef.current = widthRef.current
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    // The width follows the pointer on the element itself, and React hears of it
    // only on release: a render per pointer move would run the whole list again.
    // React leaves the inline width alone meanwhile, as its `width` prop is unchanged.
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      const newWidth = e.clientX - containerRect.left
      const nextFolded = newWidth < DRAG_COLLAPSE_THRESHOLD
      const clampedWidth = clampWidth(newWidth)
      if (!nextFolded) widthRef.current = clampedWidth
      if (nextFolded !== dragFoldedRef.current) {
        // Crossing the fold swaps the element: render once, at the width reached.
        dragFoldedRef.current = nextFolded
        setDragFolded(nextFolded)
        if (!nextFolded) setWidth(clampedWidth)
        return
      }
      if (!nextFolded) containerRef.current.style.width = `${clampedWidth}px`
    }

    const handleMouseUp = () => {
      const releasedFolded = dragFoldedRef.current
      dragFoldedRef.current = null
      // Saved before the preview ends, so no frame shows the previous choice.
      if (releasedFolded !== null) setListFolded(listLayout, releasedFolded)
      setDragFolded(null)
      setIsDragging(false)
      if (releasedFolded) {
        // Folding is not a resize: the widths passed on the way are dropped, so
        // the list opens again at the width it had.
        widthRef.current = dragStartWidthRef.current
        setWidth(dragStartWidthRef.current)
        return
      }
      setWidth(widthRef.current)
      if (widthRef.current === dragStartWidthRef.current) return
      // Persist width to in-memory store + backend config
      const currentConfig = useAppStore.getState().config
      if (currentConfig) {
        useAppStore.getState().updateConfig({ layout: { ...currentConfig.layout, sidebarWidth: widthRef.current } })
      }
      api.setConfig({ layout: { sidebarWidth: widthRef.current } }).catch(err =>
        console.error('[ConversationList] Failed to persist sidebar width:', err)
      )
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, listLayout, setListFolded])

  // Close dropdown menu on outside click
  useEffect(() => {
    if (!menuOpenId) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null)
        setMenuPosition(null)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [menuOpenId])

  // Reset menu state when conversations change (e.g. space switch)
  useEffect(() => {
    setMenuOpenId(null)
    setMenuPosition(null)
  }, [conversations])

  useEffect(() => {
    if (!editingId) {
      focusedEditingIdRef.current = null
    }
  }, [editingId])

  const attachEditInputRef = useCallback((input: HTMLInputElement | null) => {
    editInputRef.current = input
    if (!input || !editingId || focusedEditingIdRef.current === editingId) return

    focusedEditingIdRef.current = editingId
    input.focus()
    input.select()
  }, [editingId])

  // Start editing a conversation title
  const handleStartEdit = (e: React.MouseEvent, conv: ConversationMeta) => {
    e.stopPropagation()
    setEditingId(conv.id)
    setEditingTitle(conv.title || '')
  }

  // Save edited title. `editingId` is a conversationId for both kinds of row;
  // digital-human sessions live in the session registry, not the space's
  // conversation index, so they rename through a different call.
  const handleSaveEdit = () => {
    const name = editingTitle.trim()
    if (editingId && name) {
      const appChatRow = allAppChatRows.find(r => r.id === editingId)
      trackHome('home.conversation.action', { action: 'rename', kind: appChatRow ? 'digital_human' : 'normal' })
      if (appChatRow) {
        const target = appChatRegistryTarget(appChatRow)
        void api.imSessionsSetCustomName({ appId: appChatRow.appId, ...target, name })
      } else {
        const spaceId = useSpaceStore.getState().currentSpace?.id
        if (spaceId) {
          useChatStore.getState().renameConversation(spaceId, editingId, name)
        }
      }
    }
    setEditingId(null)
    setEditingTitle('')
  }

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingId(null)
    setEditingTitle('')
  }

  // Handle input key events
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleEditBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const nextTarget = e.relatedTarget
    if (nextTarget instanceof Node && editContainerRef.current?.contains(nextTarget)) {
      return
    }
    handleSaveEdit()
  }

  const handleSelectConversation = (conv: ConversationMeta) => {
    trackHome('home.conversation.select', { kind: 'normal', pinned: !!conv.starred })
    pickRow(conv.id)
    useChatStore.getState().selectConversation(conv.id)
  }

  const handleCreateConversation = (surface: 'list' | 'rail_collapsed') => {
    const spaceId = useSpaceStore.getState().currentSpace?.id
    if (!spaceId) return
    trackHome('home.conversation.create', { surface })
    useChatStore.getState().createConversation(spaceId)
  }

  const handleTogglePin = (e: React.MouseEvent, conv: ConversationMeta) => {
    e.stopPropagation()
    trackHome('home.conversation.action', { action: conv.starred ? 'unpin' : 'pin', kind: 'normal' })
    const spaceId = useSpaceStore.getState().currentSpace?.id
    if (spaceId) useChatStore.getState().toggleStarConversation(spaceId, conv.id, !conv.starred)
  }

  const openMoreMenu = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation()
    setPendingDeleteAppChatId(null)
    if (menuOpenId === conversationId) {
      setMenuOpenId(null)
      setMenuPosition(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const MENU_HEIGHT_ESTIMATE = 90
    const spaceBelow = window.innerHeight - rect.bottom - 4
    const top = spaceBelow >= MENU_HEIGHT_ESTIMATE
      ? rect.bottom + 4
      : Math.max(4, rect.top - MENU_HEIGHT_ESTIMATE - 4)
    setMenuPosition({ top, left: rect.right })
    setMenuOpenId(conversationId)
  }

  // ── Digital-human row actions ──
  // Read the space id fresh at call time (matches handleTogglePin/handleSaveEdit
  // above) rather than closing over the render-scoped `currentSpaceId` — these
  // handlers are captured inside a `useCallback` (renderAppChatItem) with a
  // narrower dep list, so a stale closure would otherwise keep an old space id.
  const handleSelectAppChat = (row: AppChatConversationRow) => {
    const spaceId = useSpaceStore.getState().currentSpace?.id
    if (!spaceId) return
    trackHome('home.conversation.select', { kind: 'digital_human', pinned: row.starred, appId: row.appId })
    markEntry('home_conv_dh')
    pickRow(row.id)
    useChatStore.getState().selectAppChatConversation(spaceId, row.appId, row.id)
  }

  const handleNewAppChat = (appId: string) => {
    const spaceId = useSpaceStore.getState().currentSpace?.id
    if (!spaceId) return
    trackHome('home.conversation.create', { surface: 'dh_group' })
    // Starting one under a collapsed group should still show it.
    setAppGroupOpen(spaceId, appId, true)
    void openDigitalHumanChat(appId, spaceId, { newConversation: true })
  }

  const handleToggleAppChatPin = (e: React.MouseEvent, row: AppChatConversationRow) => {
    e.stopPropagation()
    trackHome('home.conversation.action', { action: row.starred ? 'unpin' : 'pin', kind: 'digital_human' })
    const spaceId = useSpaceStore.getState().currentSpace?.id
    if (spaceId) toggleAppChatPin(spaceId, row.id)
  }

  // Two-step confirm inside the same portal menu used for regular
  // conversations — deleting a digital-human session is more consequential
  // (loses agent context / permanently drops a local session) than renaming
  // a title, so it gets a confirm step regular conversations don't.
  const [pendingDeleteAppChatId, setPendingDeleteAppChatId] = useState<string | null>(null)

  const handleDeleteAppChat = async (row: AppChatConversationRow) => {
    const spaceId = useSpaceStore.getState().currentSpace?.id
    if (!spaceId) return
    trackHome('home.conversation.action', { action: 'delete', kind: 'digital_human' })
    try {
      // The store owns what it holds for the conversation (cache, live turn,
      // selection), so it performs the deletion rather than only being told.
      const chat = useChatStore.getState()
      if (row.isDefault) await chat.clearConversation(row.id)
      else await chat.deleteAppChatSession(row.appId, spaceId, row.id)
    } catch (err) {
      console.error('[ConversationList] Delete app-chat session error:', err)
    } finally {
      setPendingDeleteAppChatId(null)
      setMenuOpenId(null)
      setMenuPosition(null)
    }
  }

  // Stable for the life of the list, so the memoized rows below skip rendering
  // when only the list does; each still runs the latest closure.
  const onSelectConversation = useStableHandler(handleSelectConversation)
  const onToggleConversationPin = useStableHandler(handleTogglePin)
  const onOpenMenu = useStableHandler(openMoreMenu)
  const onSelectAppChat = useStableHandler(handleSelectAppChat)
  const onToggleAppChatPinRow = useStableHandler(handleToggleAppChatPin)
  const onNewAppChat = useStableHandler(handleNewAppChat)
  const onRefreshTeams = useStableHandler(() => teamList.refresh())
  const onToggleTeam = useCallback((id: string, open: boolean) => toggleAppCollapsed(`team:${id}`, open), [toggleAppCollapsed])
  const rowEdit: RowEdit | undefined = editingId ? {
    title: editingTitle, onTitle: setEditingTitle, inputRef: attachEditInputRef, containerRef: editContainerRef,
    onKeyDown: handleEditKeyDown, onBlur: handleEditBlur, onSave: handleSaveEdit,
  } : undefined

  const renderConversationItem = (conversation: ConversationMeta) => <ConversationItemRow
    conversation={conversation}
    status={conversationStatuses.get(conversation.id) ?? 'idle'}
    active={conversation.id === currentConversationId && !selectedAppChat && !selectedTeamChat}
    menuOpen={menuOpenId === conversation.id}
    edit={editingId === conversation.id ? rowEdit : undefined}
    onSelect={onSelectConversation} onTogglePin={onToggleConversationPin} onOpenMenu={onOpenMenu}
    onHover={showHoverCard} onHoverEnd={hideHoverCard} />

  const renderAppChatItem = (row: AppChatConversationRow, standalone: boolean) => <AppChatItemRow
    row={row}
    standalone={standalone}
    status={conversationStatuses.get(row.id) ?? 'idle'}
    active={row.id === selectedAppChat?.conversationId && !selectedTeamChat}
    menuOpen={menuOpenId === row.id}
    edit={editingId === row.id ? rowEdit : undefined}
    onSelect={onSelectAppChat} onTogglePin={onToggleAppChatPinRow} onOpenMenu={onOpenMenu}
    onHover={showHoverCard} onHoverEnd={hideHoverCard} />

  const hoverCardElement = <ConversationHoverCard ref={hoverCardHandle} suppressed={!!editingId || !!menuOpenId} />

  const renderDigitalHumanHeader = (row: Extract<ConversationRow, { type: 'dh-header' }>) => <DigitalHumanHeaderRow
    appId={row.appId} name={row.name} uninstalled={row.uninstalled} collapsed={row.collapsed} status={row.status}
    onToggle={toggleAppCollapsed} onNew={onNewAppChat} />

  const renderTeamRow = (row: TeamListRow, compact = false) => <TeamConversationRow key={row.key} row={row} spaceId={spaceKey}
    onToggle={onToggleTeam} onRefresh={onRefreshTeams}
    onPick={pickRow} onHover={showHoverCard} onHoverEnd={hideHoverCard} compact={compact} />
  const renderMoreRow = (row: Extract<ConversationRow, { type: 'more' }>) => <button type="button" onClick={() => showMore(row)}
    className={cn('flex w-full items-center rounded-sm py-1 pr-1.5 text-left text-xs text-faint-foreground transition-colors ease-halo hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', row.nested ? 'pl-[38px]' : 'pl-2.5')}>
    {row.rest === 0 ? t('Show less')
      : row.unit === 'teams' ? t('{{count}} more teams', { count: row.rest })
        : row.unit === 'digital-humans' ? t('{{count}} more digital humans', { count: row.rest })
          : t('{{count}} more', { count: row.rest })}
  </button>
  const renderListRow = (row: ConversationRow) => {
    if (row.type === 'more') return renderMoreRow(row)
    if (row.type === 'team-header' || row.type === 'team-item' || row.type === 'team-retry' || row.type === 'team-hidden' || row.type === 'team-empty') return renderTeamRow(row)
    if (row.type === 'dh-header') return renderDigitalHumanHeader(row)
    if (row.type === 'dh-item') return renderAppChatItem(row.row, row.standalone)
    return renderConversationItem(row.conversation)
  }

  if (folded) {
    return (
      <div
        ref={containerRef}
        className="relative w-14 h-full flex-shrink-0 border-r border-border-faint bg-background flex flex-col items-center"
      >
        <div className="w-full px-2 pt-2.5 pb-1.5">
          <button
            onClick={() => handleCreateConversation('rail_collapsed')}
            className="flex h-9 w-full items-center justify-center rounded-sm bg-secondary/60 text-foreground transition-colors ease-halo hover:bg-surface-hover"
            title={t('New conversation')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {/* Same rows as the expanded list, minus its section headers, so
            collapsing never drops a conversation the open list shows. Dots
            carry no label of their own, so the hover bubble is the only way
            to tell them apart; it is portaled and fixed-positioned because
            this column scrolls, and a scroll container clips anything
            reaching past its edge. */}
        <div ref={reveal.stripRef} className="flex-1 w-full overflow-y-auto px-2 py-1 flex flex-col items-center gap-0.5">
          {windowRows(stripRows ?? [], 4, () => STRIP_DOT_PX, view, keepMounted, -2).map(item => {
            if ('gap' in item) return <div key={item.key} aria-hidden="true" className="w-full flex-shrink-0" style={{ height: item.gap }} />
            const row = item.row
            if (row.type === 'team-item') return renderTeamRow(row, true)
            if (row.type !== 'item' && row.type !== 'dh-item') return null
            const isAppChat = row.type === 'dh-item'
            const id = isAppChat ? row.row.id : row.conversation.id
            const active = isAppChat
              ? row.row.id === selectedAppChat?.conversationId && !selectedTeamChat
              : row.conversation.id === currentConversationId && !selectedAppChat && !selectedTeamChat
            const status = conversationStatuses.get(id) ?? 'idle'
            return (
              <button
                key={row.key}
                data-row-key={row.key}
                onClick={() => {
                  if (isAppChat) {
                    if (row.row.uninstalled) openPersonActivity(row.row.appId)
                    else handleSelectAppChat(row.row)
                  } else {
                    handleSelectConversation(row.conversation)
                  }
                }}
                onMouseEnter={(e) => showHoverCard(e.currentTarget, hoverCardFor(row, t, status))}
                onMouseLeave={hideHoverCard}
                aria-current={active}
                className={cn(
                  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-colors ease-halo hover:bg-secondary',
                  active && 'bg-secondary'
                )}
              >
                {/* Colour carries the state; the round backdrop marks the open
                    conversation (and hover) — with the list collapsed this is
                    the only place either is visible. */}
                {status !== 'idle' ? (
                  <TaskStatusDot status={status} size="md" />
                ) : (
                  <span className={cn(
                    'w-[7px] h-[7px] rounded-full',
                    active ? 'bg-foreground' : 'bg-subtle-foreground opacity-50'
                  )} />
                )}
              </button>
            )
          })}
        </div>
        {hoverCardElement}
        <div
          className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 transition-colors z-20 ${
            isDragging ? 'bg-primary/50' : ''
          }`}
          onMouseDown={handleMouseDown}
          title={t('Drag to resize width')}
        />
      </div>
    )
  }

  /** Running offset of the scrolling column's content while its sections are laid out below. */
  let contentY = 0
  return (
    <>
    <div
      ref={containerRef}
      className="border-r border-border-faint flex flex-col bg-background relative"
      style={{ width, transition: isDragging ? 'none' : 'width 0.2s ease' }}
    >
      <div className="flex flex-col gap-2 px-2.5 pt-4 pb-3">
        <button
          onClick={() => handleCreateConversation('list')}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm bg-secondary/60 text-xs font-medium text-foreground transition-colors ease-halo hover:bg-surface-hover"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('New conversation')}
        </button>
      </div>

      <div ref={listColumnRef} className="flex-1 min-h-0 flex flex-col">
      {/* Pinned stays put: a pane of its own at the top, scrolling inside past its height. */}
      {pinnedRows.length > 0 && (
        <div className="group/section relative flex min-h-0 flex-col pb-2">
          {/* pr-4: the 8px a scrollbar keeps on the right below, so this heading's arrow lines up with theirs. */}
          <div className="flex-shrink-0 pl-2 pr-4 pt-1">
            <SectionHeaderButton section="pinned" label={t('Pinned')} collapsed={!pinnedOpen} onToggle={toggleSection} />
          </div>
          {pinnedOpen && <>
            <div ref={reveal.pinnedRef} className="min-h-8 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]" style={{ maxHeight: pinnedResize.height }}>
              {pinnedRows.map(row => <div key={row.key} data-row-key={row.key} className="flow-root px-2 pb-0.5">{renderListRow(row)}</div>)}
            </div>
            <PaneResizeHandle label={t('Resize pinned list')} height={pinnedResize.height} dragging={pinnedResize.dragging} handleProps={pinnedResize.handleProps} />
          </>}
        </div>
      )}

      {/* The rest scrolls as one. Headings are siblings of the rows rather than wrapping them, so each
          can stay on top while its rows go by, and those further down can wait stacked at the bottom. */}
      <div ref={reveal.scrollerRef} data-fill-pane="" className={cn('flex-1 min-h-[68px] overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]', pinnedRows.length > 0 && 'border-t border-border-faint')}>
        {([
          { section: 'teams', rows: teamRows, open: teamsOpen, label: t('Teams'), attention: teamsAttention, hint: t('Conversations with your teams in this workspace') },
          { section: 'digital-humans', rows: digitalHumanRows, open: digitalHumansOpen, label: t('Digital Humans'), attention: digitalHumanAttention, hint: t('Conversations with digital humans available in this workspace') },
          { section: 'conversations', rows: conversationRows, open: conversationsOpen, label: t('Conversations'), attention: conversationsAttention, hint: t('Your direct conversations with Halo') },
        ] satisfies Array<{ section: ConversationSection; rows: ConversationRow[]; open: boolean; label: string; attention?: TaskStatus; hint?: string }>)
          .filter(({ rows }) => rows.length > 0)
          .flatMap(({ section, rows, open, label, attention, hint }, index, all) => {
            // Where this section's rows start in the column: every heading and row above it.
            contentY += STICKY_HEADING_PX
            const items = open ? windowRows(rows, contentY, rowHeights.heightOf, view, keepMounted) : []
            if (open) for (const row of rows) contentY += rowHeights.heightOf(row)
            return [
            <div key={`anchor:${section}`} aria-hidden="true" ref={el => { if (el) sectionAnchors.current.set(section, el); else sectionAnchors.current.delete(section) }} />,
            <div key={`heading:${section}`}
              // Centred: stacked on top or waiting at the bottom, each heading sits between dividers.
              className={cn('group/section sticky z-10 flex flex-col justify-center bg-background px-2', index > 0 && 'border-t border-border-faint')}
              style={{ top: index * STICKY_HEADING_PX, bottom: (all.length - 1 - index) * STICKY_HEADING_PX, height: STICKY_HEADING_PX }}>
              <SectionHeaderButton section={section} label={label} hint={hint} collapsed={!open} attention={attention} onToggle={toggleSection}
                docked={docked.has(section)} count={sectionCount[section]} onJump={jumpToSection} className="pb-0" />
            </div>,
            ...items.map(item => 'gap' in item
              ? <div key={item.key} aria-hidden="true" style={{ height: item.gap }} />
              : <div key={item.row.key} data-row-key={item.row.key} className={LIST_ROW}>{renderListRow(item.row)}</div>),
          ]
          })}
        {/* Room after the last row as a spacer, not padding: a sticky heading stops at the
            padding's edge, so the headings waiting at the bottom would let rows show beneath them. */}
        <div aria-hidden="true" className="h-3" />
      </div>
      </div>

      {/* Drag handle - on right side */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 transition-colors z-20 ${
          isDragging ? 'bg-primary/50' : ''
        }`}
        onMouseDown={handleMouseDown}
        title={t('Drag to resize width')}
      />
    </div>

    {hoverCardElement}

    {/* Dropdown menu — Portal to document.body, fully outside flex layout.
        Pin lives inline on the row now; this keeps rename/delete. */}
    {menuOpenId && menuPosition && (() => {
      const conv = conversations.find(c => c.id === menuOpenId)
      if (conv) {
        return createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] min-w-[140px] bg-popover border border-border rounded-lg shadow-lg py-1"
            style={{ top: menuPosition.top, left: menuPosition.left, transform: 'translateX(-100%)' }}
          >
            <button
              onClick={(e) => {
                handleStartEdit(e, conv)
                setMenuOpenId(null)
                setMenuPosition(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-secondary transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>{t('Rename')}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                trackHome('home.conversation.action', { action: 'delete', kind: 'normal' })
                const spaceId = useSpaceStore.getState().currentSpace?.id
                if (spaceId) useChatStore.getState().deleteConversation(spaceId, conv.id)
                setMenuOpenId(null)
                setMenuPosition(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('Delete')}</span>
            </button>
          </div>,
          document.body
        )
      }

      // Digital-human row menu: delete only (rename is meaningless —
      // the title is always the digital-human's own name), with an inline
      // confirm step since it either clears history or drops a local session.
      const dhRow = allAppChatRows.find(r => r.id === menuOpenId)
      if (!dhRow) return null
      const confirming = pendingDeleteAppChatId === dhRow.id
      return createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[160px] bg-popover border border-border rounded-lg shadow-lg py-1"
          style={{ top: menuPosition.top, left: menuPosition.left, transform: 'translateX(-100%)' }}
        >
          {confirming ? (
            <div className="px-3 py-2">
              <p className="text-xs text-muted-foreground mb-2">
                {dhRow.isDefault ? t('Clear all chat history?') : t('Delete this conversation?')}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingDeleteAppChatId(null) }}
                  className="px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary rounded transition-colors"
                >
                  {t('Cancel')}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDeleteAppChat(dhRow) }}
                  className="px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 rounded transition-colors"
                >
                  {t('Confirm')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingId(dhRow.id)
                  setEditingTitle(dhRow.customName || dhRow.title || dhRow.displayName.trim() || '')
                  setMenuOpenId(null)
                  setMenuPosition(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-secondary transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{t('Rename')}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setPendingDeleteAppChatId(dhRow.id) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{dhRow.isDefault ? t('Clear chat') : t('Delete')}</span>
              </button>
            </>
          )}
        </div>,
        document.body
      )
    })()}
    </>
  )
})
