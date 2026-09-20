/**
 * SkillInfoCard
 *
 * Right-panel detail view for a Skill-type app. Provides:
 *  - Scope badge (Global / space-scoped) with interactive space selector
 *  - Enable/disable toggle
 *  - Trigger command reference
 *  - Description (plain text)
 *  - SKILL.md viewer (MarkdownRenderer) + inline editor (CodeMirror markdown)
 *  - Open skill folder in OS file manager
 *  - Uninstall action
 *
 * Enable/Disable maps to app:pause / app:resume — disabled skills are excluded
 * from conversation context injection.
 *
 * Space selector: clicking the scope badge opens a dropdown to move the skill
 * to a different space (or to global scope) without uninstalling and reinstalling.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  ArrowLeft,
  Terminal,
  Loader2,
  FolderOpen,
  FileText,
  MessageSquare,
  Pencil,
  Power,
  PowerOff,
  X,
  Check,
  ChevronRight,
  AlertCircle,
  Share2,
  User,
} from 'lucide-react'
import { useAppsStore } from '../../stores/apps.store'
import { useAppsPageStore } from '../../stores/apps-page.store'
import { useAppStore } from '../../stores/app.store'
import { useSpaceStore } from '../../stores/space.store'
import { useChatStore } from '../../stores/chat.store'
import { AppStatusDot } from './AppStatusDot'
import { AppSpaceCell } from './AppSpaceCell'
import { AppTypeIcon } from '../store/AppTypeIcon'
import { AutomationAvatar } from './AutomationAvatar'
import { AppUninstallMenu } from './AppUninstallMenu'
import { useTranslation, getCurrentLanguage } from '../../i18n'
import { resolveSpecI18n } from '../../utils/spec-i18n'
import { getSkillMdContent } from '../../../shared/skill-frontmatter'
import { buildSkillContentPatch } from '../../utils/skill-content'
import { deriveSkillCommand } from '../../utils/skill-command'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'
import { CodeMirrorEditor } from '../canvas/viewers/CodeMirrorEditor'
import { api } from '../../api'
import { ShareCurrentAppDialog } from '../store/ShareCurrentAppDialog'
import type { AppStatus } from '../../../shared/apps/app-types'
import type { SkillSpec } from '../../../shared/apps/spec-types'

// ============================================
// Props
// ============================================

interface SkillInfoCardProps {
  appId: string
  /** Display name for the scope: resolved space name, or the translated "Global" string */
  spaceName?: string
}

// ============================================
// Helpers
// ============================================

function statusLabel(status: AppStatus, t: (s: string) => string): string {
  switch (status) {
    case 'active':      return t('Enabled')
    case 'paused':      return t('Disabled')
    case 'error':       return t('Error')
    case 'uninstalled': return t('Uninstalled')
    default:            return t('Unknown')
  }
}

/**
 * Records from before `install_source` existed carry no value at all — the
 * field's own doc comment (spec-types.ts) says to treat that as 'store', not
 * as 'manual'. Only an explicit 'manual' means someone actually placed the
 * files there by hand.
 */
function sourceLabel(source: string | undefined, t: (s: string) => string): string {
  switch (source) {
    case 'manual':  return t('Manual')
    case 'builtin': return t('Built-in')
    case 'bundled': return t('Bundled')
    default:        return t('Store')
  }
}

// ============================================
// Component
// ============================================

