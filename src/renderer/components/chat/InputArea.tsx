/**
 * Input Area - Enhanced message input with bottom toolbar
 *
 * Layout (following industry standard):
 * ┌──────────────────────────────────────────────────────┐
 * │ [Image previews]                                     │
 * │ ┌──────────────────────────────────────────────────┐ │
 * │ │ Textarea                                         │ │
 * │ └──────────────────────────────────────────────────┘ │
 * │ [+] [Knowledge] [Tools] [Thinking]────────  [Send] │
 * │      Bottom toolbar: always visible, expandable     │
 * └──────────────────────────────────────────────────────┘
 *
 * Features:
 * - Auto-resize textarea
 * - Keyboard shortcuts (Enter to send, Shift+Enter newline)
 * - Image paste/drop support with compression
 * - Extended thinking mode toggle (theme-colored)
 * - Bottom toolbar for future extensibility
 */

import { useState, useRef, useEffect, useMemo, useCallback, KeyboardEvent, ClipboardEvent, DragEvent } from 'react'
import { Plus, ImagePlus, Loader2, AlertCircle, Lightbulb } from 'lucide-react'
import { useAppStore } from '../../stores/app.store'
import { useChatStore } from '../../stores/chat.store'
import { api } from '../../api'
import { useOnboardingStore } from '../../stores/onboarding.store'
import { getOnboardingPrompt } from '../onboarding/onboardingData'
import { ToolsetControls } from './ToolsetControls'
import { LiveSessionsHeader } from './LiveSessionsHeader'
import { Popover, PopoverTrigger, PopoverContent } from '../ui/Popover'
import { ImageAttachmentPreview } from './ImageAttachmentPreview'
import { KnowledgeBaseButton } from './KnowledgeBaseButton'
import { processImage, isValidImageType, formatFileSize } from '../../utils/imageProcessor'
import type { ImageAttachment, Artifact } from '../../types'
import { getCurrentSource, resolveModelVision } from '../../types'
import { useTranslation } from '../../i18n'
import { SlashCommandMenu, filterSlashCommands } from './SlashCommandMenu'
import type { SlashCommandItem } from '../../types/slash-command'
import { DigitalHumanSelector, type DigitalHumanSelectorConfig } from './DigitalHumanSelector'

// ── #/@ mention helpers (R4.1: # = file reference, @ = recipient switch) ──

interface MentionMatch {
  query: string
  start: number
  end: number
}

/**
 * File-reference trigger. Was "@" pre-R4.1; moved to "#" once "@" became the
 * digital-human recipient trigger (IM/Copilot-style: @ = who, # = what file).
 */
function getMentionMatch(value: string, cursorPosition: number): MentionMatch | null {
  const beforeCursor = value.slice(0, cursorPosition)
  const match = beforeCursor.match(/(^|\s)#([^\s#]*)$/)
  if (!match || match.index === undefined) return null
  const start = match.index + match[1].length
  return { query: match[2] || '', start, end: cursorPosition }
}

/**
 * Digital-human recipient trigger (R4.1). Same shape as getMentionMatch but
 * keyed on "@" — the two never match the same span since they're different
 * characters, but are kept as separate functions/state rather than a shared
 * generic to avoid coupling the file-reference and recipient-switch flows,
 * which have unrelated selection semantics (insert text vs. switch link).
 */
function getAtMentionMatch(value: string, cursorPosition: number): MentionMatch | null {
  const beforeCursor = value.slice(0, cursorPosition)
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/)
  if (!match || match.index === undefined) return null
  const start = match.index + match[1].length
  return { query: match[2] || '', start, end: cursorPosition }
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, '/').trim().toLowerCase()
}

function matchesFuzzyPathPrefix(relativePath: string, query: string): boolean {
  const normalizedPath = normalizePathLike(relativePath)
  const normalizedQuery = normalizePathLike(query)
  if (!normalizedQuery) return true
  if (normalizedPath.includes(normalizedQuery)) return true
  const pathSegments = normalizedPath.split('/').filter(Boolean)
  const querySegments = normalizedQuery.split('/').filter(Boolean)
  if (querySegments.length === 0) return true
  if (querySegments.length > pathSegments.length) return false
  for (let i = 0; i < querySegments.length; i += 1) {
    if (!pathSegments[i]?.startsWith(querySegments[i])) return false
  }
  return true
}

function formatArtifactReference(relativePath: string): string {
  return `\`${relativePath}\``
}

