import { Notification, BrowserWindow } from 'electron'
import { store, Keyword, Alert, TopicRunRecord, TopicRunArticle, Settings } from './store'
import * as db from './db'
import { applyCachedSecrets } from './secrets'
import { buildQueryFromKeywords } from './query-utils'
import { maybeGenerateAutoBrief } from './briefs'
import {
  evaluateArticles,
  isAiReady,
  resolveSystemPrompt,
  LLMResult
} from './ai-evaluate'

const isDev = process.env.NODE_ENV !== 'production'

let monitorTimer: ReturnType<typeof setInterval> | null = null
let cycleRunning = false
let lastCycleAt: string | null = null

export interface MonitorStatus {
  running: boolean
  status: 'running' | 'paused' | 'idle' | 'missing_api_key'
  message: string
  autoStart: boolean
  lastCycleAt: string | null
}

let monitorStatus: MonitorStatus = {
  running: false,
  status: 'idle',
  message: 'Monitor not started',
  autoStart: true,
  lastCycleAt: null
}

interface SearchArticle {
  id: number
  title: string
  titleZh: string | null
  titleEn: string | null
  url: string
  sourceCode: string | null
  sourceName: string
  language: string | null
  publishedAt: string | null
  summary: string | null
  summaryZh: string | null
  summaryEn: string | null
  sentimentScore: number | null
  sentimentLabel: string | null
  /** Backend importance score 1~10; null if backend hasn't analyzed yet */
  /** 后端重要性评分 1~10，后端尚未分析时为 null */
  importanceScore: number | null
  keywordsZh: string[]
  keywordsEn: string[]
  categories: string[]
  /** Raw API item — all fields preserved */
  /** 原始 API item，保留全部字段 */
  _raw: Record<string, unknown>
}

interface SearchResponsePayload {
  code: number
  message?: string
  data?: {
    total?: number
    items?: Array<Record<string, unknown> & {
      id?: number
      title?: string
      titleZh?: string | null
      titleEn?: string | null
      url?: string
      source?: { name?: string }
      sourceCode?: string
      sourceName?: string
      language?: string
      publishedAt?: string | null
      summary?: string | null
      summaryZh?: string | null
      summaryEn?: string | null
      sentimentScore?: number | null
      sentimentLabel?: string | null
      keywordsZh?: string[] | null
      keywordsEn?: string[] | null
      categories?: string[] | null
      importanceScore?: number | null
      aiAnalysis?: {
        titleZh?: string | null
        titleEn?: string | null
        summaryZh?: string | null
        summaryEn?: string | null
        sentimentScore?: number | null
        sentimentLabel?: string | null
        importanceScore?: number | null
        keywordsZh?: string[] | null
        keywordsEn?: string[] | null
      }
    }>
  }
}

type SearchBatch = {
  total: number
  items: SearchArticle[]
}

type SeverityRank = Record<Alert['severity'], number>

interface KeywordMonitorGroup {
  id: string
  name: string
  keywords: Keyword[]
  query: string
  alertThreshold: number
  customPrompt: string
  previousStatus: Keyword['status']
  seenArticleIds: number[]
  topicImportanceThreshold: number | null
  topicNegativeSentimentThreshold: number | null
}

const ALERT_SEVERITY_RANK: SeverityRank = {
  low: 1,
  medium: 2,
  high: 3
}

function normalizeAlertThreshold(value?: number) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return 0.3
  if (normalized > 0) return normalized
  if (normalized <= -0.8) return 0.1
  if (normalized <= -0.65) return 0.2
  if (normalized <= -0.5) return 0.3
  return 0.4
}

function normalizeMonitorFetchLimit(limit?: number) {
  const normalized = Number(limit)
  if (!Number.isFinite(normalized)) return 20
  return Math.min(Math.max(Math.floor(normalized), 5), 50)
}

function normalizeAiDecisionMode(value: unknown): Settings['aiDecisionMode'] {
  if (value === 'threshold_only' || value === 'hybrid' || value === 'llm_only') return value
  return 'hybrid'
}

function normalizeImportanceThreshold(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 7
  return Math.min(10, Math.max(1, Math.round(n)))
}