export function SkillInfoCard({ appId, spaceName }: SkillInfoCardProps) {
  const { t } = useTranslation()
  const { apps, pauseApp, resumeApp, updateAppSpec, moveAppToSpace } = useAppsStore()
  const selectApp = useAppsPageStore(s => s.selectApp)
  const clearSelection = useAppsPageStore(s => s.clearSelection)
  const navigate = useAppStore(s => s.navigate)
  const spaces = useSpaceStore(s => s.spaces)
  const haloSpace = useSpaceStore(s => s.haloSpace)
  const currentSpace = useSpaceStore(s => s.currentSpace)
  const setCurrentSpace = useSpaceStore(s => s.setCurrentSpace)
  const refreshCurrentSpace = useSpaceStore(s => s.refreshCurrentSpace)
  const app = apps.find(a => a.id === appId)

  const [toggling, setToggling]         = useState(false)
  const [toggleError, setToggleError]   = useState<string | null>(null)
  const [isEditing, setIsEditing]       = useState(false)
  const [draftContent, setDraft]        = useState('')
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState<string | null>(null)
  const [moveError, setMoveError]       = useState<string | null>(null)
  const [spaceMoving, setSpaceMoving]   = useState(false)
  const [using, setUsing]               = useState(false)
  const [previewFile, setPreviewFile]   = useState<string | null>(null)
  const [showShareDialog, setShowShareDialog] = useState(false)

  // When the selected skill changes, discard any in-progress edit.
  // Using useEffect (not an inline setState in render) to avoid extra render cycles.
  useEffect(() => {
    setIsEditing(false)
    setDraft('')
    setToggleError(null)
    setSaveError(null)
    setMoveError(null)
    setPreviewFile(null)
  }, [appId])

  // Digital humans declaring this skill in requires.skills. Skills are
  // ambient (not per-app bound at runtime — see AppSkillsSection), so this
  // is usually empty; it only reflects an explicit dependency declaration.
  const usedBy = useMemo(() => {
    if (!app) return []
    return apps.filter(a => {
      if (a.spec.type !== 'automation' || a.status === 'uninstalled') return false
      const skills = a.spec.requires?.skills ?? []
      return skills.some(s => (typeof s === 'string' ? s : s.id) === app.specId)
    })
  }, [apps, app])

  if (!app) return null

  const { name, description } = resolveSpecI18n(app.spec, getCurrentLanguage())
  const spec       = app.spec as SkillSpec
  const status     = app.status
  const isEnabled  = status === 'active'
  const canToggle  = status === 'active' || status === 'paused' || status === 'error'

  const allSpaces = [
    ...(haloSpace ? [haloSpace] : []),
    ...spaces.filter(s => !haloSpace || s.id !== haloSpace.id),
  ]
  const space = app.spaceId ? allSpaces.find(s => s.id === app.spaceId) : undefined

  const triggerCommand  = deriveSkillCommand(spec.name)
  const skillContent    = getSkillMdContent(spec)
  const hasSkillContent = skillContent.length > 0
  const skillFiles      = spec.skill_files ?? {}
  const otherFiles      = Object.keys(skillFiles).filter(path => path !== 'SKILL.md')

  // ── Handlers ──────────────────────────────

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

  const handleStartEdit = () => {
    setDraft(skillContent)
    setSaveError(null)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setDraft('')
    setSaveError(null)
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const ok = await updateAppSpec(appId, buildSkillContentPatch(spec, draftContent))
      if (ok) {
        setIsEditing(false)
        setDraft('')
      } else {
        setSaveError(t('Save failed. Please try again.'))
      }
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleOpenFolder = useCallback(async () => {
    const res = await api.appOpenSkillFolder(appId)
    if (!res.success) {
      console.error('[SkillInfoCard] appOpenSkillFolder failed:', res.error)
    }
  }, [appId])

  const handleMoveToSpace = async (newSpaceId: string | null) => {
    setMoveError(null)
    setSpaceMoving(true)
    try {
      const ok = await moveAppToSpace(appId, newSpaceId)
      if (!ok) setMoveError(t('Failed to move skill. Please try again.'))
    } finally {
      setSpaceMoving(false)
    }
  }

  // Skills run inside a conversation, so "use" means: open the space this skill
  // lives in, start a fresh conversation there, and seed its composer with the
  // slash command. Global skills fall back to the current space.
  const handleUse = async () => {
    if (using) return
    setUsing(true)
    try {
      const target =
        (app.spaceId ? allSpaces.find(s => s.id === app.spaceId) : null) ??
        currentSpace ??
        allSpaces[0] ??
        null
      if (target) {
        setCurrentSpace(target)
        await refreshCurrentSpace()
        // A new conversation rather than whatever was last open: the command
        // is the start of a task, not a continuation of an unrelated thread.
        // SpacePage's space-init keeps this selection (it only auto-selects
        // when no conversation is current).
        await useChatStore.getState().createConversation(target.id)
        const slug = triggerCommand.slice(1)
        useChatStore.setState({
          pendingComposerInput: {
            spaceId: target.id,
            text: `/${slug} `,
            slashPreview: { command: triggerCommand, label: slug, description },
          },
        })
      }
      navigate('space')
    } finally {
      setUsing(false)
    }
  }

  // ── Render ────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Back link + hero stay pinned while the body below scrolls — this is
          the identity of the skill being viewed, not part of its content. */}
      <div className="flex-shrink-0 border-b border-border/60">
        {/* ── Back to list ── */}
        <div className="px-4 sm:px-10 pt-6">
          <button
            onClick={clearSelection}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('My Skills')}
          </button>
        </div>

        {/* ── Hero ── */}
        <div className="flex items-start gap-3.5 px-4 sm:px-10 pt-6 pb-6">
          <AppTypeIcon type="skill" icon={spec.icon} name={name} size="lg" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-xl font-semibold text-foreground truncate">{name}</h2>
            </div>
            {description && (
              <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>

          {/* Same three tiers as the digital human header: the one action you
              came for, then state control, then icon-only utilities. */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleUse}
              disabled={!isEnabled || using}
              title={isEnabled ? undefined : t('Enable this skill to use it')}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[9px] bg-primary border border-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {using
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <MessageSquare className="w-3.5 h-3.5" />}
              {t('Use')}
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
              onClick={handleOpenFolder}
              title={t('Open skill folder')}
              aria-label={t('Open skill folder')}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
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
              appType="skill"
              spaceId={app.spaceId}
              message={t('You can reinstall it later from the Uninstalled group.')}
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
              <AppStatusDot status={status} size="sm" />
              <span className="truncate">{statusLabel(status, t)}</span>
            </div>
          </div>

          <div className="flex flex-col items-stretch justify-start bg-card border border-border/60 rounded-lg px-3.5 py-3">
            <div className="text-[11px] text-subtle-foreground mb-[5px]">{t('Command')}</div>
            <div className="text-[13px] font-medium font-mono truncate">{triggerCommand}</div>
          </div>

          <AppSpaceCell
            spaceId={app.spaceId}
            spaceLabel={app.spaceId === null ? t('Global') : (spaceName ?? app.spaceId)}
            space={space}
            caption={app.spaceId === null
              ? t('Available in every workspace')
              : t('Available in this workspace only')}
            menuTitle={t('Move this skill to…')}
            moving={spaceMoving}
            onMove={handleMoveToSpace}
          />

          <div className="flex flex-col items-stretch justify-start bg-card border border-border/60 rounded-lg px-3.5 py-3">
            <div className="text-[11px] text-subtle-foreground mb-[5px]">{t('Source')}</div>
            <div className="text-[13px] font-medium truncate">
              {sourceLabel(spec.store?.install_source, t)}
            </div>
            {(spec.author || spec.version) && (
              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                {spec.author && (
                  <>
                    <User className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{spec.author}</span>
                  </>
                )}
                {spec.version && <span className="flex-shrink-0">{spec.author ? ` · v${spec.version}` : `v${spec.version}`}</span>}
              </div>
            )}
          </div>
        </div>

        {/* ── How to use ── */}
        <div>
          <h3 className="text-[13px] font-semibold text-foreground mb-2.5 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" />
            {t('How to use')}
          </h3>
          <div className="bg-card border border-border/60 rounded-lg p-3.5">
            <div className="text-xs font-mono text-foreground">{triggerCommand} [arguments]</div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('Invoke this skill by typing the command above in any conversation.')}
            </p>
          </div>
        </div>

        {/* ── Skill Instructions (SKILL.md) ── */}
        {(hasSkillContent || isEditing) && (
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[13px] font-semibold text-foreground">{t('Skill Instructions')}</h3>

              <div className="flex items-center gap-2">
                {!isEditing ? (
                  <button
                    onClick={handleStartEdit}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    {t('Edit')}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleCancelEdit}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-3 h-3" />
                      {t('Cancel')}
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                    >
                      {saving
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Check className="w-3 h-3" />}
                      {t('Save')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {saveError && (
              <div className="flex items-center gap-1.5 mb-2 text-xs text-halo-error">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            {isEditing ? (
              <div className="rounded-lg overflow-hidden border border-border h-[36rem]">
                {/*
                  key={appId} ensures the editor remounts if the user switches skills
                  while edit mode is open. content prop is the initial value only —
                  ongoing changes are tracked via onChange → draftContent state.
                */}
                <CodeMirrorEditor
                  key={appId}
                  content={draftContent}
                  language="markdown"
                  readOnly={false}
                  onChange={setDraft}
                  className="h-full"
                />
              </div>
            ) : (
              <div className="rounded-lg bg-card border border-border/60 p-3.5 text-sm overflow-x-auto">
                <MarkdownRenderer content={skillContent} mode="static" />
              </div>
            )}
          </div>
        )}

        {/* ── Skill Files (multi-file skills only) ── */}
        {otherFiles.length > 0 && (
          <div>
            <h3 className="text-[13px] font-semibold text-foreground mb-2.5">{t('Skill Files')}</h3>
            <div className="space-y-1.5">
              {otherFiles.map(path => (
                <div key={path} className="rounded-lg border border-border/60 bg-card overflow-hidden">
                  <button
                    onClick={() => setPreviewFile(prev => prev === path ? null : path)}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-mono text-foreground hover:bg-secondary/60 transition-colors text-left"
                  >
                    <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{path}</span>
                    <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground flex-shrink-0 ml-auto transition-transform ${previewFile === path ? 'rotate-90' : ''}`} />
                  </button>
                  {previewFile === path && (
                    <div className="border-t border-border/60 h-80">
                      <CodeMirrorEditor
                        content={skillFiles[path] ?? ''}
                        language={path.endsWith('.md') ? 'markdown' : undefined}
                        readOnly
                        className="h-full"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Used by ── */}
        {usedBy.length > 0 && (
          <div>
            <h3 className="text-[13px] font-semibold text-foreground mb-2.5">{t('Used by')}</h3>
            <div className="space-y-1.5">
              {usedBy.map(a => {
                const { name: depName } = resolveSpecI18n(a.spec, getCurrentLanguage())
                return (
                  <button
                    key={a.id}
                    onClick={() => selectApp(a.id, a.spec.type, a.spaceId ?? undefined)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-lg border border-border/60 bg-card text-left transition-all hover:border-border hover:shadow-sm"
                  >
                    <AutomationAvatar name={depName} size={20} />
                    <span className="text-[13px] text-foreground truncate flex-1 min-w-0">{depName}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  </button>
                )
              })}
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