interface InputAreaProps {
  onSend: (content: string, images?: ImageAttachment[], thinkingEnabled?: boolean) => void
  /** Called when user submits a message while generation is in progress (mid-turn inject) */
  onInject?: (content: string) => void
  /** Stop the current generation. Omit for inject-only inputs that cannot stop the
   *  underlying process (e.g. the automation run-detail supplement input); the Stop
   *  button is then hidden. */
  onStop?: () => void
  isGenerating: boolean
  placeholder?: string
  isCompact?: boolean
  /** Available slash commands for the "/" quick-input autocomplete */
  slashCommands?: SlashCommandItem[]
  /** Artifacts available for @ mention suggestions */
  mentionArtifacts?: Artifact[]
  /**
   * Hide the on-demand toolset broker control ("Tools" button). Digital-human
   * chat sets this: a digital human's tools are governed by its Capabilities
   * panel, not the broker, so the control would be inert and misleading here.
   */
  hideToolsetControls?: boolean
  /**
   * Hide the knowledge base loader button. Digital-human chat sets this: an
   * app's knowledge bases are bound via its config panel (AppKnowledgeSection),
   * not per-conversation attach — the button's space-conversation logic would
   * silently no-op here.
   */
  hideKnowledgeControls?: boolean
  /**
   * Drop the docked-input styling (top border, full-bleed background) for
   * contexts where this renders as a standalone card instead of pinned to
   * the bottom of a message list — e.g. the chat empty state's centered
   * composer.
   */
  standalone?: boolean
  /**
   * Digital-human "recipient" dropdown (R4/D2), docked at the input's left
   * edge. Only the main conversation board sets this — other InputArea
   * consumers (digital-human chat itself, the run-detail inject box) omit it
   * and the control simply doesn't render.
   */
  digitalHumanSelector?: DigitalHumanSelectorConfig
  /**
   * Enables per-conversation draft persistence (D9): unsent text is stashed
   * in chat.store's in-memory composerDrafts map under this key and restored
   * on mount, so switching the digital-human selector away and back doesn't
   * lose what was typed. Callers MUST remount this component (`key={draftKey}`)
   * when the key changes — drafts are read once, at mount, via lazy useState.
   */
  draftKey?: string
}

// Image constraints
const MAX_IMAGE_SIZE = 20 * 1024 * 1024  // 20MB max per image (before compression)
const MAX_IMAGES = 10  // Max images per message

// Number of actions offered by the attachment control. With only one
// (image), the toolbar shows it directly instead of hiding it behind a
// "+" popover — bump this when a second attach action is added.
const ATTACH_ACTION_COUNT: number = 1

// Error message type
interface ImageError {
  id: string
  message: string
}