function normalizeNegativeSentimentThreshold(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0.25
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function computeSeverity(imp: number | null, sent: number | null): Alert['severity'] {
  const i = imp ?? 0
  const s = sent ?? 0.5
  if (i >= 9 || (i >= 7 && s <= 0.2)) return 'high'
  if (i >= 7 || s <= 0.25) return 'medium'
  return 'low'
}

function normalizeAiPrescreenThreshold(value: unknown) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return 0.3
  if (normalized <= 0) return 0
  if (normalized >= 1) return 1
  return normalized
}

function getTodayKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function broadcastMonitorState() {
  const payload = getMonitorStatus()
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('monitor-state-changed', payload)
  })
}

function setMonitorState(patch: Partial<MonitorStatus>) {
  const settings = store.get('settings') as Settings
  monitorStatus = {
    ...monitorStatus,
    ...patch,
    autoStart: settings.autoStart,
    lastCycleAt
  }
  broadcastMonitorState()
}

export function getMonitorStatus(): MonitorStatus {
  const settings = store.get('settings') as Settings
  return {
    ...monitorStatus,
    autoStart: settings.autoStart,
    lastCycleAt
  }
}

function broadcastKeywordUpdates(updatedKeywords: Keyword[], alert?: Alert) {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return

  updatedKeywords.forEach((keyword, index) => {
    win.webContents.send('monitoring-update', {
      keyword,
      alert: index === 0 ? alert : undefined
    })
  })
}

function broadcastTopicRun(topicRun: TopicRunRecord) {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('topic-run-recorded', topicRun)
  })
}

function focusMainWindowAndOpenAlert(alertId: string) {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  const needsRestore = win.isMinimized() || !win.isVisible()
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  // Delay slightly if window was hidden so it's fully ready before receiving IPC
  const delay = needsRestore ? 150 : 0
  setTimeout(() => {
    win.webContents.send('open-alert-detail', { alertId })
  }, delay)
}

function showAlertNotification(alert: Alert, sound: boolean, lang: 'zh' | 'en') {
  const icon = alert.severity === 'high' ? '🔴' : alert.severity === 'medium' ? '🟡' : '🟢'
  const body = lang === 'en'
    ? (alert.reasonEn ?? alert.reason)
    : alert.reason
  const notification = new Notification({
    title: `${icon} FreeNews Sentinel — ${alert.keywordName}`,
    body: body.length > 100 ? body.slice(0, 97) + '…' : body,
    silent: !sound
  })
  notification.on('click', () => {
    focusMainWindowAndOpenAlert(alert.id)
  })
  notification.show()
}

function pushTopicRun(
  topicRun: TopicRunRecord,
  options?: {
    decisionMode?: string
    prescreenEnabled?: boolean
    prescreenThreshold?: number | null
    newArticleIds?: number[]
  }
) {
  db.insertTopicRun(topicRun, options)
  broadcastTopicRun(topicRun)
}

function getKeywordGroupId(keyword: Keyword) {
  return keyword.groupId ?? keyword.id
}

function getKeywordGroupName(keyword: Keyword) {
  return keyword.groupName?.trim() || keyword.name
}

function getGroupStatus(keywords: Keyword[]): Keyword['status'] {
  if (keywords.length > 0 && keywords.every((keyword) => keyword.status === 'paused')) return 'paused'
  if (keywords.some((keyword) => keyword.status === 'alert')) return 'alert'
  if (keywords.some((keyword) => keyword.status === 'warning')) return 'warning'
  return 'normal'
}

function buildKeywordGroups(keywords: Keyword[]): KeywordMonitorGroup[] {
  const groups = new Map<string, Keyword[]>()

  for (const keyword of keywords) {
    const groupId = getKeywordGroupId(keyword)
    const current = groups.get(groupId) ?? []
    current.push(keyword)
    groups.set(groupId, current)
  }

  return Array.from(groups.entries()).map(([groupId, groupKeywords]) => {
    const representative = groupKeywords[0]
    const seenArticleIds = Array.from(
      new Set(groupKeywords.flatMap((keyword) => keyword.seenArticleIds ?? []))
    ).slice(-200)

    return {
      id: groupId,
      name: getKeywordGroupName(representative),
      keywords: groupKeywords,
      query: buildQueryFromKeywords(groupKeywords),
      alertThreshold: normalizeAlertThreshold(representative.alertThreshold),
      customPrompt: representative.customPrompt,
      previousStatus: getGroupStatus(groupKeywords),
      seenArticleIds,
      topicImportanceThreshold: representative.topicImportanceThreshold ?? null,
      topicNegativeSentimentThreshold: representative.topicNegativeSentimentThreshold ?? null
    }
  })
}

