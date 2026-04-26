import { useEffect, useMemo, useState } from 'react'
import { useStore, Alert } from '../store'
import { shortTime, sentimentColor, sentimentLocalized, importanceTier, dateKeyInUserTz } from '../utils'
import { useLocale, pickField, pickArrayField } from '../i18n'

const PAGE_SIZE = 10

function severityIcon(severity: Alert['severity']) {
  return severity === 'high' ? '🔴' : severity === 'medium' ? '🟡' : '🟢'
}

function formatTime(iso: string, t: Record<string, string>) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  // Compare calendar days in the user-selected timezone, not the machine local zone.
  // 使用用户选择的时区做"今天/昨天"判断，避免机器本地时区与选定时区不一致时误判。
  const dateKey = dateKeyInUserTz(date)
  const now = new Date()
  const todayKey = dateKeyInUserTz(now)
  const yesterdayKey = dateKeyInUserTz(new Date(now.getTime() - 24 * 60 * 60 * 1000))

  const timeStr = shortTime(iso).split(' ')[1] ?? ''
  if (dateKey === todayKey) {
    return `${t.alert_today} ${timeStr}`
  }
  if (dateKey === yesterdayKey) {
    return `${t.alert_yesterday} ${timeStr}`
  }
  return shortTime(iso)
}

function toUnitScore(value: number | null, legacySigned = false) {
  if (value === null || value === undefined) return null
  const normalized = Number(value)
  if (Number.isNaN(normalized)) return null
  if (!Number.isFinite(normalized)) return null

  const source = legacySigned ? Math.abs(normalized) : normalized
  if (source <= 1) return Math.max(0, source)
  if (source <= 10) return source / 10
  return 1
}

function impactText(value: number | null) {
  if (value === null || value === undefined) return '—'
  const normalized = toUnitScore(value, true)
  if (normalized === null) return '—'
  return normalized.toFixed(2)
}

function relevanceText(value: number | null) {
  if (value === null || value === undefined) return '—'
  const normalized = toUnitScore(value)
  if (normalized === null) return '—'
  return normalized.toFixed(2)
}

function signedScore(value: number | null) {
  if (value === null || value === undefined) return ''
  return value.toFixed(2)
}

function cleanReason(text: string) {
  return text.replace(/^\[AI\]\s*/i, '').trim()
}

