/**
 * The owner's words waiting behind a member's turn that serves someone else.
 *
 * A turn a colleague (or an IM guest) asked for never takes the owner's
 * additions — it runs on what was granted to them and reports back to them.
 * What the owner sends meanwhile is their own next message instead: it waits
 * in the runtime's mailbox and opens a turn of its own once that one ends.
 * This shows it waiting, says why, and lets the owner take it back before the
 * member reads it.
 *
 * Kept per conversation outside the component: the member panel is remounted
 * per member, and a message still waits while someone else is looked at.
 */

import { useCallback, useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { api } from '../../api'
import { useTranslation } from '../../i18n'
import type { Message } from '../../types'

export type TurnServesOther = 'colleague' | 'guest'

export interface WaitingMessage {
  key: string
  content: string
  /** When it was sent; the record its own turn writes is never older. */
  at: number
  servesOther?: TurnServesOther
}

const kept = new Map<string, WaitingMessage[]>()
/** A record written this long before the send still counts as its own (clock skew). */
const RECORD_SLACK_MS = 2000

/** Waiting messages whose own turn has not written them into the transcript yet. */
export function stillWaiting(waiting: readonly WaitingMessage[], messages: readonly Message[]): WaitingMessage[] {
  const recorded = messages.filter(message => message.role === 'user')
  const left = [...recorded]
  return waiting.filter(item => {
    const index = left.findIndex(message => (message.content ?? '').trim() === item.content.trim()
      && Date.parse(message.timestamp) >= item.at - RECORD_SLACK_MS)
    if (index < 0) return true
    left.splice(index, 1)
    return false
  })
}

export function useWaitingAfterTurn({ appId, conversationId, messages, isGenerating, enabled }: {
  appId: string
  conversationId: string
  messages: readonly Message[]
  isGenerating: boolean
  /** A locally run session with a conversation to send into. */
  enabled: boolean
}) {
  const [waiting, setWaitingState] = useState<WaitingMessage[]>(() => kept.get(conversationId) ?? [])
  const [servesOther, setServesOther] = useState<TurnServesOther | undefined>()

  const setWaiting = useCallback((update: (prev: WaitingMessage[]) => WaitingMessage[]) => {
    setWaitingState(prev => {
      const next = update(prev)
      if (next.length) kept.set(conversationId, next)
      else kept.delete(conversationId)
      return next
    })
  }, [conversationId])

  useEffect(() => { setWaitingState(kept.get(conversationId) ?? []) }, [conversationId])

  // Gone from here once its own turn has recorded it.
  useEffect(() => {
    setWaiting(prev => {
      if (prev.length === 0) return prev
      const next = stillWaiting(prev, messages)
      return next.length === prev.length ? prev : next
    })
  }, [messages, setWaiting])

  // Whose request the running turn serves, so the composer can say so before anything is typed.
  useEffect(() => {
    if (!enabled || !isGenerating) {
      setServesOther(undefined)
      return
    }
    let cancelled = false
    const read = () => {
      void api.appChatStatus(appId, conversationId).then(response => {
        if (!cancelled && response.success) setServesOther(response.data?.isGenerating ? response.data.servesOther : undefined)
      }).catch(() => {})
    }
    read()
    // The identity is stamped as the turn starts, and the next turn may serve someone else.
    const timer = setInterval(read, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [appId, conversationId, enabled, isGenerating])

  const add = useCallback((content: string, serves?: TurnServesOther): WaitingMessage => {
    const item: WaitingMessage = { key: `waiting-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, content, at: Date.now(), servesOther: serves }
    if (serves) setServesOther(serves)
    setWaiting(prev => [...prev, item])
    return item
  }, [setWaiting])

  const remove = useCallback((key: string) => {
    setWaiting(prev => prev.filter(item => item.key !== key))
  }, [setWaiting])

  /** False when it was no longer waiting: its turn had begun. */
  const withdraw = useCallback(async (item: WaitingMessage): Promise<boolean> => {
    const response = await api.appChatWithdraw({ appId, conversationId, message: item.content })
    if (!response.success || !response.data?.withdrawn) return false
    remove(item.key)
    return true
  }, [appId, conversationId, remove])

  return { waiting, servesOther, add, remove, withdraw }
}

export function WaitingAfterTurnPanel({ waiting, onWithdraw }: {
  waiting: readonly WaitingMessage[]
  onWithdraw: (item: WaitingMessage) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [late, setLate] = useState<string | null>(null)
  if (waiting.length === 0) return null
  const serves = waiting.find(item => item.servesOther)?.servesOther
  return (
    // The same quiet surface as the queued additions it stands in for.
    <div className="mt-2 rounded-lg border border-border-soft bg-card px-3.5 py-2">
      <div className="mb-1 flex select-none items-center gap-1.5 text-xs text-faint-foreground">
        <Clock className="h-3 w-3" />
        <span>{t('After this turn')}</span>
      </div>
      <div className="space-y-0.5">
        {waiting.map(item => (
          <div key={item.key} className="group/waiting flex items-start gap-1.5 text-xs text-subtle-foreground">
            <span className="mt-px shrink-0 select-none">↳</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.content}</span>
            {late !== item.key && <button
              type="button"
              onClick={() => {
                setLate(null)
                void onWithdraw(item).then(taken => { if (!taken) setLate(item.key) })
              }}
              className="shrink-0 rounded px-1 text-faint-foreground transition-colors ease-halo hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('Withdraw')}
            </button>}
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] leading-4 text-faint-foreground">
        {late && waiting.some(item => item.key === late)
          ? t('Already being handled — it can no longer be withdrawn')
          : serves === 'guest'
            ? t('It is working on a guest’s request; this won’t be added to it')
            : t('It is working on a colleague’s request; this won’t be added to it')}
      </p>
    </div>
  )
}
