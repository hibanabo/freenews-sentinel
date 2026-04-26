import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { Alert, AlertRelatedArticle, Brief, Keyword, TopicRunArticle, TopicRunRecord } from './store'

/**
 * SQLite data layer for operational entities (keywords/articles/runs/alerts/briefs).
 *
 * Notes:
 * - App settings stay in electron-store.
 * - API keys are handled in keytar (see secrets.ts).
 */
const DB_FILE_NAME = 'sentinel.sqlite'
const RUN_LIMIT = 600
const ALERT_LIMIT = 500
const BRIEF_LIMIT = 50

let dbInstance: Database.Database | null = null

function toIsoString(value: unknown) {
  if (!value) return null
  let raw = String(value).trim()
  if (!raw) return null
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) &&
    !raw.endsWith('Z') &&
    !/[+-]\d{2}:\d{2}$/.test(raw)
  ) {
    raw += 'Z'
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function nowIso() {
  return new Date().toISOString()
}

function getTodayKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function serializeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return 'null'
  }
}

function normalizeKeyword(keyword: Keyword): Keyword {
  const normalizedGroupId = keyword.groupId ?? keyword.id
  return {
    ...keyword,
    groupId: normalizedGroupId,
    groupName: keyword.groupName ?? keyword.name,
    regions: keyword.regions ?? [],
    sentimentHistory: keyword.sentimentHistory ?? [],
    seenArticleIds: keyword.seenArticleIds ?? [],
    customPrompt: keyword.customPrompt ?? ''
  }
}