function padHistory(history: number[]) {
  const trimmed = history.slice(-6)
  return trimmed
}

export function toIsoString(value: unknown) {
  if (!value) return null
  let raw = String(value).trim()
  // API-returned timestamps without timezone (e.g. "2026-04-05T19:31:19") are treated as UTC
  // API 返回的时间无时区标识（如 "2026-04-05T19:31:19"），视为 UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !raw.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(raw)) {
    raw += 'Z'
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeSearchItem(
  item: NonNullable<NonNullable<SearchResponsePayload['data']>['items']>[number]
): SearchArticle | null {
  if (!item?.id || !item.title || !item.url) return null

  const titleZh = item.aiAnalysis?.titleZh ?? item.titleZh ?? null
  const titleEn = item.aiAnalysis?.titleEn ?? item.titleEn ?? null

  const summaryZh = item.aiAnalysis?.summaryZh ?? item.summaryZh ?? null
  const summaryEn = item.aiAnalysis?.summaryEn ?? item.summaryEn ?? null
  const summary = summaryZh ?? summaryEn ?? item.summary ?? null

  const sentimentScore = item.aiAnalysis?.sentimentScore ?? item.sentimentScore ?? null
  const sentimentLabel = item.aiAnalysis?.sentimentLabel ?? item.sentimentLabel ?? null
  const importanceRaw = item.aiAnalysis?.importanceScore ?? item.importanceScore ?? null
  const importanceScore =
    typeof importanceRaw === 'number' && Number.isFinite(importanceRaw) ? importanceRaw : null
  const keywordsZh = item.aiAnalysis?.keywordsZh ?? item.keywordsZh ?? []
  const keywordsEn = item.aiAnalysis?.keywordsEn ?? item.keywordsEn ?? []

  return {
    id: Number(item.id),
    title: item.title,
    titleZh,
    titleEn,
    url: item.url,
    sourceCode: (item.sourceCode as string) ?? null,
    sourceName: item.source?.name ?? item.sourceName ?? '',
    language: (item.language as string) ?? null,
    publishedAt: toIsoString(item.publishedAt),
    summary,
    summaryZh,
    summaryEn,
    sentimentScore,
    sentimentLabel,
    importanceScore,
    keywordsZh: Array.isArray(keywordsZh) ? keywordsZh : [],
    keywordsEn: Array.isArray(keywordsEn) ? keywordsEn : [],
    categories: Array.isArray(item.categories) ? (item.categories as string[]) : [],
    _raw: { ...item, aiAnalysis: undefined } as Record<string, unknown>
  }
}

async function searchNews(
  query: string,
  apiKey: string,
  baseUrl: string,
  fetchLimit: number
): Promise<SearchBatch | null> {
  const url = new URL(`${baseUrl}/api/v1/search`)
  url.searchParams.set('keyword', query)
  url.searchParams.set('pageSize', String(fetchLimit))

  const res = await fetch(url.toString(), { headers: { 'X-API-Key': apiKey } })
  let json: SearchResponsePayload | null = null
  try {
    json = (await res.json()) as SearchResponsePayload
  } catch {
    json = null
  }

  if (!res.ok) {
    throw new Error(json?.message || `HTTP ${res.status}`)
  }

  if (!json || json.code !== 0 || !json.data?.items) {
    throw new Error(json?.message || 'Unexpected search API response')
  }

  const items = json.data.items
    .map((item) => normalizeSearchItem(item))
    .filter((item): item is SearchArticle => Boolean(item))

  return {
    total: json.data.total ?? items.length,
    items
  }
}

function dedupeArticles(articles: SearchArticle[]) {
  const seen = new Set<number>()
  const deduped: SearchArticle[] = []
  for (const article of articles) {
    if (seen.has(article.id)) continue
    seen.add(article.id)
    deduped.push(article)
  }
  return deduped
}

function buildRelatedArticles(articles: SearchArticle[]) {
  return articles.slice(0, 5).map((article) => ({
    id: article.id,
    title: article.title,
    titleZh: article.titleZh,
    titleEn: article.titleEn,
    url: article.url,
    sourceName: article.sourceName,
    publishedAt: article.publishedAt,
    summary: article.summary,
    summaryZh: article.summaryZh,
    summaryEn: article.summaryEn,
    sentimentScore: article.sentimentScore,
    sentimentLabel: article.sentimentLabel,
    importanceScore: article.importanceScore,
    keywordsZh: article.keywordsZh ?? [],
    keywordsEn: article.keywordsEn ?? [],
    _raw: article._raw
  }))
}

function buildTopicRunArticles(
  recentArticles: SearchArticle[],
  evaluatedArticles: SearchArticle[],
  results: LLMResult[],
  threshold: number,
  useThresholdFallback: boolean
): TopicRunArticle[] {
  const resultByArticleId = new Map<number, LLMResult>()

  evaluatedArticles.forEach((article, index) => {
    const matched =
      results.find((result) => result.articleId === article.id) ??
      results.find((result) => result.index === index + 1)
    if (matched) {
      resultByArticleId.set(article.id, matched)
    }
  })

  return recentArticles.map((article) => {
    const aiResult = resultByArticleId.get(article.id)
    return {
      id: article.id,
      title: article.title,
      titleZh: article.titleZh,
      titleEn: article.titleEn,
      url: article.url,
      sourceCode: article.sourceCode,
      sourceName: article.sourceName,
      language: article.language,
      publishedAt: article.publishedAt,
      summary: article.summary,
      summaryZh: article.summaryZh,
      summaryEn: article.summaryEn,
      sentimentScore: article.sentimentScore,
      sentimentLabel: article.sentimentLabel,
      importanceScore: article.importanceScore,
      keywordsZh: article.keywordsZh ?? [],
      keywordsEn: article.keywordsEn ?? [],
      categories: article.categories ?? [],
      aiReasoning: aiResult?.reasoning ?? null,
      aiImpact: aiResult?.impactScore ?? null,
      aiImpactDirection: aiResult?.impactDirection ?? null,
      aiUrgency: aiResult?.urgency ?? null,
      aiRelevance: aiResult?.relevanceScore ?? null,
      triggerAlert:
        aiResult?.triggerAlert ??
        (useThresholdFallback && article.sentimentScore !== null && article.sentimentScore < threshold),
      _raw: article._raw
    }
  })
}

function severityRank(severity: Alert['severity']) {
  return ALERT_SEVERITY_RANK[severity]
}

function shouldSuppressAlert(
  groupId: string,
  severity: Alert['severity'],
  cooldownMinutes: number,
  alerts: Alert[]
) {
  const previousAlert = alerts.find((alert) => alert.keywordId === groupId)
  if (!previousAlert) return false

  const elapsed = Date.now() - new Date(previousAlert.timestamp).getTime()
  if (elapsed >= cooldownMinutes * 60 * 1000) return false

  return severityRank(severity) <= severityRank(previousAlert.severity)
}

async function checkGroup(group: KeywordMonitorGroup, settings: Settings) {
  if (group.previousStatus === 'paused' || !settings.freenewsApiKey || !group.query) return

  const nowIso = new Date().toISOString()
  const todayKey = getTodayKey()
  const fetchLimit = normalizeMonitorFetchLimit(settings.monitorFetchLimit)
  const representative = group.keywords[0]
  const baseTodayCount =
    representative.todayCountDate === todayKey ? representative.todayCount : 0

  try {
    // 1) Fetch and normalize latest articles for this topic group.
    const result = await searchNews(
      group.query,
      settings.freenewsApiKey,
      settings.freenewsBaseUrl,
      fetchLimit
    )

    const allArticles = dedupeArticles(result?.items ?? []).slice(0, fetchLimit)
    const totalResults = result?.total ?? allArticles.length
    const latest = allArticles[0] ?? null
    const seenIds = new Set(group.seenArticleIds)
    const newArticles = allArticles.filter((article) => !seenIds.has(article.id))
    const decisionMode = normalizeAiDecisionMode(settings.aiDecisionMode)
    const useAiDecision = decisionMode !== 'threshold_only'
    const aiReady = useAiDecision && isAiReady(settings)
    const prescreenEnabled = Boolean(settings.aiPrescreenEnabled)
    const prescreenThreshold = normalizeAiPrescreenThreshold(settings.aiPrescreenThreshold)
    const impThreshold = group.topicImportanceThreshold != null
      ? normalizeImportanceThreshold(group.topicImportanceThreshold)
      : normalizeImportanceThreshold(settings.importanceThreshold)
    const sentThreshold = group.topicNegativeSentimentThreshold != null
      ? normalizeNegativeSentimentThreshold(group.topicNegativeSentimentThreshold)
      : normalizeNegativeSentimentThreshold(settings.negativeSentimentThreshold)
    const thresholdRiskArticles = newArticles.filter(
      (article) =>
        (article.importanceScore !== null && article.importanceScore >= impThreshold) ||
        (article.sentimentScore !== null && article.sentimentScore <= sentThreshold)
    )
    const aiCandidates =
      useAiDecision
        ? prescreenEnabled
          ? newArticles.filter(
              (article) =>
                article.sentimentScore !== null && article.sentimentScore < prescreenThreshold
            )
          : newArticles
        : []
    const evaluatedArticles = aiCandidates.slice(0, fetchLimit)
    const withScore = allArticles.filter((article) => article.sentimentScore !== null)
    const avgScore =
      withScore.length > 0
        ? withScore.reduce((sum, article) => sum + (article.sentimentScore ?? 0), 0) / withScore.length
        : 0
    const updatedHistory =
      allArticles.length > 0
        ? [...padHistory(representative.sentimentHistory), avgScore].slice(-7)
        : representative.sentimentHistory.slice(-7)
    const updatedSeenIds = [
      ...new Set([...group.seenArticleIds, ...allArticles.map((article) => article.id)])
    ].slice(-200)

    // 2) Decide whether we should alert (threshold-only / hybrid / llm-only).
    let newStatus: Keyword['status'] = allArticles.length === 0 ? group.previousStatus : 'normal'
    let alertReason: string | null = null
    let alertReasonEn: string | null = null
    let alertSeverity: Alert['severity'] = 'low'
    let alertArticle = latest
    let matchedLlmResult: LLMResult | null = null
    let llmResults: LLMResult[] = []
    let relatedAlertArticles: SearchArticle[] =
      thresholdRiskArticles.length > 0 ? thresholdRiskArticles : allArticles
    let aiAttempted = false

    if (aiReady && evaluatedArticles.length > 0) {
      aiAttempted = true
      const prompt = resolveSystemPrompt(group.customPrompt, settings)
      llmResults = await evaluateArticles(evaluatedArticles, prompt, settings)
    }

    const hasUsableLlmResults = llmResults.length > 0
    const useThresholdFallback =
      decisionMode === 'threshold_only' ||
      (useAiDecision && (!aiReady || (aiAttempted && !hasUsableLlmResults)))

    if (hasUsableLlmResults) {
      const triggered = llmResults.filter((result) => result.triggerAlert)
      if (triggered.length > 0) {
        matchedLlmResult = triggered.reduce((strongest, current) =>
          current.impactScore > strongest.impactScore ? current : strongest
        )
        newStatus = matchedLlmResult.urgency === 'high' ? 'alert' : 'warning'
        alertSeverity = newStatus === 'alert' ? 'high' : 'medium'
        alertArticle =
          evaluatedArticles.find((article) => article.id === matchedLlmResult?.articleId) ??
          evaluatedArticles[matchedLlmResult.index - 1] ??
          latest
        alertReason = matchedLlmResult.reasoning
        relatedAlertArticles = evaluatedArticles.filter((article) =>
          llmResults.some((result) => result.triggerAlert && result.articleId === article.id)
        )
      }
    } else if (useThresholdFallback && thresholdRiskArticles.length > 0) {
      const primaryArticle = thresholdRiskArticles.reduce((best, article) => {
        const bestScore = (best.importanceScore ?? 0) * 10 + (1 - (best.sentimentScore ?? 0.5))
        const curScore = (article.importanceScore ?? 0) * 10 + (1 - (article.sentimentScore ?? 0.5))
        return curScore > bestScore ? article : best
      })
      alertSeverity = computeSeverity(primaryArticle.importanceScore, primaryArticle.sentimentScore)
      if (alertSeverity === 'low') alertSeverity = 'medium'
      newStatus = alertSeverity === 'high' ? 'alert' : 'warning'
      const articleTitleZh = primaryArticle?.titleZh ?? primaryArticle?.title ?? group.name
      const articleTitleEn = primaryArticle?.titleEn ?? primaryArticle?.title ?? group.name
      const triggerTagZh = primaryArticle.importanceScore !== null && primaryArticle.importanceScore >= impThreshold
        ? `重要性 ${primaryArticle.importanceScore}/10`
        : `情感分 ${(primaryArticle.sentimentScore ?? 0).toFixed(2)}`
      const triggerTagEn = primaryArticle.importanceScore !== null && primaryArticle.importanceScore >= impThreshold
        ? `importance ${primaryArticle.importanceScore}/10`
        : `sentiment ${(primaryArticle.sentimentScore ?? 0).toFixed(2)}`
      alertReason = `「${group.name}」这一轮新增 ${newArticles.length} 条新闻，其中 ${thresholdRiskArticles.length} 条达到提醒阈值（${triggerTagZh}）。最需要关注的是：${articleTitleZh}`
      alertReasonEn = `"${group.name}" — ${newArticles.length} new article(s) this cycle, ${thresholdRiskArticles.length} reached alert threshold (${triggerTagEn}). Top article: ${articleTitleEn}`
      alertArticle = primaryArticle
    }

    // 3) Persist updated topic state for all keywords in this group.
    const updatedKeywords = group.keywords.map((keyword, index) => ({
      ...keyword,
      groupId: group.id,
      groupName: group.name,
      status: newStatus,
      todayCount: index === 0 ? baseTodayCount + newArticles.length : 0,
      todayCountDate: todayKey,
      lastChecked: nowIso,
      latestArticleTitle: latest?.titleZh ?? latest?.title ?? keyword.latestArticleTitle,
      latestArticleTitleEn: latest?.titleEn ?? latest?.title ?? keyword.latestArticleTitleEn ?? null,
      latestArticleUrl: latest?.url ?? keyword.latestArticleUrl,
      latestArticleSource: latest?.sourceName ?? keyword.latestArticleSource,
      sentimentHistory: updatedHistory,
      seenArticleIds: updatedSeenIds
    }))

    db.saveKeywordsBatch(updatedKeywords)

    // 4) Create and persist alert if status escalated and cooldown allows it.
    let createdAlert: Alert | undefined
    if (newStatus !== 'normal' && group.previousStatus !== newStatus && alertReason && alertArticle) {
      const alerts = db.getAlerts() as Alert[]
      const cooldownMinutes = settings.alertCooldownMinutes ?? 30
      const suppressAlert = shouldSuppressAlert(group.id, alertSeverity, cooldownMinutes, alerts)

      if (!suppressAlert) {
        createdAlert = {
          id: `alert_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          keywordId: group.id,
          keywordName: group.name,
          severity: alertSeverity,
          reason: alertReason,
          reasonEn: alertReasonEn,
          articleTitle: alertArticle.title,
          articleTitleZh: alertArticle.titleZh,
          articleTitleEn: alertArticle.titleEn,
          articleUrl: alertArticle.url,
          articleSource: alertArticle.sourceName,
          articlePublishedAt: alertArticle.publishedAt,
          articleSummary: alertArticle.summary,
          articleSummaryZh: alertArticle.summaryZh,
          articleSummaryEn: alertArticle.summaryEn,
          queryExpression: group.query,
          sentimentScore: alertArticle.sentimentScore,
          sentimentLabel: alertArticle.sentimentLabel,
          articleImportance: alertArticle.importanceScore,
          aiReasoning: matchedLlmResult?.reasoning ?? null,
          aiImpact: matchedLlmResult?.impactScore ?? null,
          aiImpactDirection: matchedLlmResult?.impactDirection ?? null,
          aiUrgency: matchedLlmResult?.urgency ?? null,
          aiRelevance: matchedLlmResult?.relevanceScore ?? null,
          relatedArticles: buildRelatedArticles(relatedAlertArticles),
          timestamp: nowIso,
          read: false
        }

        db.insertAlert(createdAlert)

        if (settings.notifications) {
          showAlertNotification(createdAlert, settings.sound, settings.language ?? 'zh')
        }
      }
    }

    const topicRun: TopicRunRecord = {
      id: `run_${group.id}_${Date.now()}`,
      groupId: group.id,
      groupName: group.name,
      checkedAt: nowIso,
      queryExpression: group.query,
      articleCount: totalResults > 0 ? totalResults : allArticles.length,
      newArticleCount: newArticles.length,
      aiEvaluatedCount: llmResults.length > 0 ? evaluatedArticles.length : 0,
      sampledArticleCount: allArticles.length,
      status: newStatus,
      matchedRegions: [],
      triggered: Boolean(createdAlert),
      alertId: createdAlert?.id ?? null,
      latestArticleTitle: latest?.titleZh ?? latest?.title ?? null,
      latestArticleTitleEn: latest?.titleEn ?? latest?.title ?? null,
      latestArticleUrl: latest?.url ?? null,
      latestArticleSource: latest?.sourceName ?? null,
      reason: alertReason,
      recentArticles: buildTopicRunArticles(
        allArticles.slice(0, fetchLimit),
        evaluatedArticles,
        llmResults,
        sentThreshold,
        useThresholdFallback
      )
    }

    pushTopicRun(topicRun, {
      decisionMode,
      prescreenEnabled,
      prescreenThreshold,
      newArticleIds: newArticles.map((article) => article.id)
    })
    broadcastKeywordUpdates(updatedKeywords, createdAlert)
  } catch (error) {
    console.error(`[Monitor] Error checking group "${group.name}":`, error)
    const topicRun: TopicRunRecord = {
      id: `run_${group.id}_${Date.now()}`,
      groupId: group.id,
      groupName: group.name,
      checkedAt: nowIso,
      queryExpression: group.query,
      articleCount: 0,
      newArticleCount: 0,
      aiEvaluatedCount: 0,
      sampledArticleCount: 0,
      status: group.previousStatus,
      matchedRegions: [],
      triggered: false,
      alertId: null,
      latestArticleTitle: representative.latestArticleTitle,
      latestArticleTitleEn: representative.latestArticleTitleEn ?? null,
      latestArticleUrl: representative.latestArticleUrl,
      latestArticleSource: representative.latestArticleSource,
      reason: `Check failed: ${(error as Error).message}`,
      recentArticles: []
    }
    pushTopicRun(topicRun)
  }
}

async function runCycle() {
  const settings = applyCachedSecrets(store.get('settings') as Settings)
  const keywords = db.getKeywords() as Keyword[]
  if (!settings.freenewsApiKey) {
    setMonitorState({
      running: false,
      status: 'missing_api_key',
      message: 'FreeNews API Key not configured'
    })
    return
  }

  const groups = buildKeywordGroups(keywords)
  for (const group of groups) {
    await checkGroup(group, settings)
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  await maybeGenerateAutoBrief()

  lastCycleAt = new Date().toISOString()
  setMonitorState({
    running: true,
    status: 'running',
    message: `Auto-checking every ${settings.checkInterval} min`
  })
}

async function runCycleSafely() {
  if (cycleRunning) return
  cycleRunning = true
  try {
    await runCycle()
  } finally {
    cycleRunning = false
  }
}

export function startMonitor(force = false) {
  stopMonitor(false)
  const settings = applyCachedSecrets(store.get('settings') as Settings)

  if (!settings.freenewsApiKey) {
    setMonitorState({
      running: false,
      status: 'missing_api_key',
      message: 'FreeNews API Key not configured'
    })
    return
  }

  if (!force && !settings.autoStart) {
    setMonitorState({
      running: false,
      status: 'paused',
      message: 'Auto-monitoring disabled'
    })
    return
  }

  const intervalMs = (settings.checkInterval ?? 5) * 60 * 1000
  if (isDev) console.log(`[Monitor] Starting — interval: ${settings.checkInterval} min`)
  setMonitorState({
    running: true,
    status: 'running',
    message: `Auto-checking every ${settings.checkInterval} min`
  })
  void runCycleSafely()
  monitorTimer = setInterval(() => {
    void runCycleSafely()
  }, intervalMs)
}

export function stopMonitor(updateState = true) {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
    if (isDev) console.log('[Monitor] Stopped')
  }
  if (updateState) {
    setMonitorState({
      running: false,
      status: 'idle',
      message: 'Monitor stopped'
    })
  }
}

export function restartMonitor() {
  stopMonitor(false)
  startMonitor()
}

export function startMonitorNow() {
  startMonitor(true)
  return getMonitorStatus()
}

export function stopMonitorNow() {
  stopMonitor()
  return getMonitorStatus()
}
