/**
 * McpStatusCard
 *
 * Right-panel detail view for an MCP-type app.
 * Shows connection status, enable/disable toggle, and full inline editing
 * (visual + JSON modes) matching the quality of the old Settings > MCP page.
 *
 * Enable/Disable maps to app:pause / app:resume.
 * Edit saves via updateAppSpec({ mcp_server: ... }).
 */

import { useState, useCallback } from 'react'
import {
  ArrowLeft, Wrench, Loader2, AlertTriangle, Pencil, X, Check,
  Plus, Settings2, Code, AlertCircle, ChevronDown, ChevronRight, PlugZap, Info, Power, PowerOff, Share2,
} from 'lucide-react'
import { api } from '../../api'
import { useAppsStore, useMcpDependents } from '../../stores/apps.store'
import { useAppsPageStore } from '../../stores/apps-page.store'
import { useAppStore } from '../../stores/app.store'
import { useSpaceStore } from '../../stores/space.store'
import { AppStatusDot } from './AppStatusDot'
import { AppSpaceCell } from './AppSpaceCell'
import { AppTypeIcon } from '../store/AppTypeIcon'
import { AutomationAvatar } from './AutomationAvatar'
import { AppUninstallMenu } from './AppUninstallMenu'
import { useTranslation, getCurrentLanguage } from '../../i18n'
import { resolveSpecI18n } from '../../utils/spec-i18n'
import { deriveMcpHealth, type McpHealth } from '../../utils/mcpStatus'
import { formatTimeAgo } from '../../utils/format-time'
import { ShareCurrentAppDialog } from '../store/ShareCurrentAppDialog'
import {
  internalMcpServerToJsonConfig,
  keyValueLinesToRecord,
  mcpJsonConfigToInternal,
  recordToKeyValueLines,
} from '../../utils/mcpConfigCompat'
import type { AppStatus } from '../../../shared/apps/app-types'
import type { McpSpec, McpServerConfig } from '../../../shared/apps/spec-types'

interface McpStatusCardProps {
  appId: string
  /** Display name for the scope badge when space-scoped */
  spaceName?: string
}

// ── Types ──────────────────────────────────────────────────────────────────

type Transport = 'stdio' | 'sse' | 'streamable-http'

