import { Settings } from './store'
import { PROMPT_PRESETS } from '../renderer/src/presets'

type ImpactDirection = 'negative' | 'neutral' | 'positive'

export interface LLMResult {
  articleId?: number
  index: number
  sentimentScore: number | null
  relevanceScore: number
  impactScore: number
  impactDirection: ImpactDirection
  urgency: 'low' | 'medium' | 'high'
  triggerAlert: boolean
  reasoning: string
}

export interface EvaluateArticleInput {
  id: number
  title: string
  titleZh: string | null
  titleEn: string | null
  summary: string | null
  summaryZh: string | null
  summaryEn: string | null
  sourceName: string
  publishedAt: string | null
  sentimentScore: number | null
  sentimentLabel: string | null
  keywordsZh: string[]
  keywordsEn: string[]
  categories: string[]
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function isLocalAiEndpoint(baseUrl: string) {
  return /(^https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseUrl.trim())
}

export function isAiReady(settings: Settings): boolean {
  if (!settings.aiEnabled) return false
  const baseUrl = settings.aiBaseUrl?.trim() ?? ''
  const model = settings.aiModel?.trim() ?? ''
  const apiKey = settings.aiApiKey?.trim() ?? ''
  if (!baseUrl || !model) return false
  if (settings.aiProviderType === 'anthropic') return Boolean(apiKey)
  return Boolean(apiKey || isLocalAiEndpoint(baseUrl))
}

export function resolveSystemPrompt(customPrompt: string, settings: Settings): string {
  const raw = customPrompt?.trim() ?? ''

  if (!raw) return settings.aiPromptPrefix

  if (raw.startsWith('preset:')) {
    const index = Number(raw.slice('preset:'.length))
    return PROMPT_PRESETS[index]?.value ?? settings.aiPromptPrefix
  }

  if (raw.startsWith('custom:')) {
    const index = Number(raw.slice('custom:'.length))
    return settings.customPresets?.[index]?.value ?? settings.aiPromptPrefix
  }

  return raw
}

function buildUserPrompt(articles: EvaluateArticleInput[]) {
  const items = articles.map((article, idx) => ({
    index: idx + 1,
    article_id: article.id,
    title_zh: article.titleZh ?? null,
    title_en: article.titleEn ?? null,
    title: article.title,
    summary_zh: article.summaryZh ?? null,
    summary_en: article.summaryEn ?? null,
    summary: article.summary ?? null,
    source: article.sourceName,
    published_at: article.publishedAt,
    sentiment_score: article.sentimentScore,
    sentiment_label: article.sentimentLabel,
    keywords_zh: article.keywordsZh,
    keywords_en: article.keywordsEn,
    categories: article.categories
  }))

  return `请按给定角色逐条评估下面的新闻。请只返回 JSON 数组，不要返回解释、Markdown 或代码块。

返回字段必须使用 camelCase，且所有分数字段范围都为 0~1（保留 2 位小数）。

返回格式：
[
  {
    "index": 1,
    "articleId": 123456,
    "sentimentScore": 0.18,
    "relevanceScore": 0.87,
    "impactScore": 0.76,
    "impactDirection": "negative",
    "urgency": "high",
    "triggerAlert": true,
    "reasoning": "1-2句中文，直接说明这条信息改变了什么"
  }
]

字段说明：
- index: 与输入新闻序号一致（从 1 开始）
- articleId: 输入里有 article_id 就原样返回
- sentimentScore: 0~1，越低越偏负面
- relevanceScore: 0~1，越高越相关
- impactScore: 0~1，越高影响越大
- impactDirection: "negative" | "neutral" | "positive"
- urgency: "low" | "medium" | "high"
- triggerAlert: 仅在确实值得提醒时设为 true
- reasoning: 必须中文，简洁直接

硬性要求：
- 只返回 JSON 数组
- 不要输出数组外的任何文字
- 不要输出 null 字段，无值时可省略可选字段

待评估新闻：
${JSON.stringify(items, null, 2)}`
}

function getTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('\n')
  }
  return ''
}

