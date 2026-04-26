import { useStore, Keyword, TopicRunRecord, TopicRunArticle } from '../store'
import { FREENEWS_SITE_URL } from '../constants'
import { relativeTime, shortTime, sentimentColor, sentimentLocalized, importanceTier } from '../utils'
import { useLocale, pickField, pickArrayField } from '../i18n'

function statusBadge(status: string, t: Record<string, string>) {
  const map: Record<string, { cls: string; label: string }> = {
    normal:  { cls: 'badge-green',  label: t.badge_normal_icon },
    warning: { cls: 'badge-orange', label: t.badge_warning_icon },
    alert:   { cls: 'badge-red',    label: t.badge_alert_icon },
    paused:  { cls: 'badge-gray',   label: t.badge_paused_icon }
  }
  return map[status] ?? map.normal
}

function severityIcon(sev: string) {
  return sev === 'high' ? '🔴' : sev === 'medium' ? '🟡' : '🟢'
}

const CHART_HEIGHTS = [42, 65, 55, 80, 70, 90, 100, 75, 85, 60, 95, 78]
const RISK_THRESHOLD = 0.35

interface RiskArticle extends TopicRunArticle {
  _groupName: string
  _checkedAt: string
}

function buildRiskArticles(topicRuns: TopicRunRecord[], limit: number): RiskArticle[] {
  const articles: RiskArticle[] = []
  const seen = new Set<number>()
  for (const run of topicRuns) {
    for (const a of run.recentArticles ?? []) {
      if (seen.has(a.id)) continue
      if (a.sentimentScore !== null && a.sentimentScore < RISK_THRESHOLD) {
        seen.add(a.id)
        articles.push({ ...a, _groupName: run.groupName, _checkedAt: run.checkedAt })
      }
    }
  }
  return articles
    .sort((a, b) =>
      new Date(b.publishedAt ?? b._checkedAt).getTime() -
      new Date(a.publishedAt ?? a._checkedAt).getTime()
    )
    .slice(0, limit)
}

interface TopicStatusRow {
  id: string
  name: string
  status: Keyword['status']
  keywordCount: number
  lastChecked: string | null
  latestArticleTitle: string | null
  latestArticleTitleEn: string | null
  latestArticleSource: string | null
  latestReason: string | null
}

function getGroupStatus(keywords: Keyword[]): Keyword['status'] {
  if (keywords.length > 0 && keywords.every((keyword) => keyword.status === 'paused')) return 'paused'
  if (keywords.some((keyword) => keyword.status === 'alert')) return 'alert'
  if (keywords.some((keyword) => keyword.status === 'warning')) return 'warning'
  return 'normal'
}

function buildTopicRows(keywords: Keyword[], topicRuns: TopicRunRecord[]): TopicStatusRow[] {
  const groups = new Map<string, Keyword[]>()

  for (const keyword of keywords) {
    const groupId = keyword.groupId ?? keyword.id
    const current = groups.get(groupId) ?? []
    current.push(keyword)
    groups.set(groupId, current)
  }

  return Array.from(groups.entries())
    .map(([groupId, groupKeywords]) => {
      const orderedRuns = topicRuns
        .filter((run) => run.groupId === groupId)
        .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())

      const latestKeyword =
        [...groupKeywords].sort(
          (a, b) => new Date(b.lastChecked ?? 0).getTime() - new Date(a.lastChecked ?? 0).getTime()
        )[0] ?? groupKeywords[0]

      const latestRun = orderedRuns[0]

      return {
        id: groupId,
        name: groupKeywords[0].groupName?.trim() || groupKeywords[0].name,
        status: getGroupStatus(groupKeywords),
        keywordCount: groupKeywords.length,
        lastChecked: latestRun?.checkedAt ?? latestKeyword.lastChecked,
        latestArticleTitle: latestRun?.latestArticleTitle ?? latestKeyword.latestArticleTitle,
        latestArticleTitleEn: latestRun?.latestArticleTitleEn ?? latestKeyword.latestArticleTitleEn ?? null,
        latestArticleSource: latestRun?.latestArticleSource ?? latestKeyword.latestArticleSource,
        latestReason: latestRun?.reason ?? null
      }
    })
    .sort((a, b) => new Date(b.lastChecked ?? 0).getTime() - new Date(a.lastChecked ?? 0).getTime())
}

