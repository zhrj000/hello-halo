/**
 * FileChangesFooter - "Changed N files · +A −D ›" line under an AI
 * reply that edited files. Opens the reply's edits in the canvas changes view.
 *
 * The counts come from the message metadata (shown at once), or from the
 * reply's thoughts when they are already loaded; the diffs themselves are read
 * by the changes view when it opens.
 */

import { useMemo } from 'react'
import { ChevronRight, FileDiff } from 'lucide-react'
import { extractFileChanges, hasFileChanges, summaryToFileChanges } from './utils'
import type { Thought, FileChangesSummary } from '../../types'
import { useCanvasActions } from '../../hooks/useCanvasLifecycle'
import { useTranslation } from '../../i18n'

interface FileChangesFooterProps {
  fileChangesSummary?: FileChangesSummary  // From metadata: immediate stats display
  thoughts?: Thought[] | null              // From message: exact stats once loaded
  /** The reply these changes belong to; without it they cannot be opened. */
  reply?: { spaceId: string; conversationId: string; messageId: string; timestamp: string }
}

export function FileChangesFooter({ fileChangesSummary, thoughts, reply }: FileChangesFooterProps) {
  const { t, i18n } = useTranslation()
  const { openChanges } = useCanvasActions()

  const changes = useMemo(() => {
    if (Array.isArray(thoughts) && thoughts.length > 0) {
      const extracted = extractFileChanges(thoughts)
      if (hasFileChanges(extracted)) return extracted
    }
    if (fileChangesSummary) return summaryToFileChanges(fileChangesSummary)
    return null
  }, [fileChangesSummary, thoughts])

  if (!changes) return null

  const open = () => {
    if (!reply) return
    const at = Date.parse(reply.timestamp)
    const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(Number.isNaN(at) ? Date.now() : at)
    void openChanges({
      kind: 'message',
      spaceId: reply.spaceId,
      conversationId: reply.conversationId,
      messageId: reply.messageId,
      title: t('Reply {{time}}', { time }),
      replyAt: Number.isNaN(at) ? Date.now() : at,
    })
  }

  const format = (value: number) => new Intl.NumberFormat(i18n.language).format(value)

  // Drawn like the reply's "Worked for" line above it — a quiet line, not a card —
  // so the two entries into a reply's details read as one family. The fill bleeds
  // into the gutter, so the icon keeps the reply's left edge.
  return (
    <button
      type="button"
      onClick={open}
      disabled={!reply}
      className="group/changes -mx-1.5 mt-3 flex w-fit max-w-[calc(100%+0.75rem)] min-h-8 items-center gap-[7px] rounded-[5px] px-1.5 py-1 text-left text-[13px] text-muted-foreground transition-colors duration-200 hover:bg-secondary/60 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [@media(pointer:coarse)]:min-h-11"
    >
      <FileDiff size={14} className="shrink-0 text-faint-foreground" aria-hidden />
      <span className="min-w-0 truncate">{t('Changed {{count}} files', { count: changes.totalFiles })}</span>
      <span className="shrink-0 text-xs tabular-nums text-faint-foreground">
        · <span className="text-diff-add/70">+{format(changes.totalAdded)}</span>{' '}
        <span className="text-diff-del/70">−{format(changes.totalRemoved)}</span>
      </span>
      {reply && (
        <>
          <span className="sr-only">{t('View changes')}</span>
          <ChevronRight size={12} className="shrink-0 opacity-0 transition-opacity duration-200 group-hover/changes:opacity-100 group-focus-visible/changes:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden />
        </>
      )}
    </button>
  )
}
