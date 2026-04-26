import { useStore } from '../store'
import { useLocale } from '../i18n'

export default function Sidebar() {
  const { currentPage, setPage, stats, monitorStatus, settings } = useStore()
  const { t } = useLocale()

  const NAV = [
    { group: t.nav_monitor, items: [
      { id: 'dashboard', icon: '◉', label: t.nav_dashboard },
      { id: 'keywords',  icon: '🔑', label: t.nav_keywords },
      { id: 'alerts',    icon: '🔔', label: t.nav_alerts, badge: 'unread' as const }
    ]},
    { group: t.nav_system, items: [
      { id: 'settings', icon: '⚙', label: t.nav_settings }
    ]}
  ]

  const getBadge = (badge?: string) => {
    if (badge === 'alerts') return stats.todayAlerts > 0 ? stats.todayAlerts : null
    if (badge === 'unread') return stats.unreadAlerts > 0 ? stats.unreadAlerts : null
    return null
  }

  const statusText =
    !settings.freenewsApiKey
      ? t.status_waiting_key
      : monitorStatus.running
        ? t.status_running
        : monitorStatus.message || t.status_not_started

  const statusClass =
    !settings.freenewsApiKey
      ? 'pulse-amber'
      : monitorStatus.running
        ? 'pulse-green'
        : 'pulse-gray'

  return (
    <nav className="sidebar">
      <div className="logo">
        <div className="logo-mark">
          <div className="logo-icon">📡</div>
          <div>
            <div className="logo-name">FreeNews</div>
            <div className="logo-sub">Sentinel</div>
          </div>
        </div>
      </div>

      <div className="nav">
        {NAV.map((group) => (
          <div className="nav-group" key={group.group}>
            <span className="nav-label">{group.group}</span>
            {group.items.map((item) => {
              const badge = getBadge(item.badge)
              return (
                <div
                  key={item.id}
                  className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                  onClick={() => setPage(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-text">{item.label}</span>
                  {badge !== null && <span className="nav-badge">{badge}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="status-row">
          <div className={`pulse-dot ${statusClass}`} />
          <span>{statusText}</span>
        </div>
      </div>
    </nav>
  )
}
