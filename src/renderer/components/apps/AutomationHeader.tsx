/**
 * AutomationHeader
 *
 * Persona card + tab bar for automation (digital human) apps.
 * Top section: avatar, name, status, last activity summary, and action buttons.
 * Bottom section: tab bar to switch between Chat / Activity / Config views.
 *
 * The avatar is generated deterministically from the app name using boring-avatars.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Play, Pause, RotateCcw, Globe, ExternalLink, LayoutDashboard, MessageSquare, Activity, Cog, ChevronRight, ArrowLeft } from 'lucide-react'
import { AutomationAvatar } from './AutomationAvatar'
import { useAppsStore } from '../../stores/apps.store'
import { useAppsPageStore } from '../../stores/apps-page.store'
import { useTranslation, getCurrentLanguage } from '../../i18n'
import { resolveSpecI18n } from '../../utils/spec-i18n'
import { automationStatusLabel, automationStatusTextClass, deriveAutomationStatus } from '../../utils/automation-status'
import { formatElapsed, formatTimeAgo } from '../../utils/format-time'
import { AppStatusDot } from './AppStatusDot'
import { AppLifecycleMenu } from './AppLifecycleMenu'
import { resolvePermission } from '../../../shared/apps/app-types'
import { api } from '../../api'
import { navigateToAppChat } from '../pulse'
import { getAppChatConversationId } from '../../../shared/apps/im-keys'

interface AutomationHeaderProps {
  appId: string
}

// Chatting with this digital human happens on the main conversation board,
// opened via the "Chat" action button in the persona card, not a tab here.
export type AutomationTab = 'overview' | 'activity' | 'config'

export function AutomationHeader({ appId }: AutomationHeaderProps) {
  const { t } = useTranslation()
  const { apps, appStates, pauseApp, resumeApp, triggerApp } = useAppsStore()
  const { openAppConfig, openActivityThread, openAppOverview, detailView, clearSelection } = useAppsPageStore()
  const app = apps.find(a => a.id === appId)
  const runtimeState = appStates[appId]

  // Browser popover state
  const [showBrowserPopover, setShowBrowserPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    if (!showBrowserPopover) return
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowBrowserPopover(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showBrowserPopover])

  const handleOpenBrowser = useCallback((url: string, label: string) => {
    setShowBrowserPopover(false)
    api.openLoginWindow(url, label)
  }, [])

  // Keeps the running elapsed counter moving; idle states need no tick.
  const [, forceTick] = useState(0)
  const isTicking = runtimeState?.status === 'running'
  useEffect(() => {
    if (!isTicking) return
    const id = setInterval(() => forceTick(v => v + 1), 1000)
    return () => clearInterval(id)
  }, [isTicking])

  // Derive current tab from detailView
  const currentTab: AutomationTab = useMemo(() => {
    if (detailView?.type === 'app-config') return 'config'
    if (detailView?.type === 'activity-thread') return 'activity'
    return 'overview'
  }, [detailView])

  if (!app) return null

  const { name, description, browser_login } = resolveSpecI18n(app.spec, getCurrentLanguage())
  const status = app.status
  const effectiveStatus = deriveAutomationStatus(status, runtimeState?.status)
  const isAutomation = app.spec.type === 'automation'

  const isWaiting = status === 'waiting_user'
  const isPaused = status === 'paused'
  const isRunning = effectiveStatus === 'running'
  const isQueued = effectiveStatus === 'queued'

  // The header is the only surface present on every tab, so it carries the
  // one-line "what is it doing right now" that Overview's status grid shows.
  const statusDetail = isRunning && runtimeState?.runningAtMs
    ? formatElapsed(runtimeState.runningAtMs)
    : runtimeState?.nextRunAtMs && (effectiveStatus === 'idle' || effectiveStatus === 'queued')
      ? t('next {{time}}', { time: new Date(runtimeState.nextRunAtMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })
      : runtimeState?.lastRunAtMs
        ? formatTimeAgo(runtimeState.lastRunAtMs, t)
        : null

  // Browser button visibility
  const hasBrowserLogin = browser_login && browser_login.length > 0
  const hasAiBrowser = resolvePermission(app, 'ai-browser')
  const showBrowserButton = hasBrowserLogin || hasAiBrowser

  // Tab click handlers
  const handleTabOverview = () => openAppOverview(appId)
  const handleTabActivity = () => openActivityThread(appId)
  const handleTabConfig = () => openAppConfig(appId)

  const tabs: { key: AutomationTab; label: string; icon: typeof MessageSquare; onClick: () => void }[] = [
    { key: 'overview', label: t('Overview'), icon: LayoutDashboard, onClick: handleTabOverview },
    { key: 'activity', label: t('Activity'), icon: Activity, onClick: handleTabActivity },
    { key: 'config', label: t('Settings'), icon: Cog, onClick: handleTabConfig },
  ]

  // R8: jumps to the main conversation board with this digital human
  // selected. Global apps (no home space, D3/G8) open in the current space
  // rather than a no-op — see navigateToAppChat's appSpaceId param.
  const handleOpenChat = () => {
    navigateToAppChat(app.spaceId ?? null, appId, getAppChatConversationId(appId))
  }

  return (
    <div className="flex-shrink-0">
      {/* ── Back to list ── */}
      <div className="px-4 sm:px-10 pt-6">
        <button
          onClick={clearSelection}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('My Digital Humans')}
        </button>
      </div>

      {/* ── Persona Card ── */}
      <div className="flex items-start gap-3.5 px-4 sm:px-10 pt-6 pb-6">
        {/* Avatar */}
        <div className="flex-shrink-0 rounded-2xl overflow-hidden">
          <AutomationAvatar name={name || appId} size={52} />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
            <h2 className="text-xl font-semibold text-foreground truncate leading-tight">{name}</h2>
            {isAutomation && (
              <span className="inline-flex items-center gap-1.5 flex-shrink-0">
                <AppStatusDot status={app.status} runtimeStatus={runtimeState?.status} />
                <span className={`text-xs ${automationStatusTextClass(effectiveStatus)}`}>
                  {automationStatusLabel(effectiveStatus, t)}
                </span>
                {statusDetail && (
                  <span className="text-xs text-muted-foreground">· {statusDetail}</span>
                )}
              </span>
            )}
          </div>
          {description && (
            <p className="text-[13px] text-muted-foreground mt-[5px] line-clamp-2">{description}</p>
          )}
        </div>

        {/* Action buttons */}
        {isAutomation && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Chat (R8) — jumps to the main conversation board with this
                digital human selected; the detail page itself no longer
                embeds a Chat tab (R7). Leads the row: it's the most common
                action, everything else is app-lifecycle management. */}
            <button
              onClick={handleOpenChat}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[9px] bg-primary border border-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" /> {t('Chat')}
            </button>

            {/* Run now (also available when paused — backend auto-resumes) */}
            {!isWaiting && (
              <button
                onClick={() => triggerApp(appId)}
                disabled={isRunning || isQueued}
                title={isQueued ? t('Queued — waiting for a run slot') : isPaused ? t('Resume and run now') : t('Run now')}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[9px] border border-border bg-secondary text-[13px] font-medium text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5" /> {t('Run now')}
              </button>
            )}

            {/* Pause / Enable — distinct copy from Skill/MCP's generic
                Enable/Disable toggle (SkillCard.tsx, McpCard.tsx, etc.):
                this one turns the app's own scheduled/triggered runs on or
                off, not a dependency other things use, so "automatic tasks"
                names what's actually being toggled. */}
            {isPaused ? (
              <button
                onClick={() => resumeApp(appId)}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[9px] border border-border bg-secondary text-[13px] font-medium text-foreground hover:bg-secondary/80 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> {t('Enable automatic tasks')}
              </button>
            ) : (
              <button
                onClick={() => pauseApp(appId)}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[9px] border border-border bg-secondary text-[13px] font-medium text-foreground hover:bg-secondary/80 transition-colors"
              >
                <Pause className="w-3.5 h-3.5" /> {t('Pause automatic tasks')}
              </button>
            )}

            {/* Browser */}
            {showBrowserButton && (
              <div ref={popoverRef} className="relative">
                <button
                  onClick={() => setShowBrowserPopover(prev => !prev)}
                  title={t('Browser')}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
                >
                  <Globe className="w-3.5 h-3.5" />
                </button>
                {showBrowserPopover && (
                  <BrowserLoginPopover
                    onOpenCustomUrl={(url) => handleOpenBrowser(url, t('Browser'))}
                    t={t}
                  />
                )}
              </div>
            )}

            {/* Restart / share / export / clear memory / uninstall */}
            <AppLifecycleMenu appId={appId} spaceId={app.spaceId} />
          </div>
        )}
      </div>

      {/* ── Tab Bar ── */}
      {isAutomation && (
        <div className="px-4 sm:px-10">
          <div className="flex items-center gap-0.5 border-b border-border">
            {tabs.map(tab => {
              const Icon = tab.icon
              const isActive = currentTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={tab.onClick}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                    isActive
                      ? 'text-foreground border-foreground'
                      : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// Browser Login Popover
// ──────────────────────────────────────────────

/** Ad-hoc "open any URL in the Halo browser" utility. The app's declared login
 * sites are deliberately not repeated here — Settings owns that list, and the
 * login notice bar owns the alarm. */
interface BrowserLoginPopoverProps {
  onOpenCustomUrl: (url: string) => void
  t: (s: string, opts?: Record<string, unknown>) => string
}

function BrowserLoginPopover({ onOpenCustomUrl, t }: BrowserLoginPopoverProps) {
  const [customUrl, setCustomUrl] = useState('')

  const handleOpenCustom = () => {
    const trimmed = customUrl.trim()
    if (!trimmed) return
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    onOpenCustomUrl(url)
    setCustomUrl('')
  }

  return (
    <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] max-w-[calc(100vw-2rem)] sm:max-w-[300px] bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-foreground">{t('Browser')}</span>
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleOpenCustom() }}
            placeholder={t('Enter URL')}
            className="flex-1 min-w-0 bg-muted border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <button
            onClick={handleOpenCustom}
            disabled={!customUrl.trim()}
            className="flex-shrink-0 p-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('Open')}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
