/**
 * The sender line of a reply that deliveries started: "Halo · Received a
 * message from X ›" — X a teammate, or another conversation (then with the
 * sending AI's one-line summary). The deliveries are the reply's cause, as a
 * user's message is, so they are drawn on it rather than as cards of their own;
 * expanding shows them in full. With no reply after them it is the same line on
 * its own.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import type { Message } from '../../../types'
import { useTranslation } from '../../../i18n'
import { canvasLifecycle } from '../../../services/canvas-lifecycle'
// Direct, not the package index: the line is reached from light views (WorkHistory) that should not load the composer's pieces.
import { useCrossConversationSources } from '../cross-conversation/useCrossConversationSources'
import { clipSubject } from '../process-line'
import { isTeamMessage, readTeamProvenance } from './message-source'
import { CollabQuotes } from './CollabQuotes'

/** Display columns a conversation's title may take in the line; the summary needs the rest. */
const TITLE_COLUMNS = 24

/** A request to show one of the openers, e.g. from a search jump; a new object per request. */
export interface OpenerReveal {
  messageId: string
}

/** One delivery as the sender line lists it, whatever record it came from. */
export interface OpenerItem {
  id: string
  key?: string
  /** Null for system-authored notices. */
  from: string | null
  /** `from` names another conversation, not a teammate. */
  fromConversation?: boolean
  at: number
  content: string
  onOpen?: () => void
}

interface OpenersLineProps {
  senderName?: string
  items: readonly OpenerItem[]
  /** Shown faint after the label, cut to the line: what a single delivery is about. */
  detail?: string
  /** Closes the expanded panel: where to find the delivery elsewhere. */
  footer: ReactNode
  reveal?: OpenerReveal
}

export function OpenersLine({ senderName, items, detail, footer, reveal }: OpenersLineProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(!!reveal)
  useEffect(() => {
    if (reveal) setIsExpanded(true)
  }, [reveal])
  const members = [...new Set(items.flatMap(item => item.from && !item.fromConversation ? [item.from] : []))]
  const conversations = [...new Set(items.flatMap(item => item.fromConversation ? [item.from ?? ''] : []))]

  const label = conversations.length > 0
    ? members.length === 0 && conversations.length === 1
      ? t('Received a message from “{{title}}”', { title: clipSubject(conversations[0], TITLE_COLUMNS).text })
      : t('Received {{count}} messages', { count: items.length })
    : members.length === 0
      ? t('Received a team update')
      : members.length === 1
        ? t('Received a message from {{member}}', { member: members[0] })
        : t('Received messages from {{member}} and {{count}} more', { member: members[0], count: members.length - 1 })

  return (
    <div className="mb-2">
      <div className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
        {senderName && <span className="shrink-0 text-sm font-semibold text-foreground">{senderName}</span>}
        {senderName && <span className="shrink-0 text-faint-foreground">·</span>}
        <button
          onClick={() => setIsExpanded(v => !v)}
          aria-expanded={isExpanded}
          className="group/openers inline-flex min-w-0 items-center gap-1 transition-colors hover:text-foreground"
        >
          <span className={detail ? 'max-w-[60%] shrink-0 truncate' : 'truncate'}>{label}</span>
          {detail && <span className="ml-1 min-w-0 truncate text-muted-foreground/70 transition-colors group-hover/openers:text-muted-foreground">{detail}</span>}
          <ChevronRight size={12} className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </button>
      </div>
      {isExpanded && (
        <CollabQuotes
          quotes={items.map(item => ({ key: item.key ?? item.id, messageId: item.id, label: item.from || t('Team update'), onOpen: item.onOpen, at: item.at, content: item.content }))}
          footer={footer}
        />
      )}
    </div>
  )
}

interface ReplyOpenersProps {
  senderName?: string
  /** Teammates' and other conversations' deliveries, in the order received. */
  openers: readonly Message[]
  reveal?: OpenerReveal
}

export function ReplyOpeners({ senderName, openers, reveal }: ReplyOpenersProps) {
  const { t } = useTranslation()
  const sources = useCrossConversationSources(openers)
  const team = openers.map(readTeamProvenance).find(provenance => provenance !== null)
  const hasTeam = openers.some(isTeamMessage)
  const items = openers.map((message): OpenerItem => {
    const source = sources.get(message.id)
    return {
      id: message.id,
      key: message.clientKey ?? message.id,
      from: source ? source.title : readTeamProvenance(message)?.fromMemberName ?? null,
      ...(source ? { fromConversation: true, onOpen: source.open } : {}),
      at: new Date(message.timestamp).getTime(),
      content: message.content,
    }
  })
  const fromConversations = [...sources.values()]
  const single = openers.length === 1 ? sources.get(openers[0].id) : undefined
  const footer = (
    <>
      {hasTeam && <span className="text-faint-foreground">{t('Sent by a team member, not by you')}</span>}
      {hasTeam && fromConversations.length > 0 && <span className="text-faint-foreground">·</span>}
      {fromConversations.length > 0 && (
        <span className="text-faint-foreground">
          {fromConversations.every(source => source.fromRun)
            ? t('One-way notice from a scheduled run, no reply possible')
            : t("Sent by that conversation's AI, not by you")}
        </span>
      )}
      {team && (
        <button
          onClick={() => void canvasLifecycle.openTeam(team.teamId, team.teamName)}
          className="inline-flex items-center gap-0.5 text-primary hover:underline"
        >
          {t('Open team view')}
          <ArrowUpRight size={11} aria-hidden="true" />
        </button>
      )}
    </>
  )
  return <OpenersLine senderName={senderName} items={items} detail={single?.summary || undefined} footer={footer} reveal={reveal} />
}