export default function Alerts() {
  const {
    alerts,
    keywords,
    setAlerts,
    updateAlertReadState,
    markAllAlertsRead,
    alertDetailId,
    setAlertDetailId
  } = useStore()
  const { t, lang } = useLocale()

  const [filterKw, setFilterKw] = useState('')
  const [filterSev, setFilterSev] = useState('')
  const [filterRead, setFilterRead] = useState<'all' | 'unread' | 'read'>('all')
  const [page, setPage] = useState(1)

  const unreadCount = alerts.filter((alert) => !alert.read).length

  const groupOptions = Array.from(
    new Map(
      keywords.map((keyword) => [
        keyword.groupId ?? keyword.id,
        keyword.groupName?.trim() || keyword.name
      ])
    ).entries()
  )

  const selectedAlert = useMemo(
    () => alerts.find((alert) => alert.id === alertDetailId) ?? null,
    [alerts, alertDetailId]
  )

  const filtered = alerts.filter((alert) => {
    if (filterKw && alert.keywordId !== filterKw) return false
    if (filterSev && alert.severity !== filterSev) return false
    if (filterRead === 'unread' && alert.read) return false
    if (filterRead === 'read' && !alert.read) return false
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  async function applyReadState(alertId: string, read: boolean) {
    try {
      if (read) {
        await window.api.markAlertRead(alertId)
      } else {
        await window.api.markAlertUnread(alertId)
      }
      updateAlertReadState(alertId, read)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!selectedAlert || selectedAlert.read) return

    void (async () => {
      await applyReadState(selectedAlert.id, true)
    })()
  }, [selectedAlert?.id, selectedAlert?.read])

  async function handleMarkAllRead() {
    if (unreadCount === 0) return
    await window.api.markAllAlertsRead()
    markAllAlertsRead()
  }

  async function handleClear() {
    if (!confirm(t.alert_clear_confirm)) return
    await window.api.clearAlerts()
    setAlerts([])
    setAlertDetailId(null)
  }

  function openAlert(alert: Alert) {
    setAlertDetailId(alert.id)
    if (!alert.read) {
      void applyReadState(alert.id, true)
    }
  }

  function closeDetail() {
    setAlertDetailId(null)
  }

  function openExternal(url: string) {
    if (!url) return
    void window.api.openExternal(url)
  }

  const severityLabel = (sev: Alert['severity']) =>
    sev === 'high' ? t.severity_high : sev === 'medium' ? t.severity_medium : t.severity_low

  const urgencyLabel = (urg: Alert['aiUrgency']) =>
    urg === 'high' ? t.urgency_high : urg === 'medium' ? t.urgency_medium : urg === 'low' ? t.urgency_low : '—'

  return (
    <>
      <div className="filter-bar">
        <select
          className="form-input"
          style={{ width: 140 }}
          value={filterKw}
          onChange={(event) => {
            setFilterKw(event.target.value)
            setPage(1)
          }}
        >
          <option value="">{t.alert_all_topics}</option>
          {groupOptions.map(([groupId, groupName]) => (
            <option key={groupId} value={groupId}>
              {groupName}
            </option>
          ))}
        </select>
        <select
          className="form-input"
          style={{ width: 130 }}
          value={filterSev}
          onChange={(event) => {
            setFilterSev(event.target.value)
            setPage(1)
          }}
        >
          <option value="">{t.alert_all_levels}</option>
          <option value="high">{t.alert_high}</option>
          <option value="medium">{t.alert_medium}</option>
          <option value="low">{t.alert_low}</option>
        </select>
        <select
          className="form-input"
          style={{ width: 130 }}
          value={filterRead}
          onChange={(event) => {
            setFilterRead(event.target.value as 'all' | 'unread' | 'read')
            setPage(1)
          }}
        >
          <option value="all">{t.alert_all_states}</option>
          <option value="unread">{t.alert_state_unread}</option>
          <option value="read">{t.alert_state_read}</option>
        </select>
        <div className="filter-spacer" />
        <span className="filter-count">{t.alert_total.replace('{n}', String(filtered.length))}</span>
        {unreadCount > 0 && (
          <button className="btn btn-sm" onClick={handleMarkAllRead}>
            {t.alert_mark_all_read.replace('{n}', String(unreadCount))}
          </button>
        )}
        {alerts.length > 0 && (
          <button className="btn btn-sm" onClick={handleClear}>
            {t.alert_clear}
          </button>
        )}
      </div>

      {paged.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🟢</div>
          <p>{alerts.length === 0 ? t.alert_empty : t.alert_no_filter}</p>
        </div>
      ) : (
        <>
          {paged.map((alert) => (
            <div
              key={alert.id}
              className={`alert-list-item ${!alert.read ? 'unread' : ''}`}
              onClick={() => openAlert(alert)}
              title={lang === 'zh' ? '点击查看详情' : 'Click to view details'}
            >
              <span className="ali-sev">{severityIcon(alert.severity)}</span>
              <div className="ali-kw">{alert.keywordName}</div>
              <div className="ali-reason">{pickField(lang, alert.reason, alert.reasonEn, alert.reason)}</div>
              <div className={`ali-read ${alert.read ? 'read' : 'unread'}`}>
                {alert.read ? t.alert_state_read : t.alert_state_unread}
              </div>
              <div className="ali-title" title={pickField(lang, alert.articleTitleZh, alert.articleTitleEn, alert.articleTitle)}>
                {pickField(lang, alert.articleTitleZh, alert.articleTitleEn, alert.articleTitle)}
              </div>
              <div className="ali-time">{formatTime(alert.timestamp, t)}</div>
              <button
                className="btn btn-sm ali-toggle"
                onClick={(event) => {
                  event.stopPropagation()
                  void applyReadState(alert.id, !alert.read)
                }}
              >
                {alert.read ? t.alert_mark_unread : t.alert_mark_read}
              </button>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="pagination">
              {page > 1 && (
                <button className="page-btn" onClick={() => setPage(page - 1)}>
                  ‹
                </button>
              )}
              {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => index + 1).map((current) => (
                <button
                  key={current}
                  className={`page-btn ${current === page ? 'active' : ''}`}
                  onClick={() => setPage(current)}
                >
                  {current}
                </button>
              ))}
              {page < totalPages && (
                <button className="page-btn" onClick={() => setPage(page + 1)}>
                  ›
                </button>
              )}
            </div>
          )}
        </>
      )}

      {selectedAlert && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && closeDetail()}>
          <div className="modal-box alert-detail-modal">
            <div className="modal-header">
              <span className="modal-title">
                {severityIcon(selectedAlert.severity)} {selectedAlert.keywordName} · {severityLabel(selectedAlert.severity)}
              </span>
              <button className="modal-close" onClick={closeDetail}>
                ✕
              </button>
            </div>
            <div className="modal-body alert-detail-body">
              <div className="alert-detail-head">
                <div>
                  <div className="alert-detail-kicker">
                    <span className={`badge ${
                      selectedAlert.severity === 'high'
                        ? 'badge-red'
                        : selectedAlert.severity === 'medium'
                          ? 'badge-orange'
                          : 'badge-green'
                    }`}
                    >
                      {severityLabel(selectedAlert.severity)}
                    </span>
                    {selectedAlert.articleSource === '测试数据' && (
                      <span className="alert-detail-test-tag">{t.alert_test_tag}</span>
                    )}
                  </div>
                  <div className="alert-detail-title">
                    {pickField(lang, selectedAlert.articleTitleZh, selectedAlert.articleTitleEn, selectedAlert.articleTitle)}
                  </div>
                  <div className="alert-detail-meta">
                    <span>{selectedAlert.articleSource || t.alert_source_unknown}</span>
                    <span>{selectedAlert.articlePublishedAt ? formatTime(selectedAlert.articlePublishedAt, t) : t.alert_pub_unknown}</span>
                    <span>{t.alert_triggered_at.replace('{time}', formatTime(selectedAlert.timestamp, t))}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => void applyReadState(selectedAlert.id, !selectedAlert.read)}
                  >
                    {selectedAlert.read ? t.alert_mark_unread : t.alert_mark_read}
                  </button>
                  {selectedAlert.articleUrl && (
                    <button className="btn btn-sm btn-primary" onClick={() => openExternal(selectedAlert.articleUrl)}>
                      {t.btn_open_original}
                    </button>
                  )}
                </div>
              </div>

              {!selectedAlert.articleUrl && (
                <div className="alert-detail-note">{t.alert_test_note}</div>
              )}

              <div className="alert-detail-section">
                <div className="alert-detail-section-title">{t.alert_what_happened}</div>
                <div className="alert-detail-text">{cleanReason(pickField(lang, selectedAlert.reason, selectedAlert.reasonEn, selectedAlert.reason))}</div>
              </div>

              <div className="alert-detail-section">
                <div className="alert-detail-section-title">{t.alert_summary}</div>
                <div className="alert-detail-text">
                  {pickField(lang, selectedAlert.articleSummaryZh, selectedAlert.articleSummaryEn, selectedAlert.articleSummary ?? '') || t.alert_no_summary}
                </div>
              </div>

              <div className="alert-detail-facts">
                <div className="alert-detail-fact">
                  <span>{t.alert_level}</span>
                  <strong>{severityLabel(selectedAlert.severity)}</strong>
                </div>
                <div className="alert-detail-fact">
                  <span>{t.alert_sentiment}</span>
                  <strong style={{ color: selectedAlert.sentimentScore != null ? sentimentColor(selectedAlert.sentimentScore) : undefined }}>
                    {sentimentLocalized(selectedAlert.sentimentLabel, lang) ?? '—'}
                    {selectedAlert.sentimentScore !== null && selectedAlert.sentimentScore !== undefined
                      ? ` · ${signedScore(selectedAlert.sentimentScore)}`
                      : ''}
                  </strong>
                </div>
                {importanceTier(selectedAlert.articleImportance) && (
                  <div className="alert-detail-fact">
                    <span>{t.alert_importance}</span>
                    <strong>
                      <span className={`importance-pill ${importanceTier(selectedAlert.articleImportance)}`}>
                        ★ {selectedAlert.articleImportance}
                      </span>
                    </strong>
                  </div>
                )}
                {selectedAlert.aiImpact !== null && selectedAlert.aiImpact !== undefined && (
                  <div className="alert-detail-fact">
                    <span>{t.alert_impact}</span>
                    <strong>
                      {impactText(selectedAlert.aiImpact)}
                      {selectedAlert.aiImpactDirection && (
                        ` · ${
                          selectedAlert.aiImpactDirection === 'negative'
                            ? lang === 'zh'
                              ? '负向'
                              : 'Negative'
                            : selectedAlert.aiImpactDirection === 'positive'
                              ? lang === 'zh'
                                ? '正向'
                                : 'Positive'
                              : lang === 'zh'
                                ? '中性'
                                : 'Neutral'
                        }`
                      )}
                    </strong>
                  </div>
                )}
                {selectedAlert.aiUrgency && (
                  <div className="alert-detail-fact">
                    <span>{t.alert_urgency}</span>
                    <strong>{urgencyLabel(selectedAlert.aiUrgency)}</strong>
                  </div>
                )}
                {selectedAlert.aiRelevance !== null && selectedAlert.aiRelevance !== undefined && (
                  <div className="alert-detail-fact">
                    <span>{t.alert_relevance}</span>
                    <strong>{relevanceText(selectedAlert.aiRelevance)}</strong>
                  </div>
                )}
              </div>

              <div className="alert-detail-section">
                <div className="alert-detail-section-title">{t.alert_related}</div>
                {selectedAlert.relatedArticles.length === 0 ? (
                  <div className="alert-detail-text">{t.alert_no_related}</div>
                ) : (
                  <div className="alert-related-list">
                    {selectedAlert.relatedArticles.map((article, index) => (
                      <div className="alert-related-item" key={`${selectedAlert.id}_${article.id ?? index}`}>
                        <div className="alert-related-top">
                          <strong>{pickField(lang, article.titleZh, article.titleEn, article.title)}</strong>
                          <div className="alert-related-right">
                            {importanceTier(article.importanceScore) && (
                              <span
                                className={`importance-pill ${importanceTier(article.importanceScore)}`}
                                title={t.alert_importance}
                              >
                                ★ {article.importanceScore}
                              </span>
                            )}
                            {article.sentimentScore != null && (
                              <span
                                className="alert-related-sentiment"
                                style={{ color: sentimentColor(article.sentimentScore) }}
                              >
                                {sentimentLocalized(article.sentimentLabel, lang) ?? '—'} {article.sentimentScore.toFixed(2)}
                              </span>
                            )}
                            <span>{article.sourceName}</span>
                          </div>
                        </div>
                        {pickField(lang, article.summaryZh, article.summaryEn, article.summary ?? '') && (
                          <div className="alert-related-summary">
                            {pickField(lang, article.summaryZh, article.summaryEn, article.summary ?? '')}
                          </div>
                        )}
                        {pickArrayField(lang, article.keywordsZh, article.keywordsEn).length > 0 && (
                          <div className="alert-related-tags">
                            {pickArrayField(lang, article.keywordsZh, article.keywordsEn).slice(0, 5).map((tag) => (
                              <span className="alert-related-tag" key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                        <div className="alert-related-meta">
                          <span>{article.publishedAt ? formatTime(article.publishedAt, t) : t.time_unknown}</span>
                          {article.url && (
                            <button className="btn btn-sm" onClick={() => openExternal(article.url)}>
                              {t.btn_open}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