function getDb(): Database.Database {
  if (dbInstance) return dbInstance

  const userDataDir = app.getPath('userData')
  mkdirSync(userDataDir, { recursive: true })
  const dbPath = join(userDataDir, DB_FILE_NAME)

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Schema initialization (idempotent).
  db.exec(`
    CREATE TABLE IF NOT EXISTS keywords (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_id TEXT NOT NULL,
      group_name TEXT NOT NULL,
      regions_json TEXT NOT NULL DEFAULT '[]',
      alert_threshold REAL NOT NULL DEFAULT 0.3,
      status TEXT NOT NULL DEFAULT 'normal',
      today_count INTEGER NOT NULL DEFAULT 0,
      today_count_date TEXT,
      last_checked TEXT,
      latest_article_title TEXT,
      latest_article_url TEXT,
      latest_article_source TEXT,
      sentiment_history_json TEXT NOT NULL DEFAULT '[]',
      seen_article_ids_json TEXT NOT NULL DEFAULT '[]',
      custom_prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_keywords_group_id ON keywords(group_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_status ON keywords(status);

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      freenews_id INTEGER NOT NULL UNIQUE,
      url TEXT NOT NULL,
      source_code TEXT,
      source_name TEXT NOT NULL,
      language TEXT,
      title TEXT NOT NULL,
      title_zh TEXT,
      title_en TEXT,
      summary TEXT,
      summary_zh TEXT,
      summary_en TEXT,
      keywords_zh_json TEXT NOT NULL DEFAULT '[]',
      keywords_en_json TEXT NOT NULL DEFAULT '[]',
      categories_json TEXT NOT NULL DEFAULT '[]',
      entities_json TEXT NOT NULL DEFAULT '[]',
      sentiment_label TEXT,
      sentiment_score REAL,
      importance_score INTEGER,
      published_at TEXT,
      source_created_at TEXT,
      score_raw TEXT,
      highlight_raw_json TEXT,
      raw_json TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_last_seen_at ON articles(last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS monitor_runs (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      topic_name TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      query_expression TEXT NOT NULL,
      article_count INTEGER NOT NULL DEFAULT 0,
      new_article_count INTEGER NOT NULL DEFAULT 0,
      ai_evaluated_count INTEGER NOT NULL DEFAULT 0,
      sampled_article_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      matched_regions_json TEXT NOT NULL DEFAULT '[]',
      triggered INTEGER NOT NULL DEFAULT 0,
      alert_id TEXT,
      latest_article_title TEXT,
      latest_article_url TEXT,
      latest_article_source TEXT,
      reason TEXT,
      decision_mode TEXT NOT NULL DEFAULT 'hybrid',
      prescreen_enabled INTEGER NOT NULL DEFAULT 0,
      prescreen_threshold REAL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_monitor_runs_checked ON monitor_runs(checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_monitor_runs_topic_checked ON monitor_runs(topic_id, checked_at DESC);

    CREATE TABLE IF NOT EXISTS run_articles (
      run_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      article_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_new INTEGER NOT NULL DEFAULT 0,
      trigger_alert INTEGER NOT NULL DEFAULT 0,
      decision_source TEXT NOT NULL DEFAULT 'threshold',
      ai_reasoning TEXT,
      ai_sentiment_score REAL,
      ai_relevance_score REAL,
      ai_impact_score REAL,
      ai_impact_direction TEXT,
      ai_urgency TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, article_id),
      FOREIGN KEY (run_id) REFERENCES monitor_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES articles(freenews_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_articles_topic ON run_articles(topic_id, run_id);
    CREATE INDEX IF NOT EXISTS idx_run_articles_trigger ON run_articles(trigger_alert);

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      topic_name TEXT NOT NULL,
      severity TEXT NOT NULL,
      reason TEXT NOT NULL,
      article_id INTEGER,
      article_title TEXT NOT NULL,
      article_title_zh TEXT,
      article_url TEXT NOT NULL,
      article_source TEXT,
      article_published_at TEXT,
      article_summary TEXT,
      article_summary_zh TEXT,
      article_importance INTEGER,
      query_expression TEXT,
      sentiment_score REAL,
      sentiment_label TEXT,
      ai_reasoning TEXT,
      ai_impact REAL,
      ai_impact_direction TEXT,
      ai_urgency TEXT,
      ai_relevance REAL,
      timestamp TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_topic_timestamp ON alerts(topic_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(is_read, timestamp DESC);

    CREATE TABLE IF NOT EXISTS alert_related_articles (
      alert_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      article_id INTEGER,
      title TEXT NOT NULL,
      title_zh TEXT,
      title_en TEXT,
      url TEXT NOT NULL,
      source_name TEXT NOT NULL,
      published_at TEXT,
      summary TEXT,
      summary_zh TEXT,
      summary_en TEXT,
      sentiment_score REAL,
      sentiment_label TEXT,
      importance_score INTEGER,
      keywords_zh_json TEXT NOT NULL DEFAULT '[]',
      keywords_en_json TEXT NOT NULL DEFAULT '[]',
      raw_json TEXT,
      PRIMARY KEY (alert_id, sort_order),
      FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      topic_ids_json TEXT NOT NULL DEFAULT '[]',
      topics_json TEXT NOT NULL DEFAULT '[]',
      date_range TEXT,
      auto_generated INTEGER NOT NULL DEFAULT 0,
      generated_at TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_briefs_generated_at ON briefs(generated_at DESC);
  `)

  // Idempotent column migrations. SQLite has no ADD COLUMN IF NOT EXISTS;
  // 幂等列迁移：SQLite 无 ADD COLUMN IF NOT EXISTS，用 try/catch 吞重复报错
  const addColumnIfMissing = (sql: string) => {
    try {
      db.exec(sql)
    } catch (err) {
      if (!String(err).includes('duplicate column name')) throw err
    }
  }
  addColumnIfMissing(`ALTER TABLE articles ADD COLUMN importance_score INTEGER`)
  addColumnIfMissing(`ALTER TABLE alerts ADD COLUMN article_importance INTEGER`)
  addColumnIfMissing(`ALTER TABLE alert_related_articles ADD COLUMN importance_score INTEGER`)
  addColumnIfMissing(`ALTER TABLE keywords ADD COLUMN topic_importance_threshold REAL`)
  addColumnIfMissing(`ALTER TABLE keywords ADD COLUMN topic_negative_sentiment_threshold REAL`)
  addColumnIfMissing(`ALTER TABLE alerts ADD COLUMN reason_en TEXT`)
  addColumnIfMissing(`ALTER TABLE alerts ADD COLUMN article_title_en TEXT`)
  addColumnIfMissing(`ALTER TABLE alerts ADD COLUMN article_summary_en TEXT`)
  addColumnIfMissing(`ALTER TABLE keywords ADD COLUMN latest_article_title_en TEXT`)
  addColumnIfMissing(`ALTER TABLE monitor_runs ADD COLUMN latest_article_title_en TEXT`)

  // Seed example topic group on first run (only if keywords table is empty)
  const isEmpty = (db.prepare('SELECT COUNT(*) as c FROM keywords').get() as { c: number }).c === 0
  if (isEmpty) {
    const now = nowIso()
    const seedKeywords = [
      { id: 'kw_seed_us_iran_il_0', name: '美国 伊朗 以色列' },
      { id: 'kw_seed_us_iran_il_1', name: '美国 以色列' },
      { id: 'kw_seed_us_iran_il_2', name: '美国 伊朗' },
      { id: 'kw_seed_us_iran_il_3', name: '伊朗 以色列' },
      { id: 'kw_seed_us_iran_il_4', name: '中东' },
      { id: 'kw_seed_us_iran_il_5', name: '伊朗' },
    ]
    const insertKw = db.prepare(`
      INSERT OR IGNORE INTO keywords (
        id, name, group_id, group_name, regions_json, alert_threshold, status,
        today_count, last_checked, latest_article_title, latest_article_title_en,
        latest_article_url, latest_article_source, sentiment_history_json,
        seen_article_ids_json, custom_prompt,
        topic_importance_threshold, topic_negative_sentiment_threshold,
        created_at, updated_at
      ) VALUES (
        @id, @name, 'group_seed_us_iran_israel', '美伊冲突', '[]', 0.3, 'normal',
        0, NULL, NULL, NULL, NULL, NULL, '[]', '[]', '',
        6, 0.4, @now, @now
      )
    `)
    const insertMany = db.transaction(() => {
      for (const kw of seedKeywords) insertKw.run({ id: kw.id, name: kw.name, now })
    })
    insertMany()
  }

  dbInstance = db
  return db
}

export function initDataStore() {
  getDb()
}

