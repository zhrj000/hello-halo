/**
 * Apps Page
 *
 * Top-level page for the Apps system. Accessible from SpacePage header.
 * Layout: Header + tab bar + two-level navigation (full-width list, or
 * full-width detail with a back button) — the same structure at every
 * viewport width, desktop included. There is no side-by-side split pane.
 *
 * Session Detail drill-down:
 * When viewing a run's execution trace, a breadcrumb bar replaces the
 * AutomationHeader. Clicking the app name in the breadcrumb returns to
 * the Activity Thread without losing the current selection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSpaceStore } from '../stores/space.store'
import { useAppsStore } from '../stores/apps.store'
import { useAppsPageStore, tabForAppType } from '../stores/apps-page.store'
import { useSearchStore } from '../stores/search.store'
import type { AppType } from '../../shared/apps/spec-types'
import { Header } from '../components/layout/Header'
import { SearchIcon } from '../components/search/SearchIcon'
import { AutomationCardWall } from '../components/apps/AutomationCardWall'
import { SkillCardWall } from '../components/apps/SkillCardWall'
import { McpCardWall } from '../components/apps/McpCardWall'
import { AutomationHeader } from '../components/apps/AutomationHeader'
import { AppOverviewPanel } from '../components/apps/AppOverviewPanel'
import { LoginNoticeBar } from '../components/apps/LoginNoticeBar'
import { ActivityThread } from '../components/apps/ActivityThread'
import { SessionDetailView } from '../components/apps/SessionDetailView'
import { AppConfigPanel } from '../components/apps/AppConfigPanel'
import { AppBotSessionsView } from '../components/apps/AppBotSessionsView'
import { McpStatusCard } from '../components/apps/McpStatusCard'
import { SkillInfoCard } from '../components/apps/SkillInfoCard'
import { EmptyState } from '../components/apps/EmptyState'
import { AppInstallDialog } from '../components/apps/AppInstallDialog'
import { ManualAddDialog } from '../components/apps/ManualAddDialog'
import { SkillInstallDialog } from '../components/apps/SkillInstallDialog'
import { UninstalledDetailView } from '../components/apps/UninstalledDetailView'
import { useTranslation, getCurrentLanguage } from '../i18n'
import { resolveSpecI18n } from '../utils/spec-i18n'
import { api } from '../api'
import { ChevronRight, ArrowLeft } from 'lucide-react'

export function AppsPage() {
  const { t } = useTranslation()
  const { openSearch } = useSearchStore()
  const haloSpace = useSpaceStore(state => state.haloSpace)
  const spaces = useSpaceStore(state => state.spaces)
  const { apps, loadApps, updateAppOverrides } = useAppsStore()
  const {
    currentTab,
    setCurrentTab,
    selectedAppId,
    detailView,
    initialAppId,
    showInstallDialog,
    selectApp,
    clearSelection,
    openAppOverview,
    openActivityThread,
    setInitialAppId,
    setShowInstallDialog,
    openMarketplaceFilteredBy,
  } = useAppsPageStore()

  /** When set, ManualAddDialog opens pre-targeted to that type (skips chooser) */
  const [manualAddType, setManualAddType] = useState<'mcp' | 'skill' | null>(null)
  const [showSkillInstallDialog, setShowSkillInstallDialog] = useState(false)

  /** Maps the current tab to the AppType filter used for visibility */
  const appTypeForCurrentTab = useMemo<AppType | null>(() => {
    if (currentTab === 'my-skills') return 'skill'
    if (currentTab === 'my-mcp') return 'mcp'
    if (currentTab === 'my-digital-humans') return 'automation'
    return null
  }, [currentTab])

  /** Filter apps visible in the current tab */
  const appsForCurrentTab = useMemo(() => {
    if (!appTypeForCurrentTab) return []
    return apps.filter(a => a.spec.type === appTypeForCurrentTab)
  }, [apps, appTypeForCurrentTab])

  /**
   * Open the marketplace pre-filtered by the target type. Delegates to the
   * store action so the listing is always refetched — never silently stale.
   */
  const handleBrowseMarketplace = useCallback((type: AppType) => {
    void openMarketplaceFilteredBy(type)
  }, [openMarketplaceFilteredBy])

  // Load all apps globally (across all spaces) on mount
  useEffect(() => {
    loadApps()
  }, [loadApps])

  // Fetch available updates on mount and stay subscribed to push events so
  // the store's "Update" affordances stay fresh without polling.
  const checkUpdatesAction = useAppsPageStore(s => s.checkUpdates)
  useEffect(() => {
    void checkUpdatesAction()
    const unsubscribe = api.onStoreUpgradeAvailable(() => {
      void checkUpdatesAction()
    })
    return () => {
      unsubscribe()
    }
  }, [checkUpdatesAction])

  // Build spaceId -> space name map for display
  // Always populate from both haloSpace and dedicated spaces
  const spaceMap = useMemo(() => {
    const map: Record<string, string> = {}
    if (haloSpace) map[haloSpace.id] = haloSpace.name
    for (const s of spaces) {
      map[s.id] = s.name
    }
    return map
  }, [spaces, haloSpace])

  // Auto-select initial app (from notification/badge navigation)
  useEffect(() => {
    if (initialAppId && apps.length > 0) {
      const app = apps.find(a => a.id === initialAppId)
      if (app) {
        // Switch to the correct tab for this app type (digital-humans / skills / mcp)
        const targetTab = tabForAppType(app.spec.type)
        if (currentTab !== targetTab) setCurrentTab(targetTab)
        selectApp(app.id, app.status === 'uninstalled' ? 'uninstalled' : app.spec.type, app.spaceId ?? undefined)
        setInitialAppId(null)
      }
    }
  }, [apps, initialAppId, selectApp, setInitialAppId, currentTab, setCurrentTab])

  // Clear selection when switching between the 3 tabs (my-digital-humans /
  // my-skills / my-mcp). Store is a separate top-level view that unmounts
  // this whole page while visiting it, so a round-trip through Store never
  // runs this effect at all, and selectedAppId (held in the store, not
  // component state) survives the unmount/remount untouched — no
  // special-casing needed for it here.
  const prevTabRef = useRef(currentTab)
  useEffect(() => {
    const prev = prevTabRef.current
    prevTabRef.current = currentTab
    if (prev !== currentTab) {
      // Preserve the selection when it already belongs to the new tab. This is
      // the case for programmatic cross-tab navigation (e.g. opening an MCP or
      // skill detail from a digital human's settings), which sets the tab and
      // the selection together — clearing here would wipe the just-opened
      // detail and auto-select the first app instead.
      const sel = apps.find(a => a.id === selectedAppId)
      const belongsToNewTab = sel ? tabForAppType(sel.spec.type) === currentTab : false
      if (!belongsToNewTab) clearSelection()
    }
  }, [currentTab, clearSelection, apps, selectedAppId])

  // Resolve the selected app (for breadcrumb and detail panel)
  const selectedApp = useMemo(
    () => apps.find(a => a.id === selectedAppId),
    [apps, selectedAppId]
  )

  // Locale-resolved display fields for breadcrumbs and login notice
  const resolvedSpec = useMemo(
    () => selectedApp ? resolveSpecI18n(selectedApp.spec, getCurrentLanguage()) : undefined,
    [selectedApp]
  )
  const selectedAppName = resolvedSpec?.name

  // Login notice bar: show when browser_login exists and not dismissed
  const showLoginNotice = useMemo(() => {
    if (!selectedApp || selectedApp.spec.type !== 'automation') return false
    const browserLogin = resolvedSpec?.browser_login
    if (!browserLogin || browserLogin.length === 0) return false
    return !selectedApp.userOverrides?.loginNoticeDismissed
  }, [selectedApp, resolvedSpec])

  const isSessionDetail = detailView?.type === 'session-detail' || detailView?.type === 'bot-sessions'
  const isAppConfig = detailView?.type === 'app-config'
  const isUninstalledDetail = detailView?.type === 'uninstalled-detail'

  // Right-pane EmptyState is informational only; install/browse CTAs live
  // exclusively in each card wall to avoid double action surfaces.
  const emptyStateVariant = currentTab === 'my-skills'
    ? 'skill' as const
    : currentTab === 'my-mcp'
      ? 'mcp' as const
      : 'automation' as const

  const renderDetail = () => {
    if (!detailView) {
      return (
        <EmptyState
          hasApps={appsForCurrentTab.length > 0}
          variant={emptyStateVariant}
        />
      )
    }

    switch (detailView.type) {
      case 'app-overview':
        return <AppOverviewPanel appId={detailView.appId} />
      case 'activity-thread':
        return <ActivityThread appId={detailView.appId} />
      case 'session-detail':
        return (
          <SessionDetailView
            appId={detailView.appId}
            runId={detailView.runId}
          />
        )
      case 'bot-sessions':
        return (
          <AppBotSessionsView
            appId={detailView.appId}
            spaceId={selectedApp?.spaceId ?? ''}
            instanceId={detailView.instanceId}
          />
        )
      case 'app-config':
        return <AppConfigPanel appId={detailView.appId} spaceName={selectedApp?.spaceId ? spaceMap[selectedApp.spaceId] : t('Global')} />
      case 'mcp-status':
        return <McpStatusCard appId={detailView.appId} spaceName={selectedApp?.spaceId ? spaceMap[selectedApp.spaceId] : t('Global')} />
      case 'skill-info':
        return <SkillInfoCard appId={detailView.appId} spaceName={selectedApp?.spaceId ? spaceMap[selectedApp.spaceId] : t('Global')} />
      case 'uninstalled-detail':
        return <UninstalledDetailView appId={detailView.appId} spaceName={selectedApp?.spaceId ? spaceMap[selectedApp.spaceId] : t('Global')} />
      default:
        return (
          <EmptyState
            hasApps={appsForCurrentTab.length > 0}
            variant={emptyStateVariant}
          />
        )
    }
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header — .header.plain: non-conversation pages show global search,
          not a settings button (settings lives in NavRail). The search
          control sits in the left slot, not the right, so it's the same
          position in both chat and plain header modes. */}
      <Header
        left={
          <>
            {selectedAppId && selectedAppName ? (
              <h1 className="text-[15px] font-semibold text-foreground truncate flex-shrink-0 max-w-[240px]">
                {selectedAppName}
              </h1>
            ) : (
              <h1 className="text-[15px] font-semibold text-foreground flex-shrink-0">
                {t('Digital Humans · Extensions')}
              </h1>
            )}
            <SearchIcon onClick={() => openSearch('global')} />
          </>
        }
      />

      {/* List chrome (page title/lead + tab bar) — hidden while a detail view
          is open: the prototype swaps the whole list block for the detail page
          (agentList hidden, #pageTitle becomes the app name), so the detail
          page owns its full vertical space and its own back button. */}
      {!selectedAppId && (
        <>
          {/* Page title/lead — outer container only, per §4.12: doesn't touch the
              existing tab bar / content area's own spacing below it. */}
          <div className="px-4 sm:px-10 pt-5 sm:pt-7 flex-shrink-0">
            <h1 className="text-xl font-semibold mb-1">{t('Digital Humans · Extensions')}</h1>
            <p className="text-[13px] text-muted-foreground mb-5">
              {t('Manage all installed digital humans, Skills, and MCPs.')}
            </p>
          </div>

          {/* Tab bar — kept provider-agnostic via TabButton sub-component */}
          <div className="flex items-center gap-1 mx-4 sm:mx-10 border-b border-border flex-shrink-0 overflow-x-auto">
            <TabButton
              active={currentTab === 'my-digital-humans'}
              label={t('My Digital Humans')}
              count={apps.filter(a => a.spec.type === 'automation').length}
              onClick={() => setCurrentTab('my-digital-humans')}
            />
            <TabButton
              active={currentTab === 'my-skills'}
              label={t('My Skills')}
              count={apps.filter(a => a.spec.type === 'skill').length}
              onClick={() => setCurrentTab('my-skills')}
            />
            <TabButton
              active={currentTab === 'my-mcp'}
              label={t('My MCP')}
              count={apps.filter(a => a.spec.type === 'mcp').length}
              onClick={() => setCurrentTab('my-mcp')}
            />
          </div>
        </>
      )}

      {/* Content area */}
      {/*
        Two-level navigation, same structure at every width: full-width list,
        or full-width detail with a back button. No side-by-side split pane —
        desktop and mobile share this one code path.
      */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedAppId ? (
          <>
            {/* Every detail view owns its back button (AutomationHeader,
                SkillInfoCard, McpStatusCard, UninstalledDetailView); session
                detail has the breadcrumb's own back arrow instead. No generic
                fallback bar — one was kept here historically for views that
                hadn't been given their own yet, but that's now none of them,
                and it produced a second back button stacked above McpStatusCard's. */}

            {/* Session detail breadcrumb — replaces AutomationHeader when drilling into a specific run */}
            {isSessionDetail && selectedApp && (
              detailView?.type === 'bot-sessions' ? (
                // No secondary label: the left pane's contact list and the
                // selected conversation's own info bar already say who this
                // is. Back returns to Overview, where bot rows link in from.
                <SessionBreadcrumb
                  appName={selectedAppName ?? ''}
                  onBack={() => openAppOverview(selectedApp.id)}
                />
              ) : (
                <SessionBreadcrumb
                  appName={selectedAppName ?? ''}
                  runId={(detailView as { runId: string }).runId}
                  onBack={() => openActivityThread(selectedApp.id)}
                />
              )
            )}

            {/* Automation persona card + tab bar — shown for all automation views except session detail drill-down */}
            {!isSessionDetail && !isUninstalledDetail && selectedApp?.spec.type === 'automation' && (
              <>
                <AutomationHeader appId={selectedAppId} />
                {showLoginNotice && resolvedSpec?.browser_login && (detailView?.type === 'app-overview' || detailView?.type === 'activity-thread') && (
                  <LoginNoticeBar
                    browserLogin={resolvedSpec.browser_login}
                    onDismiss={() => {
                      if (selectedAppId) {
                        updateAppOverrides(selectedAppId, { loginNoticeDismissed: true })
                      }
                    }}
                    onOpenBrowser={(url, label) => {
                      api.openLoginWindow(url, label)
                    }}
                  />
                )}
              </>
            )}

            {/* Detail content — session-detail manages its own scroll + flex layout */}
            <div className={`flex-1 ${isSessionDetail ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              {renderDetail()}
            </div>
          </>
        ) : (
          /* No selection: full-width list — outer container owns the gutter so
             the toolbar's border-b inlines with the tab bar above, and the
             walls don't re-add per-section padding. */
          <div className="flex-1 min-h-0 px-4 sm:px-10 flex flex-col">
            {currentTab === 'my-skills' ? (
              <SkillCardWall
                spaceMap={spaceMap}
                onBrowseStore={() => handleBrowseMarketplace('skill')}
                onManualAdd={() => setShowSkillInstallDialog(true)}
              />
            ) : currentTab === 'my-mcp' ? (
              <McpCardWall
                spaceMap={spaceMap}
                onBrowseStore={() => handleBrowseMarketplace('mcp')}
                onManualAdd={() => setManualAddType('mcp')}
              />
            ) : (
              <AutomationCardWall
                spaceMap={spaceMap}
                onInstall={() => setShowInstallDialog(true)}
                onBrowseStore={() => handleBrowseMarketplace('automation')}
              />
            )}
          </div>
        )}
      </div>

      {/* Install dialog */}
      {showInstallDialog && (
        <AppInstallDialog
          onClose={() => setShowInstallDialog(false)}
        />
      )}

      {/* Manual add dialog (MCP only — pre-typed by tab, no chooser step) */}
      {manualAddType && (
        <ManualAddDialog
          initialType={manualAddType}
          onClose={() => setManualAddType(null)}
          onSkillAdd={() => setShowSkillInstallDialog(true)}
        />
      )}

      {/* Skill install dialog */}
      {showSkillInstallDialog && (
        <SkillInstallDialog
          onClose={() => setShowSkillInstallDialog(false)}
        />
      )}

    </div>
  )
}

// ──────────────────────────────────────────────
// Tab button sub-component
// ──────────────────────────────────────────────

interface TabButtonProps {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}

function TabButton({ active, label, count, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`h-[34px] px-3.5 -mb-px border-b-2 text-[13px] font-medium transition-colors ease-halo whitespace-nowrap ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-subtle-foreground hover:text-foreground'
      }`}
    >
      {label}
      {typeof count === 'number' && (
        <span className="ml-1 text-[11px] text-subtle-foreground">{count}</span>
      )}
    </button>
  )
}

// ──────────────────────────────────────────────
// Breadcrumb sub-component
// ──────────────────────────────────────────────

interface SessionBreadcrumbProps {
  appName: string
  runId?: string
  label?: string
  onBack: () => void
}

function SessionBreadcrumb({ appName, runId, label, onBack }: SessionBreadcrumbProps) {
  const { t } = useTranslation()
  // Show abbreviated run ID (first 8 chars)
  const shortRunId = runId ? (runId.length > 8 ? runId.slice(0, 8) : runId) : ''
  const displayLabel = label || (shortRunId ? `${t('Run')} ${shortRunId}` : '')

  return (
    <div className="flex items-center gap-1.5 px-4 sm:px-10 py-2.5 border-b border-border bg-muted/30 flex-shrink-0">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        {appName}
      </button>
      {displayLabel && (
        <>
          <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
          <span className="text-sm text-muted-foreground">
            {displayLabel}
          </span>
        </>
      )}
    </div>
  )
}