export function InputArea({ onSend, onInject, onStop, isGenerating, placeholder, isCompact = false, slashCommands = [], mentionArtifacts = [], hideToolsetControls = false, hideKnowledgeControls = false, standalone = false, digitalHumanSelector, draftKey }: InputAreaProps) {
  const { t } = useTranslation()
  const sendKeyMode = useAppStore(state => state.config?.chat?.sendKeyMode ?? 'enter')

  // Vision support detection — images are always accepted; for non-vision
  // models the backend persists them to files and routes them through the
  // on-device OCR tool, so this flag only drives the informational hint.
  // Shares `resolveModelVision` with the backend so the hint can never claim
  // OCR while the request still ships image blocks.
  const aiSources = useAppStore(state => state.config?.aiSources)
  const visionEnabled = useMemo(() => {
    if (!aiSources) return true
    const source = getCurrentSource(aiSources)
    if (!source) return true
    return resolveModelVision(source, source.model)
  }, [aiSources])
  const [content, setContentState] = useState(() => draftKey ? useChatStore.getState().getComposerDraft(draftKey) : '')
  // Persists to chat.store's in-memory draft map on every change (D9). The
  // caller remounts this component when draftKey changes (see prop doc), so
  // this never needs to react to draftKey changing under it.
  const setContent = useCallback((value: string | ((prev: string) => string)) => {
    setContentState(prev => {
      const next = typeof value === 'function' ? (value as (prev: string) => string)(prev) : value
      if (draftKey) useChatStore.getState().setComposerDraft(draftKey, next)
      return next
    })
  }, [draftKey])
  const [isFocused, setIsFocused] = useState(false)
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProcessingImages, setIsProcessingImages] = useState(false)
  const [imageError, setImageError] = useState<ImageError | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(true)  // Extended thinking mode
  const [showAttachMenu, setShowAttachMenu] = useState(false)  // Attachment menu visibility
  // Slash-command autocomplete
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  // Set only by the pendingComposerInput prefill path (see its effect below)
  // to show a confirmation menu independent of the session's live command
  // list. Cleared the moment the user actually types, falling back to the
  // normal session-derived filtering.
  const [slashPreviewOverride, setSlashPreviewOverride] = useState<SlashCommandItem | null>(null)
  // @ mention autocomplete (P1 fix: track cursor as state for correct useMemo deps)
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false)
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)
  // @ recipient-switch autocomplete (R4.1) — only meaningful when
  // digitalHumanSelector is provided; otherwise these stay permanently false.
  const [dhMentionMenuOpen, setDhMentionMenuOpen] = useState(false)
  const [dhMentionSelectedIndex, setDhMentionSelectedIndex] = useState(0)
  const [cursorPos, setCursorPos] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Consume a composer prefill requested for this space (e.g. a skill's slash
  // command from the store's "Use" action, or SkillsTab's row click): fill
  // the box once, focus, cursor to end. Cleared immediately so it never
  // re-fires or leaks into another space.
  const pendingComposerInput = useChatStore(state => state.pendingComposerInput)
  const currentSpaceId = useChatStore(state => state.currentSpaceId)
  useEffect(() => {
    if (!pendingComposerInput || pendingComposerInput.spaceId !== currentSpaceId) return
    const text = pendingComposerInput.text
    const slashPreview = pendingComposerInput.slashPreview
    useChatStore.setState({ pendingComposerInput: null })
    setContent(text)
    // A prefilled slash command (skill "use" actions always fill one) opens
    // the same autocomplete menu the user would see typing it — it's the
    // only surface that shows the skill's argument hint, and it doubles as
    // a quick confirm of what actually got filled. The live-typing handler
    // below gates on "no space yet" to avoid opening while typing plain
    // text that starts with '/'; that concern doesn't apply here since this
    // path only ever fills a real, known command.
    if (text.startsWith('/')) {
      setSlashMenuOpen(true)
      setSlashSelectedIndex(0)
      // Show it even if the current session hasn't announced this command
      // (new empty conversation, or a skill the SDK didn't load for this
      // session) — see slashPreviewOverride's declaration for why that's safe.
      setSlashPreviewOverride(slashPreview ? {
        id: `preview-${slashPreview.command}`,
        command: slashPreview.command,
        label: slashPreview.label,
        description: slashPreview.description,
        category: 'skill',
      } : null)
    }
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`
    })
  }, [pendingComposerInput, currentSpaceId])

  // Auto-clear error after 3 seconds
  useEffect(() => {
    if (imageError) {
      const timer = setTimeout(() => setImageError(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [imageError])

  // Show error to user
  const showError = (message: string) => {
    setImageError({ id: `err-${Date.now()}`, message })
  }

  // Onboarding state
  const { isActive: isOnboarding, currentStep } = useOnboardingStore()
  const isOnboardingSendStep = isOnboarding && currentStep === 'send-message'

  // In onboarding send step, show prefilled prompt
  const onboardingPrompt = getOnboardingPrompt(t)
  const displayContent = isOnboardingSendStep ? onboardingPrompt : content

  // Process file to ImageAttachment with professional compression
  const processFileWithCompression = async (file: File): Promise<ImageAttachment | null> => {
    // Validate type
    if (!isValidImageType(file)) {
      showError(t('Unsupported image format: {{type}}', { type: file.type || t('Unknown') }))
      return null
    }

    // Validate size (before compression)
    if (file.size > MAX_IMAGE_SIZE) {
      showError(t('Image too large ({{size}}), max 20MB', { size: formatFileSize(file.size) }))
      return null
    }

    try {
      // Use professional image processor for compression
      const processed = await processImage(file)

      return {
        id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'image',
        mediaType: processed.mediaType,
        data: processed.data,
        name: file.name,
        size: processed.compressedSize
      }
    } catch (error) {
      console.error(`Failed to process image: ${file.name}`, error)
      showError(t('Failed to process image: {{name}}', { name: file.name }))
      return null
    }
  }

  // Add images (with limit check and loading state)
  const addImages = async (files: File[]) => {
    const remainingSlots = MAX_IMAGES - images.length
    if (remainingSlots <= 0) return

    const filesToProcess = files.slice(0, remainingSlots)

    // Show loading state during compression
    setIsProcessingImages(true)

    try {
      const newImages = await Promise.all(filesToProcess.map(processFileWithCompression))
      const validImages = newImages.filter((img): img is ImageAttachment => img !== null)

      if (validImages.length > 0) {
        setImages(prev => [...prev, ...validImages])
      }
    } finally {
      setIsProcessingImages(false)
    }
  }

  // Remove image
  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }

  // Handle paste event
  const handlePaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault()  // Prevent default only if we're handling images
      await addImages(imageFiles)
    }
  }

  // Handle drag events
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (!isDragOver) setIsDragOver(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  // Handle artifact drag-drop reference insertion
  const handleDropReference = (rawPath: string): boolean => {
    const normalizedPath = normalizePathLike(rawPath)
    // P1 fix: use string match instead of RegExp
    const target = mentionArtifacts.find(a => {
      const rp = normalizePathLike(a.relativePath)
      return rp === normalizedPath || rp.endsWith('/' + normalizedPath)
    })
    if (!target) return false

    const prefix = content && !content.endsWith(' ') && !content.endsWith('\n') ? ' ' : ''
    const nextContent = `${content}${prefix}${formatArtifactReference(target.relativePath)} `
    setContent(nextContent)
    handleMentionClose()

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const len = nextContent.length
        textareaRef.current.setSelectionRange(len, len)
        setCursorPos(len)
      }
    })
    return true
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    // Check for artifact drag-drop first
    const referencePath = e.dataTransfer.getData('text/halo-artifact-relative-path') || e.dataTransfer.getData('text/plain')
    if (referencePath && handleDropReference(referencePath)) {
      return
    }

    const files = Array.from(e.dataTransfer.files).filter(file => isValidImageType(file))

    if (files.length > 0) {
      await addImages(files)
    }
  }

  // Handle file input change
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      await addImages(files)
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Handle image button click (from attachment menu)
  const handleImageButtonClick = () => {
    setShowAttachMenu(false)
    fileInputRef.current?.click()
  }

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`
    }
  }, [displayContent])

  // Focus on mount
  useEffect(() => {
    if (!isGenerating && !isOnboardingSendStep) {
      textareaRef.current?.focus()
    }
  }, [isGenerating, isOnboardingSendStep])

  // Slash-command helpers

  // Upper bound on filter length: the longest command label (e.g. "compact" = 7).
  // Computed once per commands list change — used to short-circuit onChange cheaply.
  const maxCommandLen = useMemo(
    () => slashCommands.reduce((max, c) => Math.max(max, c.label.length), 0),
    [slashCommands]
  )

  // `slashFilter` is the text typed after "/" — drives filtering and menu visibility.
  const slashFilter = slashMenuOpen && content.startsWith('/') ? content.slice(1) : ''

  // Pre-filtered, pre-sorted list — single source of truth for rendering and keyboard nav.
  // Only computed when the menu is open; returns [] otherwise (zero cost when closed).
  // A prefill override bypasses the session-derived list entirely (see its
  // declaration above for why).
  const filteredSlashCommands = useMemo(
    () => slashPreviewOverride
      ? [slashPreviewOverride]
      : (slashMenuOpen ? filterSlashCommands(slashCommands, slashFilter) : []),
    [slashCommands, slashFilter, slashMenuOpen, slashPreviewOverride]
  )

  // @ mention match — depends on both content and cursor position (P1 fix)
  const mentionMatch = useMemo(
    () => getMentionMatch(content, cursorPos),
    [content, cursorPos]
  )

  // Filtered & scored mention artifacts — only computed when menu is open
  const filteredMentionArtifacts = useMemo(() => {
    if (!mentionMenuOpen) return []
    const query = mentionMatch?.query.trim() || ''
    const normalizedQuery = normalizePathLike(query)

    const score = (artifact: Artifact) => {
      const name = normalizePathLike(artifact.name)
      const rp = normalizePathLike(artifact.relativePath)
      if (!normalizedQuery) return artifact.type === 'folder' ? 0 : 1
      if (rp === normalizedQuery || name === normalizedQuery) return 0
      if (rp.startsWith(normalizedQuery)) return 1
      if (name.startsWith(normalizedQuery)) return 2
      if (rp.includes(normalizedQuery)) return 3
      return 10
    }

    return [...mentionArtifacts]
      .filter(a => matchesFuzzyPathPrefix(a.relativePath, query))
      .sort((a, b) => {
        const diff = score(a) - score(b)
        if (diff !== 0) return diff
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.relativePath.localeCompare(b.relativePath)
      })
      .slice(0, 50)
  }, [mentionArtifacts, mentionMatch, mentionMenuOpen])

  // @ recipient-switch match + filtered option list (R4.1). Digital humans
  // only — @ is "who do I hand this to", not a toggle back to normal chat;
  // switching back to Halo is the selector's own "Halo" entry or clearing
  // the current selection, not an @ target.
  const dhMentionMatch = useMemo(
    () => getAtMentionMatch(content, cursorPos),
    [content, cursorPos]
  )
  const dhMentionOptions = useMemo(() => {
    if (!dhMentionMenuOpen || !digitalHumanSelector) return []
    const query = dhMentionMatch?.query.trim().toLowerCase() || ''
    const options = digitalHumanSelector.options.map(o => ({ appId: o.appId, name: o.name }))
    return query ? options.filter(o => o.name.toLowerCase().includes(query)) : options
  }, [dhMentionMenuOpen, digitalHumanSelector, dhMentionMatch])

  const handleSlashClose = () => {
    setSlashMenuOpen(false)
    setSlashSelectedIndex(0)
  }

  const handleMentionClose = () => {
    setMentionMenuOpen(false)
    setMentionSelectedIndex(0)
  }

  const handleDhMentionClose = () => {
    setDhMentionMenuOpen(false)
    setDhMentionSelectedIndex(0)
  }

  /**
   * Switch recipient via @ (R4.1/D11): removes the "@query" span entirely —
   * no residual text — since the selection's only effect is switching which
   * link the input points at (the chip/selector shows the result), not
   * inserting a reference the way # does.
   *
   * @ always starts a fresh session with the digital human (D5 revision —
   * @ing is "start talking to X", distinct from the dropdown's "open X's
   * existing conversation"), so a digital human can accumulate several
   * sessions the way a normal recipient can have several threads.
   */
  const selectDhMention = async (appId: string) => {
    const currentCursor = textareaRef.current?.selectionStart ?? content.length
    const match = getAtMentionMatch(content, currentCursor)
    if (!match) return

    const suffix = content.slice(match.end)
    const prefix = content.slice(0, match.start)
    // Drop a single leading space the trigger regex captured, so removing
    // "@query" doesn't leave a double space behind.
    const nextContent = `${prefix}${suffix}`
    const nextCursor = prefix.length

    setContent(nextContent)
    handleDhMentionClose()

    try {
      const res = await api.appSessionCreate(appId)
      if (res.success && res.data) {
        digitalHumanSelector?.onChange(appId, res.data.conversationId)
      } else {
        console.error('[InputArea] Failed to create digital-human session:', res.error)
      }
    } catch (err) {
      console.error('[InputArea] Create digital-human session error:', err)
    }

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(nextCursor, nextCursor)
        setCursorPos(nextCursor)
      }
    })
  }

  const insertMention = (relativePath: string) => {
    const currentCursor = textareaRef.current?.selectionStart ?? content.length
    const match = getMentionMatch(content, currentCursor)
    if (!match) return

    const mentionText = formatArtifactReference(relativePath)
    const suffix = content.slice(match.end)
    const needsTrailingSpace = suffix.length === 0 || !/^\s/.test(suffix)
    const nextContent = `${content.slice(0, match.start)}${mentionText}${needsTrailingSpace ? ' ' : ''}${suffix}`
    const nextCursor = content.slice(0, match.start).length + mentionText.length + (needsTrailingSpace ? 1 : 0)

    setContent(nextContent)
    handleMentionClose()

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(nextCursor, nextCursor)
        setCursorPos(nextCursor)
      }
    })
  }

  const handleSlashSelect = (item: SlashCommandItem) => {
    const newContent = item.command + ' '
    setContent(newContent)
    setSlashMenuOpen(false)
    setSlashSelectedIndex(0)
    // Resize textarea to fit the new (short) content and restore focus
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
        textareaRef.current.focus()
        // Place cursor at the end
        const len = textareaRef.current.value.length
        textareaRef.current.setSelectionRange(len, len)
      }
    })
  }

  // Handle send — routes to inject path when generation is in progress
  const handleSend = () => {
    const textToSend = isOnboardingSendStep ? onboardingPrompt : content.trim()

    if (isGenerating) {
      // Mid-turn inject: text only (no images, no thinking toggle)
      if (textToSend && onInject) {
        onInject(textToSend)
        setContent('')
        if (draftKey) useChatStore.getState().clearComposerDraft(draftKey)
        handleMentionClose()
        handleSlashClose()
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      }
      return
    }

    const hasContent = textToSend || images.length > 0
    if (hasContent) {
      onSend(textToSend, images.length > 0 ? images : undefined, thinkingEnabled)

      if (!isOnboardingSendStep) {
        setContent('')
        if (draftKey) useChatStore.getState().clearComposerDraft(draftKey)
        setImages([])  // Clear images after send
        handleMentionClose()
        handleSlashClose()
        // Don't reset thinkingEnabled - user might want to keep it on
        // Reset height
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
      }
    }
  }

  // Detect mobile device (touch + narrow screen)
  const isMobile = () => {
    return 'ontouchstart' in window && window.innerWidth < 768
  }

  // Handle key press
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore key events during IME composition (Chinese/Japanese/Korean input)
    // This prevents Enter from sending the message while confirming IME candidates
    if (e.nativeEvent.isComposing) return

    // ── @ mention menu navigation ──────────────────────────────────────────────
    if (mentionMenuOpen && filteredMentionArtifacts.length > 0) {
      const mLen = filteredMentionArtifacts.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionSelectedIndex(i => (i + 1) % mLen)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionSelectedIndex(i => (i - 1 + mLen) % mLen)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const selected = filteredMentionArtifacts[mentionSelectedIndex]
        if (selected) insertMention(selected.relativePath)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleMentionClose()
        return
      }
    }

    // ── @ recipient-switch menu navigation (R4.1) ───────────────────────────────
    if (dhMentionMenuOpen && dhMentionOptions.length > 0) {
      const dLen = dhMentionOptions.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setDhMentionSelectedIndex(i => (i + 1) % dLen)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setDhMentionSelectedIndex(i => (i - 1 + dLen) % dLen)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const selected = dhMentionOptions[dhMentionSelectedIndex]
        if (selected) void selectDhMention(selected.appId)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleDhMentionClose()
        return
      }
    }

    // ── Slash-command menu navigation ─────────────────────────────────────────
    // filteredSlashCommands is already computed by useMemo — no extra filtering here.
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      const filteredLen = filteredSlashCommands.length

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelectedIndex((i) => (i + 1) % filteredLen)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIndex((i) => (i - 1 + filteredLen) % filteredLen)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (filteredSlashCommands[slashSelectedIndex]) {
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex])
        }
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        if (filteredSlashCommands[slashSelectedIndex]) {
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex])
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleSlashClose()
        return
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Mobile: send via button only
    // PC: respect sendKeyMode setting
    if (!isMobile()) {
      if (sendKeyMode === 'ctrl-enter') {
        // Ctrl+Enter to send, Enter for new line
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault()
          handleSend()
        }
      } else {
        // Enter to send, Shift+Enter for new line
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleSend()
        }
      }
    }
    // Esc to stop
    if (e.key === 'Escape' && isGenerating && onStop) {
      e.preventDefault()
      onStop()
    }
  }

  // In onboarding mode, can always send (prefilled content)
  // Can send if has text OR has images (and not processing/generating)
  // During generation (inject mode): only plain text is allowed, no images
  // Normal mode: text or images, not currently processing
  const canSend = isOnboardingSendStep ||
    (isGenerating
      ? (content.trim().length > 0 && !!onInject)
      : ((content.trim().length > 0 || images.length > 0) && !isProcessingImages)
    )
  const hasImages = images.length > 0

  return (
    <div className={`
      ${standalone ? '' : isCompact ? 'border-t border-border/50 bg-background' : 'bg-gradient-to-b from-transparent to-background'}
      transition-[padding] duration-300 ease-out
      ${standalone ? '' : isCompact ? 'px-3 py-2' : 'pt-3 px-6 pb-[18px]'}
    `}>
      <div className={standalone ? '' : isCompact ? '' : 'max-w-[720px] mx-auto'}>
        {/* Error toast notification */}
        {imageError && (
          <div className="mb-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20
            flex items-start gap-2 animate-fade-in">
            <AlertCircle size={16} className="text-destructive mt-0.5 flex-shrink-0" />
            <span className="text-sm text-destructive flex-1">{imageError.message}</span>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        {/* Live AI sessions — capsule tab adhered to the input's top-left edge.
            Sibling above the input card; the input box itself is untouched. */}
        <LiveSessionsHeader />

        {/* Input container — radius kept at the prototype's literal values
            (its own core visual feature, not on the 8/10/12/16 scale):
            22px centered/standalone, 18px once docked at the bottom. */}
        <div
          className={`
            relative flex flex-col border bg-card shadow-soft
            transition-colors ease-halo
            ${standalone ? 'rounded-[22px]' : 'rounded-[18px]'}
            ${isFocused ? 'border-primary ring-[3px] ring-primary/[0.12]' : 'border-border'}
            ${isDragOver ? 'ring-2 ring-primary/50 bg-primary/5' : ''}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Slash-command autocomplete menu — floats above the input box.
              Only rendered when there are actual matches; no empty-state UI. */}
          {slashMenuOpen && filteredSlashCommands.length > 0 && (
            <SlashCommandMenu
              items={filteredSlashCommands}
              selectedIndex={slashSelectedIndex}
              onSelect={handleSlashSelect}
              onClose={handleSlashClose}
            />
          )}
          {/* @ mention autocomplete menu */}
          {mentionMenuOpen && filteredMentionArtifacts.length > 0 && (
            <div className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-popover border border-border rounded-xl shadow-lg z-30 overflow-hidden">
              <div className="max-h-[336px] overflow-y-auto py-1">
                {filteredMentionArtifacts.map((artifact, index) => {
                  const isSelected = index === mentionSelectedIndex
                  return (
                    <button
                      key={`${artifact.path}-${artifact.type}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        insertMention(artifact.relativePath)
                      }}
                      className={`w-full flex items-center gap-2 text-left min-h-[38px] border-l-2 ${isSelected ? 'bg-primary/10 border-primary pl-2.5 pr-3' : 'border-transparent pl-2.5 pr-3 hover:bg-muted/50'}`}
                    >
                      <span className="text-xs font-medium text-primary/80 shrink-0">
                        {artifact.type === 'folder' ? t('Folder') : t('File')}
                      </span>
                      <span className="text-sm truncate flex-1 min-w-0">{artifact.relativePath}</span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-border/40 px-3 py-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/40 select-none">
                <span>↑↓ {t('navigate')}</span>
                <span>↵ {t('select')}</span>
                <span>Esc {t('close')}</span>
              </div>
            </div>
          )}
          {/* @ recipient-switch autocomplete menu (R4.1). Stays open even with
              zero options — a silently empty "@" is indistinguishable from
              the keystroke not registering, so an empty workspace still gets
              a popup explaining why there's nothing to pick. */}
          {dhMentionMenuOpen && digitalHumanSelector && (
            <div className="absolute bottom-full left-0 mb-2 w-56 max-w-md bg-popover border border-border rounded-xl shadow-lg z-30 overflow-hidden">
              {dhMentionOptions.length > 0 ? (
                <>
                  <div className="max-h-[336px] overflow-y-auto py-1">
                    {dhMentionOptions.map((option, index) => {
                      const isSelected = index === dhMentionSelectedIndex
                      return (
                        <button
                          key={option.appId}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            void selectDhMention(option.appId)
                          }}
                          className={`w-full flex items-center gap-2 text-left min-h-[36px] px-3 border-l-2 ${isSelected ? 'bg-primary/10 border-primary' : 'border-transparent hover:bg-muted/50'}`}
                        >
                          <span className="text-sm truncate flex-1 min-w-0">{option.name}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="border-t border-border/40 px-3 py-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/40 select-none">
                    <span>↑↓ {t('navigate')}</span>
                    <span>↵ {t('select')}</span>
                    <span>Esc {t('close')}</span>
                  </div>
                </>
              ) : (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                  {digitalHumanSelector.options.length === 0
                    ? t('This workspace has no digital humans yet')
                    : t('No matching results found')}
                </div>
              )}
            </div>
          )}
          {/* Image preview area */}
          {hasImages && (
            <>
              <ImageAttachmentPreview
                images={images}
                onRemove={removeImage}
              />
              {!visionEnabled && (
                <div className="px-4 py-1.5 text-xs text-muted-foreground border-b border-border/30">
                  {t('Current model has no vision — images will be read via local OCR (text only)')}
                </div>
              )}
            </>
          )}

          {/* Image processing indicator */}
          {isProcessingImages && (
            <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground border-b border-border/30">
              <Loader2 size={14} className="animate-spin" />
              <span>{t('Processing image...')}</span>
            </div>
          )}

          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center
              bg-primary/5 rounded-2xl border-2 border-dashed border-primary/30
              pointer-events-none z-10">
              <div className="flex flex-col items-center gap-2 text-primary/70">
                <ImagePlus size={24} />
                <span className="text-sm font-medium">{t('Drop to add images')}</span>
              </div>
            </div>
          )}

          {/* Textarea area */}
          <div className="px-4 pt-3.5">
            <textarea
              ref={textareaRef}
              value={displayContent}
              onChange={(e) => {
                if (isOnboardingSendStep) return
                const val = e.target.value
                setContent(val)
                // Real typing always falls back to the session's live command
                // list — a stale prefill preview shouldn't keep overriding it.
                setSlashPreviewOverride(null)
                // Open slash-command menu only when the input is a plausible command prefix.
                // Short-circuits before any filter computation via maxCommandLen:
                //   • starts with "/"
                //   • no spaces or newlines (file paths, multi-line text are not commands)
                //   • at most as long as the longest known command
                const afterSlash = val.slice(1)
                const looksLikeCommand =
                  slashCommands.length > 0 &&
                  val.startsWith('/') &&
                  !afterSlash.includes(' ') &&
                  !afterSlash.includes('\n') &&
                  afterSlash.length <= maxCommandLen
                if (looksLikeCommand) {
                  setSlashMenuOpen(true)
                  setSlashSelectedIndex(0)
                  setMentionMenuOpen(false)
                  setDhMentionMenuOpen(false)
                } else {
                  setSlashMenuOpen(false)
                }

                // # file-reference detection (P1 fix: track cursor position as state)
                const nextCursor = e.target.selectionStart ?? val.length
                setCursorPos(nextCursor)
                const nextMentionMatch = getMentionMatch(val, nextCursor)
                // D11: only opens once a character follows "#" — an empty query
                // would otherwise fire on every Markdown heading (# ) keystroke.
                if (nextMentionMatch && nextMentionMatch.query.length > 0 && mentionArtifacts.length > 0) {
                  setMentionMenuOpen(true)
                  setMentionSelectedIndex(0)
                } else {
                  setMentionMenuOpen(false)
                }

                // @ recipient-switch detection (R4.1) — no query-length gate
                // ("#" heading collision doesn't apply to "@"); locked (R5.1:
                // generating or queued) suppresses it entirely rather than
                // showing a menu whose selection would be rejected anyway.
                const nextDhMentionMatch = getAtMentionMatch(val, nextCursor)
                if (nextDhMentionMatch && digitalHumanSelector && !digitalHumanSelector.locked) {
                  setDhMentionMenuOpen(true)
                  setDhMentionSelectedIndex(0)
                } else {
                  setDhMentionMenuOpen(false)
                }
              }}
              onSelect={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              // No greeting lead-in here — the full-takeover empty state
              // already has "What do you want to do today?" as an h2 right
              // above the composer; repeating it in the placeholder was pure
              // redundancy the docked (post-first-message) state inherits
              // the same placeholder for, since it's the same InputArea
              // instance either way.
              placeholder={placeholder || (digitalHumanSelector
                ? t('@ to switch recipient, # to reference files, / for skills and commands')
                : t('# to reference files, / for skills and commands'))}
              readOnly={isOnboardingSendStep}
              rows={1}
              className={`w-full bg-transparent resize-none text-[15px] leading-[1.5]
                focus:outline-none text-foreground placeholder:text-subtle-foreground
                disabled:cursor-not-allowed min-h-[26px]
                ${isOnboardingSendStep ? 'cursor-default' : ''}`}
              style={{ maxHeight: '180px' }}
            />
          </div>

          {/* Bottom toolbar - always visible, industry standard layout */}
          <InputToolbar
            isGenerating={isGenerating}
            isOnboarding={isOnboardingSendStep}
            isProcessingImages={isProcessingImages}
            thinkingEnabled={thinkingEnabled}
            onThinkingToggle={() => setThinkingEnabled(!thinkingEnabled)}
            showAttachMenu={showAttachMenu}
            onAttachMenuChange={setShowAttachMenu}
            onImageClick={handleImageButtonClick}
            imageCount={images.length}
            maxImages={MAX_IMAGES}
            canSend={canSend}
            onSend={handleSend}
            onStop={onStop}
            sendKeyMode={sendKeyMode}
            visionEnabled={visionEnabled}
            hideToolsetControls={hideToolsetControls}
            hideKnowledgeControls={hideKnowledgeControls}
            digitalHumanSelector={digitalHumanSelector}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Input Toolbar - Bottom action bar
 * Extracted as a separate component for maintainability and future extensibility
 *
 * Layout: [+attachment] [knowledge] [tools] [thinking] ──── [send]
 */
interface InputToolbarProps {
  isGenerating: boolean
  isOnboarding: boolean
  isProcessingImages: boolean
  thinkingEnabled: boolean
  onThinkingToggle: () => void
  showAttachMenu: boolean
  onAttachMenuChange: (open: boolean) => void
  onImageClick: () => void
  imageCount: number
  maxImages: number
  canSend: boolean
  onSend: () => void
  onStop?: () => void
  sendKeyMode: 'enter' | 'ctrl-enter'
  visionEnabled: boolean
  hideToolsetControls: boolean
  hideKnowledgeControls: boolean
  digitalHumanSelector?: DigitalHumanSelectorConfig
}

function InputToolbar({
  isGenerating,
  isOnboarding,
  isProcessingImages,
  thinkingEnabled,
  onThinkingToggle,
  showAttachMenu,
  onAttachMenuChange,
  onImageClick,
  imageCount,
  maxImages,
  canSend,
  onSend,
  onStop,
  sendKeyMode,
  visionEnabled,
  hideToolsetControls,
  hideKnowledgeControls,
  digitalHumanSelector
}: InputToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-nowrap items-center justify-between gap-1 px-4 pb-2.5 mt-2">
      {/* Left section: recipient selector + attachment + toolsets + thinking.
          Scrolls horizontally on narrow widths so the fixed Send/Stop group
          is never pushed off. */}
      <div className="flex flex-nowrap items-center gap-1 min-w-0 overflow-x-auto scrollbar-none">
        {digitalHumanSelector && !isOnboarding && (
          <DigitalHumanSelector {...digitalHumanSelector} />
        )}

        {/* Attachment — a single available action (image) shows directly as
            its own icon button instead of hiding behind a "+" popover; the
            popover form only earns its keep once a second action exists. */}
        {!isGenerating && !isOnboarding && (
          ATTACH_ACTION_COUNT === 1 ? (
            <button
              type="button"
              onClick={onImageClick}
              disabled={isProcessingImages || imageCount >= maxImages}
              title={!visionEnabled ? t('Current model has no vision — images will be read via local OCR (text only)') : t('Add image')}
              className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-sm cursor-pointer
                transition-colors ease-halo
                ${imageCount > 0
                  ? 'bg-primary/[0.12] text-accent-on-dark'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }
                ${(isProcessingImages || imageCount >= maxImages) ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <ImagePlus size={17} />
            </button>
          ) : (
            <Popover
              open={showAttachMenu}
              onOpenChange={(open) => {
                if (open && isProcessingImages) return
                onAttachMenuChange(open)
              }}
            >
              <PopoverTrigger
                title={t('Add attachment')}
                className={`w-8 h-8 shrink-0 items-center justify-center rounded-sm cursor-pointer
                  transition-all duration-150
                  ${showAttachMenu
                    ? 'bg-primary/[0.12] text-accent-on-dark'
                    : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary'
                  }
                  ${isProcessingImages ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <Plus size={17} className={`transition-transform duration-200 ${showAttachMenu ? 'rotate-45' : ''}`} />
              </PopoverTrigger>

              <PopoverContent side="top" align="start" sideOffset={8} className="py-1.5 rounded-xl min-w-[160px]">
                <button
                  onClick={onImageClick}
                  disabled={imageCount >= maxImages}
                  className={`w-full px-3 py-2 flex items-center gap-3 text-sm
                    transition-colors duration-150
                    ${imageCount >= maxImages
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'text-foreground hover:bg-muted/50'
                    }
                  `}
                  title={!visionEnabled ? t('Current model has no vision — images will be read via local OCR (text only)') : undefined}
                >
                  <ImagePlus size={16} className="text-muted-foreground" />
                  <span>{t('Add image')}</span>
                  {!visionEnabled && imageCount === 0 && (
                    <span className="ml-auto text-xs text-muted-foreground/60">
                      {t('via OCR')}
                    </span>
                  )}
                  {imageCount > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {imageCount}/{maxImages}
                    </span>
                  )}
                </button>
              </PopoverContent>
            </Popover>
          )
        )}

        {/* Knowledge base loader */}
        {!isGenerating && !isOnboarding && !hideKnowledgeControls && <KnowledgeBaseButton />}

        {/* On-demand toolsets (catalog menu + activation pills) */}
        {!isGenerating && !isOnboarding && !hideToolsetControls && <ToolsetControls />}

        {/* Thinking mode toggle - always show full label, no expansion */}
        {!isGenerating && !isOnboarding && (
          <button
            onClick={onThinkingToggle}
            className={`h-8 shrink-0 flex items-center gap-[5px] px-[9px] rounded-sm
              transition-colors ease-halo
              ${thinkingEnabled
                ? 'bg-primary/[0.12] text-accent-on-dark'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }
            `}
            title={thinkingEnabled ? t('Disable Deep Thinking') : t('Enable Deep Thinking')}
          >
            <Lightbulb size={17} />
            <span className="hidden sm:inline text-xs whitespace-nowrap">{t('Deep Thinking')}</span>
          </button>
        )}
      </div>

      {/* Right section: Stop (when generating) + Send — fixed, never scrolls */}
      <div className="flex flex-nowrap items-center gap-1 shrink-0">
        {isGenerating && onStop && (
          <button
            onClick={onStop}
            className="w-8 h-8 flex items-center justify-center
              bg-destructive/10 text-destructive rounded-sm
              hover:bg-destructive/20 active:bg-destructive/30
              transition-all duration-150"
            title={t('Stop generation (Esc)')}
          >
            <div className="w-3 h-3 border-2 border-current rounded-sm" />
          </button>
        )}
        {!isOnboarding && (
          <button
            data-onboarding="send-button"
            onClick={onSend}
            disabled={!canSend}
            className={`
              w-[34px] h-[34px] flex items-center justify-center rounded-full transition-all ease-halo
              ${canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary-hover hover:-translate-y-[1px] active:scale-95'
                : 'bg-muted/50 text-muted-foreground/40 cursor-not-allowed'
              }
            `}
            title={
              isGenerating
                ? t('Add to queue')
                : sendKeyMode === 'ctrl-enter'
                  ? (thinkingEnabled ? t('Send (Deep Thinking) — Ctrl+Enter') : t('Send — Ctrl+Enter'))
                  : (thinkingEnabled ? t('Send (Deep Thinking) — Enter') : t('Send — Enter'))
            }
          >
            <svg className="w-[17px] h-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
