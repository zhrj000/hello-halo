import type { Message } from '../../../types'
import type { TeamActivity } from '../../../../shared/apps/team-types'
import { useTranslation } from '../../../i18n'
import { StandingRunLine } from '../../chat/StandingWork'
import { ReportCard } from './ReportCard'

/**
 * What the member said when a periodic check woke it, as one quiet line in the
 * conversation (see StandingRunLine). Its report, when it made one, is what the line is
 * about; opening it shows the report and its closing words. The live state of the check
 * is the mark in the member rail, not these lines.
 */
export function CheckRunLine({ message, reports = [] }: { message: Message; reports?: readonly TeamActivity[] }) {
  const { t } = useTranslation()
  const text = message.content.trim()
  if (!reports.length) return <StandingRunLine message={message} label={t('Periodic check')} />
  return <StandingRunLine message={message} label={t('Periodic check')} subject={(reports[0].subject || reports[0].body || '').trim()}
    detail={<>
      {reports.map(report => <ReportCard key={report.id} activity={report} />)}
      {text && <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-[1.7] text-foreground/[0.88]">{text}</p>}
    </>} />
}
