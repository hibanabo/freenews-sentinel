import type { Brief as BriefRecord } from '../store'

declare global {
  interface Window {
    api: {
      getSettings: () => Promise<unknown>
      saveSettings: (s: unknown) => Promise<{ ok: boolean }>
      getKeywords: () => Promise<unknown>
      saveKeyword: (k: unknown) => Promise<{ ok: boolean }>
      deleteKeyword: (id: string) => Promise<{ ok: boolean }>
      toggleKeywordPause: (id: string) => Promise<{ ok: boolean }>
      testTopicQuery: (o: { terms: string[] }) => Promise<unknown>
      getAlerts: () => Promise<unknown>
      getTopicRuns: () => Promise<unknown>
      getNewsDetail: (id: number) => Promise<unknown>
      triggerMockAlert: (level: 'high' | 'medium' | 'low') => Promise<unknown>
      markAlertRead: (id: string) => Promise<{ ok: boolean }>
      markAlertUnread: (id: string) => Promise<{ ok: boolean }>
      markAllAlertsRead: () => Promise<{ ok: boolean }>
      clearAlerts: () => Promise<{ ok: boolean }>
      getBriefs: () => Promise<unknown>
      saveBrief: (b: unknown) => Promise<{ ok: boolean }>
      getStats: () => Promise<unknown>
      getMonitorStatus: () => Promise<unknown>
      startMonitor: () => Promise<unknown>
      stopMonitor: () => Promise<unknown>
      openExternal: (url: string) => Promise<{ ok: boolean }>
      testFreenews: (o: { apiKey: string; baseUrl: string }) => Promise<{
        ok: boolean
        message: string
        quota?: {
          keyName: string
          keyPrefix: string
          status: string
          planName: string
          planDisplayName: string
          callsToday: number
          dailyLimit: number
          dailyRemaining: number
          effectiveRemaining?: number
          callsMonth: number
          monthlyLimit: number
          monthlyRemaining: number
          effectiveLimitScope?: string | null
          lastUsedAt: string | null
          expiresAt: string | null
          nextDailyResetAt: string | null
          nextMonthlyResetAt: string | null
        }
      }>
      testAi: (o: { baseUrl: string; apiKey: string; model: string; providerType?: 'openai' | 'anthropic' }) => Promise<{ ok: boolean; message: string }>
      generateBrief: (o: { topicIds: string[]; dateRange: string }) => Promise<{ ok: boolean; content?: string; message?: string; brief?: BriefRecord }>
      onMonitoringUpdate: (cb: (data: { keyword: unknown; alert?: unknown }) => void) => () => void
      onMonitorStateChange: (cb: (data: unknown) => void) => () => void
      onTopicRunRecorded: (cb: (data: unknown) => void) => () => void
      onOpenAlertDetail: (cb: (data: unknown) => void) => () => void
      onBriefCreated: (cb: (data: unknown) => void) => () => void
    }
  }
}

export {}
