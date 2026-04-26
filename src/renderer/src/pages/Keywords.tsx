import { useEffect, useState } from 'react'
import { useStore, Keyword, TopicRunRecord, TopicRunArticle } from '../store'
import { FREENEWS_SITE_URL } from '../constants'
import { relativeTime as _relativeTime, shortTime, sentimentColor, sentimentLocalized } from '../utils'
import { useLocale, pickField, pickArrayField, type TranslationKeys } from '../i18n'
import { PROMPT_PRESETS } from '../presets'

type GroupStatus = Keyword['status']

interface KeywordGroup {
  id: string
  name: string
  keywords: Keyword[]
  status: GroupStatus
  todayCount: number
  lastChecked: string | null
  latestArticleTitle: string | null
  latestArticleTitleEn: string | null
  latestArticleUrl: string | null
  latestArticleSource: string | null
  latestKeywordName: string | null
  history: number[]
  queryExpression: string
  recentRuns: TopicRunRecord[]
}

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

interface TopicQueryPreviewResult {
  ok: boolean
  message?: string
  query?: string
  total?: number
  verdict?: string
  items?: TopicQueryPreviewItem[]
}

type ArticleWithMeta = TopicRunArticle & {
  _runCheckedAt: string
  _runTriggered: boolean
  _synthetic?: boolean
}

interface TopicNewsDetail {
  id: number
  title: string
  titleZh: string | null
  titleEn: string | null
  summary: string | null
  summaryZh: string | null
  summaryEn: string | null
  content: string | null
  contentTruncated: boolean
  url: string
  sourceName: string
  publishedAt: string | null
  sentimentScore: number | null
  sentimentLabel: string | null
  keywordsZh: string[]
  keywordsEn: string[]
}

function buildSyntheticArticleId(seed: string) {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0
  }
  return -(Math.abs(hash) + 1)
}

function isValidArticleIdentity(articleId: number, url: string) {
  return Number.isFinite(Number(articleId)) && Number(articleId) > 0 && Boolean(url)
}

function fallbackArticleFromRun(run: TopicRunRecord, fallbackKeywords: string[]): ArticleWithMeta | null {
  if (!run.latestArticleTitle || !run.latestArticleUrl) return null

  return {
    id: buildSyntheticArticleId(run.id),
    title: run.latestArticleTitle,
    titleZh: null,
    titleEn: null,
    url: run.latestArticleUrl,
    sourceCode: null,
    sourceName: run.latestArticleSource ?? '',
    language: null,
    publishedAt: null,
    summary: null,
    summaryZh: null,
    summaryEn: null,
    sentimentScore: null,
    sentimentLabel: null,
    importanceScore: null,
    keywordsZh: fallbackKeywords,
    keywordsEn: [],
    categories: [],
    aiReasoning: null,
    aiImpact: null,
    aiImpactDirection: null,
    aiUrgency: null,
    aiRelevance: null,
    triggerAlert: run.triggered,
    _runCheckedAt: run.checkedAt,
    _runTriggered: run.triggered,
    _synthetic: true
  }
}

function runStatsText(run: TopicRunRecord, t: TranslationKeys) {
  const sampledCount = run.sampledArticleCount ?? run.aiEvaluatedCount ?? run.newArticleCount
  const newCount = run.newArticleCount ?? 0

  if (sampledCount === 0 && run.articleCount === 0) {
    return t.kw_run_no_result
  }

  if (newCount === 0) {
    return t.kw_run_stats
      .replace('{sampled}', String(sampledCount))
      .replace('{total}', String(run.articleCount))
  }

  return t.kw_run_stats_new
    .replace('{sampled}', String(sampledCount))
    .replace('{new}', String(newCount))
    .replace('{total}', String(run.articleCount))
}

function runStatsCompact(run: TopicRunRecord, t: TranslationKeys) {
  const sampledCount = run.sampledArticleCount ?? run.aiEvaluatedCount ?? run.newArticleCount
  const newCount = run.newArticleCount ?? 0

  if (sampledCount === 0 && run.articleCount === 0) {
    return t.kw_run_compact_no_result
  }

  if (newCount === 0) {
    return t.kw_run_compact
      .replace('{sampled}', String(sampledCount))
      .replace('{total}', String(run.articleCount))
  }

  return t.kw_run_compact_new
    .replace('{sampled}', String(sampledCount))
    .replace('{new}', String(newCount))
    .replace('{total}', String(run.articleCount))
}

function statusBadge(status: GroupStatus, t: TranslationKeys) {
  const map: Record<GroupStatus, { cls: string; label: string }> = {
    normal: { cls: 'badge-green', label: t.badge_normal },
    warning: { cls: 'badge-orange', label: t.badge_warning },
    alert: { cls: 'badge-red', label: t.badge_alert },
    paused: { cls: 'badge-gray', label: t.badge_paused }
  }
  return map[status]
}

function relativeTime(iso: string | null) {
  return _relativeTime(iso, '检查')
}

function uniqueTerms(input: string) {
  const seen = new Set<string>()
  return input
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const lower = item.toLowerCase()
      if (seen.has(lower)) return false
      seen.add(lower)
      return true
    })
}

function getGroupStatus(keywords: Keyword[]): GroupStatus {
  if (keywords.length > 0 && keywords.every((kw) => kw.status === 'paused')) return 'paused'
  if (keywords.some((kw) => kw.status === 'alert')) return 'alert'
  if (keywords.some((kw) => kw.status === 'warning')) return 'warning'
  return 'normal'
}

function padHistory(history: number[]) {
  const trimmed = history.slice(-7)
  return Array(Math.max(0, 7 - trimmed.length)).fill(0).concat(trimmed)
}

function combineHistory(keywords: Keyword[]) {
  const padded = keywords.map((kw) => padHistory(kw.sentimentHistory))
  return Array.from({ length: 7 }, (_, index) => {
    const values = padded.map((history) => history[index] ?? 0)
    return values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0
  })
}

