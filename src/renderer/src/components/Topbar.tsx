import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { useLocale } from '../i18n'
import { getGlobalTimezone } from '../utils'

interface Props {
  title: string
  sub: string
}

export default function Topbar({ title, sub }: Props) {
  const [time, setTime] = useState('')
  const { monitorStatus, settings, setSettings } = useStore()
  const { t, lang } = useLocale()
  const tz = settings.timezone || getGlobalTimezone()

  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', {
          hour12: false,
          timeZone: tz
        })
      )
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [lang, tz])

  const liveLabel =
    !settings.freenewsApiKey
      ? t.top_not_configured
      : monitorStatus.running
        ? t.top_live
        : t.top_paused

  const theme = settings.theme ?? 'dark'

  async function toggleLanguage() {
    const nextLang = lang === 'zh' ? 'en' : 'zh'
    const nextSettings = { ...settings, language: nextLang as 'zh' | 'en' }
    setSettings(nextSettings)
    await window.api.saveSettings(nextSettings)
  }

  async function toggleTheme() {
    const nextTheme: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark'
    const nextSettings = { ...settings, theme: nextTheme }
    setSettings(nextSettings)
    document.documentElement.setAttribute('data-theme', nextTheme)
    await window.api.saveSettings(nextSettings)
  }

  // Sync theme to DOM on mount and changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <div className="topbar">
      <div className="topbar-copy">
        <div className="topbar-title">{title}</div>
        <div className="topbar-sub">{sub}</div>
      </div>
      <div className="topbar-spacer" />
      <div className="lang-switch" title={lang === 'zh' ? 'Switch to English' : '切换为中文'}>
        <button
          className={`lang-switch-btn${lang === 'zh' ? ' lang-active' : ''}`}
          onClick={() => lang !== 'zh' && toggleLanguage()}
        >
          简
        </button>
        <span className="lang-switch-sep" />
        <button
          className={`lang-switch-btn${lang === 'en' ? ' lang-active' : ''}`}
          onClick={() => lang !== 'en' && toggleLanguage()}
        >
          EN
        </button>
      </div>
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={theme === 'dark' ? (lang === 'zh' ? '切换到明亮模式' : 'Switch to light mode') : (lang === 'zh' ? '切换到暗黑模式' : 'Switch to dark mode')}
      >
        {theme === 'dark' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        )}
      </button>
      <div className="live-pill">
        <div
          className={`pulse-dot ${
            !settings.freenewsApiKey
              ? 'pulse-amber'
              : monitorStatus.running
                ? 'pulse-green'
                : 'pulse-gray'
          }`}
        />
        {liveLabel}
      </div>
      <div className="topbar-clock">{time}</div>
    </div>
  )
}
