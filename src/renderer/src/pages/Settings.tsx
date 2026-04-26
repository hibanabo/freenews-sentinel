import { useEffect, useMemo, useState } from 'react'
import { useStore, MonitorStatus, Settings as SettingsType } from '../store'
import { FREENEWS_SITE_URL } from '../constants'
import { shortTime, setGlobalTimezone } from '../utils'
import { useLocale } from '../i18n'
import { PROMPT_PRESETS } from '../presets'

interface FreenewsQuotaInfo {
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

interface FreenewsConnectionStatus {
  ok: boolean
  message: string
  quota?: FreenewsQuotaInfo
}

function effectiveRemaining(quota: FreenewsQuotaInfo) {
  return quota.effectiveRemaining ?? Math.max(0, Math.min(quota.dailyRemaining, quota.monthlyRemaining))
}

function isUnlimitedQuotaValue(value: number | null | undefined) {
  return value === -1
}

function normalizeUnitThreshold(value: number, fallback = 0.3) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric <= 0) return 0
  if (numeric >= 1) return 1
  return numeric
}

function buildCustomRoleLabel(index: number, lang: 'zh' | 'en') {
  return lang === 'zh' ? `自定义角色 ${index + 1}` : `Custom role ${index + 1}`
}

interface RoleTab {
  key: string
  label: string
  value: string
  source: 'preset' | 'custom' | 'detached'
}

function customRoleIndex(roleKey: string) {
  if (!roleKey.startsWith('custom:')) return -1
  const index = Number(roleKey.slice('custom:'.length))
  return Number.isFinite(index) && index >= 0 ? index : -1
}

