import { BrowserWindow, Notification } from 'electron'
import { Brief, Keyword, Settings, store } from './store'
import { applyCachedSecrets } from './secrets'
import { buildQueryFromKeywords } from './query-utils'

interface TopicGroup {
  id: string
  name: string
  queryExpression: string
  status: Keyword['status']
}

interface BriefArticle {
  title: string
  url: string
  sourceName: string
  summary: string | null
  publishedAt: string | null
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function resolveDateRange(dateRange: string) {
  const end = new Date()
  const start = new Date(end)

  if (dateRange === '最近 12 小时') {
    start.setHours(start.getHours() - 12)
    return {
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      startDate: getLocalDateKey(start),
      endDate: getLocalDateKey(end)
    }
  }

  if (dateRange === '最近 24 小时' || dateRange === '今天') {
    start.setHours(start.getHours() - 24)
    return {
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      startDate: getLocalDateKey(start),
      endDate: getLocalDateKey(end)
    }
  }

  if (dateRange === '最近 3 天') {
    start.setDate(start.getDate() - 2)
    start.setHours(0, 0, 0, 0)
    return {
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      startDate: getLocalDateKey(start),
      endDate: getLocalDateKey(end)
    }
  }

  start.setDate(start.getDate() - 6)
  start.setHours(0, 0, 0, 0)
  return {
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    startDate: getLocalDateKey(start),
    endDate: getLocalDateKey(end)
  }
}

function isLocalAiEndpoint(baseUrl: string) {
  return /(^https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseUrl.trim())
}

function hasAiConfig(settings: Settings) {
  const aiBaseUrl = settings.aiBaseUrl?.trim() ?? ''
  const aiModel = settings.aiModel?.trim() ?? ''
  const aiApiKey = settings.aiApiKey?.trim() ?? ''
  return Boolean(aiBaseUrl && aiModel && (aiApiKey || isLocalAiEndpoint(aiBaseUrl)))
}

function buildTopicGroups(keywords: Keyword[]): TopicGroup[] {
  const groups = new Map<string, Keyword[]>()

  for (const keyword of keywords) {
    const groupId = keyword.groupId ?? keyword.id
    const current = groups.get(groupId) ?? []
    current.push(keyword)
    groups.set(groupId, current)
  }

  return Array.from(groups.entries()).map(([groupId, groupKeywords]) => {
    const representative = groupKeywords[0]
    const status =
      groupKeywords.length > 0 && groupKeywords.every((keyword) => keyword.status === 'paused')
        ? 'paused'
        : groupKeywords.some((keyword) => keyword.status === 'alert')
          ? 'alert'
          : groupKeywords.some((keyword) => keyword.status === 'warning')
            ? 'warning'
            : 'normal'

    return {
      id: groupId,
      name: representative.groupName?.trim() || representative.name,
      queryExpression: buildQueryFromKeywords(groupKeywords),
      status
    }
  })
}

async function fetchTopicArticles(
  topic: TopicGroup,
  settings: Settings,
  dateRange: string
): Promise<BriefArticle[]> {
  const { startDateTime, endDateTime, startDate, endDate } = resolveDateRange(dateRange)
  const merged: BriefArticle[] = []
  const url = new URL(`${settings.freenewsBaseUrl}/api/v1/search`)
  url.searchParams.set('keyword', topic.queryExpression)
  url.searchParams.set('pageSize', '8')
  url.searchParams.set('startDate', startDate)
  url.searchParams.set('endDate', endDate)
  url.searchParams.set('startDateTime', startDateTime)
  url.searchParams.set('endDateTime', endDateTime)

  const res = await fetch(url.toString(), {
    headers: { 'X-API-Key': settings.freenewsApiKey }
  })
  if (!res.ok) return []

  const json = (await res.json()) as {
    code: number
    data?: {
      items?: Array<{
        title?: string
        url?: string
        source?: { name?: string }
        sourceName?: string
        publishedAt?: string | null
        summary?: string | null
        summaryZh?: string | null
        summaryEn?: string | null
        aiAnalysis?: {
          summaryZh?: string | null
          summaryEn?: string | null
        }
      }>
    }
  }

  if (json.code !== 0 || !json.data?.items) return []

  json.data.items.forEach((item) => {
    if (!item.title || !item.url) return
    merged.push({
      title: item.title,
      url: item.url,
      sourceName: item.source?.name ?? item.sourceName ?? '未知来源',
      publishedAt: item.publishedAt ?? null,
      summary:
        item.aiAnalysis?.summaryZh ??
        item.aiAnalysis?.summaryEn ??
        item.summaryZh ??
        item.summaryEn ??
        item.summary ??
        null
    })
  })

  const seen = new Set<string>()
  return merged.filter((article) => {
    const key = `${article.url}|${article.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildPrompt(
  topics: Array<{ topic: TopicGroup; articles: BriefArticle[] }>,
  dateRange: string
) {
  const sections = topics
    .map(({ topic, articles }) => {
      const lines = articles.slice(0, 6).map((article) => {
        const summary = article.summary ? `；摘要：${article.summary}` : ''
        return `- ${article.sourceName}｜${article.title}${summary}`
      })

      return `主题：${topic.name}\n命中 ${articles.length} 条\n${lines.join('\n')}`
    })
    .join('\n\n')

  return `你是一名新闻编辑，现在要把最近一段时间的监控结果整理成一份简报。

时间范围：${dateRange}

下面是各主题命中的新闻：

${sections}

请按下面结构输出，语言自然一点，不要写得像宣传文案：

## 总览
用几句话概括这次最值得注意的变化。

## 主题分项
按主题分别写，每个主题说清楚最近发生了什么、需要注意什么。

## 建议关注
列出接下来值得继续盯的点。
`
}

async function requestBriefFromAi(settings: Settings, prompt: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (settings.aiApiKey.trim()) {
    headers.Authorization = `Bearer ${settings.aiApiKey}`
  }

  const res = await fetch(`${settings.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.aiModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.3
    })
  })

  if (!res.ok) {
    throw new Error(`AI HTTP ${res.status}`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return json.choices?.[0]?.message?.content?.trim() ?? ''
}

function broadcastBriefCreated(brief: Brief) {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('brief-created', brief)
  })
}

function showBriefNotification(brief: Brief, sound: boolean) {
  const title = brief.topics?.[0] ?? brief.keywords[0] ?? '简报'
  const notification = new Notification({
    title: `📋 新简报已生成`,
    body: brief.topics && brief.topics.length > 1 ? `${title} 等 ${brief.topics.length} 个主题` : title,
    silent: !sound
  })
  notification.show()
}

export async function generateBriefForTopics(options: {
  topicIds: string[]
  dateRange: string
  autoGenerated?: boolean
}) {
  void options
  const settings = applyCachedSecrets(store.get('settings') as Settings)
  if (!settings.freenewsApiKey) return { ok: false, message: 'Please configure FreeNews API Key first' }
  return { ok: false, message: 'Advanced analysis feature is under development' }
}

export async function maybeGenerateAutoBrief() {
  return
}