function escapeQueryTerm(term: string) {
  return term.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildQueryClause(term: string) {
  const parts = term
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (parts.length <= 1) {
    return `"${escapeQueryTerm(parts[0] ?? term.trim())}"`
  }

  return `(${parts.map((item) => `+"${escapeQueryTerm(item)}"`).join(' ')})`
}

function buildQueryExpression(terms: string[]) {
  if (terms.length === 0) return ''
  const clauses = terms.map((term) => buildQueryClause(term))
  if (clauses.length === 1) return clauses[0]
  return `(${clauses.join(' | ')})`
}

function buildGroups(
  keywords: Keyword[],
  topicRuns: TopicRunRecord[]
): KeywordGroup[] {
  const groups = new Map<string, Keyword[]>()

  for (const keyword of keywords) {
    const groupId = keyword.groupId ?? keyword.id
    const current = groups.get(groupId) ?? []
    current.push(keyword)
    groups.set(groupId, current)
  }

  return Array.from(groups.entries())
    .map(([groupId, items]) => {
      const orderedItems = [...items].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      const latestKeyword =
        [...items]
          .filter((item) => item.lastChecked || item.latestArticleTitle)
          .sort((a, b) => new Date(b.lastChecked ?? 0).getTime() - new Date(a.lastChecked ?? 0).getTime())[0] ??
        orderedItems[0]

      return {
        id: groupId,
        name: orderedItems[0].groupName?.trim() || orderedItems[0].name,
        keywords: orderedItems,
        status: getGroupStatus(items),
        todayCount: items.reduce((sum, item) => sum + item.todayCount, 0),
        lastChecked: latestKeyword.lastChecked,
        latestArticleTitle: latestKeyword.latestArticleTitle,
        latestArticleTitleEn: latestKeyword.latestArticleTitleEn ?? null,
        latestArticleUrl: latestKeyword.latestArticleUrl,
        latestArticleSource: latestKeyword.latestArticleSource,
        latestKeywordName: latestKeyword.name,
        history: combineHistory(items),
        queryExpression: buildQueryExpression(orderedItems.map((item) => item.name)),
        recentRuns: topicRuns
          .filter((run) => run.groupId === groupId)
          .slice(0, 4)
      }
    })
    .sort((a, b) => {
      const timeDiff =
        new Date(b.lastChecked ?? 0).getTime() - new Date(a.lastChecked ?? 0).getTime()
      if (timeDiff !== 0) return timeDiff
      return a.name.localeCompare(b.name, 'zh-CN')
    })
}

type DetailArticleSnapshot = TopicRunArticle | TopicQueryPreviewItem

export default function Keywords() {
  const { keywords, setKeywords, settings, setPage, topicRuns } = useStore()
  const { t, lang } = useLocale()

  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [termsInput, setTermsInput] = useState('')
  const [topicImpThreshold, setTopicImpThreshold] = useState<number | null>(null)
  const [topicSentThreshold, setTopicSentThreshold] = useState<number | null>(null)
  const [groupPrompt, setGroupPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'attention' | 'paused'>('all')
  const [queryPreview, setQueryPreview] = useState<TopicQueryPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null)
  const [detailRunId, setDetailRunId] = useState<string | null>(null)
  const [detailArticleId, setDetailArticleId] = useState<number | null>(null)
  const [detailArticle, setDetailArticle] = useState<TopicNewsDetail | null>(null)
  const [detailArticleLoading, setDetailArticleLoading] = useState(false)
  const [detailArticleError, setDetailArticleError] = useState<string | null>(null)
  const [liveArticles, setLiveArticles] = useState<TopicQueryPreviewItem[]>([])
  const [liveArticlesLoading, setLiveArticlesLoading] = useState(false)
  const [liveArticlesError, setLiveArticlesError] = useState<string | null>(null)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchSaving, setBatchSaving] = useState(false)

  const keywordGroups = buildGroups(keywords, topicRuns)
  const parsedTerms = uniqueTerms(termsInput)
  const promptPresetSelectValue =
    groupPrompt.startsWith('preset:') || groupPrompt.startsWith('custom:') || groupPrompt === ''
      ? groupPrompt
      : '__custom__'
  const currentEditingGroup = editingGroupId
    ? keywordGroups.find((group) => group.id === editingGroupId) ?? null
    : null

  const relocatingTerms = parsedTerms.filter((term) =>
    keywords.some(
      (keyword) =>
        keyword.name.toLowerCase() === term.toLowerCase() &&
        (keyword.groupId ?? keyword.id) !== editingGroupId
    )
  )

  const activeGroupCount = keywordGroups.filter((group) => group.status !== 'paused').length
  const pausedGroupCount = keywordGroups.filter((group) => group.status === 'paused').length
  const attentionGroupCount = keywordGroups.filter(
    (group) => group.status === 'warning' || group.status === 'alert'
  ).length
  const todayNewsCount = keywordGroups.reduce((sum, group) => sum + group.todayCount, 0)

  const normalizedQuery = query.trim().toLowerCase()

  const filteredGroups = keywordGroups.filter((group) => {
    if (statusFilter === 'active' && group.status === 'paused') return false
    if (statusFilter === 'attention' && group.status !== 'warning' && group.status !== 'alert') return false
    if (statusFilter === 'paused' && group.status !== 'paused') return false

    if (!normalizedQuery) return true

    const haystack = [
      group.name,
      group.latestArticleTitle ?? '',
      group.latestArticleSource ?? '',
      group.latestKeywordName ?? '',
      ...group.keywords.map((keyword) => keyword.name)
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })

  const currentDetailGroup = detailGroupId
    ? keywordGroups.find((group) => group.id === detailGroupId) ?? null
    : null

  const allDetailArticles: ArticleWithMeta[] = currentDetailGroup
    ? currentDetailGroup.recentRuns
        .flatMap((run) => {
          const runArticles = (run.recentArticles ?? [])
            .filter(
              (article) =>
                isValidArticleIdentity(article.id, article.url)
            )
            .map((article) => ({
              ...article,
              _runCheckedAt: run.checkedAt,
              _runTriggered: run.triggered
            }))
          if (runArticles.length > 0) return runArticles

          const fallback = fallbackArticleFromRun(
            run,
            currentDetailGroup.keywords.map((keyword) => keyword.name)
          )
          return fallback ? [fallback] : []
        })
        .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
        .sort(
          (a, b) =>
            new Date(b.publishedAt ?? b._runCheckedAt).getTime() -
            new Date(a.publishedAt ?? a._runCheckedAt).getTime()
        )
    : []

  const hasRealDetailArticles = allDetailArticles.some((article) => !article._synthetic)
  const shouldShowRunArticleList =
    hasRealDetailArticles ||
    (!liveArticlesLoading && liveArticles.length === 0 && allDetailArticles.length > 0)

  const currentDetailArticle =
    allDetailArticles.find((a) => a.id === detailArticleId) ??
    allDetailArticles[0] ??
    null

  useEffect(() => {
    if (!currentDetailGroup || allDetailArticles.length === 0) {
      setDetailArticleId(null)
      return
    }
    setDetailArticleId((prev) =>
      prev && allDetailArticles.some((a) => a.id === prev) ? prev : null
    )
  }, [currentDetailGroup?.id, allDetailArticles.length])

  useEffect(() => {
    if (!detailArticleId || detailArticleId <= 0) {
      setDetailArticle(null)
      setDetailArticleLoading(false)
      setDetailArticleError(null)
      return
    }

    let cancelled = false
    setDetailArticleLoading(true)
    setDetailArticleError(null)

    void window.api.getNewsDetail(detailArticleId).then((result) => {
      if (cancelled) return
      const payload = result as { ok: boolean; message?: string; detail?: TopicNewsDetail }
      if (payload.ok && payload.detail) {
        setDetailArticle(payload.detail)
        setDetailArticleLoading(false)
      } else {
        setDetailArticle(null)
        setDetailArticleError(payload.message ?? (lang === 'zh' ? '新闻详情加载失败' : 'Failed to load article'))
        setDetailArticleLoading(false)
      }
    }).catch(() => {
      if (cancelled) return
      setDetailArticle(null)
      setDetailArticleError(lang === 'zh' ? '新闻详情加载失败' : 'Failed to load article')
      setDetailArticleLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [detailArticleId])

  function openAddModal() {
    setEditingGroupId(null)
    setGroupName('')
    setTermsInput('')
    setTopicImpThreshold(null)
    setTopicSentThreshold(null)
    setGroupPrompt('')
    setQueryPreview(null)
    setShowGroupModal(true)
  }

  function openEditGroup(group: KeywordGroup) {
    const firstKeyword = group.keywords[0]
    setEditingGroupId(group.id)
    setGroupName(group.name)
    setTermsInput(group.keywords.map((keyword) => keyword.name).join('、'))
    setTopicImpThreshold(firstKeyword.topicImportanceThreshold ?? null)
    setTopicSentThreshold(firstKeyword.topicNegativeSentimentThreshold ?? null)
    setGroupPrompt(firstKeyword.customPrompt ?? '')
    setQueryPreview(null)
    setShowGroupModal(true)
  }

  function closeGroupModal() {
    if (saving) return
    setShowGroupModal(false)
    setEditingGroupId(null)
    setGroupName('')
    setTermsInput('')
    setTopicImpThreshold(null)
    setTopicSentThreshold(null)
    setGroupPrompt('')
    setQueryPreview(null)
  }

  function openGroupDetail(group: KeywordGroup) {
    setDetailGroupId(group.id)
    setDetailRunId(group.recentRuns[0]?.id ?? null)
    setDetailArticleId(null)
    setLiveArticles([])
    setLiveArticlesError(null)
    setLiveArticlesLoading(false)

    const hasRunArticles = group.recentRuns.some(
      (run) =>
        (run.recentArticles ?? []).some((article) =>
          isValidArticleIdentity(article.id, article.url)
        )
    )
    if (!hasRunArticles) {
      const terms = group.keywords.map((k) => k.name)
      if (terms.length > 0) {
        setLiveArticlesLoading(true)
        void window.api.testTopicQuery({ terms }).then((result: unknown) => {
          const r = result as TopicQueryPreviewResult
          if (r.ok && r.items) {
            setLiveArticles(r.items)
            setLiveArticlesError(null)
          } else {
            setLiveArticlesError(r.message ?? t.kw_detail_live_error)
          }
          setLiveArticlesLoading(false)
        }).catch(() => {
          setLiveArticlesError(t.kw_detail_live_error)
          setLiveArticlesLoading(false)
        })
      }
    }
  }

  function closeGroupDetail() {
    setDetailGroupId(null)
    setDetailRunId(null)
    setDetailArticleId(null)
    setDetailArticle(null)
    setDetailArticleLoading(false)
    setDetailArticleError(null)
    setLiveArticles([])
    setLiveArticlesError(null)
    setLiveArticlesLoading(false)
  }

  async function refreshKeywords() {
    const updated = (await window.api.getKeywords()) as Keyword[]
    setKeywords(updated)
  }

  async function handleSaveGroup() {
    if (parsedTerms.length === 0) return

    setSaving(true)

    const targetGroupId = editingGroupId ?? `group_${Date.now()}`
    const normalizedGroupName = groupName.trim() || parsedTerms[0]
    const existingKeywords = currentEditingGroup?.keywords ?? []
    const existingByName = new Map(keywords.map((keyword) => [keyword.name.toLowerCase(), keyword]))
    const nextNames = new Set(parsedTerms.map((term) => term.toLowerCase()))

    const nextKeywords: Keyword[] = parsedTerms.map((term, index) => {
      const existing = existingByName.get(term.toLowerCase())
      if (existing) {
        return {
          ...existing,
          groupId: targetGroupId,
          groupName: normalizedGroupName,
          regions: [],
          alertThreshold: 0.3,
          topicImportanceThreshold: topicImpThreshold,
          topicNegativeSentimentThreshold: topicSentThreshold,
          customPrompt: groupPrompt
        }
      }

      return {
        id: `kw_${Date.now()}_${index}`,
        name: term,
        groupId: targetGroupId,
        groupName: normalizedGroupName,
        regions: [],
        alertThreshold: 0.3,
        topicImportanceThreshold: topicImpThreshold,
        topicNegativeSentimentThreshold: topicSentThreshold,
        status: 'normal',
        todayCount: 0,
        lastChecked: null,
        latestArticleTitle: null,
        latestArticleTitleEn: null,
        latestArticleUrl: null,
        latestArticleSource: null,
        sentimentHistory: [],
        seenArticleIds: [],
        customPrompt: groupPrompt
      }
    })

    const removedKeywords = existingKeywords.filter(
      (keyword) => !nextNames.has(keyword.name.toLowerCase())
    )

    await Promise.all(nextKeywords.map((keyword) => window.api.saveKeyword(keyword)))
    if (removedKeywords.length > 0) {
      await Promise.all(removedKeywords.map((keyword) => window.api.deleteKeyword(keyword.id)))
    }

    await refreshKeywords()
    setSaving(false)
    closeGroupModal()
  }

  async function handleTestQuery() {
    if (parsedTerms.length === 0 || previewLoading) return
    setPreviewLoading(true)
    setQueryPreview(null)
    const result = (await window.api.testTopicQuery({
      terms: parsedTerms
    })) as TopicQueryPreviewResult
    setQueryPreview(result)
    setPreviewLoading(false)
  }

  async function handleDeleteGroup(group: KeywordGroup) {
    if (!confirm(t.kw_delete_confirm.replace('{name}', group.name).replace('{n}', String(group.keywords.length)))) return
    await Promise.all(group.keywords.map((keyword) => window.api.deleteKeyword(keyword.id)))
    setKeywords(
      keywords.filter((keyword) => (keyword.groupId ?? keyword.id) !== group.id)
    )
  }

  async function handleTogglePauseGroup(group: KeywordGroup) {
    const nextStatus: Keyword['status'] = group.status === 'paused' ? 'normal' : 'paused'
    await Promise.all(
      group.keywords.map((keyword) =>
        window.api.saveKeyword({
          ...keyword,
          status: nextStatus
        })
      )
    )
    await refreshKeywords()
  }

  function parseBatchInput(input: string): Array<{ name: string; terms: string[] }> {
    return input
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const colonIndex = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':')
        if (colonIndex !== -1) {
          const name = line.slice(0, colonIndex).trim()
          const terms = uniqueTerms(line.slice(colonIndex + 1))
          return { name: name || terms[0] || '', terms: terms.length > 0 ? terms : [name] }
        }
        const terms = uniqueTerms(line)
        return { name: terms[0] || line, terms }
      })
      .filter((item) => item.terms.length > 0)
  }

  async function handleBatchAdd() {
    const groups = parseBatchInput(batchInput)
    if (groups.length === 0) return
    setBatchSaving(true)

    for (const group of groups) {
      const groupId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const newKeywords: Keyword[] = group.terms.map((term, index) => ({
        id: `kw_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        name: term,
        groupId,
        groupName: group.name,
        regions: [],
        alertThreshold: 0.3,
        topicImportanceThreshold: null,
        topicNegativeSentimentThreshold: null,
        status: 'normal',
        todayCount: 0,
        lastChecked: null,
        latestArticleTitle: null,
        latestArticleTitleEn: null,
        latestArticleUrl: null,
        latestArticleSource: null,
        sentimentHistory: [],
        seenArticleIds: [],
        customPrompt: ''
      }))
      await Promise.all(newKeywords.map((kw) => window.api.saveKeyword(kw)))
    }

    await refreshKeywords()
    setBatchSaving(false)
    setShowBatchModal(false)
    setBatchInput('')
  }

  async function handleEnableAll() {
    const pausedGroups = keywordGroups.filter((g) => g.status === 'paused')
    if (pausedGroups.length === 0) return
    if (!confirm(t.kw_batch_enable_confirm.replace('{n}', String(pausedGroups.length)))) return

    const allPausedKeywords = pausedGroups.flatMap((g) => g.keywords)
    await Promise.all(
      allPausedKeywords.map((kw) =>
        window.api.saveKeyword({ ...kw, status: 'normal' })
      )
    )
    await refreshKeywords()
  }

  function openArticle(url: string | null) {
    if (!url) return
    void window.api.openExternal(url)
  }

  // Helper to get display title/summary from article + detail
  function articleDisplayTitle(
    article: Pick<TopicRunArticle, 'title' | 'titleZh' | 'titleEn'>,
    detail?: TopicNewsDetail | null
  ) {
    return pickField(lang, detail?.titleZh ?? article.titleZh, detail?.titleEn ?? article.titleEn, detail?.title ?? article.title)
  }

  function articleDisplaySummary(
    article: Pick<TopicRunArticle, 'summary' | 'summaryZh' | 'summaryEn'>,
    detail?: TopicNewsDetail | null
  ) {
    return pickField(lang, detail?.summaryZh ?? article.summaryZh, detail?.summaryEn ?? article.summaryEn, detail?.summary ?? article.summary ?? '')
  }

  return (
    <>
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-h">{t.kw_title}</div>
          <div className="section-sub">
            {t.kw_n_groups_n_keywords.replace('{g}', String(keywordGroups.length)).replace('{k}', String(keywords.length))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => { setBatchInput(''); setShowBatchModal(true) }}>
            {t.kw_batch_add}
          </button>
          <button className="btn btn-primary" onClick={openAddModal}>
            {t.kw_new_group}
          </button>
        </div>
      </div>

      {keywordGroups.length > 0 && (
        <>
          <div className="keywords-overview">
            <div className="keywords-summary-card">
              <span>{t.kw_group_label}</span>
              <strong>{keywordGroups.length}</strong>
              <small>{t.kw_by_group}</small>
            </div>
            <div className="keywords-summary-card">
              <span>{t.kw_keywords_label}</span>
              <strong>{keywords.length}</strong>
              <small>{t.kw_keywords_hint}</small>
            </div>
            <div className="keywords-summary-card">
              <span>{t.kw_attention}</span>
              <strong>{attentionGroupCount}</strong>
              <small>{t.kw_attention_hint}</small>
            </div>
            <div className="keywords-summary-card">
              <span>{t.kw_today_news}</span>
              <strong>{todayNewsCount}</strong>
              <small>{t.kw_n_active_n_paused.replace('{a}', String(activeGroupCount)).replace('{p}', String(pausedGroupCount))}</small>
            </div>
          </div>

          <div className="keywords-toolbar">
            <div className="keywords-filter-group">
              <button
                className={`keywords-filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                {t.kw_filter_all}
              </button>
              <button
                className={`keywords-filter-pill ${statusFilter === 'active' ? 'active' : ''}`}
                onClick={() => setStatusFilter('active')}
              >
                {t.kw_filter_active}
              </button>
              <button
                className={`keywords-filter-pill ${statusFilter === 'attention' ? 'active' : ''}`}
                onClick={() => setStatusFilter('attention')}
              >
                {t.kw_filter_attention}
              </button>
              <button
                className={`keywords-filter-pill ${statusFilter === 'paused' ? 'active' : ''}`}
                onClick={() => setStatusFilter('paused')}
              >
                {t.kw_filter_paused}
              </button>
            </div>
            <div className="keywords-toolbar-spacer" />
            <input
              className="form-input keywords-search"
              placeholder={t.kw_search_placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {pausedGroupCount > 0 && (
              <button className="btn btn-sm" onClick={handleEnableAll}>
                {t.kw_batch_enable_all}
              </button>
            )}
          </div>
        </>
      )}

      {keywordGroups.length === 0 ? (
        <div className="empty" style={{ marginTop: 60 }}>
          <div className="empty-icon">🗂️</div>
          <p>{settings.freenewsApiKey ? t.kw_no_topics : t.kw_no_topics_hint}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button
              className="btn btn-primary"
              onClick={settings.freenewsApiKey ? openAddModal : () => setPage('settings')}
            >
              {settings.freenewsApiKey ? t.kw_first_group : t.kw_go_settings}
            </button>
            {!settings.freenewsApiKey && (
              <button className="btn" onClick={() => window.api.openExternal(FREENEWS_SITE_URL)}>
                {t.settings_api_open_site}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="keywords-grid">
          {filteredGroups.map((group) => {
            const { cls, label } = statusBadge(group.status, t)
            const runningCount = group.keywords.filter((keyword) => keyword.status !== 'paused').length
            const visibleKeywords = group.keywords.slice(0, 4)
            const hiddenKeywordCount = Math.max(0, group.keywords.length - visibleKeywords.length)

            return (
              <div className="kw-card" key={group.id}>
                <div className="kw-card-top">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="kw-card-header">
                      <div
                        className="kw-card-name kw-card-name-clickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => openGroupDetail(group)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openGroupDetail(group)
                          }
                        }}
                      >
                        {group.name}
                      </div>
                      <span className={`badge ${cls}`}>{label}</span>
                    </div>
                    <div className="kw-card-meta">
                      <span>{t.kw_n_keywords.replace('{n}', String(group.keywords.length))}</span>
                      <span>{t.kw_n_running.replace('{n}', String(runningCount)).replace('{total}', String(group.keywords.length))}</span>
                      <span>{t.kw_all_languages}</span>
                      <span>{relativeTime(group.lastChecked)}</span>
                    </div>
                  </div>
                  <div className="kw-card-countbox">
                    <strong>{group.todayCount}</strong>
                    <span>{t.kw_today}</span>
                  </div>
                </div>

                <div className="kw-group-terms">
                  {visibleKeywords.map((keyword) => (
                    <span className="kw-term-chip" key={keyword.id}>
                      {keyword.name}
                    </span>
                  ))}
                  {hiddenKeywordCount > 0 && (
                    <span className="kw-term-chip kw-term-chip-muted">
                      {t.kw_more_n.replace('{n}', String(hiddenKeywordCount))}
                    </span>
                  )}
                </div>

                <div className="kw-card-info">
                  <div className="kw-info-chip">
                    <span>{t.kw_detail_processing}</span>
                    <strong>{t.kw_processing}</strong>
                  </div>
                </div>

                <div className="kw-card-bottom">
                  {group.latestArticleTitle ? (
                    <div className="kw-latest-article">
                      {group.latestArticleSource && (
                        <span className="kw-latest-src">{group.latestArticleSource}</span>
                      )}
                      <span className="kw-latest-title">{pickField(lang, group.latestArticleTitle, group.latestArticleTitleEn, group.latestArticleTitle ?? '')}</span>
                    </div>
                  ) : (
                    <div className="kw-latest-article kw-latest-empty">{t.kw_waiting_first}</div>
                  )}

                  {group.recentRuns.length > 0 && (() => {
                    const run = group.recentRuns[0]
                    return (
                      <div className="kw-last-run">
                        <span className={`badge ${statusBadge(run.status, t).cls}`}>
                          {statusBadge(run.status, t).label}
                        </span>
                        <span className="kw-last-run-time">{shortTime(run.checkedAt)}</span>
                        {(run.newArticleCount ?? 0) > 0 && (
                          <span className="kw-last-run-new">+{run.newArticleCount} {t.kw_new_suffix}</span>
                        )}
                        {run.triggered && (
                          <span className="kw-run-hit">{t.kw_triggered}</span>
                        )}
                      </div>
                    )
                  })()}

                  <div className="kw-actions">
                    <button
                      className="btn btn-sm btn-accent-dim"
                      style={{ flex: 1 }}
                      onClick={() => openGroupDetail(group)}
                    >
                      {t.kw_view_articles}
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => openEditGroup(group)}
                    >
                      {t.btn_edit}
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => handleTogglePauseGroup(group)}
                    >
                      {group.status === 'paused' ? t.kw_resume : t.kw_pause}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDeleteGroup(group)}
                    >
                      {t.btn_delete}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {keywordGroups.length > 0 && filteredGroups.length === 0 && (
        <div className="empty" style={{ marginTop: 40 }}>
          <div className="empty-icon">🔎</div>
          <p>{t.kw_no_filter_match}</p>
        </div>
      )}

      {showGroupModal && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && closeGroupModal()}>
          <div className="modal-box" style={{ width: 900, maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <span className="modal-title">
                {editingGroupId ? t.kw_modal_edit : t.kw_modal_create}
              </span>
              <button className="modal-close" onClick={closeGroupModal}>✕</button>
            </div>

            {/* ── 左右分栏 ── */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

              {/* 左侧：表单 */}
              <div style={{ flex: '0 0 420px', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', borderRight: '1px solid var(--border)' }}>

                {/* 主题名称 */}
                <div className="form-group">
                  <label className="form-label">{t.kw_modal_name}</label>
                  <input
                    className="form-input"
                    style={{ width: '100%' }}
                    placeholder={t.kw_modal_name_placeholder}
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    autoFocus
                  />
                </div>

                {/* 监控词 */}
                <div className="form-group">
                  <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
                    <label className="form-label" style={{ margin: 0 }}>{t.kw_modal_terms}</label>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 8, fontWeight: 400, textTransform: 'none' }}>
                      {t.kw_modal_terms_hint}
                    </span>
                  </div>
                  <textarea
                    className="form-input"
                    rows={4}
                    style={{ width: '100%', resize: 'vertical', lineHeight: 1.7 }}
                    placeholder={t.kw_modal_terms_placeholder}
                    value={termsInput}
                    onChange={(event) => {
                      setTermsInput(event.target.value)
                      setQueryPreview(null)
                    }}
                  />
                  {parsedTerms.length > 0 && (
                    <div className="kw-modal-preview">
                      <span className="kw-modal-preview-label">{t.kw_modal_will_monitor}</span>
                      {parsedTerms.map((term) => {
                        const isRelocating = relocatingTerms.includes(term)
                        return (
                          <span
                            key={term}
                            className={`kw-term-chip ${isRelocating ? 'kw-term-chip-conflict' : ''}`}
                            title={isRelocating ? (lang === 'zh' ? '保存后会移动到当前主题组' : 'Will be moved to current group after saving') : ''}
                          >
                            {term}
                          </span>
                        )
                      })}
                      <span className="kw-modal-preview-meta">
                        {t.kw_modal_total_n.replace('{n}', String(parsedTerms.length))}
                      </span>
                    </div>
                  )}
                  {relocatingTerms.length > 0 && (
                    <div className="conn-status conn-ok" style={{ marginTop: 8 }}>
                      ✓ {t.kw_modal_relocate}{relocatingTerms.join('、')}
                    </div>
                  )}
                  {/* 测试查询按钮 — 结果显示在右侧 */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-sm"
                      onClick={handleTestQuery}
                      disabled={previewLoading || parsedTerms.length === 0}
                    >
                      {previewLoading ? <span className="spinner" /> : t.kw_modal_test_query}
                    </button>
                    {parsedTerms.length > 0 && (
                      <span className="kw-modal-preview-meta" style={{ wordBreak: 'break-all' }}>
                        {t.kw_modal_current_expr}{buildQueryExpression(parsedTerms)}
                      </span>
                    )}
                  </div>
                </div>

                {/* 重要性阈值 */}
                <div className="form-group">
                  <label className="form-label">{t.kw_topic_imp_label}</label>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>{t.kw_topic_imp_hint}</div>
                  <select
                    className="form-input"
                    style={{ width: '100%' }}
                    value={topicImpThreshold ?? ''}
                    onChange={(e) => setTopicImpThreshold(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">{lang === 'zh' ? `跟随全局（默认 ${settings.importanceThreshold ?? 7}）` : `Follow global (default ${settings.importanceThreshold ?? 7})`}</option>
                    {[5, 6, 7, 8, 9, 10].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>

                {/* 负面情感阈值 */}
                <div className="form-group">
                  <label className="form-label">{t.kw_topic_sent_label}</label>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>{t.kw_topic_sent_hint}</div>
                  <select
                    className="form-input"
                    style={{ width: '100%' }}
                    value={topicSentThreshold ?? ''}
                    onChange={(e) => setTopicSentThreshold(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">{lang === 'zh' ? `跟随全局（默认 ${settings.negativeSentimentThreshold ?? 0.25}）` : `Follow global (default ${settings.negativeSentimentThreshold ?? 0.25})`}</option>
                    {[0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40].map((v) => (
                      <option key={v} value={v}>{v.toFixed(2)}</option>
                    ))}
                  </select>
                </div>

                {/* AI 角色（可选） */}
                <div className="form-group">
                  <label className="form-label">{lang === 'zh' ? 'AI 角色（可选）' : 'AI role (optional)'}</label>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                    {lang === 'zh'
                      ? '默认使用全局角色。你也可以给当前主题组指定单独的分析角色。'
                      : 'By default, this group uses global role. You can override it for this topic group.'}
                  </div>
                  <select
                    className="form-input"
                    style={{ width: '100%' }}
                    value={promptPresetSelectValue}
                    onChange={(event) => {
                      const value = event.target.value
                      if (value === '__custom__') return
                      setGroupPrompt(value)
                    }}
                  >
                    <option value="">{lang === 'zh' ? '跟随全局设置' : 'Use global default'}</option>
                    {PROMPT_PRESETS.map((preset, index) => (
                      <option key={preset.label} value={`preset:${index}`}>
                        {preset.label}
                      </option>
                    ))}
                    {(settings.customPresets ?? []).map((preset, index) => (
                      <option key={`custom_${index}_${preset.label}`} value={`custom:${index}`}>
                        {`🧩 ${preset.label}`}
                      </option>
                    ))}
                    {promptPresetSelectValue === '__custom__' && (
                      <option value="__custom__">{lang === 'zh' ? '自定义规则（保留）' : 'Custom rule (kept)'}</option>
                    )}
                  </select>
                </div>

                {/* 最近运行历史 */}
                {currentEditingGroup && currentEditingGroup.recentRuns.length > 0 && (
                  <div className="form-group">
                    <label className="form-label">{t.kw_modal_recent_runs}</label>
                    <div className="topic-preview-card">
                      <div className="topic-preview-list">
                        {currentEditingGroup.recentRuns.map((run) => (
                          <div className="topic-preview-item" key={run.id}>
                            <div className="topic-preview-item-top">
                              <strong>{shortTime(run.checkedAt)}</strong>
                              <span>{statusBadge(run.status, t).label}</span>
                            </div>
                            <div className="topic-preview-item-summary">
                              {runStatsText(run, t)}
                              {run.reason ? ` · ${run.reason}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 右侧：查询预览 */}
              <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                {previewLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-3)', gap: 10 }}>
                    <span className="spinner" />
                    <span>{lang === 'zh' ? '查询中...' : 'Querying...'}</span>
                  </div>
                ) : queryPreview ? (
                  queryPreview.ok ? (
                    <>
                      <div className="topic-preview-head" style={{ marginBottom: 8 }}>
                        <strong>{t.kw_modal_query_preview}</strong>
                      </div>
                      {queryPreview.verdict && (
                        <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', color: '#f5c842', fontSize: 12, lineHeight: 1.5 }}>
                          ⚠️ {lang === 'zh'
                            ? (queryPreview.verdict.toLowerCase().includes('too broad')
                                ? '查询范围过宽，建议缩小监控词'
                                : queryPreview.verdict.toLowerCase().includes('narrow')
                                  ? '建议精简关键词组合'
                                  : queryPreview.verdict)
                            : queryPreview.verdict}
                        </div>
                      )}
                      <div className="topic-preview-code" style={{ marginBottom: 8 }}>{queryPreview.query}</div>
                      <div className="topic-preview-meta" style={{ marginBottom: 12 }}>
                        {t.kw_modal_query_total
                          .replace('{total}', String(queryPreview.total ?? 0))
                          .replace('{count}', String(queryPreview.items?.length ?? 0))}
                      </div>
                      <div className="topic-preview-list" style={{ flex: 1 }}>
                        {(queryPreview.items ?? []).map((item) => (
                          <div className="topic-preview-item" key={item.id}>
                            <div className="topic-preview-item-top">
                              <strong>{pickField(lang, item.titleZh, item.titleEn, item.title)}</strong>
                              <span>{item.sourceName}</span>
                            </div>
                            <div className="topic-preview-item-meta">
                              <span>{item.publishedAt ? shortTime(item.publishedAt) : t.time_unknown}</span>
                              <button className="btn btn-sm" onClick={() => openArticle(item.url)}>
                                {t.btn_open}
                              </button>
                            </div>
                            {pickField(lang, item.summaryZh, item.summaryEn, item.summary ?? '') && (
                              <div className="topic-preview-item-summary">
                                {pickField(lang, item.summaryZh, item.summaryEn, item.summary ?? '')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="conn-status conn-err">✗ {queryPreview.message}</div>
                  )
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 10, color: 'var(--text-3)' }}>
                    <span style={{ fontSize: 28 }}>🔍</span>
                    <span style={{ fontSize: 13 }}>
                      {lang === 'zh' ? '点击「测试查询」，这里会显示样本文章' : 'Click "Test query" to preview matching articles'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={closeGroupModal}>{t.btn_cancel}</button>
              <button
                className="btn btn-primary"
                onClick={handleSaveGroup}
                disabled={saving || parsedTerms.length === 0}
              >
                {saving
                  ? <span className="spinner" />
                  : editingGroupId
                    ? t.kw_modal_save
                    : t.kw_modal_create_btn}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchModal && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && !batchSaving && setShowBatchModal(false)}>
          <div className="modal-box" style={{ width: 640 }}>
            <div className="modal-header">
              <span className="modal-title">{t.kw_batch_modal_title}</span>
              <button className="modal-close" onClick={() => !batchSaving && setShowBatchModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'pre-line', lineHeight: 1.7 }}>
                {t.kw_batch_modal_hint}
              </div>
              <textarea
                className="form-input"
                rows={10}
                style={{ width: '100%', resize: 'vertical', lineHeight: 1.7, fontFamily: 'inherit' }}
                placeholder={t.kw_batch_modal_placeholder}
                value={batchInput}
                onChange={(event) => setBatchInput(event.target.value)}
                autoFocus
              />
              {parseBatchInput(batchInput).length > 0 && (
                <div className="kw-modal-preview">
                  <span className="kw-modal-preview-label">
                    {t.kw_batch_modal_preview.replace('{n}', String(parseBatchInput(batchInput).length))}
                  </span>
                  {parseBatchInput(batchInput).map((group, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', minWidth: 60 }}>{group.name}</span>
                      {group.terms.map((term) => (
                        <span className="kw-term-chip" key={term}>{term}</span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowBatchModal(false)} disabled={batchSaving}>{t.btn_cancel}</button>
              <button
                className="btn btn-primary"
                onClick={handleBatchAdd}
                disabled={batchSaving || parseBatchInput(batchInput).length === 0}
              >
                {batchSaving ? <span className="spinner" /> : t.kw_batch_modal_btn}
              </button>
            </div>
          </div>
        </div>
      )}

      {currentDetailGroup && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && closeGroupDetail()}>
          <div className="modal-box kw-detail-modal">
            <div className="modal-header">
              {detailArticleId ? (
                <button className="kw-detail-back-btn" onClick={() => setDetailArticleId(null)}>
                  {t.kw_detail_back}
                </button>
              ) : (
                <span className="modal-title">{currentDetailGroup.name} · {t.kw_detail_articles}</span>
              )}
              <button className="modal-close" onClick={closeGroupDetail}>✕</button>
            </div>

            {!detailArticleId && (
              <div className="modal-body kw-detail-body">
                <div className="kw-detail-head">
                  <div className="kw-detail-head-main">
                    <div className="kw-detail-title-row">
                      <div className="kw-detail-title">{currentDetailGroup.name}</div>
                      <span className={`badge ${statusBadge(currentDetailGroup.status, t).cls}`}>
                        {statusBadge(currentDetailGroup.status, t).label}
                      </span>
                    </div>
                    <div className="kw-detail-meta">
                      <span>{t.kw_n_keywords.replace('{n}', String(currentDetailGroup.keywords.length))}</span>
                      <span>{t.kw_detail_last_check.replace('{time}', relativeTime(currentDetailGroup.lastChecked))}</span>
                    </div>
                  </div>
                </div>

                {shouldShowRunArticleList ? (
                  <div className="kw-detail-risk-list risk-feed-list">
                    {allDetailArticles.map((article) => {
                      const title = pickField(lang, article.titleZh, article.titleEn, article.title)
                      const summary = pickField(lang, article.summaryZh, article.summaryEn, article.summary ?? '')
                      const summaryText = summary.trim() || t.alert_no_summary
                      const sourceText = article.sourceName || t.alert_source_unknown

                      return (
                        <button
                          type="button"
                          className="risk-feed-item kw-risk-row"
                          key={article.id}
                          onClick={() => {
                            if (article._synthetic) {
                              openArticle(article.url)
                              return
                            }
                            setDetailArticleId(article.id)
                          }}
                        >
                          <div className="risk-feed-main">
                            <div className="risk-feed-title">{title}</div>
                            <div className="risk-feed-summary">{summaryText}</div>
                            <div className="risk-feed-meta">
                              <span>{sourceText}</span>
                              <span>{article.publishedAt ? shortTime(article.publishedAt) : shortTime(article._runCheckedAt)}</span>
                              {article.triggerAlert && <span className="kw-risk-hit">{t.kw_detail_hit_alert}</span>}
                              {pickArrayField(lang, article.keywordsZh, article.keywordsEn).slice(0, 4).map((kw) => (
                                <span key={kw} className="risk-feed-tag">{kw}</span>
                              ))}
                            </div>
                          </div>
                          <div
                            className="risk-feed-score"
                            style={{
                              color: article.sentimentScore != null ? sentimentColor(article.sentimentScore) : 'var(--text-3)'
                            }}
                          >
                            <strong>{article.sentimentScore != null ? article.sentimentScore.toFixed(2) : t.no_data}</strong>
                            <span>
                              {article.sentimentScore != null
                                ? sentimentLocalized(article.sentimentLabel, lang) ?? t.no_data
                                : t.no_data}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : liveArticlesLoading ? (
                  <div className="kw-empty-state">{t.kw_detail_fetching}</div>
                ) : liveArticles.length > 0 ? (
                  <div className="kw-detail-risk-list risk-feed-list">
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
                      {t.kw_detail_live_hint.replace('{n}', String(liveArticles.length))}
                    </div>
                    {liveArticles.map((article) => {
                      const title = pickField(lang, article.titleZh, article.titleEn, article.title)
                      const summary = pickField(lang, article.summaryZh, article.summaryEn, article.summary ?? '')
                      const summaryText = summary.trim() || t.alert_no_summary
                      const sourceText = article.sourceName || t.alert_source_unknown

                      return (
                        <button
                          type="button"
                          className="risk-feed-item kw-risk-row"
                          key={article.id}
                          onClick={() => openArticle(article.url)}
                        >
                          <div className="risk-feed-main">
                            <div className="risk-feed-title">{title}</div>
                            <div className="risk-feed-summary">{summaryText}</div>
                            <div className="risk-feed-meta">
                              <span>{sourceText}</span>
                              <span>{article.publishedAt ? shortTime(article.publishedAt) : t.time_unknown}</span>
                              {pickArrayField(lang, article.keywordsZh, article.keywordsEn).slice(0, 4).map((kw) => (
                                <span key={kw} className="risk-feed-tag">{kw}</span>
                              ))}
                            </div>
                          </div>
                          <div
                            className="risk-feed-score"
                            style={{
                              color: article.sentimentScore != null ? sentimentColor(article.sentimentScore) : 'var(--text-3)'
                            }}
                          >
                            <strong>{article.sentimentScore != null ? article.sentimentScore.toFixed(2) : t.no_data}</strong>
                            <span>
                              {article.sentimentScore != null
                                ? sentimentLocalized(article.sentimentLabel, lang) ?? t.no_data
                                : t.no_data}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : liveArticlesError ? (
                  <div className="kw-empty-state">{liveArticlesError}</div>
                ) : (
                  <div className="kw-empty-state">{t.kw_detail_empty}</div>
                )}
              </div>
            )}

            {detailArticleId && currentDetailArticle && (
              <div className="modal-body kw-detail-body">
                {detailArticleLoading ? (
                  <div className="kw-empty-state">{t.kw_detail_loading}</div>
                ) : (
                  <>
                    <div className="kw-detail-article-panel-head">
                      <div>
                        <div className="kw-detail-article-panel-title">
                          {articleDisplayTitle(currentDetailArticle, detailArticleError ? null : detailArticle)}
                        </div>
                        <div className="kw-detail-article-meta">
                          <span>{(detailArticleError ? null : detailArticle)?.sourceName ?? currentDetailArticle.sourceName}</span>
                          <span>
                            {((detailArticleError ? null : detailArticle)?.publishedAt ?? currentDetailArticle.publishedAt)
                              ? shortTime(((detailArticleError ? null : detailArticle)?.publishedAt ?? currentDetailArticle.publishedAt) as string)
                              : t.time_unknown}
                          </span>
                          <span className={`kw-detail-match ${currentDetailArticle.triggerAlert ? 'hit' : ''}`}>
                            {currentDetailArticle.triggerAlert ? t.kw_detail_hit_alert : t.kw_detail_no_hit}
                          </span>
                        </div>
                      </div>
                      <button className="btn btn-sm" onClick={() => openArticle((detailArticleError ? null : detailArticle)?.url ?? currentDetailArticle.url)}>
                        {t.btn_open_original}
                      </button>
                    </div>

                    {articleDisplaySummary(currentDetailArticle, detailArticleError ? null : detailArticle) && (
                      <div className="kw-detail-article-summary">
                        {articleDisplaySummary(currentDetailArticle, detailArticleError ? null : detailArticle)}
                      </div>
                    )}

                    {!detailArticleError && pickArrayField(lang, detailArticle?.keywordsZh, detailArticle?.keywordsEn).length > 0 && (
                      <div className="kw-detail-tags">
                        {pickArrayField(lang, detailArticle?.keywordsZh, detailArticle?.keywordsEn).map((keyword) => (
                          <span key={keyword} className="kw-detail-tag">{keyword}</span>
                        ))}
                      </div>
                    )}

                    <div className="kw-detail-facts">
                      <div className="kw-detail-fact">
                        <span>{t.kw_detail_sentiment}</span>
                        <strong>
                          {sentimentLocalized(
                            (detailArticleError ? null : detailArticle)?.sentimentLabel ?? currentDetailArticle.sentimentLabel,
                            lang
                          ) ?? '—'}
                          {((detailArticleError ? null : detailArticle)?.sentimentScore ?? currentDetailArticle.sentimentScore) != null
                            ? ` · ${((detailArticleError ? null : detailArticle)?.sentimentScore ?? currentDetailArticle.sentimentScore)?.toFixed(2)}`
                            : ''}
                        </strong>
                      </div>
                      <div className="kw-detail-fact">
                        <span>{t.alert_importance}</span>
                        <strong>
                          {currentDetailArticle.importanceScore != null
                            ? `${currentDetailArticle.importanceScore} / 10`
                            : '—'}
                        </strong>
                      </div>
                      <div className="kw-detail-fact" style={{ gridColumn: '1 / -1' }}>
                        <span>{t.kw_detail_alert_status}</span>
                        <strong>{currentDetailArticle.triggerAlert ? t.kw_detail_hit_alert : t.kw_detail_no_hit}</strong>
                      </div>
                    </div>

                    {detailArticleError && (
                      <div className="kw-empty-state" style={{ marginTop: 12 }}>
                        {detailArticleError}{t.kw_detail_error_suffix}
                      </div>
                    )}

                    {!detailArticleError && detailArticle?.content && (
                      <div className="kw-detail-article-content">
                        <span>{t.kw_detail_content}</span>
                        <div>{detailArticle.content}</div>
                        {detailArticle.contentTruncated && (
                          <p>{t.kw_detail_truncated}</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
