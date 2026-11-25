import { api } from '../../api'
import i18n from '../../i18n'

/**
 * Team transcripts live outside the board chat backend; use their app-chat entry directly.
 *
 * `sendAfterTurn` sends the text as a new message when no turn was there to
 * take it. `waitBehindTurn` is for a turn serving someone else (a colleague's
 * or a guest's request), which never takes the owner's words: the text is
 * sent as the owner's next message, waiting for that turn to end. Without it
 * that case falls back to `sendAfterTurn`, which waits the same way.
 */
export async function injectTeamSessionMessage(
  input: Parameters<typeof api.appChatInject>[0],
  sendAfterTurn: () => Promise<boolean>,
  waitBehindTurn?: (servesOther: 'colleague' | 'guest' | undefined) => Promise<boolean>
): Promise<boolean> {
  const response = await api.appChatInject(input)
  if (!response.success) throw new Error(response.error || i18n.t('Failed to add message'))
  if (response.data?.delivered !== false) return true
  if (response.data.stopped) return false
  if (response.data.afterTurn && waitBehindTurn) return waitBehindTurn(response.data.servesOther)
  return sendAfterTurn()
}