// ── Keywords ─────────────────────────────────────────────────────────
export function getKeywords(): Keyword[] {
  const db = getDb()
  const rows = db
    .prepare(
      `
        SELECT
          id,
          name,
          group_id,
          group_name,
          regions_json,
          alert_threshold,
          status,
          today_count,
          today_count_date,
          last_checked,
          latest_article_title,
          latest_article_title_en,
          latest_article_url,
          latest_article_source,
          sentiment_history_json,
          seen_article_ids_json,
          custom_prompt,
          topic_importance_threshold,
          topic_negative_sentiment_threshold
        FROM keywords
        ORDER BY updated_at DESC, created_at DESC
      `
    )
    .all() as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    groupId: String(row.group_id),
    groupName: String(row.group_name),
    regions: parseJsonArray<string>(row.regions_json),
    alertThreshold: Number(row.alert_threshold),
    status: String(row.status) as Keyword['status'],
    todayCount: Number(row.today_count ?? 0),
    todayCountDate: row.today_count_date ? String(row.today_count_date) : undefined,
    lastChecked: row.last_checked ? String(row.last_checked) : null,
    latestArticleTitle: row.latest_article_title ? String(row.latest_article_title) : null,
    latestArticleTitleEn: row.latest_article_title_en ? String(row.latest_article_title_en) : null,
    latestArticleUrl: row.latest_article_url ? String(row.latest_article_url) : null,
    latestArticleSource: row.latest_article_source ? String(row.latest_article_source) : null,
    sentimentHistory: parseJsonArray<number>(row.sentiment_history_json),
    seenArticleIds: parseJsonArray<number>(row.seen_article_ids_json),
    customPrompt: row.custom_prompt ? String(row.custom_prompt) : '',
    topicImportanceThreshold: row.topic_importance_threshold != null ? Number(row.topic_importance_threshold) : null,
    topicNegativeSentimentThreshold: row.topic_negative_sentiment_threshold != null ? Number(row.topic_negative_sentiment_threshold) : null
  }))
}

export function saveKeyword(keyword: Keyword) {
  const db = getDb()
  const now = nowIso()
  const normalized = normalizeKeyword(keyword)

  db.prepare(
    `
      INSERT INTO keywords (
        id,
        name,
        group_id,
        group_name,
        regions_json,
        alert_threshold,
        status,
        today_count,
        today_count_date,
        last_checked,
        latest_article_title,
        latest_article_title_en,
        latest_article_url,
        latest_article_source,
        sentiment_history_json,
        seen_article_ids_json,
        custom_prompt,
        topic_importance_threshold,
        topic_negative_sentiment_threshold,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @name,
        @groupId,
        @groupName,
        @regions,
        @alertThreshold,
        @status,
        @todayCount,
        @todayCountDate,
        @lastChecked,
        @latestArticleTitle,
        @latestArticleTitleEn,
        @latestArticleUrl,
        @latestArticleSource,
        @sentimentHistory,
        @seenArticleIds,
        @customPrompt,
        @topicImportanceThreshold,
        @topicNegativeSentimentThreshold,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        group_id = excluded.group_id,
        group_name = excluded.group_name,
        regions_json = excluded.regions_json,
        alert_threshold = excluded.alert_threshold,
        status = excluded.status,
        today_count = excluded.today_count,
        today_count_date = excluded.today_count_date,
        last_checked = excluded.last_checked,
        latest_article_title = excluded.latest_article_title,
        latest_article_title_en = excluded.latest_article_title_en,
        latest_article_url = excluded.latest_article_url,
        latest_article_source = excluded.latest_article_source,
        sentiment_history_json = excluded.sentiment_history_json,
        seen_article_ids_json = excluded.seen_article_ids_json,
        custom_prompt = excluded.custom_prompt,
        topic_importance_threshold = excluded.topic_importance_threshold,
        topic_negative_sentiment_threshold = excluded.topic_negative_sentiment_threshold,
        updated_at = excluded.updated_at
    `
  ).run({
    id: normalized.id,
    name: normalized.name,
    groupId: normalized.groupId,
    groupName: normalized.groupName,
    regions: serializeJson(normalized.regions),
    alertThreshold: normalized.alertThreshold,
    status: normalized.status,
    todayCount: normalized.todayCount,
    todayCountDate: normalized.todayCountDate ?? null,
    lastChecked: normalized.lastChecked,
    latestArticleTitle: normalized.latestArticleTitle,
    latestArticleTitleEn: normalized.latestArticleTitleEn ?? null,
    latestArticleUrl: normalized.latestArticleUrl,
    latestArticleSource: normalized.latestArticleSource,
    sentimentHistory: serializeJson(normalized.sentimentHistory),
    seenArticleIds: serializeJson(normalized.seenArticleIds),
    customPrompt: normalized.customPrompt,
    topicImportanceThreshold: normalized.topicImportanceThreshold ?? null,
    topicNegativeSentimentThreshold: normalized.topicNegativeSentimentThreshold ?? null,
    createdAt: now,
    updatedAt: now
  })
}

export function saveKeywordsBatch(keywords: Keyword[]) {
  const db = getDb()
  const tx = db.transaction((items: Keyword[]) => {
    for (const keyword of items) {
      saveKeyword(keyword)
    }
  })
  tx(keywords)
}

export function deleteKeyword(keywordId: string) {
  const db = getDb()
  db.prepare('DELETE FROM keywords WHERE id = ?').run(keywordId)
}

