/**
 * 统一时间格式化工具
 * 全项目共用，避免各页面写不同逻辑导致同一时间显示不一致
 */

/** 相对时间：刚刚 / 3 分钟前 / 2 小时前 / 1 天前 */
export function relativeTime(iso: string | null | undefined, suffix = ''): string {
  if (!iso) return suffix ? `尚未${suffix}` : '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return suffix ? `刚刚${suffix}` : '刚刚'
  if (m < 60) return `${m} 分钟前${suffix}`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前${suffix}`
  const d = Math.floor(h / 24)
  return `${d} 天前${suffix}`
}

/**
 * 用户配置的时区，全局共享
 * 在 App 初始化时通过 setGlobalTimezone 设定，默认北京时间
 */
let _globalTimezone = 'Asia/Shanghai'
export function setGlobalTimezone(tz: string) {
  _globalTimezone = tz
}
export function getGlobalTimezone() {
  return _globalTimezone
}

/**
 * 精确短时间：04-06 18:24
 * 按用户配置的时区显示
 */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: _globalTimezone
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/**
 * 返回 YYYY-MM-DD 字符串（按用户选定时区计算），用于"今天/昨天"等日期比较。
 * Return a YYYY-MM-DD key in the user-selected timezone, for today/yesterday comparisons.
 */
export function dateKeyInUserTz(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: _globalTimezone
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * 完整时间：2026-04-06 18:24:03
 * 按用户配置的时区显示
 */
export function fullTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: _globalTimezone
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

/** 情感颜色 */
export function sentimentColor(val: number): string {
  if (val >= 0.6) return 'var(--green)'
  if (val >= 0.4) return 'var(--amber)'
  if (val >= 0.2) return 'var(--orange)'
  return 'var(--red)'
}

/** 情感英转中 */
const SENTIMENT_ZH: Record<string, string> = {
  positive: '积极',
  negative: '消极',
  neutral: '中性',
  mixed: '复杂',
  'very positive': '非常积极',
  'very negative': '非常消极',
  'slightly positive': '偏积极',
  'slightly negative': '偏消极'
}

const SENTIMENT_EN: Record<string, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
  mixed: 'Mixed',
  'very positive': 'Very positive',
  'very negative': 'Very negative',
  'slightly positive': 'Slightly positive',
  'slightly negative': 'Slightly negative'
}

export function sentimentZh(label: string | null | undefined): string | null {
  if (!label) return null
  return SENTIMENT_ZH[label.toLowerCase()] ?? label
}

/** 按语言返回情感标签 */
export function sentimentLocalized(label: string | null | undefined, lang: 'zh' | 'en'): string | null {
  if (!label) return null
  const map = lang === 'zh' ? SENTIMENT_ZH : SENTIMENT_EN
  return map[label.toLowerCase()] ?? label
}

/**
 * Tier the backend importanceScore (1~10) into a visual bucket.
 * 把后端 importanceScore (1~10) 分成三档可视化色阶。
 */
export function importanceTier(score: number | null | undefined): 'high' | 'mid' | 'low' | null {
  if (score === null || score === undefined) return null
  if (!Number.isFinite(score)) return null
  if (score >= 7) return 'high'
  if (score >= 5) return 'mid'
  return 'low'
}
