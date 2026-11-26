/**
 * SpaceSearchSelect — the "Install to" workspace picker shared by the store
 * install dialog and the local digital-human / skill install dialogs.
 *
 * A floating, searchable list: pinned rows (Global, the default workspace)
 * first, then the user's own workspaces under a header. Typing filters every
 * row by its visible label; ↑/↓ move, Enter picks, Esc closes only the list.
 * Portaled so the dialog's scroll area does not clip it.
 */

import { useState, useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useTranslation } from '../../i18n'

export interface SpaceSearchOption {
  id: string
  label: string
}

interface SpaceSearchSelectProps {
  /** Selected option id; a value matching no option shows the placeholder. */
  value: string
  onChange: (id: string) => void
  /** Rows above the header, e.g. Global and the default workspace. */
  pinned?: SpaceSearchOption[]
  /** The user's own workspaces, listed under "Dedicated workspaces". */
  spaces: SpaceSearchOption[]
  placeholder?: string
  invalid?: boolean
  /** Trigger surface — match the surrounding form's inputs. */
  variant?: 'soft' | 'secondary'
}

export function SpaceSearchSelect({ value, onChange, pinned = [], spaces, placeholder, invalid, variant = 'soft' }: SpaceSearchSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null)
  const [query, setQuery] = useState('')
  // Keyboard-highlighted row (index into `options`); -1 = none.
  const [active, setActive] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const openList = () => {
    const r = triggerRef.current?.getBoundingClientRect()
    // Open below the trigger, or above it when the trigger sits low and there
    // is more room up there; cap the height to that room so the list never
    // runs off the window (it scrolls inside).
    if (r) {
      const below = window.innerHeight - r.bottom - 16
      const above = r.top - 16
      const up = below < 220 && above > below
      const maxHeight = Math.max(120, Math.min(320, up ? above : below))
      setAnchor(up
        ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width, maxHeight }
        : { top: r.bottom + 4, left: r.left, width: r.width, maxHeight })
    }
    setQuery('')
    setOpen(true)
  }
  const closeList = () => { setOpen(false); setQuery('') }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      closeList()
    }
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return
      closeList()
    }
    const onResize = () => closeList()
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const currentLabel = [...pinned, ...spaces].find(o => o.id === value)?.label ?? ''

  const select = (id: string) => { onChange(id); closeList() }

  // Searching filters every row by its visible label, case-insensitively.
  const needle = query.trim().toLowerCase()
  const matches = (o: SpaceSearchOption) => !needle || o.label.toLowerCase().includes(needle)
  const shownPinned = pinned.filter(matches)
  const shownSpaces = spaces.filter(matches)
  const options = [...shownPinned, ...shownSpaces]

  // On open, highlight the current choice; while typing, the first match so
  // Enter picks it.
  useEffect(() => {
    if (!open) return
    setActive(needle ? (options.length > 0 ? 0 : -1) : options.findIndex(o => o.id === value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, needle])

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open || active < 0) return
    scrollRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { openList(); return }
      if (options.length) setActive(i => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (options.length) setActive(i => (i <= 0 ? options.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      if (active >= 0 && options[active]) select(options[active].id)
    } else if (e.key === 'Escape' && open) {
      // Close only the list, not the dialog around it.
      e.preventDefault()
      e.stopPropagation()
      closeList()
      triggerRef.current?.focus()
    }
  }

  const renderRow = (o: SpaceSearchOption, idx: number) => (
    <button
      key={o.id || '__global'}
      type="button"
      role="option"
      aria-selected={value === o.id}
      data-idx={idx}
      onClick={() => select(o.id)}
      onMouseMove={() => { if (active !== idx) setActive(idx) }}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
        value === o.id ? 'bg-primary/10 font-medium text-foreground'
        : active === idx ? 'bg-secondary/60 text-foreground'
        : 'text-foreground'
      }`}
    >
      <span className="flex-1 min-w-0 truncate">{o.label}</span>
      {value === o.id && <Check className="w-3.5 h-3.5 flex-shrink-0 text-primary" />}
    </button>
  )

  const surface = variant === 'secondary' ? 'bg-secondary' : 'bg-muted/40'
  const border = invalid ? 'border-red-400 ring-1 ring-red-400/40' : variant === 'secondary' ? 'border-border' : 'border-border-soft'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-sm border rounded-lg text-left focus:outline-none focus:ring-1 focus:ring-primary ${surface} ${border}`}
      >
        <span className={`truncate ${currentLabel ? 'text-foreground' : 'text-muted-foreground/50'}`}>
          {currentLabel || placeholder || t('Select a workspace')}
        </span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 text-muted-foreground/60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && anchor && createPortal(
        <div
          ref={listRef}
          style={{ position: 'fixed', top: anchor.top, bottom: anchor.bottom, left: anchor.left, width: anchor.width, maxHeight: anchor.maxHeight }}
          className="z-[60] flex flex-col overflow-hidden rounded-lg border border-border-soft bg-background shadow-lg"
        >
          {/* Search stays fixed above the scrolling list. */}
          <div className="flex-shrink-0 p-2 border-b border-border-soft">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('Search workspaces')}
                className="w-full h-8 pl-8 pr-2.5 text-[13px] bg-muted/40 border border-border-soft rounded-md text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>
          <div ref={scrollRef} role="listbox" className="flex-1 min-h-0 overflow-y-auto py-1">
            {shownPinned.map((o, i) => renderRow(o, i))}
            {shownSpaces.length > 0 && (
              <>
                <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground/60">{t('Dedicated workspaces')}</div>
                {shownSpaces.map((o, i) => renderRow(o, shownPinned.length + i))}
              </>
            )}
            {options.length === 0 && (
              <div className="px-3 py-5 text-center text-xs text-muted-foreground">{t('No matching results found')}</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