interface EditableConfig {
  transport: Transport
  command: string   // command (stdio) or URL (sse / streamable-http)
  args: string[]    // only used for stdio
  envText: string   // KEY=VALUE lines
  headersText: string // KEY=VALUE lines for http/sse headers
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statusLabel(health: McpHealth, t: (s: string) => string): string {
  switch (health) {
    case 'connected':     return t('Connected')
    case 'unprobed':      return t('Installed')
    case 'disabled':      return t('Disabled')
    case 'failed':        return t('Connection error')
    case 'session-stale': return t('Connection error')
    case 'needs-login':   return t('Needs login')
    case 'not-installed': return t('Not installed')
    default:              return health
  }
}

/** Health → the AppStatusDot color bucket that reproduces this card's prior visuals exactly. */
function healthToDotStatus(health: McpHealth): AppStatus {
  switch (health) {
    case 'failed':
    case 'session-stale': return 'error'
    case 'needs-login':   return 'needs_login'
    case 'disabled':      return 'paused'
    default:              return 'active'
  }
}

function mcpServerToEditable(mcpServer: McpServerConfig): EditableConfig {
  const transport: Transport = mcpServer.transport ?? 'stdio'
  const command = mcpServer.command ?? ''
  const args: string[] = mcpServer.args ?? []
  const envText = recordToKeyValueLines(mcpServer.env)
  const headersText = recordToKeyValueLines(mcpServer.headers)
  return { transport, command, args, envText, headersText }
}

function editableToMcpServer(edit: EditableConfig): McpServerConfig {
  return {
    transport: edit.transport,
    command: edit.command.trim(),
    ...(edit.transport === 'stdio' && edit.args.length > 0 ? { args: edit.args.filter(a => a.trim()) } : {}),
    ...(keyValueLinesToRecord(edit.envText) ? { env: keyValueLinesToRecord(edit.envText)! } : {}),
    ...(edit.transport !== 'stdio' && keyValueLinesToRecord(edit.headersText) ? { headers: keyValueLinesToRecord(edit.headersText)! } : {}),
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ArgList({
  args,
  onChange,
  t,
}: {
  args: string[]
  onChange: (args: string[]) => void
  t: (s: string) => string
}) {
  const update = (i: number, v: string) => {
    const next = [...args]; next[i] = v; onChange(next)
  }
  const remove = (i: number) => onChange(args.filter((_, idx) => idx !== i))
  const add = () => onChange([...args, ''])

  return (
    <div className="space-y-2">
      {args.map((arg, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={arg}
            onChange={e => update(i, e.target.value)}
            className="flex-1 px-3 py-1.5 border border-border rounded-lg bg-input text-foreground text-sm font-mono focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
            placeholder={t('Argument value')}
          />
          <button
            onClick={() => remove(i)}
            className="p-1.5 text-muted-foreground hover:text-halo-error hover:bg-halo-error/10 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        {t('Add argument')}
      </button>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function McpStatusCard({ appId, spaceName }: McpStatusCardProps) {
  const { t } = useTranslation()
  const { apps, pauseApp, resumeApp, updateAppSpec, moveAppToSpace } = useAppsStore()
  const { mcpStatus } = useAppStore()
  const dependents = useMcpDependents()
  const selectApp = useAppsPageStore(s => s.selectApp)
  const clearSelection = useAppsPageStore(s => s.clearSelection)
  const spaces = useSpaceStore(s => s.spaces)
  const haloSpace = useSpaceStore(s => s.haloSpace)
  const app = apps.find(a => a.id === appId)

  // Toggle state
  const [toggling, setToggling]       = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  // Space move state
  const [spaceMoving, setSpaceMoving] = useState(false)
  const [moveError, setMoveError]     = useState<string | null>(null)

  const [showShareDialog, setShowShareDialog] = useState(false)

  // Connection test state (result arrives via the agent:mcp-status broadcast)
  const [testing, setTesting]     = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  // Edit state
  const [isEditing, setIsEditing] = useState(false)
  const [editMode, setEditMode] = useState<'visual' | 'json'>('visual')
  const [editConfig, setEditConfig] = useState<EditableConfig>({ transport: 'stdio', command: '', args: [], envText: '', headersText: '' })
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Tools section collapse
  const [toolsExpanded, setToolsExpanded] = useState(false)

  if (!app) return null

  const { name, description } = resolveSpecI18n(app.spec, getCurrentLanguage())
  const spec = app.spec as McpSpec
  const mcpServer: McpServerConfig | undefined = app.spec.type === 'mcp' ? spec.mcp_server : undefined

  const allSpaces = [
    ...(haloSpace ? [haloSpace] : []),
    ...spaces.filter(s => !haloSpace || s.id !== haloSpace.id),
  ]
  const space = app.spaceId ? allSpaces.find(s => s.id === app.spaceId) : undefined

  // Connection status
  const status = app.status
  const isPaused  = status === 'paused'
  const isEnabled = status === 'active'
  const canToggle = status === 'active' || status === 'paused' || status === 'error'

  const sdkEntry = mcpStatus.find(s => s.name === app.specId)
  const health = deriveMcpHealth(app, sdkEntry)
  const displayStatus = healthToDotStatus(health)
  const isError = health === 'failed' || health === 'session-stale'
  // Editing the token would not help here — Halo clears the leftover state and
  // the next session picks the server up again.
  const sessionOnlyFailure = health === 'session-stale'
  const usedBy = dependents[app.specId] ?? []

  // Init edit state when entering edit mode
  const startEditing = useCallback(() => {
    if (!mcpServer) return
    const cfg = mcpServerToEditable(mcpServer)
    setEditConfig(cfg)
    setJsonText(JSON.stringify(internalMcpServerToJsonConfig(mcpServer), null, 2))
    setJsonError(null)
    setHasChanges(false)
    setSaveError(null)
    setEditMode('visual')
    setIsEditing(true)
  }, [mcpServer])

  const cancelEditing = () => {
    setIsEditing(false)
    setJsonError(null)
    setSaveError(null)
  }

  // Visual field updaters
  const updateField = useCallback((field: keyof EditableConfig, value: any) => {
    setEditConfig(prev => {
      const next = { ...prev, [field]: value }
      setJsonText(JSON.stringify(internalMcpServerToJsonConfig(editableToMcpServer(next)), null, 2))
      setHasChanges(true)
      return next
    })
  }, [])

  // When transport changes, reset args (only for stdio)
  const handleTransportChange = useCallback((transport: Transport) => {
    setEditConfig(prev => {
      const next = { ...prev, transport, args: transport === 'stdio' ? prev.args : [] }
      setJsonText(JSON.stringify(internalMcpServerToJsonConfig(editableToMcpServer(next)), null, 2))
      setHasChanges(true)
      return next
    })
  }, [])

  // JSON mode handler — syncs back to visual
  const handleJsonChange = useCallback((text: string) => {
    setJsonText(text)
    setHasChanges(true)
    try {
      const parsed = JSON.parse(text)
      const result = mcpJsonConfigToInternal(parsed)
      if (result.error) {
        setJsonError(t(result.error))
        return
      }
      setJsonError(null)
      setEditConfig(mcpServerToEditable(result.data!))
    } catch (e) {
      setJsonError(t('Invalid JSON: {{message}}', { message: (e as Error).message }))
    }
  }, [t])

  // Switch modes — sync JSON → visual and visual → JSON
  const switchMode = (mode: 'visual' | 'json') => {
    if (mode === 'json' && !jsonError) {
      setJsonText(JSON.stringify(internalMcpServerToJsonConfig(editableToMcpServer(editConfig)), null, 2))
    }
    setEditMode(mode)
  }

  const handleSave = async () => {
    let serverConfig: McpServerConfig
    if (editMode === 'json') {
      try {
        const result = mcpJsonConfigToInternal(JSON.parse(jsonText))
        if (result.error || !result.data) {
          setJsonError(t(result.error ?? 'Invalid MCP configuration'))
          return
        }
        serverConfig = result.data
      } catch (e) {
        setJsonError(t('Invalid JSON: {{message}}', { message: (e as Error).message }))
        return
      }
    } else {
      serverConfig = editableToMcpServer(editConfig)
    }

    setIsSaving(true)
    setSaveError(null)
    try {
      const ok = await updateAppSpec(appId, { mcp_server: serverConfig })
      if (ok) {
        setIsEditing(false)
        setHasChanges(false)
      } else {
        setSaveError(t('Save failed. Please try again.'))
      }
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggle = async () => {
    if (!canToggle || toggling) return
    setToggling(true)
    setToggleError(null)
    try {
      await (isEnabled ? pauseApp(appId) : resumeApp(appId))
    } catch (e) {
      setToggleError((e as Error).message)
    } finally {
      setToggling(false)
    }
  }

  // Run a native connection probe. The main process updates the shared
  // status cache and broadcasts agent:mcp-status, which refreshes this card.
  const handleTestConnection = async () => {
    if (testing) return
    setTesting(true)
    setTestError(null)
    try {
      const res = await api.probeMcpApp(appId)
      if (!res.success) setTestError(res.error ?? t('Connection test failed'))
    } catch (e) {
      setTestError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  const handleMoveToSpace = async (newSpaceId: string | null) => {
    setMoveError(null)
    setSpaceMoving(true)
    try {
      const ok = await moveAppToSpace(appId, newSpaceId)
      if (!ok) setMoveError(t('Failed to move MCP server. Please try again.'))
    } finally {
      setSpaceMoving(false)
    }
  }

  const uninstallMessage = usedBy.length > 0
    ? t('{{count}} digital humans depend on it — they will lose access to its tools. You can reinstall it later from the Uninstalled group.', { count: usedBy.length })
    : t('You can reinstall it later from the Uninstalled group.')

  // Env display (masked values for security)
  const envEntries = mcpServer?.env ? Object.entries(mcpServer.env) : []
  const headerEntries = mcpServer?.headers ? Object.entries(mcpServer.headers) : []

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Back link + hero stay pinned while the body below scrolls — this is
          the identity of the server being viewed, not part of its content. */}
      <div className="flex-shrink-0 border-b border-border/60">
        {/* ── Back to list ── */}
        <div className="px-4 sm:px-10 pt-6">
          <button
            onClick={clearSelection}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('My MCP')}
          </button>
        </div>

        {/* ── Hero ── */}
        <div className="flex items-start gap-3.5 px-4 sm:px-10 pt-6 pb-6">
          <AppTypeIcon type="mcp" icon={spec.icon} name={name} size="lg" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-xl font-semibold text-foreground truncate">{name}</h2>
              {spec.author && (
                <span className="text-xs text-muted-foreground truncate flex-shrink-0">{t('by')} {spec.author}</span>
              )}
            </div>
            {description && (
              <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>

          {/* Same three tiers as the digital human / skill headers: the one
              action you came for, then state control, then icon-only utilities. */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleTestConnection}
              disabled={isPaused || testing}
              title={isPaused ? t('Enable this server to test it') : undefined}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[9px] bg-primary border border-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <PlugZap className="w-3.5 h-3.5" />}
              {t('Test connection')}
            </button>

            <button
              onClick={handleToggle}
              disabled={!canToggle || toggling}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[9px] border border-border bg-secondary text-[13px] font-medium text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {toggling
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : isEnabled
                  ? <PowerOff className="w-3.5 h-3.5" />
                  : <Power className="w-3.5 h-3.5" />}
              {isEnabled ? t('Disable') : t('Enable')}
            </button>

            <button
              type="button"
              onClick={() => setShowShareDialog(true)}
              title={t('Share')}
              aria-label={t('Share')}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <AppUninstallMenu
              appId={appId}
              appType="mcp"
              spaceId={app.spaceId}
              message={uninstallMessage}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-10 pt-5 pb-8 space-y-5">

        {toggleError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-halo-error/10 border border-halo-error/20 text-xs text-halo-error">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {toggleError}
          </div>
        )}
        {moveError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-halo-error/10 border border-halo-error/20 text-xs text-halo-error">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {moveError}
          </div>
        )}

        {/* ── Status grid ── */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          <div className="flex flex-col items-stretch justify-start bg-card border border-border/60 rounded-lg px-3.5 py-3">
            <div className="text-[11px] text-subtle-foreground mb-[5px]">{t('Status')}</div>
            <div className="text-[13px] font-medium flex items-center gap-1.5">
              <AppStatusDot status={displayStatus} size="sm" />
              <span className="truncate">{statusLabel(health, t)}</span>
            </div>
          </div>

          <div className="flex flex-col items-stretch justify-start bg-card border border-border/60 rounded-lg px-3.5 py-3">
            <div className="text-[11px] text-subtle-foreground mb-[5px]">{t('Transport')}</div>
            <div className="text-[13px] font-medium font-mono truncate">{mcpServer?.transport ?? 'stdio'}</div>
          </div>

          <AppSpaceCell
            spaceId={app.spaceId}
            spaceLabel={app.spaceId === null ? t('Global') : (spaceName ?? app.spaceId)}
            space={space}
            caption={app.spaceId === null
              ? t('Available to every digital human')
              : t('Available only within this workspace')}
            menuTitle={t('Move this MCP server to…')}
            moving={spaceMoving}
            onMove={handleMoveToSpace}
          />

          <div className="flex flex-col items-stretch justify-start bg-card border border-border/60 rounded-lg px-3.5 py-3">
            <div className="text-[11px] text-subtle-foreground mb-[5px]">{t('Tools')}</div>
            <div className="text-[13px] font-medium tabular-nums truncate">
              {sdkEntry?.tools ? sdkEntry.tools.length : '—'}
            </div>
          </div>
        </div>

        {/* ── Connection failure details + retry ── */}
        {(isError || displayStatus === 'needs_login') && (
          <div className={`px-3 py-2.5 rounded-lg space-y-2 ${
            sessionOnlyFailure
              ? 'bg-halo-warning/10 border border-halo-warning/20'
              : 'bg-halo-error/10 border border-halo-error/20'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-2.5">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${
                  sessionOnlyFailure ? 'text-halo-warning' : 'text-halo-error'
                }`} />
                <div className="min-w-0 space-y-1">
                  <p className={`text-xs ${sessionOnlyFailure ? 'text-halo-warning' : 'text-halo-error'}`}>
                    {sessionOnlyFailure
                      ? t('This server connects fine, but the last agent session could not use it. Halo has cleared the leftover state — it will be picked up again on the next message.')
                      : displayStatus === 'needs_login'
                        ? t('Authentication was rejected by the MCP server. Update the token in the configuration below, then test again.')
                        : t('The MCP server failed to connect.')}
                  </p>
                  {!sessionOnlyFailure && sdkEntry?.errorDetail && (
                    <p className="text-[11px] font-mono text-halo-error/80 break-all">
                      {sdkEntry.errorDetail}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-colors
                  disabled:opacity-50 flex-shrink-0 self-start border ${
                    sessionOnlyFailure
                      ? 'text-halo-warning hover:border-halo-warning/60 border-halo-warning/30'
                      : 'text-halo-error hover:border-halo-error/60 border-halo-error/30'
                  }`}
              >
                {testing
                  ? <><Loader2 className="w-3 h-3 animate-spin" />{t('Testing...')}</>
                  : <><PlugZap className="w-3 h-3" />{t('Test connection')}</>}
              </button>
            </div>
            {testError && (
              <p className="text-[11px] text-halo-error/80 pl-6">{testError}</p>
            )}
          </div>
        )}

        {/* ── Configuration (view / edit) ── */}
        {mcpServer && (
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[13px] font-semibold text-foreground">{t('Configuration')}</h3>
              {!isEditing && (
                <button
                  onClick={startEditing}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  {t('Edit')}
                </button>
              )}
            </div>

          {!isEditing ? (
            /* ── Read-only view ── */
            <div className="bg-card border border-border/60 rounded-lg p-3.5 text-xs font-mono space-y-1.5">
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 flex-shrink-0">{t('Transport')}</span>
                <span className="text-foreground">{mcpServer.transport ?? 'stdio'}</span>
              </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">
                    {(mcpServer.transport === 'sse' || mcpServer.transport === 'streamable-http') ? t('URL') : t('Command')}
                  </span>
                  <span className="text-foreground break-all">{mcpServer.command}</span>
                </div>
              {mcpServer.args && (mcpServer.args as string[]).length > 0 && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">{t('Args')}</span>
                  <span className="text-foreground break-all">{(mcpServer.args as string[]).join(' ')}</span>
                </div>
              )}
              {envEntries.length > 0 && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">ENV</span>
                  <div className="space-y-0.5">
                    {envEntries.map(([k]) => (
                      <div key={k} className="text-foreground">
                        {k}=<span className="text-muted-foreground">{'•'.repeat(8)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {headerEntries.length > 0 && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">{t('Headers')}</span>
                  <div className="space-y-0.5">
                    {headerEntries.map(([k]) => (
                      <div key={k} className="text-foreground">
                        {k}=<span className="text-muted-foreground">{'•'.repeat(8)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Edit form ── */
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Mode toggle */}
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border">
                <div className="flex items-center gap-1 p-0.5 bg-secondary rounded-lg">
                  <button
                    onClick={() => switchMode('visual')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                      editMode === 'visual'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    {t('Visual')}
                  </button>
                  <button
                    onClick={() => switchMode('json')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                      editMode === 'json'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Code className="w-3.5 h-3.5" />
                    JSON
                  </button>
                </div>
                {hasChanges && (
                  <span className="text-xs text-halo-warning">{t('Unsaved changes')}</span>
                )}
              </div>

              <div className="p-4">
                {editMode === 'visual' ? (
                  <div className="space-y-4">
                    {/* Transport */}
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-1">
                        {t('Transport')}
                      </label>
                      <select
                        value={editConfig.transport}
                        onChange={e => handleTransportChange(e.target.value as Transport)}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground text-sm focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
                      >
                        <option value="stdio">{t('Command line (stdio)')}</option>
                        <option value="sse">SSE (Server-Sent Events)</option>
                        <option value="streamable-http">HTTP (Streamable)</option>
                      </select>
                    </div>

                    {/* Command / URL */}
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">
                          {editConfig.transport === 'stdio' ? t('Command') : t('URL')}
                        </label>
                      <input
                        type="text"
                        value={editConfig.command}
                        onChange={e => updateField('command', e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground text-sm font-mono focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
                        placeholder={editConfig.transport === 'stdio' ? 'npx' : 'https://...'}
                      />
                    </div>

                    {/* Args (stdio only) */}
                    {editConfig.transport === 'stdio' && (
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">
                          {t('Arguments')}
                        </label>
                        <ArgList
                          args={editConfig.args}
                          onChange={args => updateField('args', args)}
                          t={t}
                        />
                      </div>
                    )}

                    {/* Env vars */}
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-1">
                        {t('Environment Variables')}{' '}
                        <span className="font-normal text-muted-foreground/70">(KEY=VALUE, {t('one per line')})</span>
                      </label>
                      <textarea
                        value={editConfig.envText}
                        onChange={e => updateField('envText', e.target.value)}
                        rows={3}
                        spellCheck={false}
                        placeholder="API_KEY=your-key-here"
                        className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground text-sm font-mono focus:ring-2 focus:ring-primary focus:border-transparent resize-none transition-colors"
                      />
                    </div>

                    {editConfig.transport !== 'stdio' && (
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">
                          {t('Headers')}{' '}
                          <span className="font-normal text-muted-foreground/70">(KEY=VALUE, {t('one per line')})</span>
                        </label>
                        <textarea
                          value={editConfig.headersText}
                          onChange={e => updateField('headersText', e.target.value)}
                          rows={3}
                          spellCheck={false}
                          placeholder={t('Authorization=Bearer <token>')}
                          className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground text-sm font-mono focus:ring-2 focus:ring-primary focus:border-transparent resize-none transition-colors"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  /* JSON mode */
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      {t('Paste config from Cursor or Claude Desktop directly.')}
                    </p>
                    <textarea
                      value={jsonText}
                      onChange={e => handleJsonChange(e.target.value)}
                      rows={10}
                      spellCheck={false}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-input text-foreground text-sm font-mono focus:ring-2 focus:ring-primary focus:border-transparent resize-none transition-colors"
                      placeholder={'{\n  "command": "npx",\n  "args": ["-y", "@example/mcp"],\n  "env": { "API_KEY": "xxx" }\n}'}
                    />
                    {jsonError && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-halo-error">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        {jsonError}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Save / Cancel */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
                <div>
                  {saveError && (
                    <p className="text-xs text-halo-error">{saveError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={cancelEditing}
                    disabled={isSaving}
                    className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
                  >
                    {t('Cancel')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!!jsonError || isSaving || !hasChanges}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-lg transition-colors"
                  >
                    {isSaving ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('Saving...')}</>
                    ) : (
                      <><Check className="w-3.5 h-3.5" />{t('Save')}</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

        {/* ── Tools ── */}
        <div>
          <button
            onClick={() => setToolsExpanded(v => !v)}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground hover:text-foreground/80 transition-colors w-full text-left mb-2.5"
          >
            {toolsExpanded
              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            }
            <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
            {t('Tools provided by this server')}
            {sdkEntry?.tools && sdkEntry.tools.length > 0 && (
              <span className="text-muted-foreground font-normal">({sdkEntry.tools.length})</span>
            )}
          </button>
          {toolsExpanded && (
            <div className="bg-card border border-border/60 rounded-lg p-3.5">
              {sdkEntry?.tools && sdkEntry.tools.length > 0 ? (
                <ul className="space-y-1">
                  {sdkEntry.tools.map(tool => (
                    <li key={tool} className="text-xs text-muted-foreground font-mono truncate" title={tool}>
                      {tool}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  {isPaused
                    ? t('Enable this server to load its tools.')
                    : t('No tools loaded yet — use "Test connection" to fetch the tool list.')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Server info ── */}
        {sdkEntry && (sdkEntry.serverInfo || sdkEntry.lastCheckedAt != null || sdkEntry.latencyMs != null) && (
          <div>
            <h3 className="text-[13px] font-semibold text-foreground mb-2.5 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              {t('Server info')}
            </h3>
            <div className="bg-card border border-border/60 rounded-lg p-3.5 text-xs space-y-1.5">
              {sdkEntry.serverInfo && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 flex-shrink-0">{t('Reported as')}</span>
                  <span className="text-foreground font-mono">{sdkEntry.serverInfo.name} v{sdkEntry.serverInfo.version}</span>
                </div>
              )}
              {sdkEntry.lastCheckedAt != null && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 flex-shrink-0">{t('Last checked')}</span>
                  <span className="text-foreground">{formatTimeAgo(sdkEntry.lastCheckedAt, t)}</span>
                </div>
              )}
              {sdkEntry.latencyMs != null && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 flex-shrink-0">{t('Latency')}</span>
                  <span className="text-foreground tabular-nums">{sdkEntry.latencyMs}ms</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Used by ── */}
        {usedBy.length > 0 && (
          <div>
            <h3 className="text-[13px] font-semibold text-foreground mb-2.5">{t('Used by')}</h3>
            <div className="space-y-1.5">
              {usedBy.map(dep => (
                <button
                  key={dep.appId}
                  onClick={() => selectApp(dep.appId, 'automation')}
                  className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-lg border border-border/60 bg-card text-left transition-all hover:border-border hover:shadow-sm"
                >
                  <AutomationAvatar name={dep.name} size={20} />
                  <span className="text-[13px] text-foreground truncate flex-1 min-w-0">{dep.name}</span>
                  {!dep.enabled && (
                    <span className="text-[10px] px-1.5 py-px rounded-full bg-muted text-muted-foreground flex-shrink-0">
                      {t('disabled for this app')}
                    </span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

      </div>

      {showShareDialog && (
        <ShareCurrentAppDialog
          appId={appId}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </div>
  )
}
