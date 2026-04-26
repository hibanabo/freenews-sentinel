import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import type { Keyword, Alert, MonitorStatus, TopicRunRecord, Brief as BriefRecord, Settings as SettingsType } from './store'
import { setGlobalTimezone } from './utils'
import { useLocale } from './i18n'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Dashboard from './pages/Dashboard'
import Keywords from './pages/Keywords'
import Alerts from './pages/Alerts'
import Brief from './pages/Brief'
import Settings from './pages/Settings'

function AppContent() {
  const {
    currentPage,
    setPage,
    setAlertDetailId,
    addAlert,
    applyKeywordUpdate
  } = useStore()
  const { t } = useLocale()
  const [toast, setToast] = useState<{ id: number; message: string; onClick?: () => void } | null>(null)

  function pushToast(message: string, onClick?: () => void) {
    const id = Date.now()
    setToast({ id, message, onClick })
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current))
    }, 4500)
  }

  // Expose pushToast for use in the mount effect
  const pushToastRef = useRef(pushToast)
  pushToastRef.current = pushToast

  const pages: Record<string, JSX.Element> = {
    dashboard: <Dashboard />,
    keywords:  <Keywords />,
    alerts:    <Alerts />,
    brief:     <Brief />,
    settings:  <Settings />
  }

  const titles: Record<string, [string, string]> = {
    dashboard: [t.page_dashboard, t.page_dashboard_sub],
    keywords:  [t.page_keywords, t.page_keywords_sub],
    alerts:    [t.page_alerts, t.page_alerts_sub],
    brief:     [t.page_brief, t.page_brief_sub],
    settings:  [t.page_settings, t.page_settings_sub]
  }

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <Topbar title={titles[currentPage]?.[0] ?? ''} sub={titles[currentPage]?.[1] ?? ''} />
        <div className="content">
          {pages[currentPage] ?? <Dashboard />}
        </div>
        {toast && (
          <div
            className={`app-toast ${toast.onClick ? 'app-toast-clickable' : ''}`}
            onClick={() => {
              if (toast.onClick) {
                toast.onClick()
                setToast(null)
              }
            }}
          >
            <div className="app-toast-title">{t.toast_title}</div>
            <div className="app-toast-body">{toast.message}</div>
            {toast.onClick && (
              <div className="app-toast-hint">{t.toast_click_hint}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  const {
    setSettings,
    setKeywords,
    setAlerts,
    setBriefs,
    setTopicRuns,
    setStats,
    setMonitorStatus,
    setAlertDetailId,
    setPage,
    applyKeywordUpdate,
    addAlert,
    addTopicRun,
    addBrief
  } = useStore()
  const unsubRef = useRef<(() => void) | null>(null)
  const monitorUnsubRef = useRef<(() => void) | null>(null)
  const topicRunUnsubRef = useRef<(() => void) | null>(null)
  const alertDetailUnsubRef = useRef<(() => void) | null>(null)
  const briefCreatedUnsubRef = useRef<(() => void) | null>(null)

  // Load all data on mount
  useEffect(() => {
    async function loadAll() {
      const [settings, keywords, alerts, briefs, topicRuns, stats, monitorStatus] = await Promise.all([
        window.api.getSettings(),
        window.api.getKeywords(),
        window.api.getAlerts(),
        window.api.getBriefs(),
        window.api.getTopicRuns(),
        window.api.getStats(),
        window.api.getMonitorStatus()
      ])
      const s = settings as SettingsType
      if (s.timezone) setGlobalTimezone(s.timezone)
      document.documentElement.setAttribute('data-theme', s.theme ?? 'dark')
      setSettings(s)
      setKeywords(keywords as Keyword[])
      setAlerts(alerts as Alert[])
      setBriefs(briefs as ReturnType<typeof setBriefs extends (b: infer B) => void ? (b: B) => B : never>)
      setTopicRuns(topicRuns as TopicRunRecord[])
      setStats(stats as ReturnType<typeof setStats extends (s: infer S) => void ? (s: S) => S : never>)
      setMonitorStatus(monitorStatus as MonitorStatus)
    }
    loadAll()

    // Subscribe to real-time updates from monitor
    unsubRef.current = window.api.onMonitoringUpdate((data) => {
      applyKeywordUpdate(data.keyword as Keyword)
      if (data.alert) {
        const alert = data.alert as Alert
        addAlert(alert)
      }
    })

    monitorUnsubRef.current = window.api.onMonitorStateChange((data) => {
      setMonitorStatus(data as MonitorStatus)
    })

    topicRunUnsubRef.current = window.api.onTopicRunRecorded((data) => {
      addTopicRun(data as TopicRunRecord)
    })

    alertDetailUnsubRef.current = window.api.onOpenAlertDetail((data) => {
      const alertId = (data as { alertId?: string }).alertId
      if (!alertId) return
      setPage('alerts')
      setAlertDetailId(alertId)
    })

    briefCreatedUnsubRef.current = window.api.onBriefCreated((data) => {
      const brief = data as BriefRecord
      addBrief(brief)
    })

    return () => {
      unsubRef.current?.()
      monitorUnsubRef.current?.()
      topicRunUnsubRef.current?.()
      alertDetailUnsubRef.current?.()
      briefCreatedUnsubRef.current?.()
    }
  }, [])

  return <AppContent />
}

export default App