function extractJsonArray(text: string) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = (fenceMatch?.[1] ?? text).trim()
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []

  try {
    const parsed = JSON.parse(source.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizeUrgency(value: unknown): LLMResult['urgency'] {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'low'
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function normalizeSentimentScore(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric < 0) return 0
  if (numeric > 1 && numeric <= 10) return clampUnit(numeric / 10)
  return clampUnit(numeric)
}

function normalizeRelevanceScore(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  if (numeric > 1 && numeric <= 10) return clampUnit(numeric / 10)
  return clampUnit(numeric)
}

function normalizeImpactScore(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  const abs = Math.abs(numeric)
  if (abs > 1 && abs <= 10) return clampUnit(abs / 10)
  return clampUnit(abs)
}

function normalizeImpactDirection(value: unknown, legacyImpact: number | null): ImpactDirection {
  if (value === 'negative' || value === 'neutral' || value === 'positive') return value
  if (legacyImpact !== null) {
    if (legacyImpact < 0) return 'negative'
    if (legacyImpact > 0) return 'positive'
  }
  return 'neutral'
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}

function normalizeResult(
  value: unknown,
  fallbackIndex: number,
  articleId: number
): LLMResult | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const index = Number(item.index)
  const articleIdValue = Number(item.articleId)
  const legacyImpact = Number.isFinite(Number(item.impact)) ? Number(item.impact) : null
  const reasoning = typeof item.reasoning === 'string' ? item.reasoning.trim() : ''

  if (!reasoning) return null

  return {
    articleId: Number.isFinite(articleIdValue) && articleIdValue > 0 ? articleIdValue : articleId,
    index: Number.isFinite(index) && index > 0 ? index : fallbackIndex,
    sentimentScore: normalizeSentimentScore(item.sentimentScore),
    relevanceScore: normalizeRelevanceScore(item.relevanceScore ?? item.relevance),
    impactScore: normalizeImpactScore(item.impactScore ?? item.impact),
    impactDirection: normalizeImpactDirection(item.impactDirection, legacyImpact),
    urgency: normalizeUrgency(item.urgency),
    triggerAlert: normalizeBoolean(item.triggerAlert ?? item.trigger_alert),
    reasoning
  }
}

const AI_REQUEST_TIMEOUT_MS = 25000

async function fetchWithTimeout(input: string, init: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`AI request timed out (>${Math.floor(AI_REQUEST_TIMEOUT_MS / 1000)}s)`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function callOpenAiCompatible(
  articles: EvaluateArticleInput[],
  systemPrompt: string,
  settings: Settings
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  const apiKey = settings.aiApiKey?.trim()
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const res = await fetchWithTimeout(`${trimTrailingSlash(settings.aiBaseUrl)}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.aiModel,
      temperature: 0.2,
      max_tokens: 1600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildUserPrompt(articles) }
      ]
    })
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }

  return getTextContent(json.choices?.[0]?.message?.content)
}

async function callAnthropic(
  articles: EvaluateArticleInput[],
  systemPrompt: string,
  settings: Settings
) {
  const res = await fetchWithTimeout(`${trimTrailingSlash(settings.aiBaseUrl)}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.aiApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.aiModel,
      max_tokens: 1600,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: buildUserPrompt(articles) }]
    })
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }

  const textBlocks = (json.content ?? [])
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')

  return textBlocks.join('\n')
}

export async function evaluateArticles(
  articles: EvaluateArticleInput[],
  systemPrompt: string,
  settings: Settings
): Promise<LLMResult[]> {
  if (!isAiReady(settings) || articles.length === 0) return []

  const results: LLMResult[] = []
  const batchSize = 10

  for (let offset = 0; offset < articles.length; offset += batchSize) {
    const batch = articles.slice(offset, offset + batchSize)

    try {
      const rawText =
        settings.aiProviderType === 'anthropic'
          ? await callAnthropic(batch, systemPrompt, settings)
          : await callOpenAiCompatible(batch, systemPrompt, settings)

      const parsed = extractJsonArray(rawText)
      const normalized = parsed
        .map((item, idx) => normalizeResult(item, idx + 1, batch[idx]?.id ?? 0))
        .filter((item): item is LLMResult => Boolean(item && item.articleId))

      normalized.forEach((item) => {
        const articleId = batch[item.index - 1]?.id ?? item.articleId
        if (!articleId) return
        results.push({
          ...item,
          articleId
        })
      })
    } catch (error) {
      console.error('[AI] evaluate batch failed:', error)
    }
  }

  return results
}
