/**
 * Reminders a digital human set in a conversation, drawn as a team's periodic checks are
 * in a team conversation (see chat/StandingWork) under their own name: a mark after the
 * recipient in the composer's toolbar that opens them, and the quiet line each coming-due's reply becomes. A reminder
 * is the digital human's own, set by asking it, and stopped here or from its page.
 */

import { Timer } from 'lucide-react'
import type { ConversationReminderView } from '../../../shared/apps/conversation-reminders'
import { getCurrentLanguage, useTranslation } from '../../i18n'
import { useEffect, useRef } from 'react'
import { useAppRemindersStore, useConversationReminders } from '../../stores/app-reminders.store'
import { useChatStore } from '../../stores/chat.store'
import { formatStandingTime, StandingRunLine, StandingWorkPopover, type StandingItem } from '../chat/StandingWork'
import { formatCronHumanReadable, formatFrequency } from './schedule-utils'
import type { Message } from '../../types'

/**
 * Read a digital human's reminders again each time a turn of `conversationId` ends: the
 * turn is where one was set, cancelled or came due. For the open conversation only.
 */
function useRemindersAfterTurns(appId: string | null | undefined, conversationId: string | null | undefined): void {
  const generating = useChatStore(state => !!conversationId && state.getSession(conversationId).isGenerating)
  const was = useRef(generating)
  useEffect(() => {
    if (was.current && !generating && appId) void useAppRemindersStore.getState().load(appId)
    was.current = generating
  }, [generating, appId])
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export function reminderRhythm(reminder: ConversationReminderView, t: Translate): string {
  const { schedule } = reminder
  if (schedule.kind === 'once') return t('Once')
  return schedule.kind === 'every' ? formatFrequency(schedule.every, t) : formatCronHumanReadable(schedule.cron, getCurrentLanguage())
}

/**
 * This conversation's reminders, as the mark a team conversation carries in its member rail.
 * A digital human's chat has no rail; the mark follows the digital human it belongs to in the
 * composer's toolbar, so the recipient keeps its place whether or not there are reminders. Absent when there are none.
 */
export function ConversationRemindersMark({ appId, conversationId }: { appId: string; conversationId: string }) {
  const { t } = useTranslation()
  const reminders = useConversationReminders(appId, conversationId)
  useRemindersAfterTurns(appId, conversationId)
  const cancel = useAppRemindersStore(state => state.cancel)
  if (reminders.length === 0) return null
  const items: StandingItem[] = reminders.map(reminder => ({
    id: reminder.id,
    meta: [reminderRhythm(reminder, t), ...(reminder.setBy ? [t('asked by {{name}}', { name: reminder.setBy })] : [])].join(' · '),
    text: reminder.message,
    stats: reminder.nextAt !== null ? t('Next {{time}}', { time: formatStandingTime(reminder.nextAt) }) : '',
  }))
  return <StandingWorkPopover title={t('Reminders')} subtitle={t('Each comes back to this conversation when it is due')}
    items={items} side="top" align="start" label={t('Reminders: {{n}}', { n: reminders.length })}
    triggerClassName={open => `h-8 cursor-pointer items-center gap-1 rounded-sm px-2.5 text-xs font-medium tabular-nums transition-colors ease-halo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${open ? 'bg-surface-hover text-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
    onStop={id => void cancel(appId, id)}
    stopTitle={t('Stop this reminder?')} stopMessage={t('It will not come back to this conversation again. To have it again, ask the digital human.')}>
    <Timer size={13} strokeWidth={1.8} aria-hidden="true" className="shrink-0" />
    <span>{reminders.length}</span>
  </StandingWorkPopover>
}

/** The reply a reminder's coming-due drew from the digital human, as the run line a team check's reply is. */
export function ReminderRunLine({ message }: { message: Message }) {
  const { t } = useTranslation()
  return <StandingRunLine message={message} label={t('Reminder')} />
}
