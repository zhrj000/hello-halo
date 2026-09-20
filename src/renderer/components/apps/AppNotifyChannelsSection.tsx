/**
 * AppNotifyChannelsSection
 *
 * Read-only overview of which external notification channels are configured,
 * linking out to the global settings that own them. Contacts moved to
 * AppContactsList, which nests under the bot that produced them.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Mail, MessageSquare, Bell, Webhook,
  ExternalLink, Users, User, Pencil, Trash2, Copy, Check, Search,
  AlertTriangle, Info,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../api'
import type { HaloConfig } from '../../types'
import type {
  NotificationChannelsConfig,
} from '../../../shared/types/notification-channels'
import { NOTIFICATION_CHANNEL_META } from '../../../shared/types/notification-channels'
import type { ImSessionRecord, ImChannelInstanceStatus } from '../../../shared/types/im-channel'
import { getImSessionDisplayName } from '../../../shared/types/im-channel'

// ============================================
// Types
// ============================================

// ============================================
// Channel Display Config
// ============================================

interface ChannelDisplayInfo {
  id: string
  icon: typeof Mail
  labelKey: string
}

const NOTIFICATION_CHANNELS: ChannelDisplayInfo[] = [
  { id: 'email', icon: Mail, labelKey: NOTIFICATION_CHANNEL_META.email.labelKey },
  { id: 'wecom', icon: MessageSquare, labelKey: NOTIFICATION_CHANNEL_META.wecom.labelKey },
  { id: 'dingtalk', icon: Bell, labelKey: NOTIFICATION_CHANNEL_META.dingtalk.labelKey },
  { id: 'feishu', icon: MessageSquare, labelKey: NOTIFICATION_CHANNEL_META.feishu.labelKey },
  { id: 'webhook', icon: Webhook, labelKey: NOTIFICATION_CHANNEL_META.webhook.labelKey },
]

const IM_CHANNEL_DISPLAY: Record<string, { label: string; color: string }> = {
  'wecom-bot': { label: 'WeCom', color: 'text-green-500' },
  'feishu-bot': { label: 'Feishu', color: 'text-blue-500' },
  'dingtalk-bot': { label: 'DingTalk', color: 'text-indigo-500' },
  'weixin-ilink-bot': { label: 'WeChat iLink', color: 'text-green-600' },
}

function getImChannelDisplay(channel: string) {
  return IM_CHANNEL_DISPLAY[channel] ?? { label: channel, color: 'text-muted-foreground' }
}

/**
 * WeCom's own documentation for the "message" permission capability — the
 * exact page explaining how to authorize it and copy the URL this feature
 * needs. Not a Halo-authored guide (this feature has none yet), but the
 * authoritative source for the steps involved.
 */
const IM_NAME_RESOLUTION_DOC_URL = 'https://developer.work.weixin.qq.com/document/path/101764'

/** LocalStorage-backed dismiss flag. Permanent until localStorage is cleared — matches "not a required setup step, don't keep asking". */
function useDismissedFlag(key: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(key, '1')
    } catch {
      // Ignore — worst case the banner reappears next session
    }
    setDismissed(true)
  }, [key])
  return [dismissed, dismiss]
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) return '1d ago'
  if (diffDays < 30) return `${diffDays}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ============================================
// Channel Overview (read-only)
// ============================================

function ChannelOverview() {
  const { t } = useTranslation()
  const { navigate } = useAppStore()
  const [config, setConfig] = useState<HaloConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getConfig().then((res: any) => {
      if (!cancelled && res.success && res.data) setConfig(res.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const channels = config?.notificationChannels as NotificationChannelsConfig | undefined

  const handleGoToSettings = useCallback(() => {
    navigate('settings')
    setTimeout(() => {
      const el = document.getElementById('message-channels')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [navigate])

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t('AI-driven: the digital human decides when and what to notify via configured channels.')}
      </p>
      <div className="bg-secondary/40 rounded-lg space-y-1 p-1">
        {NOTIFICATION_CHANNELS.map((ch) => {
          const Icon = ch.icon
          const channelConfig = channels?.[ch.id as keyof NotificationChannelsConfig] as { enabled?: boolean } | undefined
          const configured = Boolean(channelConfig?.enabled)

          return (
            <div
              key={ch.id}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md"
            >
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${configured ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
              <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${configured ? 'text-muted-foreground' : 'text-muted-foreground/40'}`} />
              <span className={`text-sm flex-1 ${configured ? 'text-foreground' : 'text-muted-foreground/60'}`}>
                {t(ch.labelKey)}
              </span>
              <span className={`text-xs ${configured ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground/50'}`}>
                {configured ? t('Configured') : t('Not configured')}
              </span>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={handleGoToSettings}
        className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
      >
        {t('Configure channels in Settings')}
        <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  )
}

export function AppNotifyChannelsSection() {
  return <ChannelOverview />
}