export function toggleKeywordPause(keywordId: string) {
  const db = getDb()
  const row = db
    .prepare('SELECT status FROM keywords WHERE id = ?')
    .get(keywordId) as { status?: string } | undefined

  if (!row?.status) return
  const nextStatus = row.status === 'paused' ? 'normal' : 'paused'
  db.prepare('UPDATE keywords SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, nowIso(), keywordId)
}

// ── Articles + Alerts ───────────────────────────────────────────────
function upsertArticleSnapshot(article: TopicRunArticle) {
  const db = getDb()
  const raw = article._raw ?? {}
  const entities = Array.isArray(raw.entities) ? raw.entities : []
  const highlight = raw.highlight ?? null
  const sourceCreatedAt = toIsoString(raw.createdAt)
  const scoreRaw = raw.score == null ? null : String(raw.score)

  db.prepare(
    `
      INSERT INTO articles (
        freenews_id,
        url,
        source_code,
        source_name,
        language,
        title,
        title_zh,
        title_en,
        summary,
        summary_zh,
        summary_en,
        keywords_zh_json,
        keywords_en_json,
        categories_json,
        entities_json,
        sentiment_label,
        sentiment_score,
        importance_score,
        published_at,
        source_created_at,
        score_raw,
        highlight_raw_json,
        raw_json,
        first_seen_at,
        last_seen_at
      ) VALUES (
        @freenewsId,
        @url,
        @sourceCode,
        @sourceName,
        @language,
        @title,
        @titleZh,
        @titleEn,
        @summary,
        @summaryZh,
        @summaryEn,
        @keywordsZh,
        @keywordsEn,
        @categories,
        @entities,
        @sentimentLabel,
        @sentimentScore,
        @importanceScore,
        @publishedAt,
        @sourceCreatedAt,
        @scoreRaw,
        @highlight,
        @raw,
        @firstSeenAt,
        @lastSeenAt
      )
      ON CONFLICT(freenews_id) DO UPDATE SET
        url = excluded.url,
        source_code = excluded.source_code,
        source_name = excluded.source_name,
        language = excluded.language,
        title = excluded.title,
        title_zh = excluded.title_zh,
        title_en = excluded.title_en,
        summary = excluded.summary,
        summary_zh = excluded.summary_zh,
        summary_en = excluded.summary_en,
        keywords_zh_json = excluded.keywords_zh_json,
        keywords_en_json = excluded.keywords_en_json,
        categories_json = excluded.categories_json,
        entities_json = excluded.entities_json,
        sentiment_label = excluded.sentiment_label,
        sentiment_score = excluded.sentiment_score,
        importance_score = excluded.importance_score,
        published_at = excluded.published_at,
        source_created_at = excluded.source_created_at,
        score_raw = excluded.score_raw,
        highlight_raw_json = excluded.highlight_raw_json,
        raw_json = excluded.raw_json,
        last_seen_at = excluded.last_seen_at
    `
  ).run({
    freenewsId: article.id,
    url: article.url,
    sourceCode: article.sourceCode,
    sourceName: article.sourceName,
    language: article.language,
    title: article.title,
    titleZh: article.titleZh,
    titleEn: article.titleEn,
    summary: article.summary,
    summaryZh: article.summaryZh,
    summaryEn: article.summaryEn,
    keywordsZh: serializeJson(article.keywordsZh ?? []),
    keywordsEn: serializeJson(article.keywordsEn ?? []),
    categories: serializeJson(article.categories ?? []),
    entities: serializeJson(entities),
    sentimentLabel: article.sentimentLabel,
    sentimentScore: article.sentimentScore,
    importanceScore: article.importanceScore,
    publishedAt: article.publishedAt,
    sourceCreatedAt,
    scoreRaw,
    highlight: serializeJson(highlight),
    raw: serializeJson(raw),
    firstSeenAt: nowIso(),
    lastSeenAt: nowIso()
  })
}

function mapRelatedArticleRow(row: Record<string, unknown>): AlertRelatedArticle {
  return {
    id: row.article_id == null ? null : Number(row.article_id),
    title: String(row.title),
    titleZh: row.title_zh ? String(row.title_zh) : null,
    titleEn: row.title_en ? String(row.title_en) : null,
    url: String(row.url),
    sourceName: String(row.source_name ?? ''),
    publishedAt: row.published_at ? String(row.published_at) : null,
    summary: row.summary ? String(row.summary) : null,
    summaryZh: row.summary_zh ? String(row.summary_zh) : null,
    summaryEn: row.summary_en ? String(row.summary_en) : null,
    sentimentScore: row.sentiment_score == null ? null : Number(row.sentiment_score),
    sentimentLabel: row.sentiment_label ? String(row.sentiment_label) : null,
    importanceScore: row.importance_score == null ? null : Number(row.importance_score),
    keywordsZh: parseJsonArray<string>(row.keywords_zh_json),
    keywordsEn: parseJsonArray<string>(row.keywords_en_json),
    _raw: parseJsonObject(row.raw_json)
  }
}

export function getAlerts(): Alert[] {
  const db = getDb()
  const alertRows = db
    .prepare(
      `
        SELECT
          id,
          topic_id,
          topic_name,
          severity,
          reason,
          reason_en,
          article_id,
          article_title,
          article_title_zh,
          article_title_en,
          article_url,
          article_source,
          article_published_at,
          article_summary,
          article_summary_zh,
          article_summary_en,
          article_importance,
          query_expression,
          sentiment_score,
          sentiment_label,
          ai_reasoning,
          ai_impact,
          ai_impact_direction,
          ai_urgency,
          ai_relevance,
          timestamp,
          is_read
        FROM alerts
        ORDER BY timestamp DESC
      `
    )
    .all() as Array<Record<string, unknown>>

  const relatedStmt = db.prepare(
    `
      SELECT
        alert_id,
        sort_order,
        article_id,
        title,
        title_zh,
        title_en,
        url,
        source_name,
        published_at,
        summary,
        summary_zh,
        summary_en,
        sentiment_score,
        sentiment_label,
        importance_score,
        keywords_zh_json,
        keywords_en_json,
        raw_json
      FROM alert_related_articles
      WHERE alert_id = ?
      ORDER BY sort_order ASC
    `
  )

  return alertRows.map((row) => ({
    id: String(row.id),
    keywordId: String(row.topic_id),
    keywordName: String(row.topic_name),
    severity: String(row.severity) as Alert['severity'],
    reason: String(row.reason),
    reasonEn: row.reason_en ? String(row.reason_en) : null,
    articleTitle: String(row.article_title),
    articleTitleZh: row.article_title_zh ? String(row.article_title_zh) : null,
    articleTitleEn: row.article_title_en ? String(row.article_title_en) : null,
    articleUrl: String(row.article_url),
    articleSource: row.article_source ? String(row.article_source) : null,
    articlePublishedAt: row.article_published_at ? String(row.article_published_at) : null,
    articleSummary: row.article_summary ? String(row.article_summary) : null,
    articleSummaryZh: row.article_summary_zh ? String(row.article_summary_zh) : null,
    articleSummaryEn: row.article_summary_en ? String(row.article_summary_en) : null,
    queryExpression: row.query_expression ? String(row.query_expression) : null,
    sentimentScore: row.sentiment_score == null ? null : Number(row.sentiment_score),
    sentimentLabel: row.sentiment_label ? String(row.sentiment_label) : null,
    aiReasoning: row.ai_reasoning ? String(row.ai_reasoning) : null,
    aiImpact: row.ai_impact == null ? null : Number(row.ai_impact),
    aiImpactDirection:
      row.ai_impact_direction == null
        ? null
        : (String(row.ai_impact_direction) as Alert['aiImpactDirection']),
    aiUrgency: row.ai_urgency == null ? null : (String(row.ai_urgency) as Alert['aiUrgency']),
    aiRelevance: row.ai_relevance == null ? null : Number(row.ai_relevance),
    articleImportance: row.article_importance == null ? null : Number(row.article_importance),
    relatedArticles: (relatedStmt.all(row.id) as Array<Record<string, unknown>>).map((item) =>
      mapRelatedArticleRow(item)
    ),
    timestamp: String(row.timestamp),
    read: Number(row.is_read) === 1
  }))
}

function cleanupAlerts() {
  const db = getDb()
  db.prepare(
    `
      DELETE FROM alerts
      WHERE id NOT IN (
        SELECT id FROM alerts
        ORDER BY timestamp DESC
        LIMIT ${ALERT_LIMIT}
      )
    `
  ).run()
}

export function insertAlert(alert: Alert) {
  const db = getDb()
  const tx = db.transaction((record: Alert) => {
    db.prepare(
      `
        INSERT OR REPLACE INTO alerts (
          id,
          topic_id,
          topic_name,
          severity,
          reason,
          reason_en,
          article_id,
          article_title,
          article_title_zh,
          article_title_en,
          article_url,
          article_source,
          article_published_at,
          article_summary,
          article_summary_zh,
          article_summary_en,
          article_importance,
          query_expression,
          sentiment_score,
          sentiment_label,
          ai_reasoning,
          ai_impact,
          ai_impact_direction,
          ai_urgency,
          ai_relevance,
          timestamp,
          is_read
        ) VALUES (
          @id,
          @topicId,
          @topicName,
          @severity,
          @reason,
          @reasonEn,
          @articleId,
          @articleTitle,
          @articleTitleZh,
          @articleTitleEn,
          @articleUrl,
          @articleSource,
          @articlePublishedAt,
          @articleSummary,
          @articleSummaryZh,
          @articleSummaryEn,
          @articleImportance,
          @queryExpression,
          @sentimentScore,
          @sentimentLabel,
          @aiReasoning,
          @aiImpact,
          @aiImpactDirection,
          @aiUrgency,
          @aiRelevance,
          @timestamp,
          @isRead
        )
      `
    ).run({
      id: record.id,
      topicId: record.keywordId,
      topicName: record.keywordName,
      severity: record.severity,
      reason: record.reason,
      reasonEn: record.reasonEn ?? null,
      articleId: null,
      articleTitle: record.articleTitle,
      articleTitleZh: record.articleTitleZh,
      articleTitleEn: record.articleTitleEn,
      articleUrl: record.articleUrl,
      articleSource: record.articleSource,
      articlePublishedAt: record.articlePublishedAt,
      articleSummary: record.articleSummary,
      articleSummaryZh: record.articleSummaryZh,
      articleSummaryEn: record.articleSummaryEn,
      articleImportance: record.articleImportance,
      queryExpression: record.queryExpression,
      sentimentScore: record.sentimentScore,
      sentimentLabel: record.sentimentLabel,
      aiReasoning: record.aiReasoning,
      aiImpact: record.aiImpact,
      aiImpactDirection: record.aiImpactDirection,
      aiUrgency: record.aiUrgency,
      aiRelevance: record.aiRelevance,
      timestamp: record.timestamp,
      isRead: record.read ? 1 : 0
    })

    db.prepare('DELETE FROM alert_related_articles WHERE alert_id = ?').run(record.id)

    const insertRelated = db.prepare(
      `
        INSERT INTO alert_related_articles (
          alert_id,
          sort_order,
          article_id,
          title,
          title_zh,
          title_en,
          url,
          source_name,
          published_at,
          summary,
          summary_zh,
          summary_en,
          sentiment_score,
          sentiment_label,
          importance_score,
          keywords_zh_json,
          keywords_en_json,
          raw_json
        ) VALUES (
          @alertId,
          @sortOrder,
          @articleId,
          @title,
          @titleZh,
          @titleEn,
          @url,
          @sourceName,
          @publishedAt,
          @summary,
          @summaryZh,
          @summaryEn,
          @sentimentScore,
          @sentimentLabel,
          @importanceScore,
          @keywordsZh,
          @keywordsEn,
          @rawJson
        )
      `
    )

    record.relatedArticles.forEach((item, index) => {
      insertRelated.run({
        alertId: record.id,
        sortOrder: index,
        articleId: item.id,
        title: item.title,
        titleZh: item.titleZh,
        titleEn: item.titleEn,
        url: item.url,
        sourceName: item.sourceName,
        publishedAt: item.publishedAt,
        summary: item.summary,
        summaryZh: item.summaryZh,
        summaryEn: item.summaryEn,
        sentimentScore: item.sentimentScore,
        sentimentLabel: item.sentimentLabel,
        importanceScore: item.importanceScore,
        keywordsZh: serializeJson(item.keywordsZh ?? []),
        keywordsEn: serializeJson(item.keywordsEn ?? []),
        rawJson: serializeJson(item._raw ?? null)
      })
    })

    cleanupAlerts()
  })

  tx(alert)
}

export function markAlertRead(alertId: string) {
  getDb().prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(alertId)
}

export function markAlertUnread(alertId: string) {
  getDb().prepare('UPDATE alerts SET is_read = 0 WHERE id = ?').run(alertId)
}

export function markAllAlertsRead() {
  getDb().prepare('UPDATE alerts SET is_read = 1 WHERE is_read = 0').run()
}

export function clearAlerts() {
  getDb().prepare('DELETE FROM alerts').run()
}

// ── Monitor runs ─────────────────────────────────────────────────────
function mapRunArticleRow(row: Record<string, unknown>): TopicRunArticle {
  return {
    id: Number(row.freenews_id),
    title: String(row.title),
    titleZh: row.title_zh ? String(row.title_zh) : null,
    titleEn: row.title_en ? String(row.title_en) : null,
    url: String(row.url),
    sourceCode: row.source_code ? String(row.source_code) : null,
    sourceName: String(row.source_name ?? ''),
    language: row.language ? String(row.language) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    summary: row.summary ? String(row.summary) : null,
    summaryZh: row.summary_zh ? String(row.summary_zh) : null,
    summaryEn: row.summary_en ? String(row.summary_en) : null,
    sentimentScore: row.sentiment_score == null ? null : Number(row.sentiment_score),
    sentimentLabel: row.sentiment_label ? String(row.sentiment_label) : null,
    importanceScore: row.importance_score == null ? null : Number(row.importance_score),
    keywordsZh: parseJsonArray<string>(row.keywords_zh_json),
    keywordsEn: parseJsonArray<string>(row.keywords_en_json),
    categories: parseJsonArray<string>(row.categories_json),
    aiReasoning: row.ai_reasoning ? String(row.ai_reasoning) : null,
    aiImpact: row.ai_impact_score == null ? null : Number(row.ai_impact_score),
    aiImpactDirection:
      row.ai_impact_direction == null
        ? null
        : (String(row.ai_impact_direction) as TopicRunArticle['aiImpactDirection']),
    aiUrgency: row.ai_urgency == null ? null : (String(row.ai_urgency) as TopicRunArticle['aiUrgency']),
    aiRelevance: row.ai_relevance_score == null ? null : Number(row.ai_relevance_score),
    triggerAlert: Number(row.trigger_alert) === 1,
    _raw: parseJsonObject(row.raw_json)
  }
}

export function getTopicRuns(): TopicRunRecord[] {
  const db = getDb()
  const runRows = db
    .prepare(
      `
        SELECT
          id,
          topic_id,
          topic_name,
          checked_at,
          query_expression,
          article_count,
          new_article_count,
          ai_evaluated_count,
          sampled_article_count,
          status,
          matched_regions_json,
          triggered,
          alert_id,
          latest_article_title,
          latest_article_title_en,
          latest_article_url,
          latest_article_source,
          reason
        FROM monitor_runs
        ORDER BY checked_at DESC
        LIMIT ${RUN_LIMIT}
      `
    )
    .all() as Array<Record<string, unknown>>

  const runArticleStmt = db.prepare(
    `
      SELECT
        ra.run_id,
        ra.sort_order,
        ra.trigger_alert,
        ra.ai_reasoning,
        ra.ai_sentiment_score,
        ra.ai_relevance_score,
        ra.ai_impact_score,
        ra.ai_impact_direction,
        ra.ai_urgency,
        a.freenews_id,
        a.title,
        a.title_zh,
        a.title_en,
        a.url,
        a.source_code,
        a.source_name,
        a.language,
        a.published_at,
        a.summary,
        a.summary_zh,
        a.summary_en,
        a.sentiment_score,
        a.sentiment_label,
        a.importance_score,
        a.keywords_zh_json,
        a.keywords_en_json,
        a.categories_json,
        a.raw_json
      FROM run_articles ra
      INNER JOIN articles a ON a.freenews_id = ra.article_id
      WHERE ra.run_id = ?
      ORDER BY ra.sort_order ASC
    `
  )

  return runRows.map((row) => ({
    id: String(row.id),
    groupId: String(row.topic_id),
    groupName: String(row.topic_name),
    checkedAt: String(row.checked_at),
    queryExpression: String(row.query_expression),
    articleCount: Number(row.article_count ?? 0),
    newArticleCount: Number(row.new_article_count ?? 0),
    aiEvaluatedCount: Number(row.ai_evaluated_count ?? 0),
    sampledArticleCount: Number(row.sampled_article_count ?? 0),
    status: String(row.status) as Keyword['status'],
    matchedRegions: parseJsonArray<string>(row.matched_regions_json),
    triggered: Number(row.triggered) === 1,
    alertId: row.alert_id ? String(row.alert_id) : null,
    latestArticleTitle: row.latest_article_title ? String(row.latest_article_title) : null,
    latestArticleTitleEn: row.latest_article_title_en ? String(row.latest_article_title_en) : null,
    latestArticleUrl: row.latest_article_url ? String(row.latest_article_url) : null,
    latestArticleSource: row.latest_article_source ? String(row.latest_article_source) : null,
    reason: row.reason ? String(row.reason) : null,
    recentArticles: (runArticleStmt.all(row.id) as Array<Record<string, unknown>>).map((item) =>
      mapRunArticleRow(item)
    )
  }))
}

function cleanupRuns() {
  const db = getDb()
  db.prepare(
    `
      DELETE FROM monitor_runs
      WHERE id NOT IN (
        SELECT id FROM monitor_runs
        ORDER BY checked_at DESC
        LIMIT ${RUN_LIMIT}
      )
    `
  ).run()
}

export function insertTopicRun(
  run: TopicRunRecord,
  options?: {
    decisionMode?: string
    prescreenEnabled?: boolean
    prescreenThreshold?: number | null
    newArticleIds?: number[]
  }
) {
  const db = getDb()

  const tx = db.transaction((record: TopicRunRecord) => {
    db.prepare(
      `
        INSERT OR REPLACE INTO monitor_runs (
          id,
          topic_id,
          topic_name,
          checked_at,
          query_expression,
          article_count,
          new_article_count,
          ai_evaluated_count,
          sampled_article_count,
          status,
          matched_regions_json,
          triggered,
          alert_id,
          latest_article_title,
          latest_article_title_en,
          latest_article_url,
          latest_article_source,
          reason,
          decision_mode,
          prescreen_enabled,
          prescreen_threshold,
          created_at
        ) VALUES (
          @id,
          @topicId,
          @topicName,
          @checkedAt,
          @queryExpression,
          @articleCount,
          @newArticleCount,
          @aiEvaluatedCount,
          @sampledArticleCount,
          @status,
          @matchedRegions,
          @triggered,
          @alertId,
          @latestArticleTitle,
          @latestArticleTitleEn,
          @latestArticleUrl,
          @latestArticleSource,
          @reason,
          @decisionMode,
          @prescreenEnabled,
          @prescreenThreshold,
          @createdAt
        )
      `
    ).run({
      id: record.id,
      topicId: record.groupId,
      topicName: record.groupName,
      checkedAt: record.checkedAt,
      queryExpression: record.queryExpression,
      articleCount: record.articleCount,
      newArticleCount: record.newArticleCount,
      aiEvaluatedCount: record.aiEvaluatedCount ?? 0,
      sampledArticleCount: record.sampledArticleCount ?? 0,
      status: record.status,
      matchedRegions: serializeJson(record.matchedRegions ?? []),
      triggered: record.triggered ? 1 : 0,
      alertId: record.alertId,
      latestArticleTitle: record.latestArticleTitle,
      latestArticleTitleEn: record.latestArticleTitleEn ?? null,
      latestArticleUrl: record.latestArticleUrl,
      latestArticleSource: record.latestArticleSource,
      reason: record.reason,
      decisionMode: options?.decisionMode ?? 'hybrid',
      prescreenEnabled: options?.prescreenEnabled ? 1 : 0,
      prescreenThreshold: options?.prescreenThreshold ?? null,
      createdAt: nowIso()
    })

    db.prepare('DELETE FROM run_articles WHERE run_id = ?').run(record.id)
    const insertRunArticle = db.prepare(
      `
        INSERT INTO run_articles (
          run_id,
          topic_id,
          article_id,
          sort_order,
          is_new,
          trigger_alert,
          decision_source,
          ai_reasoning,
          ai_sentiment_score,
          ai_relevance_score,
          ai_impact_score,
          ai_impact_direction,
          ai_urgency,
          created_at
        ) VALUES (
          @runId,
          @topicId,
          @articleId,
          @sortOrder,
          @isNew,
          @triggerAlert,
          @decisionSource,
          @aiReasoning,
          @aiSentimentScore,
          @aiRelevance,
          @aiImpact,
          @aiImpactDirection,
          @aiUrgency,
          @createdAt
        )
      `
    )

    const newIdSet = new Set(options?.newArticleIds ?? [])
    ;(record.recentArticles ?? []).forEach((article, index) => {
      upsertArticleSnapshot(article)

      const decisionSource =
        article.aiReasoning != null && article.aiReasoning.trim()
          ? 'llm'
          : article.triggerAlert
            ? 'threshold'
            : 'none'

      insertRunArticle.run({
        runId: record.id,
        topicId: record.groupId,
        articleId: article.id,
        sortOrder: index,
        isNew: newIdSet.has(article.id) ? 1 : 0,
        triggerAlert: article.triggerAlert ? 1 : 0,
        decisionSource,
        aiReasoning: article.aiReasoning,
        aiSentimentScore: null,
        aiRelevance: article.aiRelevance,
        aiImpact: article.aiImpact,
        aiImpactDirection: article.aiImpactDirection,
        aiUrgency: article.aiUrgency,
        createdAt: nowIso()
      })
    })

    cleanupRuns()
  })

  tx(run)
}

// ── Briefs + Stats ──────────────────────────────────────────────────
export function getBriefs(): Brief[] {
  const db = getDb()
  const rows = db
    .prepare(
      `
        SELECT
          id,
          keywords_json,
          topic_ids_json,
          topics_json,
          date_range,
          auto_generated,
          generated_at,
          content
        FROM briefs
        ORDER BY generated_at DESC
        LIMIT ${BRIEF_LIMIT}
      `
    )
    .all() as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: String(row.id),
    keywords: parseJsonArray<string>(row.keywords_json),
    topicIds: parseJsonArray<string>(row.topic_ids_json),
    topics: parseJsonArray<string>(row.topics_json),
    dateRange: row.date_range ? String(row.date_range) : undefined,
    autoGenerated: Number(row.auto_generated) === 1,
    generatedAt: String(row.generated_at),
    content: String(row.content)
  }))
}

