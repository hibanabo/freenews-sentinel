import { useStore } from '../store'
import { FREENEWS_SITE_URL } from '../constants'
import { useLocale } from '../i18n'

export default function Brief() {
  const { settings, setPage } = useStore()
  const { t } = useLocale()

  return (
    <>
      <div className="callout-card" style={{ marginBottom: 20 }}>
        <div>
          <strong>{t.brief_dev_title}</strong>
          <div className="callout-copy">{t.brief_dev_desc}</div>
        </div>
      </div>

      {!settings.freenewsApiKey ? (
        <div className="empty" style={{ marginTop: 60 }}>
          <div className="empty-icon">📡</div>
          <p>{t.brief_no_key}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => setPage('settings')}>
              {t.brief_go_settings}
            </button>
            <button className="btn" onClick={() => window.api.openExternal(FREENEWS_SITE_URL)}>
              {t.settings_api_open_site}
            </button>
          </div>
        </div>
      ) : (
        <div className="brief-card">
          <div className="brief-placeholder">
            <div className="brief-placeholder-icon">{t.brief_placeholder_title}</div>
            <p>{t.brief_placeholder}</p>
            <p style={{ marginTop: 8, fontSize: 12 }}>{t.brief_placeholder_hint}</p>
          </div>
        </div>
      )}
    </>
  )
}