export default function Settings() {
  const { settings, setSettings, monitorStatus, setMonitorStatus } = useStore()
  const { t, lang } = useLocale()
  const [form, setForm] = useState<SettingsType>({ ...settings, customPresets: settings.customPresets ?? [] })
  const [fnStatus, setFnStatus] = useState<FreenewsConnectionStatus | null>(null)
  const [aiStatus, setAiStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic')
  const [monitorBusy, setMonitorBusy] = useState(false)
  const [activeRoleKey, setActiveRoleKey] = useState('preset:0')

  useEffect(() => {
    setForm({ ...settings, customPresets: settings.customPresets ?? [] })
    const presetIndex = PROMPT_PRESETS.findIndex((preset) => preset.value === settings.aiPromptPrefix)
    if (presetIndex >= 0) {
      setActiveRoleKey(`preset:${presetIndex}`)
      return
    }

    const customIndex = (settings.customPresets ?? []).findIndex((preset) => preset.value === settings.aiPromptPrefix)
    if (customIndex >= 0) {
      setActiveRoleKey(`custom:${customIndex}`)
      return
    }

    if (settings.aiPromptPrefix?.trim()) {
      setActiveRoleKey('detached')
      return
    }

    setActiveRoleKey('preset:0')
  }, [settings])

  useEffect(() => {
    if (!settings.freenewsApiKey) {
      setFnStatus(null)
      return
    }

    let cancelled = false

    void (async () => {
      const result = await window.api.testFreenews({
        apiKey: settings.freenewsApiKey,
        baseUrl: settings.freenewsBaseUrl
      })
      if (!cancelled) setFnStatus(result)
    })()

    return () => {
      cancelled = true
    }
  }, [settings.freenewsApiKey, settings.freenewsBaseUrl])

  function update<K extends keyof SettingsType>(key: K, value: SettingsType[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleTestFreenews() {
    setFnStatus(null)
    const result = await window.api.testFreenews({
      apiKey: form.freenewsApiKey,
      baseUrl: form.freenewsBaseUrl
    })
    setFnStatus(result)
  }

  async function handleSave() {
    setSaving(true)
    const nextSettings: SettingsType = {
      ...form,
      aiPrescreenThreshold: normalizeUnitThreshold(form.aiPrescreenThreshold, 0.3),
      importanceThreshold: Math.min(10, Math.max(1, Math.round(Number(form.importanceThreshold) || 7))),
      negativeSentimentThreshold: normalizeUnitThreshold(form.negativeSentimentThreshold ?? 0.25, 0.25),
      autoBriefEnabled: false
    }
    await window.api.saveSettings(nextSettings)
    if (nextSettings.timezone) setGlobalTimezone(nextSettings.timezone)
    setSettings(nextSettings)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleStartMonitor() {
    setMonitorBusy(true)
    const status = (await window.api.startMonitor()) as MonitorStatus
    setMonitorStatus(status)
    setMonitorBusy(false)
  }

  async function handleStopMonitor() {
    setMonitorBusy(true)
    const status = (await window.api.stopMonitor()) as MonitorStatus
    setMonitorStatus(status)
    setMonitorBusy(false)
  }

  async function handleTestAi() {
    setAiStatus(null)
    const result = await window.api.testAi({
      baseUrl: form.aiBaseUrl,
      apiKey: form.aiApiKey,
      model: form.aiModel,
      providerType: form.aiProviderType
    })
    setAiStatus(result as { ok: boolean; message: string })
  }

  const roleTabs = useMemo<RoleTab[]>(() => {
    const presetTabs: RoleTab[] = PROMPT_PRESETS.map((preset, index) => ({
      key: `preset:${index}`,
      label: preset.label,
      value: preset.value,
      source: 'preset'
    }))

    const customTabs: RoleTab[] = (form.customPresets ?? []).map((preset, index) => ({
      key: `custom:${index}`,
      label: preset.label?.trim() || buildCustomRoleLabel(index, lang),
      value: preset.value,
      source: 'custom'
    }))

    const hasMatchedRole =
      presetTabs.some((role) => role.value === form.aiPromptPrefix) ||
      customTabs.some((role) => role.value === form.aiPromptPrefix)

    const detachedTab: RoleTab[] =
      !hasMatchedRole && form.aiPromptPrefix.trim()
        ? [
            {
              key: 'detached',
              label: lang === 'zh' ? '当前默认（未存档）' : 'Current default (unsaved)',
              value: form.aiPromptPrefix,
              source: 'detached'
            }
          ]
        : []

    return [...presetTabs, ...customTabs, ...detachedTab]
  }, [form.customPresets, form.aiPromptPrefix, lang])

  const activeRole = roleTabs.find((role) => role.key === activeRoleKey) ?? roleTabs[0] ?? null

  useEffect(() => {
    if (roleTabs.length === 0) return
    if (roleTabs.some((role) => role.key === activeRoleKey)) return
    const matched = roleTabs.find((role) => role.value === form.aiPromptPrefix)
    setActiveRoleKey(matched?.key ?? roleTabs[0].key)
  }, [roleTabs, activeRoleKey, form.aiPromptPrefix])

  function selectRole(role: RoleTab) {
    setAiStatus(null)
    setActiveRoleKey(role.key)
    update('aiPromptPrefix', role.value)
  }

  function handleAddRole() {
    setAiStatus(null)
    const nextIndex = (form.customPresets ?? []).length
    const roleValue = ''
    const nextRole = {
      label: buildCustomRoleLabel(nextIndex, lang),
      value: roleValue
    }

    setForm((prev) => ({
      ...prev,
      aiPromptPrefix: roleValue,
      customPresets: [...(prev.customPresets ?? []), nextRole]
    }))
    setActiveRoleKey(`custom:${nextIndex}`)
  }

  function handleRoleNameChange(nextLabel: string) {
    if (!activeRole || activeRole.source !== 'custom') return
    const index = customRoleIndex(activeRole.key)
    if (index < 0) return

    setForm((prev) => {
      const customPresets = [...(prev.customPresets ?? [])]
      const current = customPresets[index]
      if (!current) return prev

      customPresets[index] = {
        ...current,
        label: nextLabel
      }

      return {
        ...prev,
        customPresets
      }
    })
  }

  function handleRolePromptChange(nextValue: string) {
    if (!activeRole) {
      update('aiPromptPrefix', nextValue)
      return
    }

    if (activeRole.source === 'custom') {
      const index = customRoleIndex(activeRole.key)
      if (index < 0) {
        update('aiPromptPrefix', nextValue)
        return
      }

      setForm((prev) => {
        const customPresets = [...(prev.customPresets ?? [])]
        const current = customPresets[index]
        if (!current) {
          return {
            ...prev,
            aiPromptPrefix: nextValue
          }
        }

        customPresets[index] = {
          ...current,
          value: nextValue
        }

        return {
          ...prev,
          aiPromptPrefix: nextValue,
          customPresets
        }
      })
      return
    }

    if (activeRole.source === 'preset') {
      if (nextValue === activeRole.value) {
        update('aiPromptPrefix', activeRole.value)
        return
      }

      const nextIndex = (form.customPresets ?? []).length
      const customLabel =
        lang === 'zh'
          ? `${activeRole.label}（自定义）`
          : `${activeRole.label} (Custom)`

      setForm((prev) => ({
        ...prev,
        aiPromptPrefix: nextValue,
        customPresets: [
          ...(prev.customPresets ?? []),
          {
            label: customLabel,
            value: nextValue
          }
        ]
      }))
      setActiveRoleKey(`custom:${nextIndex}`)
      return
    }

    update('aiPromptPrefix', nextValue)
  }

  const activeRolePrompt = (() => {
    if (!activeRole) return form.aiPromptPrefix
    if (activeRole.source === 'custom') {
      const index = customRoleIndex(activeRole.key)
      return form.customPresets[index]?.value ?? form.aiPromptPrefix
    }
    if (activeRole.source === 'detached') return form.aiPromptPrefix
    return activeRole.value
  })()

  const activeCustomRoleIndex = activeRole && activeRole.source === 'custom'
    ? customRoleIndex(activeRole.key)
    : -1

  const activeCustomRoleLabel =
    activeCustomRoleIndex >= 0
      ? form.customPresets[activeCustomRoleIndex]?.label ?? buildCustomRoleLabel(activeCustomRoleIndex, lang)
      : ''

  const decisionModeOptions = [
    {
      value: 'threshold_only' as const,
      label: lang === 'zh' ? '仅阈值（最快、最省）' : 'Threshold only (fastest, cheapest)',
      desc:
        lang === 'zh'
          ? '不调用 LLM，只看 FreeNews 情感分和你的主题阈值（0~1，越低越负面）。'
          : 'No LLM call. Alerts rely only on FreeNews sentiment score and your topic threshold (0~1, lower means more negative).',
      bestFor:
        lang === 'zh'
          ? '适合预算敏感、主题多、对误报容忍较高的场景。'
          : 'Best for cost-sensitive use cases with many topics and higher tolerance for coarse alerts.'
    },
    {
      value: 'hybrid' as const,
      label: lang === 'zh' ? '混合模式（推荐）' : 'Hybrid (recommended)',
      desc:
        lang === 'zh'
          ? '优先使用 LLM 做最终是否告警判断。若开启预筛选，先按预筛选阈值过滤再送 LLM；若 LLM 超时/失败，自动回退到主题阈值。'
          : 'LLM is used for final alert decision. If prescreen is enabled, candidates are filtered first; if LLM fails or times out, it falls back to topic threshold.',
      bestFor:
        lang === 'zh'
          ? '准确率、稳定性、成本的平衡方案。'
          : 'Balanced option across accuracy, stability, and cost.'
    },
    {
      value: 'llm_only' as const,
      label: lang === 'zh' ? '仅 LLM（最智能）' : 'LLM only (most semantic)',
      desc:
        lang === 'zh'
          ? '正常情况下只看 LLM 的 triggerAlert 结果，阈值不参与最终判定；仅在 LLM 超时/失败时回退阈值，避免完全失效。'
          : 'Uses LLM triggerAlert as the primary decision path; threshold is used only when LLM fails/times out to avoid downtime.',
      bestFor:
        lang === 'zh'
          ? '适合需要强语义判断、可接受更高 token 成本的场景。'
          : 'Best for semantic-heavy decisions where higher token cost is acceptable.'
    }
  ]

  const selectedDecisionMode =
    decisionModeOptions.find((option) => option.value === form.aiDecisionMode) ?? decisionModeOptions[1]

  const monitorStatusLabel = !form.freenewsApiKey
    ? t.status_waiting_key
    : monitorStatus.running
      ? t.status_running
      : monitorStatus.message

  const quota = fnStatus?.quota

  function formatQuotaValue(value: number) {
    return isUnlimitedQuotaValue(value) ? t.quota_unlimited : String(value)
  }

  function formatKeyStatus(status: string) {
    if (status === 'active') return t.quota_status_active
    if (status === 'disabled') return t.quota_status_disabled
    if (status === 'expired') return t.quota_status_expired
    return status || t.quota_status_unknown
  }

  function getQuotaHeadline(q: FreenewsQuotaInfo) {
    if (isUnlimitedQuotaValue(effectiveRemaining(q))) return t.quota_headline
    if (effectiveRemaining(q) <= 0) {
      if (q.effectiveLimitScope === 'monthly' || q.monthlyRemaining <= 0) return t.quota_monthly_exhausted
      if (q.effectiveLimitScope === 'daily' || q.dailyRemaining <= 0) return t.quota_daily_exhausted
    }
    return t.quota_headline
  }

  function formatTime(iso?: string | null) {
    return shortTime(iso)
  }

  return (
    <>
      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'basic' ? 'active' : ''}`}
          onClick={() => setActiveTab('basic')}
        >
          {t.settings_tab_basic}
        </button>
        <button
          className={`settings-tab ${activeTab === 'advanced' ? 'active' : ''}`}
          onClick={() => setActiveTab('advanced')}
        >
          {t.settings_tab_advanced}
        </button>
      </div>

      {activeTab === 'basic' && (
        <>
          <div className="settings-section">
            <div className="settings-title"><span>📡</span> FreeNews API</div>
            {quota ? (
              <div className="quota-panel">
                <div className="quota-panel-head">
                  <div>
                    <div className="quota-panel-title">{getQuotaHeadline(quota)}</div>
                    <div className="quota-panel-sub">
                      {quota.keyName || quota.keyPrefix} · {quota.planDisplayName || quota.planName} · {formatKeyStatus(quota.status)}
                    </div>
                  </div>
                  <div className={`quota-pill ${!isUnlimitedQuotaValue(effectiveRemaining(quota)) && effectiveRemaining(quota) <= 0 ? 'quota-pill-danger' : ''}`}>
                    {!isUnlimitedQuotaValue(effectiveRemaining(quota)) && effectiveRemaining(quota) <= 0 ? t.quota_alert : quota.keyPrefix}
                  </div>
                </div>
                <div className="quota-grid">
                  <div className="quota-item">
                    <span>{t.quota_today_used}</span>
                    <strong>{quota.callsToday} / {formatQuotaValue(quota.dailyLimit)}</strong>
                  </div>
                  <div className="quota-item">
                    <span>{t.quota_available}</span>
                    <strong>{formatQuotaValue(effectiveRemaining(quota))}</strong>
                  </div>
                  <div className="quota-item">
                    <span>{t.quota_month_used}</span>
                    <strong>{quota.callsMonth} / {formatQuotaValue(quota.monthlyLimit)}</strong>
                  </div>
                  <div className="quota-item">
                    <span>{t.quota_month_remaining}</span>
                    <strong>{formatQuotaValue(quota.monthlyRemaining)}</strong>
                  </div>
                </div>
                <div className="quota-meta">
                  <span>{t.quota_daily_reset}{formatTime(quota.nextDailyResetAt)}</span>
                  <span>{t.quota_monthly_reset}{formatTime(quota.nextMonthlyResetAt)}</span>
                  <span>{t.quota_last_used}{formatTime(quota.lastUsedAt)}</span>
                  {quota.expiresAt && <span>{t.quota_expires}{formatTime(quota.expiresAt)}</span>}
                </div>
                {fnStatus && !fnStatus.ok && (
                  <div className="conn-status conn-err" style={{ marginTop: 12 }}>
                    ✗ {fnStatus.message}
                  </div>
                )}
              </div>
            ) : (
              <div className="callout-card" style={{ marginBottom: 18 }}>
                <div>
                  <strong>{t.settings_api_cta_title}</strong>
                  <div className="callout-copy">{t.settings_api_cta_desc}</div>
                </div>
                <div className="callout-actions">
                  <button className="btn btn-primary" onClick={() => window.api.openExternal(FREENEWS_SITE_URL)}>
                    {t.settings_api_open_site}
                  </button>
                </div>
              </div>
            )}

            <div className="settings-grid">
              <div>
                <label>{t.settings_api_key_label}</label>
                <small>{t.settings_api_key_hint}</small>
              </div>
              <div>
                <div className="input-row">
                  <input
                    className="form-input"
                    type="password"
                    placeholder="fn_sk_xxxxxxxxxxxxxxxx"
                    value={form.freenewsApiKey}
                    onChange={(e) => {
                      setFnStatus(null)
                      update('freenewsApiKey', e.target.value)
                    }}
                  />
                  <button className="btn" onClick={handleTestFreenews}>{t.btn_test_connection}</button>
                </div>
                {fnStatus && !fnStatus.ok && !quota && (
                  <div className="conn-status conn-err">
                    ✗ {fnStatus.message}
                  </div>
                )}
              </div>
              <div>
                <label>{t.settings_api_url_label}</label>
                <small>{t.settings_api_url_hint}</small>
              </div>
              <input
                className="form-input"
                value={form.freenewsBaseUrl}
                onChange={(e) => {
                  setFnStatus(null)
                  update('freenewsBaseUrl', e.target.value)
                }}
              />
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-title"><span>⚙</span> {t.settings_monitor_title.replace('⚙ ', '')}</div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_timezone_label}</div>
                <div className="settings-row-desc">{t.settings_timezone_hint}</div>
              </div>
              <select
                className="form-input"
                style={{ width: 200 }}
                value={form.timezone ?? 'Asia/Shanghai'}
                onChange={(e) => update('timezone', e.target.value)}
              >
                <option value="Asia/Shanghai">{lang === 'zh' ? '北京时间' : 'Beijing'} (UTC+8)</option>
                <option value="Asia/Tokyo">{lang === 'zh' ? '东京时间' : 'Tokyo'} (UTC+9)</option>
                <option value="Asia/Singapore">{lang === 'zh' ? '新加坡时间' : 'Singapore'} (UTC+8)</option>
                <option value="Asia/Hong_Kong">{lang === 'zh' ? '香港时间' : 'Hong Kong'} (UTC+8)</option>
                <option value="Asia/Taipei">{lang === 'zh' ? '台北时间' : 'Taipei'} (UTC+8)</option>
                <option value="America/New_York">{lang === 'zh' ? '纽约时间' : 'New York'} (UTC-5/-4)</option>
                <option value="America/Los_Angeles">{lang === 'zh' ? '洛杉矶时间' : 'Los Angeles'} (UTC-8/-7)</option>
                <option value="America/Chicago">{lang === 'zh' ? '芝加哥时间' : 'Chicago'} (UTC-6/-5)</option>
                <option value="Europe/London">{lang === 'zh' ? '伦敦时间' : 'London'} (UTC+0/+1)</option>
                <option value="Europe/Berlin">{lang === 'zh' ? '柏林时间' : 'Berlin'} (UTC+1/+2)</option>
                <option value="Europe/Paris">{lang === 'zh' ? '巴黎时间' : 'Paris'} (UTC+1/+2)</option>
                <option value="Europe/Moscow">{lang === 'zh' ? '莫斯科时间' : 'Moscow'} (UTC+3)</option>
                <option value="Australia/Sydney">{lang === 'zh' ? '悉尼时间' : 'Sydney'} (UTC+10/+11)</option>
                <option value="Pacific/Auckland">{lang === 'zh' ? '奥克兰时间' : 'Auckland'} (UTC+12/+13)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_interval_label}</div>
                <div className="settings-row-desc">{t.settings_interval_hint}</div>
              </div>
              <select
                className="form-input"
                style={{ width: 140 }}
                value={form.checkInterval}
                onChange={(e) => update('checkInterval', Number(e.target.value))}
              >
                <option value={1}>1 {t.settings_minute}</option>
                <option value={5}>5 {t.settings_minute}</option>
                <option value={15}>15 {t.settings_minute}</option>
                <option value={30}>30 {t.settings_minute}</option>
              </select>
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_fetch_label}</div>
                <div className="settings-row-desc">{t.settings_fetch_hint}</div>
              </div>
              <select
                className="form-input"
                style={{ width: 140 }}
                value={form.monitorFetchLimit}
                onChange={(e) => update('monitorFetchLimit', Number(e.target.value))}
              >
                <option value={5}>5 {t.settings_items}</option>
                <option value={10}>10 {t.settings_items}</option>
                <option value={20}>20 {t.settings_items}</option>
                <option value={30}>30 {t.settings_items}</option>
                <option value={50}>50 {t.settings_items}</option>
              </select>
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_importance_label}</div>
                <div className="settings-row-desc">{t.settings_importance_hint}</div>
              </div>
              <input
                className="form-input"
                type="number"
                min={1}
                max={10}
                step={1}
                style={{ width: 80 }}
                value={form.importanceThreshold ?? 7}
                onChange={(e) => {
                  const v = Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 7)))
                  update('importanceThreshold', v)
                }}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_sentiment_neg_label}</div>
                <div className="settings-row-desc">{t.settings_sentiment_neg_hint}</div>
              </div>
              <input
                className="form-input"
                type="number"
                min={0}
                max={1}
                step={0.05}
                style={{ width: 80 }}
                value={form.negativeSentimentThreshold ?? 0.25}
                onChange={(e) => {
                  const raw = Number(e.target.value)
                  const v = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.25
                  update('negativeSentimentThreshold', v)
                }}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_cooldown_label}</div>
                <div className="settings-row-desc">{t.settings_cooldown_hint}</div>
              </div>
              <select
                className="form-input"
                style={{ width: 140 }}
                value={form.alertCooldownMinutes}
                onChange={(event) => update('alertCooldownMinutes', Number(event.target.value))}
              >
                <option value={5}>5 {t.settings_minute}</option>
                <option value={10}>10 {t.settings_minute}</option>
                <option value={15}>15 {t.settings_minute}</option>
                <option value={30}>30 {t.settings_minute}</option>
                <option value={60}>1 {t.settings_hour}</option>
                <option value={120}>2 {lang === 'zh' ? '小时' : 'hr'}</option>
                <option value={180}>3 {lang === 'zh' ? '小时' : 'hr'}</option>
              </select>
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_notifications_label}</div>
                <div className="settings-row-desc">{t.settings_notifications_hint}</div>
              </div>
              <div
                className={`toggle ${form.notifications ? 'on' : ''}`}
                onClick={() => update('notifications', !form.notifications)}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_sound_label}</div>
                <div className="settings-row-desc">{t.settings_sound_hint}</div>
              </div>
              <div
                className={`toggle ${form.sound ? 'on' : ''}`}
                onClick={() => update('sound', !form.sound)}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_autostart_label}</div>
                <div className="settings-row-desc">{t.settings_autostart_hint}</div>
              </div>
              <div
                className={`toggle ${form.autoStart ? 'on' : ''}`}
                onClick={() => update('autoStart', !form.autoStart)}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t.settings_status_label}</div>
                <div className="settings-row-desc">
                  {monitorStatusLabel}
                  {monitorStatus.lastCycleAt
                    ? ` · ${t.settings_last_check} ${shortTime(monitorStatus.lastCycleAt)}`
                    : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" disabled={monitorBusy || monitorStatus.running} onClick={handleStartMonitor}>
                  {t.btn_start_now}
                </button>
                <button className="btn btn-sm" disabled={monitorBusy || !monitorStatus.running} onClick={handleStopMonitor}>
                  {t.btn_stop_monitor}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'advanced' && (
        <>
          <div className="settings-section">
            <div className="settings-title"><span>🤖</span> {lang === 'zh' ? 'AI 告警判定' : 'AI alert decision'}</div>
            <div className="callout-card" style={{ marginBottom: 18 }}>
              <div>
                <strong>{lang === 'zh' ? 'LLM 作为可选增强层' : 'LLM as an optional enhancement layer'}</strong>
                <div className="callout-copy">
                  {lang === 'zh'
                    ? '不开启 AI 时，系统保持纯阈值告警，基础功能不受影响。'
                    : 'When AI is disabled, the app stays on threshold-only alerts and baseline workflow remains unchanged.'}
                </div>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{lang === 'zh' ? '启用 AI 判定' : 'Enable AI decision'}</div>
                <div className="settings-row-desc">
                  {lang === 'zh'
                    ? '开启后按当前配置执行 AI 评估；不开启时也可先配置，启用后立即生效。'
                    : 'When enabled, AI evaluation runs with current config. You can configure while off and apply instantly once enabled.'}
                </div>
              </div>
              <select
                className="form-input"
                style={{ width: 220 }}
                value={form.aiEnabled ? 'on' : 'off'}
                onChange={(event) => {
                  setAiStatus(null)
                  update('aiEnabled', event.target.value === 'on')
                }}
              >
                <option value="off">
                  {lang === 'zh' ? '关闭（仅阈值）' : 'Off (threshold only)'}
                </option>
                <option value="on">
                  {lang === 'zh' ? '开启（使用 AI）' : 'On (use AI)'}
                </option>
              </select>
            </div>

            <div className="settings-grid" style={{ marginTop: 14 }}>
              <div>
                <label>{lang === 'zh' ? 'Provider' : 'Provider'}</label>
                <small>{lang === 'zh' ? '选择 OpenAI 兼容接口或 Anthropic' : 'OpenAI-compatible or Anthropic'}</small>
              </div>
              <select
                className="form-input"
                value={form.aiProviderType}
                onChange={(event) => {
                  setAiStatus(null)
                  update('aiProviderType', event.target.value as SettingsType['aiProviderType'])
                }}
              >
                <option value="openai">OpenAI Compatible</option>
                <option value="anthropic">Anthropic</option>
              </select>

              <div>
                <label>{lang === 'zh' ? 'Base URL' : 'Base URL'}</label>
                <small>{lang === 'zh' ? '例如 https://api.openai.com/v1' : 'For example https://api.openai.com/v1'}</small>
              </div>
              <input
                className="form-input"
                value={form.aiBaseUrl}
                onChange={(event) => {
                  setAiStatus(null)
                  update('aiBaseUrl', event.target.value)
                }}
              />

              <div>
                <label>{lang === 'zh' ? 'Model' : 'Model'}</label>
                <small>{lang === 'zh' ? '例如 gpt-4o-mini / claude-3-5-sonnet-latest' : 'For example gpt-4o-mini / claude-3-5-sonnet-latest'}</small>
              </div>
              <input
                className="form-input"
                value={form.aiModel}
                onChange={(event) => {
                  setAiStatus(null)
                  update('aiModel', event.target.value)
                }}
              />

              <div>
                <label>{lang === 'zh' ? 'API Key' : 'API Key'}</label>
                <small>{lang === 'zh' ? '本地兼容服务可留空（localhost）' : 'Can be empty for localhost compatible endpoints'}</small>
              </div>
              <div>
                <div className="input-row">
                  <input
                    className="form-input"
                    type="password"
                    value={form.aiApiKey}
                    onChange={(event) => {
                      setAiStatus(null)
                      update('aiApiKey', event.target.value)
                    }}
                  />
                  <button
                    className="btn"
                    onClick={handleTestAi}
                    disabled={!form.aiBaseUrl.trim() || !form.aiModel.trim()}
                  >
                    {t.btn_test_connection}
                  </button>
                </div>
                {aiStatus && (
                  <div className={`conn-status ${aiStatus.ok ? 'conn-ok' : 'conn-err'}`}>
                    {aiStatus.ok ? '✓' : '✗'} {aiStatus.message}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-title"><span>🧭</span> {lang === 'zh' ? '告警决策策略' : 'Alert decision strategy'}</div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{lang === 'zh' ? '决策模式' : 'Decision mode'}</div>
                <div className="settings-row-desc">
                  {lang === 'zh'
                    ? '控制“最终是否触发告警”由谁来决定。'
                    : 'Controls who makes the final alert decision.'}
                </div>
              </div>
              <select
                className="form-input"
                style={{ width: 300 }}
                value={form.aiDecisionMode}
                onChange={(event) => update('aiDecisionMode', event.target.value as SettingsType['aiDecisionMode'])}
              >
                {decisionModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="callout-card callout-inline" style={{ marginTop: 10, marginBottom: 6 }}>
              <div>
                <strong>
                  {lang === 'zh' ? '当前模式说明：' : 'Current mode: '}
                  {selectedDecisionMode.label}
                </strong>
                <div className="callout-copy">{selectedDecisionMode.desc}</div>
                <div className="callout-copy">{selectedDecisionMode.bestFor}</div>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{lang === 'zh' ? '开启预筛选' : 'Enable prescreen'}</div>
                <div className="settings-row-desc">
                  {lang === 'zh'
                    ? '先按情感阈值筛选，再送入 LLM 评估；关闭时会把该轮新增文章全量送给 LLM。'
                    : 'Filter by sentiment threshold before LLM evaluation; if disabled, all new articles in the cycle are sent to LLM.'}
                </div>
              </div>
              <div
                className={`toggle ${form.aiPrescreenEnabled ? 'on' : ''}`}
                onClick={() => update('aiPrescreenEnabled', !form.aiPrescreenEnabled)}
              />
            </div>

            {form.aiPrescreenEnabled && (
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">{lang === 'zh' ? '预筛选阈值（0~1）' : 'Prescreen threshold (0~1)'}</div>
                  <div className="settings-row-desc">
                    {lang === 'zh' ? '越低越严格，越省 token。' : 'Lower means stricter filtering and fewer tokens.'}
                  </div>
                </div>
                <select
                  className="form-input"
                  style={{ width: 180 }}
                  value={form.aiPrescreenThreshold}
                  onChange={(event) => update('aiPrescreenThreshold', normalizeUnitThreshold(Number(event.target.value), 0.3))}
                >
                  <option value={0.4}>0.40</option>
                  <option value={0.3}>0.30</option>
                  <option value={0.2}>0.20</option>
                  <option value={0.1}>0.10</option>
                </select>
              </div>
            )}
          </div>

          <div className="settings-section">
            <div className="settings-title"><span>🎭</span> {lang === 'zh' ? '默认分析角色' : 'Default analysis role'}</div>
            <div className="settings-row-info" style={{ marginBottom: 12 }}>
              <div className="settings-row-label">{lang === 'zh' ? '点击角色切换默认立场' : 'Switch default stance by role'}</div>
              <div className="settings-row-desc">
                {lang === 'zh'
                  ? '点击上方角色后，下方可直接编辑该角色详情。点 + 可新增自定义角色。'
                  : 'Click any role above, then edit its details below. Use + to add a custom role.'}
              </div>
            </div>

            <div className="role-chip-row">
              {roleTabs.map((role) => {
                const isActive = activeRole?.key === role.key
                const isDefault = form.aiPromptPrefix === role.value
                return (
                  <button
                    key={role.key}
                    type="button"
                    className={`role-chip ${isActive ? 'active' : ''}`}
                    onClick={() => selectRole(role)}
                    title={role.label}
                  >
                    <span>{role.label}</span>
                    {isDefault && <em>{lang === 'zh' ? '默认' : 'Default'}</em>}
                  </button>
                )
              })}
              <button
                type="button"
                className="role-chip role-chip-add"
                onClick={handleAddRole}
                title={lang === 'zh' ? '新增角色' : 'Add role'}
              >
                + {lang === 'zh' ? '新增角色' : 'Add role'}
              </button>
            </div>

            <div className="role-editor">
              <div className="role-editor-head">
                <strong>{activeRole?.label ?? (lang === 'zh' ? '默认角色' : 'Default role')}</strong>
                <span>
                  {activeRole?.source === 'preset'
                    ? lang === 'zh'
                      ? '预设角色'
                      : 'Preset role'
                    : activeRole?.source === 'custom'
                      ? lang === 'zh'
                        ? '自定义角色'
                        : 'Custom role'
                      : lang === 'zh'
                        ? '当前默认（未存档）'
                        : 'Current default (unsaved)'}
                </span>
              </div>

              {activeCustomRoleIndex >= 0 && (
                <div className="role-name-row">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ margin: 0 }}>{lang === 'zh' ? '角色名称' : 'Role name'}</label>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 11, padding: 0, lineHeight: 1 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-2)')}
                      onClick={() => {
                        if (!confirm(lang === 'zh' ? `确定删除角色「${activeCustomRoleLabel}」？` : `Delete role "${activeCustomRoleLabel}"?`)) return
                        setForm((prev) => {
                          const customPresets = (prev.customPresets ?? []).filter((_, i) => i !== activeCustomRoleIndex)
                          const fallback = PROMPT_PRESETS[0]?.value ?? ''
                          return {
                            ...prev,
                            customPresets,
                            aiPromptPrefix: prev.aiPromptPrefix === (prev.customPresets ?? [])[activeCustomRoleIndex]?.value
                              ? fallback
                              : prev.aiPromptPrefix
                          }
                        })
                        setActiveRoleKey('preset:0')
                      }}
                    >
                      {lang === 'zh' ? '删除此角色' : 'Delete role'}
                    </button>
                  </div>
                  <input
                    className="form-input"
                    value={activeCustomRoleLabel}
                    placeholder={buildCustomRoleLabel(activeCustomRoleIndex, lang)}
                    onChange={(event) => handleRoleNameChange(event.target.value)}
                  />
                </div>
              )}

              <textarea
                className="form-input role-editor-textarea"
                rows={10}
                value={activeRolePrompt}
                placeholder={lang === 'zh' ? '请输入这个角色的系统提示词...' : 'Enter system prompt for this role...'}
                onChange={(event) => handleRolePromptChange(event.target.value)}
              />
              <div className="role-editor-note">
                {activeRole?.source === 'preset'
                  ? lang === 'zh'
                    ? '编辑预设内容时会自动生成一个新的自定义角色，并设为默认。'
                    : 'Editing a preset creates a new custom role automatically and sets it as default.'
                  : lang === 'zh'
                    ? '你可以持续修改这个角色，保存后会作为默认分析提示词。'
                    : 'You can keep editing this role, and saved content will be used as the default system prompt.'}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="settings-footer">
        <button
          className="btn"
          onClick={() => {
            setForm({ ...settings, customPresets: settings.customPresets ?? [] })
            setAiStatus(null)
            const presetIndex = PROMPT_PRESETS.findIndex((preset) => preset.value === settings.aiPromptPrefix)
            if (presetIndex >= 0) {
              setActiveRoleKey(`preset:${presetIndex}`)
              return
            }

            const customIndex = (settings.customPresets ?? []).findIndex((preset) => preset.value === settings.aiPromptPrefix)
            if (customIndex >= 0) {
              setActiveRoleKey(`custom:${customIndex}`)
              return
            }

            setActiveRoleKey(settings.aiPromptPrefix?.trim() ? 'detached' : 'preset:0')
          }}
        >
          {t.btn_reset}
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner" /> : saved ? t.btn_saved : t.btn_save}
        </button>
      </div>
    </>
  )
}