function cleanupBriefs() {
  const db = getDb()
  db.prepare(
    `
      DELETE FROM briefs
      WHERE id NOT IN (
        SELECT id FROM briefs
        ORDER BY generated_at DESC
        LIMIT ${BRIEF_LIMIT}
      )
    `
  ).run()
}

export function saveBrief(brief: Brief) {
  const db = getDb()
  db.prepare(
    `
      INSERT OR REPLACE INTO briefs (
        id,
        keywords_json,
        topic_ids_json,
        topics_json,
        date_range,
        auto_generated,
        generated_at,
        content,
        created_at
      ) VALUES (
        @id,
        @keywords,
        @topicIds,
        @topics,
        @dateRange,
        @autoGenerated,
        @generatedAt,
        @content,
        @createdAt
      )
    `
  ).run({
    id: brief.id,
    keywords: serializeJson(brief.keywords ?? []),
    topicIds: serializeJson(brief.topicIds ?? []),
    topics: serializeJson(brief.topics ?? []),
    dateRange: brief.dateRange ?? null,
    autoGenerated: brief.autoGenerated ? 1 : 0,
    generatedAt: brief.generatedAt,
    content: brief.content,
    createdAt: nowIso()
  })

  cleanupBriefs()
}

export function getStats() {
  const db = getDb()
  const today = new Date().toDateString()
  const todayKey = getTodayKey()

  const totalKeywords = Number(
    (db.prepare('SELECT COUNT(*) as total FROM keywords').get() as { total: number }).total
  )
  const activeKeywords = Number(
    (db.prepare("SELECT COUNT(*) as total FROM keywords WHERE status != 'paused'").get() as {
      total: number
    }).total
  )
  const todayNews = Number(
    (db
      .prepare('SELECT COALESCE(SUM(today_count), 0) as total FROM keywords WHERE today_count_date = ?')
      .get(todayKey) as { total: number }).total
  )
  const totalBriefs = Number(
    (db.prepare('SELECT COUNT(*) as total FROM briefs').get() as { total: number }).total
  )
  const unreadAlerts = Number(
    (db.prepare('SELECT COUNT(*) as total FROM alerts WHERE is_read = 0').get() as { total: number }).total
  )

  const alerts = db
    .prepare('SELECT timestamp FROM alerts ORDER BY timestamp DESC LIMIT ?')
    .all(ALERT_LIMIT) as Array<{ timestamp: string }>

  const todayAlerts = alerts.filter((alert) => new Date(alert.timestamp).toDateString() === today).length

  return {
    totalKeywords,
    activeKeywords,
    todayNews,
    todayAlerts,
    totalBriefs,
    unreadAlerts
  }
}