export default function Dashboard() {
  const { stats, keywords, alerts, settings, setPage, setAlertDetailId, monitorStatus, topicRuns } = useStore()
  const { t, lang } = useLocale()
  const recentAlerts = alerts.slice(0, 6)
  const topicRows = buildTopicRows(keywords, topicRuns)
  const riskArticles = buildRiskArticles(topicRuns, 8)
  const activeTopicCount = topicRows.filter((topic) => topic.status !== 'paused').length
  const setupSteps = [
    {
      id: 'api',
      title: t.dash_step_connect,
      desc: settings.freenewsApiKey ? t.dash_step_connect_done : t.dash_step_connect_todo,
      done: Boolean(settings.freenewsApiKey),
      actionLabel: settings.freenewsApiKey ? t.dash_view_settings : t.btn_open_site,
      onClick: () => {
        if (settings.freenewsApiKey) {
          setPage('settings')
          return
        }
        void window.api.openExternal(FREENEWS_SITE_URL)
      }
    },
    {
      id: 'keywords',
      title: t.dash_step_topic,
      desc: keywords.length > 0
        ? t.dash_step_topic_done.replace('{n}', String(keywords.length))
        : t.dash_step_topic_todo,
      done: keywords.length > 0,
      actionLabel: keywords.length > 0 ? t.dash_view_topics : t.dash_create_now,
      onClick: () => setPage('keywords')
    }
  ]
  const completedSteps = setupSteps.filter((step) => step.done).length
  const progressPercent = Math.round((completedSteps / setupSteps.length) * 100)
  const nextPendingStep = setupSteps.find((step) => !step.done)
  const showOnboarding = completedSteps < setupSteps.length
  const dashboardStatusLabel = !settings.freenewsApiKey
    ? t.top_not_configured
    : monitorStatus.running
      ? t.status_running
      : monitorStatus.message

  return (
    <>
      {showOnboarding && (
        <div className="hero-card">
          <div className="hero-content">
            <div className="hero-header">
              <div>
                <div className="hero-eyebrow">{t.dash_setup_panel}</div>
                <div className="hero-title">{t.dash_setup_title}</div>
              </div>
              <div className="hero-status-chip">
                <strong>{completedSteps}/{setupSteps.length}</strong>
                <span>{t.dash_completed}</span>
              </div>
            </div>
          <div className="hero-sub">{t.dash_setup_desc}</div>
            <div className="hero-progress">
              <div className="hero-progress-head">
                <span>{t.dash_setup_progress}</span>
                <strong>{progressPercent}%</strong>
              </div>
              <div className="hero-progress-bar">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            <div className="hero-panels">
              <div className="hero-panel">
                <div className="hero-panel-title">{t.dash_next_step}</div>
                <div className="hero-setup-list">
                  {setupSteps.map((step, index) => (
                    <div
                      key={step.id}
                      className={`hero-setup-item ${step.done ? 'done' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={step.onClick}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          step.onClick()
                        }
                      }}
                    >
                      <div className="hero-setup-index">{step.done ? '✓' : index + 1}</div>
                      <div className="hero-setup-copy">
                        <div className="hero-setup-head">
                          <strong>{step.title}</strong>
                          {!step.done && nextPendingStep?.id === step.id && (
                            <span className="hero-setup-tag">{t.dash_next_step}</span>
                          )}
                        </div>
                        <span>{step.desc}</span>
                      </div>
                      <div className="hero-setup-action">{step.actionLabel} ›</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hero-panel hero-panel-subtle">
                <div className="hero-panel-title">{t.dash_when_ready}</div>
                <div className="hero-feature-list">
                  <div className="hero-feature-item">
                    <strong>{t.dash_feature_news}</strong>
                    <span>{t.dash_feature_news_desc}</span>
                  </div>
                  <div className="hero-feature-item">
                    <strong>{t.dash_feature_alerts}</strong>
                    <span>{t.dash_feature_alerts_desc}</span>
                  </div>
                  <div className="hero-feature-item">
                    <strong>{t.dash_feature_zh}</strong>
                    <span>{t.dash_feature_zh_desc}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => setPage('settings')}>
                {t.btn_configure}
              </button>
              <button className="btn" onClick={() => window.api.openExternal(FREENEWS_SITE_URL)}>
                {t.btn_open_site}
              </button>
            </div>
          </div>
          <div className="hero-side">
            <div className="hero-side-card hero-side-highlight">
              <div className="hero-side-label">{t.dash_current_status}</div>
              <div className="hero-side-value">{dashboardStatusLabel}</div>
              <div className="hero-side-note">
                {nextPendingStep
                  ? `${t.dash_next_step_prefix}${nextPendingStep.title}`
                  : t.dash_setup_complete}
              </div>
            </div>
            <div className="hero-side-card">
              <div className="hero-panel-title">{t.dash_environment}</div>
              <div className="hero-side-list">
                <div>
                  <span>FreeNews</span>
                  <strong>{settings.freenewsBaseUrl.replace(/^https?:\/\//, '')}</strong>
                </div>
                <div>
                  <span>{t.dash_fetch_per_cycle}</span>
                  <strong>{settings.monitorFetchLimit} {t.dash_items}</strong>
                </div>
                <div>
                  <span>{t.dash_check_interval}</span>
                  <strong>{settings.checkInterval} {t.dash_minutes}</strong>
                </div>
              </div>
            </div>
            <div className="hero-side-grid">
              <div className="hero-metric">
                <strong>{topicRows.length}</strong>
                <span>{t.dash_current_topics}</span>
              </div>
              <div className="hero-metric">
                <strong>{monitorStatus.running ? 'ON' : 'OFF'}</strong>
                <span>{t.dash_monitor_status}</span>
              </div>
              <div className="hero-metric">
                <strong>{stats.unreadAlerts}</strong>
                <span>{t.dash_unread_alerts}</span>
              </div>
              <div className="hero-metric">
                <strong>{settings.monitorFetchLimit}</strong>
                <span>{t.dash_max_fetch}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid-4">
        <div className="card stat-card">
          <div className="stat-glow" style={{ background: 'var(--accent)' }} />
          <div className="stat-label">{t.dash_stat_topics}</div>
          <div className="stat-value" style={{ color: '#93c5fd' }}>{topicRows.length}</div>
          <div className="stat-delta">{t.dash_stat_active.replace('{n}', String(activeTopicCount))}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-glow" style={{ background: 'var(--green)' }} />
          <div className="stat-label">{t.dash_stat_today_news}</div>
          <div className="stat-value" style={{ color: 'var(--green)' }}>
            {stats.todayNews.toLocaleString()}
          </div>
          <div className="stat-delta">{t.dash_stat_from_sources}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-glow" style={{ background: 'var(--red)' }} />
          <div className="stat-label">{t.dash_stat_today_alerts}</div>
          <div className="stat-value" style={{ color: 'var(--red)' }}>{stats.todayAlerts}</div>
          <div className="stat-delta">
            {t.dash_stat_unread.replace('{n}', String(stats.unreadAlerts))}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-glow" style={{ background: 'var(--amber)' }} />
          <div className="stat-label">{t.dash_stat_fetch_limit}</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>{settings.monitorFetchLimit}</div>
          <div className="stat-delta">{t.dash_stat_max_check}</div>
        </div>
      </div>

      {/* Topic status */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-title">
          {t.dash_topic_status}
          <span className="card-title-extra">{t.dash_n_topics.replace('{n}', String(topicRows.length))}</span>
        </div>
        {topicRows.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🔑</div>
            <p>{t.dash_no_topics}<br />{t.dash_no_topics_hint}</p>
          </div>
        ) : (
          topicRows.map((topic) => {
            const { cls, label } = statusBadge(topic.status, t)
            return (
              <div
                className="kw-row kw-row-clickable"
                key={topic.id}
                onClick={() => setPage('keywords')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPage('keywords') } }}
              >
                <div className="kw-name">{topic.name}</div>
                <span className={`badge ${cls}`}>{label}</span>
                <div className="kw-news">
                  <span style={{ color: 'var(--text-3)', marginRight: 6 }}>
                    {t.dash_n_keywords.replace('{n}', String(topic.keywordCount))}
                  </span>
                  {topic.latestArticleSource && (
                    <span style={{ color: 'var(--text-3)', marginRight: 4 }}>
                      {topic.latestArticleSource}:
                    </span>
                  )}
                  {pickField(lang, topic.latestArticleTitle, topic.latestArticleTitleEn, topic.latestArticleTitle ?? topic.latestReason ?? t.dash_no_data)}
                </div>
                <div className="kw-time">
                  {topic.lastChecked ? relativeTime(topic.lastChecked) : t.no_data}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="grid-2-right">
        {/* Risk feed */}
        <div className="card">
          <div className="card-title">
            {t.dash_risk_news}
            <span className="card-title-extra">{t.dash_risk_threshold.replace('{n}', String(RISK_THRESHOLD))}</span>
          </div>
          {riskArticles.length === 0 ? (
            <div className="empty" style={{ padding: '24px 0' }}>
              <div className="empty-icon">🟢</div>
              <p>{t.dash_no_risk}</p>
            </div>
          ) : (
            <div className="risk-feed-list">
              {riskArticles.map((a) => (
                <div
                  className="risk-feed-item dash-risk-item"
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void window.api.openExternal(a.url)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void window.api.openExternal(a.url) }}
                >
                  <div className="risk-feed-main">
                    <div className="dash-risk-topic-row">
                      <span className="dash-risk-topic">{a._groupName}</span>
                    </div>
                    <div className="risk-feed-title">{pickField(lang, a.titleZh, a.titleEn, a.title)}</div>
                    {pickField(lang, a.summaryZh, a.summaryEn, a.summary ?? '') && (
                      <div className="risk-feed-summary">{pickField(lang, a.summaryZh, a.summaryEn, a.summary ?? '')}</div>
                    )}
                    <div className="risk-feed-meta">
                      <span>{a.sourceName}</span>
                      <span>{shortTime(a.publishedAt ?? a._checkedAt)}</span>
                      {importanceTier(a.importanceScore) && (
                        <span
                          className={`importance-pill ${importanceTier(a.importanceScore)}`}
                          title={t.alert_importance}
                        >
                          ★ {a.importanceScore}
                        </span>
                      )}
                      {pickArrayField(lang, a.keywordsZh, a.keywordsEn).slice(0, 3).map((kw) => (
                        <span key={kw} className="risk-feed-tag">{kw}</span>
                      ))}
                    </div>
                  </div>
                  <div className="risk-feed-score" style={{ color: sentimentColor(a.sentimentScore ?? 0.5) }}>
                    <strong>{a.sentimentScore?.toFixed(2) ?? t.no_data}</strong>
                    <span>{sentimentLocalized(a.sentimentLabel, lang)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent alerts + chart */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ flex: 1 }}>
            <div className="card-title">{t.dash_recent_alerts}</div>
            {recentAlerts.length === 0 ? (
              <div className="empty" style={{ padding: '24px 0' }}>
                <div className="empty-icon">🟢</div>
                <p>{t.dash_no_alerts}</p>
              </div>
            ) : (
              recentAlerts.map((a) => (
                <div
                  className="alert-mini alert-mini-clickable"
                  key={a.id}
                  onClick={() => { setPage('alerts'); setAlertDetailId(a.id) }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPage('alerts'); setAlertDetailId(a.id) } }}
                >
                  <div className="alert-mini-sev">{severityIcon(a.severity)}</div>
                  <div className="alert-mini-body">
                    <div className="alert-mini-kw">{a.keywordName}</div>
                    <div className="alert-mini-reason">{pickField(lang, a.reason, a.reasonEn, a.reason)}</div>
                  </div>
                  <div className="alert-mini-time">{relativeTime(a.timestamp)}</div>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <div className="card-title">{t.dash_news_volume}</div>
            <div className="mini-chart">
              {CHART_HEIGHTS.map((h, i) => (
                <div key={i} className="mc-bar" style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="chart-labels">
              <span>00:00</span>
              <span>12:00</span>
              <span>{t.dash_now}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
