import { app, shell, BrowserWindow, ipcMain, nativeTheme, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { store, Keyword, Alert, Brief, Settings, TopicRunRecord } from './store'
import { DEFAULT_PROMPT_PREFIX } from './constants'
import * as db from './db'
import { applyCachedSecrets, hasSecureSecretStorage, initSecretStore, saveSecrets, stripSecrets, withSecrets } from './secrets'
import { generateBriefForTopics } from './briefs'
import { buildQueryFromTerms } from './query-utils'
import {
  startMonitor,
  stopMonitor,
  restartMonitor,
  startMonitorNow,
  stopMonitorNow,
  getMonitorStatus,
  toIsoString
} from './monitor'

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#070b12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  nativeTheme.themeSource = 'dark'

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('site.freenews.sentinel')

  await initSecretStore()
  const persistedSettings = store.get('settings') as Settings
  const hasPlaintextSecrets = Boolean(
    persistedSettings?.freenewsApiKey?.trim() || persistedSettings?.aiApiKey?.trim()
  )
  if (hasPlaintextSecrets && hasSecureSecretStorage()) {
    await saveSecrets(persistedSettings)
    store.set('settings', hasSecureSecretStorage() ? stripSecrets(persistedSettings) : persistedSettings)
  }

  db.initDataStore()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  startMonitor()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopMonitor()
    app.quit()
  }
})

function getTodayKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface FreenewsQuotaSnapshot {
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

type MockAlertLevel = 'high' | 'medium' | 'low'

interface TopicQueryPreviewItem {
  id: number
  title: string
  titleZh: string | null
  titleEn: string | null
  url: string
  sourceName: string
  publishedAt: string | null
  summary: string | null
  summaryZh: string | null
  summaryEn: string | null
  sentimentScore: number | null
  sentimentLabel: string | null
  keywordsZh: string[]
  keywordsEn: string[]
}

interface TopicNewsDetail {
  id: number
  title: string
  titleZh: string | null
  summary: string | null
  summaryZh: string | null
  content: string | null
  contentTruncated: boolean
  url: string
  sourceName: string
  publishedAt: string | null
  sentimentScore: number | null
  sentimentLabel: string | null
  keywordsZh: string[]
}

function getMainWindow() {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function focusMainWindow() {
  const win = getMainWindow()
  if (!win) return null
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  return win
}

function emitOpenAlertDetail(alertId: string) {
  const win = focusMainWindow()
  if (!win) return
  win.webContents.send('open-alert-detail', { alertId })
}

function showAlertNotification(alert: Alert, sound: boolean, icon?: string) {
  const notification = new Notification({
    title: `${icon ?? '🟡'} FreeNews Sentinel — ${alert.keywordName}`,
    body: alert.reason,
    silent: !sound
  })
  notification.on('click', () => {
    emitOpenAlertDetail(alert.id)
  })
  notification.show()
}

function normalizeAlert(alert: Partial<Alert> & Pick<Alert, 'id' | 'keywordId' | 'keywordName' | 'severity' | 'reason' | 'articleTitle' | 'articleUrl' | 'timestamp' | 'read'>): Alert {
  return {
    articleTitleZh: null,
    articleTitleEn: null,
    articleSource: null,
    articlePublishedAt: null,
    articleSummary: null,
    articleSummaryZh: null,
    articleSummaryEn: null,
    queryExpression: null,
    sentimentScore: null,
    sentimentLabel: null,
    aiReasoning: null,
    aiImpact: null,
    aiImpactDirection: null,
    aiUrgency: null,
    aiRelevance: null,
    relatedArticles: [],
    ...alert,
    reasonEn: alert.reasonEn ?? null,
    articleImportance: alert.articleImportance ?? null
  }
}

function effectiveQuotaRemaining(quota: FreenewsQuotaSnapshot) {
  return quota.effectiveRemaining ?? Math.max(0, Math.min(quota.dailyRemaining, quota.monthlyRemaining))
}

function isUnlimitedQuotaValue(value: number | null | undefined) {
  return value === -1
}

function isLocalAiEndpoint(baseUrl: string) {
  return /(^https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseUrl.trim())
}

function normalizePreviewItem(item: Record<string, unknown>): TopicQueryPreviewItem | null {
  const id = Number(item.id)
  const title = typeof item.title === 'string' ? item.title : ''
  const url = typeof item.url === 'string' ? item.url : ''

  if (!id || !title || !url) return null

  const sourceName =
    (item.source && typeof item.source === 'object' && 'name' in item.source
      ? (item.source as { name?: string }).name
      : undefined) ??
    (typeof item.sourceName === 'string' ? item.sourceName : undefined) ??
    '未知来源'

  const publishedAt =
    typeof item.publishedAt === 'string' && item.publishedAt ? toIsoString(item.publishedAt) : null

  const aiAnalysis =
    item.aiAnalysis && typeof item.aiAnalysis === 'object'
      ? (item.aiAnalysis as {
          titleZh?: string | null
          titleEn?: string | null
          summaryZh?: string | null
          summaryEn?: string | null
          sentimentScore?: number | null
          sentimentLabel?: string | null
          keywordsZh?: string[] | null
          keywordsEn?: string[] | null
        })
      : undefined

  const titleZh = aiAnalysis?.titleZh ?? (typeof item.titleZh === 'string' ? item.titleZh : null)
  const titleEn = aiAnalysis?.titleEn ?? (typeof item.titleEn === 'string' ? item.titleEn : null)
  const summaryZh = aiAnalysis?.summaryZh ?? (typeof item.summaryZh === 'string' ? item.summaryZh : null)
  const summaryEn = aiAnalysis?.summaryEn ?? (typeof item.summaryEn === 'string' ? item.summaryEn : null)
  const summary = summaryZh ?? summaryEn ?? (typeof item.summary === 'string' ? item.summary : null)
  const sentimentScore = aiAnalysis?.sentimentScore ?? (typeof item.sentimentScore === 'number' ? item.sentimentScore : null)
  const sentimentLabel = aiAnalysis?.sentimentLabel ?? (typeof item.sentimentLabel === 'string' ? item.sentimentLabel : null)
  const keywordsZh = aiAnalysis?.keywordsZh ?? (Array.isArray(item.keywordsZh) ? item.keywordsZh as string[] : [])
  const keywordsEn = aiAnalysis?.keywordsEn ?? (Array.isArray(item.keywordsEn) ? item.keywordsEn as string[] : [])

  return {
    id,
    title,
    titleZh,
    titleEn,
    url,
    sourceName,
    publishedAt,
    summary,
    summaryZh,
    summaryEn,
    sentimentScore,
    sentimentLabel,
    keywordsZh: Array.isArray(keywordsZh) ? keywordsZh : [],
    keywordsEn: Array.isArray(keywordsEn) ? keywordsEn : []
  }
}

async function fetchNewsDetail(id: number, apiKey: string, baseUrl: string): Promise<TopicNewsDetail> {
  const url = new URL(`${baseUrl}/api/v1/news/${id}`)
  const res = await fetch(url.toString(), { headers: { 'X-API-Key': apiKey } })
  if (!res.ok) {
    throw new Error(`Failed to fetch news detail: HTTP ${res.status}`)
  }

  const json = (await res.json()) as {
    code: number
    message?: string
    data?: {
      id?: number
      title?: string
      summary?: string | null
      content?: string | null
      contentTruncated?: boolean | null
      url?: string
      publishedAt?: string | null
      source?: { name?: string }
      aiAnalysis?: {
        titleZh?: string | null
        summaryZh?: string | null
        sentimentScore?: number | null
        sentimentLabel?: string | null
        keywordsZh?: string[] | null
      }
    }
  }

  if (json.code !== 0 || !json.data?.id || !json.data?.title || !json.data?.url) {
    throw new Error(json.message ?? 'Unexpected news detail response')
  }

  return {
    id: Number(json.data.id),
    title: json.data.title,
    titleZh: json.data.aiAnalysis?.titleZh ?? null,
    summary: json.data.summary ?? null,
    summaryZh: json.data.aiAnalysis?.summaryZh ?? null,
    content: json.data.content ?? null,
    contentTruncated: Boolean(json.data.contentTruncated),
    url: json.data.url,
    sourceName: json.data.source?.name ?? '未知来源',
    publishedAt: toIsoString(json.data.publishedAt),
    sentimentScore: json.data.aiAnalysis?.sentimentScore ?? null,
    sentimentLabel: json.data.aiAnalysis?.sentimentLabel ?? null,
    keywordsZh: json.data.aiAnalysis?.keywordsZh ?? []
  }
}

async function runTopicPreviewSearch(
  query: string,
  apiKey: string,
  baseUrl: string,
  fetchLimit: number
) {
  const mergedItems: TopicQueryPreviewItem[] = []
  const url = new URL(`${baseUrl}/api/v1/search`)
  url.searchParams.set('keyword', query)
  url.searchParams.set('pageSize', String(fetchLimit))

  const res = await fetch(url.toString(), { headers: { 'X-API-Key': apiKey } })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const json = (await res.json()) as {
    code: number
    message?: string
    data?: {
      total?: number
      items?: Array<Record<string, unknown>>
    }
  }

  if (json.code !== 0 || !json.data?.items) {
    throw new Error(json.message ?? 'Unexpected search API response')
  }

  const total = json.data.total ?? json.data.items.length
  mergedItems.push(
    ...json.data.items
      .map((item) => normalizePreviewItem(item))
      .filter((item): item is TopicQueryPreviewItem => Boolean(item))
  )

  const seen = new Set<number>()
  const items = mergedItems.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  return {
    total,
    items: items.slice(0, fetchLimit)
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// Settings — backfill fields missing in older schema versions (backward-compatible)
// Settings — 加载时补全旧版本缺失的字段（向后兼容）
ipcMain.handle('get-settings', async () => {
  const s = store.get('settings') as Settings
  const defaults: Partial<Settings> = {
    aiEnabled: false,
    aiProviderType: 'openai',
    aiPromptPrefix: DEFAULT_PROMPT_PREFIX,
    aiDecisionMode: 'hybrid',
    aiPrescreenEnabled: false,
    aiPrescreenThreshold: 0.3,
    alertCooldownMinutes: 30,
    autoBriefEnabled: false,
    autoBriefIntervalHours: 12,
    monitorFetchLimit: 20,
    timezone: 'Asia/Shanghai',
    language: 'zh',
    theme: 'dark',
    importanceThreshold: 7,
    negativeSentimentThreshold: 0.25
  }

  const merged = {
    ...defaults,
    ...(s as Partial<Settings>)
  } as Settings

  return withSecrets(merged)
})

ipcMain.handle('save-settings', async (_, settings: Settings) => {
  await saveSecrets(settings)
  store.set('settings', hasSecureSecretStorage() ? stripSecrets(settings) : settings)
  restartMonitor()
  return { ok: true }
})

// Keywords — backward-compatible with legacy field name (languages -> regions)
// Keywords — 向后兼容旧字段名（languages → regions）
ipcMain.handle('get-keywords', () => {
  const keywords = db.getKeywords() as (Keyword & { languages?: string[] })[]
  const todayKey = getTodayKey()
  return keywords.map((k) => ({
    ...k,
    customPrompt: k.customPrompt ?? '',
    groupId: k.groupId ?? k.id,
    groupName: k.groupName ?? k.name,
    regions: k.regions ?? k.languages ?? [],
    topicImportanceThreshold: k.topicImportanceThreshold ?? null,
    topicNegativeSentimentThreshold: k.topicNegativeSentimentThreshold ?? null,
    todayCount: k.todayCountDate === todayKey ? k.todayCount : 0,
    todayCountDate: todayKey
  }))
})

ipcMain.handle('save-keyword', (_, keyword: Keyword) => {
  try {
    const normalizedKeyword: Keyword = {
      ...keyword,
      customPrompt: keyword.customPrompt ?? '',
      groupId: keyword.groupId ?? keyword.id,
      groupName: keyword.groupName ?? keyword.name,
      regions: keyword.regions ?? [],
      topicImportanceThreshold: keyword.topicImportanceThreshold ?? null,
      topicNegativeSentimentThreshold: keyword.topicNegativeSentimentThreshold ?? null
    }
    db.saveKeyword(normalizedKeyword)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})

ipcMain.handle('delete-keyword', (_, id: string) => {
  try {
    db.deleteKeyword(id)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})

ipcMain.handle('toggle-keyword-pause', (_, id: string) => {
  try {
    db.toggleKeywordPause(id)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})

ipcMain.handle(
  'test-topic-query',
  async (
    _,
    { terms }: { terms: string[] }
  ) => {
    const settings = applyCachedSecrets(store.get('settings') as Settings)
    if (!settings.freenewsApiKey) {
      return { ok: false, message: 'Please configure FreeNews API Key first' }
    }

    const query = buildQueryFromTerms(terms)
    if (!query) {
      return { ok: false, message: 'Please enter at least one monitoring keyword' }
    }

    try {
      const preview = await runTopicPreviewSearch(
        query,
        settings.freenewsApiKey,
        settings.freenewsBaseUrl,
        settings.monitorFetchLimit ?? 20
      )

      let verdict = 'Match range is moderate'
      if (preview.total === 0) verdict = 'Criteria too narrow, may not capture any news'
      else if (preview.total >= 120) verdict = 'Criteria too broad, consider narrowing topic keywords'
      else if (preview.total >= 40) verdict = 'Many matches, consider whether more precision is needed'

      return {
        ok: true,
        query,
        total: preview.total,
        verdict,
        items: preview.items
      }
    } catch (error) {
      return {
        ok: false,
        message: `Test failed: ${(error as Error).message}`
      }
    }
  }
)

// Alerts
ipcMain.handle('get-alerts', () =>
  db.getAlerts().map((alert) => normalizeAlert(alert))
)
ipcMain.handle('get-topic-runs', () => db.getTopicRuns() as TopicRunRecord[])
ipcMain.handle('get-news-detail', async (_, id: number) => {
  const settings = applyCachedSecrets(store.get('settings') as Settings)
  if (!settings.freenewsApiKey) {
    return { ok: false, message: 'Please configure FreeNews API Key first' }
  }

  try {
    const detail = await fetchNewsDetail(id, settings.freenewsApiKey, settings.freenewsBaseUrl)
    return { ok: true, detail }
  } catch (error) {
    return {
      ok: false,
      message: `Failed to load news detail: ${(error as Error).message}`
    }
  }
})

ipcMain.handle('trigger-mock-alert', (_, level: MockAlertLevel = 'high') => {
  const keywords = db.getKeywords() as Keyword[]
  const topicRuns = db.getTopicRuns() as TopicRunRecord[]
  const settings = store.get('settings') as Settings
  const targetKeyword = keywords[0]
  const topicId = targetKeyword?.groupId ?? targetKeyword?.id ?? 'mock_group'
  const topicName = targetKeyword?.groupName ?? targetKeyword?.name ?? '测试主题'
  const latestRun = [...topicRuns]
    .filter((run) => run.groupId === topicId)
    .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())[0]
  const realArticleTitle = latestRun?.latestArticleTitle ?? targetKeyword?.latestArticleTitle ?? ''
  const realArticleUrl = latestRun?.latestArticleUrl ?? targetKeyword?.latestArticleUrl ?? ''
  const realArticleSource = latestRun?.latestArticleSource ?? targetKeyword?.latestArticleSource ?? ''

  const mockTemplates: Record<
    MockAlertLevel,
    {
      severity: Alert['severity']
      icon: string
      reason: string
      articleTitle: string
      summary: string
      aiReasoning: string
      aiImpact: number
      aiImpactDirection: 'negative' | 'neutral' | 'positive'
      aiRelevance: number
    }
  > = {
    high: {
      severity: 'high',
      icon: '🔴',
      reason: `${topicName} 这一轮新增消息偏密，而且都指向同一类风险，需要尽快看一下。`,
      articleTitle: realArticleTitle || `${topicName} 相关消息密集出现，短线风险升高`,
      summary: realArticleUrl
        ? '这条测试提醒引用了该主题最近命中的一条真实新闻，用来预览通知和详情页的样子。'
        : '这是一条测试提醒，用来查看警报详情页的布局和字段，没有附带真实原文。',
      aiReasoning: '最近一轮新增内容集中在同一方向，负面程度和紧迫性都偏高，所以按高危来提醒。',
      aiImpact: 0.92,
      aiImpactDirection: 'negative',
      aiRelevance: 0.88
    },
    medium: {
      severity: 'medium',
      icon: '🟡',
      reason: `${topicName} 的新消息开始变多，情绪也有点往下走，先提醒你看一眼。`,
      articleTitle: realArticleTitle || `${topicName} 出现连续新消息，短期波动值得关注`,
      summary: realArticleUrl
        ? '这条测试提醒引用了该主题最近命中的一条真实新闻，用来预览详情页。'
        : '这是一条测试提醒，用来查看详情弹窗的展示效果。',
      aiReasoning: '热度确实在往上走，但还没到必须马上处理的程度，先作为预警比较合适。',
      aiImpact: 0.64,
      aiImpactDirection: 'negative',
      aiRelevance: 0.74
    },
    low: {
      severity: 'low',
      icon: '🟢',
      reason: `${topicName} 这轮波动已经回落了，先放一条恢复类提醒给你看效果。`,
      articleTitle: realArticleTitle || `${topicName} 波动回落，风险暂时缓和`,
      summary: realArticleUrl
        ? '这条测试提醒引用了该主题最近命中的一条真实新闻，用来预览恢复类警报。'
        : '这是一条恢复类测试提醒，没有附带真实原文链接。',
      aiReasoning: '最近一轮新增内容没有继续往坏的方向走，所以更像一条状态回落提醒。',
      aiImpact: 0.22,
      aiImpactDirection: 'positive',
      aiRelevance: 0.58
    }
  }

  const selected = mockTemplates[level]

  const alert: Alert = {
    id: `alert_mock_${level}_${Date.now()}`,
    keywordId: topicId,
    keywordName: topicName,
    severity: selected.severity,
    reason: selected.reason,
    reasonEn: null,
    articleTitle: selected.articleTitle,
    articleTitleZh: null,
    articleTitleEn: null,
    articleUrl: realArticleUrl,
    articleSource: realArticleSource || '测试数据',
    articlePublishedAt: new Date().toISOString(),
    articleSummary: selected.summary,
    articleSummaryZh: null,
    articleSummaryEn: null,
    queryExpression: buildQueryFromTerms(
      keywords
        .filter((keyword) => (keyword.groupId ?? keyword.id) === topicId)
        .map((keyword) => keyword.name)
    ),
    sentimentScore: level === 'high' ? 0.12 : level === 'medium' ? 0.28 : 0.66,
    sentimentLabel: level === 'low' ? 'positive' : 'negative',
    aiReasoning: selected.aiReasoning,
    aiImpact: selected.aiImpact,
    aiImpactDirection: selected.aiImpactDirection,
    aiUrgency: level === 'high' ? 'high' : level === 'medium' ? 'medium' : 'low',
    aiRelevance: selected.aiRelevance,
    articleImportance: null,
    relatedArticles: realArticleUrl
      ? [
          {
            id: null,
            title: selected.articleTitle,
            titleZh: null,
            titleEn: null,
            url: realArticleUrl,
            sourceName: realArticleSource || '测试数据',
            publishedAt: new Date().toISOString(),
            summary: '这条测试提醒引用了最近一次命中的真实新闻。',
            summaryZh: null,
            summaryEn: null,
            sentimentScore: null,
            sentimentLabel: null,
            importanceScore: null,
            keywordsZh: [],
            keywordsEn: []
          }
        ]
      : [],
    timestamp: new Date().toISOString(),
    read: false
  }

  db.insertAlert(alert)

  showAlertNotification(alert, settings.sound, selected.icon)

  return alert
})

ipcMain.handle('mark-alert-read', (_, id: string) => {
  try {
    db.markAlertRead(id)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})

ipcMain.handle('mark-alert-unread', (_, id: string) => {
  try {
    db.markAlertUnread(id)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})

ipcMain.handle('mark-all-alerts-read', () => {
  try {
    db.markAllAlertsRead()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})

ipcMain.handle('clear-alerts', () => {
  try {
    db.clearAlerts()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})

// Briefs
ipcMain.handle('get-briefs', () => db.getBriefs())

ipcMain.handle('save-brief', (_, brief: Brief) => {
  try {
    db.saveBrief(brief)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
})

// Stats
ipcMain.handle('get-stats', () => db.getStats())

ipcMain.handle('get-monitor-status', () => getMonitorStatus())
ipcMain.handle('start-monitor', () => startMonitorNow())
ipcMain.handle('stop-monitor', () => stopMonitorNow())
ipcMain.handle('open-external', async (_, url: string) => {
  await shell.openExternal(url)
  return { ok: true }
})

// Test connections
ipcMain.handle('test-freenews', async (_, { apiKey, baseUrl }: { apiKey: string; baseUrl: string }) => {
  try {
    const res = await fetch(`${baseUrl}/api/v1/account/quota`, {
      headers: { 'X-API-Key': apiKey }
    })
    const json = (await res.json()) as {
      code: number
      message: string
      data?: FreenewsQuotaSnapshot
    }
    if (json.code === 0) {
      const quota = json.data
      const remaining = quota ? effectiveQuotaRemaining(quota) : null
      return {
        ok: true,
        message: quota
          ? isUnlimitedQuotaValue(remaining)
            ? 'Connected · Unlimited'
            : quota.monthlyRemaining <= 0
            ? `Monthly quota exhausted · ${quota.callsMonth}/${quota.monthlyLimit}`
            : quota.dailyRemaining <= 0
              ? `Daily quota exhausted · ${quota.callsToday}/${quota.dailyLimit}`
              : `Connected · ${remaining} remaining`
          : 'Connected',
        quota
      }
    }
    return { ok: false, message: json.message || 'API returned an error, please check your API Key' }
  } catch (e) {
    return { ok: false, message: `Connection failed: ${(e as Error).message}` }
  }
})

ipcMain.handle('test-ai', async (_, {
  baseUrl,
  apiKey,
  model,
  providerType
}: {
  baseUrl: string
  apiKey: string
  model: string
  providerType?: 'openai' | 'anthropic'
}) => {
  try {
    const normalizedProvider = providerType === 'anthropic' ? 'anthropic' : 'openai'
    const trimmedBaseUrl = baseUrl.replace(/\/+$/, '')
    let res: Response

    if (normalizedProvider === 'anthropic') {
      res = await fetch(`${trimmedBaseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Reply with ok.' }]
        })
      })
    } else {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      if (apiKey.trim()) {
        headers.Authorization = `Bearer ${apiKey}`
      } else if (!isLocalAiEndpoint(trimmedBaseUrl)) {
        return { ok: false, message: 'Missing API Key' }
      }

      res = await fetch(`${trimmedBaseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
          max_tokens: 5
        })
      })
    }

    if (res.ok) {
      return { ok: true, message: `Connected · Model: ${model}` }
    }
    return { ok: false, message: `HTTP ${res.status}: ${res.statusText}` }
  } catch (e) {
    return { ok: false, message: `Connection failed: ${(e as Error).message}` }
  }
})

// Generate brief
ipcMain.handle('generate-brief', async (_, { topicIds, dateRange }: { topicIds: string[]; dateRange: string }) => {
  try {
    return await generateBriefForTopics({ topicIds, dateRange, autoGenerated: false })
  } catch (e) {
    return { ok: false, message: `Generation failed: ${(e as Error).message}` }
  }
})
